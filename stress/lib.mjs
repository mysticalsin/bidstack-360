import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { deflateRawSync } from 'node:zlib';

export const API = process.env.STRESS_API ?? 'http://127.0.0.1:4000';
export const REDIS_PORT = process.env.STRESS_REDIS_PORT ?? '6380';
export const PG = {
  host: '127.0.0.1',
  user: 'bidstack',
  db: 'bidstack',
};

/** Hard caps. The watchdog kills a process that crosses its RSS cap. */
export const CAPS = {
  hardTimeoutMs: Number(process.env.STRESS_HARD_TIMEOUT_MS ?? 50 * 60 * 1000),
  apiRss: 900 * 1024 * 1024,
  workerRss: 640 * 1024 * 1024,
  webRss: 800 * 1024 * 1024,
  harnessRss: 450 * 1024 * 1024,
  soakSeconds: Number(process.env.STRESS_SOAK_SECONDS ?? 1800),
  soakWarmupSeconds: 120,
  soakRssGrowth: 0.1,
  readP95Ms: 300,
  readP99Ms: 1000,
  writeP95Ms: 500,
  csvWorkerRss: 512 * 1024 * 1024,
  recoveryMs: 10_000,
  faultDownMs: 30_000,
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function psql(sql) {
  return execFileSync(
    'psql',
    ['-h', PG.host, '-U', PG.user, '-d', PG.db, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql],
    { env: { ...process.env, PGPASSWORD: 'bidstack' }, encoding: 'utf8' },
  ).trim();
}

export function psqlFile(sql) {
  return psql(sql);
}

export function redis(args) {
  return execFileSync('redis-cli', ['-p', REDIS_PORT, ...args], { encoding: 'utf8' }).trim();
}

export function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Fresh RSS read. A dead pid is null, never the previous sample. */
export function rssBytes(pid) {
  if (!alive(pid)) return null;
  try {
    const text = readFileSync(`/proc/${pid}/status`, 'utf8');
    const line = text.split('\n').find((row) => row.startsWith('VmRSS:'));
    if (!line) return null;
    const kb = Number(line.split(/\s+/)[1]);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch {
    return null;
  }
}

export function listeningPid(port) {
  const hex = Number(port).toString(16).toUpperCase().padStart(4, '0');
  let inode = null;
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      if (!(parts[1] ?? '').endsWith(':' + hex) || parts[3] !== '0A') continue;
      inode = parts[9];
      break;
    }
    if (inode) break;
  }
  if (!inode || inode === '0') return null;
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let fds;
    try {
      fds = readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        if (readlinkSync(`/proc/${entry}/fd/${fd}`) === `socket:[${inode}]`) return Number(entry);
      } catch {
        // raced
      }
    }
  }
  return null;
}

export async function waitFor(fn, timeoutMs, stepMs = 200) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(stepMs);
  }
  return last;
}

export async function http(method, path, { body, headers, timeoutMs = 15_000, base = API } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, ms: Math.round(performance.now() - start), text: text.slice(0, 500), json };
  } catch (err) {
    return {
      status: 0,
      ms: Math.round(performance.now() - start),
      text: err instanceof Error ? err.name + ':' + err.message : String(err),
      json: null,
      aborted: ac.signal.aborted,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** A tiny zip whose one entry inflates to `bytes` of the letter A. */
export function zipBomb(bytes) {
  const name = 'xl/worksheets/sheet1.xml';
  const raw = Buffer.alloc(bytes, 0x41);
  const compressed = deflateRawSync(raw, { level: 9 });
  const crc = crc32(raw);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  const centralLen = central.length + nameBuf.length;
  eocd.writeUInt32LE(centralLen, 12);
  const offset = local.length + nameBuf.length + compressed.length;
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([local, nameBuf, compressed, central, nameBuf, eocd]);
}

export function holdAdvisory(id = 481516234) {
  const child = spawn(
    'psql',
    ['-h', PG.host, '-U', PG.user, '-d', PG.db, '-v', 'ON_ERROR_STOP=1'],
    { env: { ...process.env, PGPASSWORD: 'bidstack' }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    buf += chunk.toString();
  });
  child.stdin.write(`SELECT pg_advisory_lock(${id});\n`);
  const ready = (async () => {
    const start = Date.now();
    while (Date.now() - start < 8_000) {
      if (buf.includes('(1 row)')) return;
      await sleep(30);
    }
    throw new Error('advisory lock was not acquired: ' + buf.slice(0, 300));
  })();
  return {
    ready,
    async release() {
      child.stdin.write(`SELECT pg_advisory_unlock(${id});\n\\q\n`);
      await new Promise((resolve) => child.once('close', resolve));
    },
  };
}

export function fileHash(rows) {
  const canonical = rows.map((row) => {
    const ordered = {};
    for (const key of Object.keys(row).sort()) ordered[key] = row[key] ?? '';
    return ordered;
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function csvRow(name) {
  return {
    source: 'CSV',
    entityType: 'companies',
    rows: [{ Name: name }],
    mappings: { Name: 'company.name' },
    dedupStrategy: 'skip',
  };
}

export function messageOf(res) {
  const msg = res.json && typeof res.json === 'object' ? res.json.message : null;
  return typeof msg === 'string' ? msg : '';
}
