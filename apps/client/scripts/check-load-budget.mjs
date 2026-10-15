import process from 'node:process';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const client = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const explicitDir = process.argv.indexOf('--dir');
// npm test runs before build in CI: build fresh, never accept stale output.
if (explicitDir === -1) {
  const build = spawnSync('npm', ['run', 'build'], { cwd: client, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const dir = explicitDir === -1 ? join(client, 'dist') : resolve(process.argv[explicitDir + 1]);
function size(path) {
  return readdirSync(path).reduce((total, name) => {
    const file = join(path, name);
    const stat = statSync(file);
    return total + (stat.isDirectory() ? size(file) : stat.size);
  }, 0);
}
// Conservative upper bound: all dist files, including both audio fallbacks,
// the Boot manifest/art and any assets deferred until the first gesture.
const total = size(dir);
const over = total > 5_000_000;
console.log(`Load budget: ${total} / 5000000 bytes — ${over ? 'OVER' : 'OK'}`);
process.exitCode = over ? 1 : 0;
