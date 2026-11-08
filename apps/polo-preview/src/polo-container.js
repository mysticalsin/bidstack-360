// The always-on Polo origin: one Cloudflare Container running Postgres, Redis,
// the API and the built SPA from `main` (container/entrypoint.mjs).
// Container disks are wiped on restart, so data lives in R2: on boot the
// container waits for a restore of the latest snapshot (or seeds when there is
// none) and the cron saves a new snapshot whenever the data changed.
import { Container } from '@cloudflare/containers';

import { containerEnv } from './container-env.js';

export const SNAPSHOT_KEY = 'polo-preview/latest.tgz';
const INTERNAL = 'http://polo.internal';

function internal(env, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-polo-internal-key', env.POLO_INTERNAL_KEY || '');
  return new Request(`${INTERNAL}${path}`, { ...init, headers });
}

export class PreviewOrigin extends Container {
  defaultPort = 8080;
  sleepAfter = '168h';
  enableInternet = true;

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = containerEnv(env);
    this.preparing = null;
  }

  onStop() {
    this.preparing = null;
  }

  async state() {
    const res = await this.containerFetch(internal(this.env, '/__internal/state'));
    return res.json();
  }

  // Hand the fresh container its data exactly once per run.
  prepare() {
    if (!this.preparing) {
      this.preparing = (async () => {
        const state = await this.state();
        if (state.phase === 'booting') {
          this.preparing = null;
          return state;
        }
        if (state.phase !== 'awaiting-data') return state;
        const snapshot = await this.env.BACKUPS.get(SNAPSHOT_KEY);
        if (snapshot) {
          await this.containerFetch(
            internal(this.env, '/__internal/restore', { method: 'PUT', body: snapshot.body }),
          );
        } else {
          await this.containerFetch(internal(this.env, '/__internal/seed', { method: 'POST' }));
        }
        return this.state();
      })().catch((err) => {
        this.preparing = null;
        throw err;
      });
    }
    return this.preparing;
  }

  async fetch(request) {
    await this.prepare();
    return this.containerFetch(request);
  }

  // Cron: keep the container awake, finish boot, and save changed data to R2.
  async tick() {
    const state = await this.prepare().then(() => this.state());
    if (state.phase !== 'ready') return { phase: state.phase, snapshot: 'skipped' };
    const last = (await this.ctx.storage.get('snapshot')) || {};
    const since = last.bootId === state.bootId ? last.counter : -1;
    const res = await this.containerFetch(internal(this.env, `/__internal/snapshot?since=${since}`));
    if (res.status === 204) return { phase: state.phase, snapshot: 'unchanged' };
    if (!res.ok) return { phase: state.phase, snapshot: `failed ${res.status}` };
    const body = await res.arrayBuffer();
    const counter = Number(res.headers.get('x-polo-change-counter') || 0);
    const day = new Date().toISOString().slice(0, 10);
    await this.env.BACKUPS.put(SNAPSHOT_KEY, body);
    await this.env.BACKUPS.put(`polo-preview/daily/${day}.tgz`, body);
    await this.ctx.storage.put('snapshot', { bootId: state.bootId, counter, at: Date.now(), bytes: body.byteLength });
    return { phase: state.phase, snapshot: 'saved', bytes: body.byteLength };
  }

  async health() {
    const state = await this.state();
    const snapshot = (await this.ctx.storage.get('snapshot')) || null;
    return { ...state, lastSnapshot: snapshot };
  }
}
