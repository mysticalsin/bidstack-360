/**
 * lint-staged config — chunks file lists into 40-file batches so a
 * sprint-sized commit (200+ staged files) doesn't blow past Windows'
 * ~8KB command-line limit when ESLint or Prettier receive the staged
 * file list. lint-staged v17 stopped auto-chunking under that ceiling.
 *
 * Returning an array of commands from a function tells lint-staged to
 * run them sequentially, each with its own chunk.
 */

const CHUNK = 40;

function chunk(arr) {
  const out = [];
  for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
  return out;
}

function quote(p) {
  // Quote any path containing whitespace/special chars; pnpm exec spawns
  // commands through a shell on Windows that treats backslashes specially.
  return /[\s"]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p;
}

function chunked(cmd, files) {
  return chunk(files).map((batch) => `${cmd} ${batch.map(quote).join(' ')}`);
}

module.exports = {
  '*.{ts,tsx,js,jsx}': (files) => [
    ...chunked('eslint --fix', files),
    ...chunked('prettier --write', files),
  ],
  '*.{json,md,yaml,yml,css}': (files) => chunked('prettier --write', files),
};
