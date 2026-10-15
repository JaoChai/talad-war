// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';

const dirs: string[] = [];
function fixture(bytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-budget-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), 'hello');
  writeFileSync(join(dir, 'assets', 'app.js'), Buffer.alloc(bytes - 5));
  return dir;
}
const script = new URL('../scripts/check-load-budget.mjs', import.meta.url).pathname;
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

it('prints the recursive total and accepts exactly 5,000,000 bytes', () => {
  expect(
    execFileSync(process.execPath, [script, '--dir', fixture(5_000_000)], { encoding: 'utf8' }),
  ).toContain('Load budget: 5000000 / 5000000 bytes — OK');
});

it('exits 1 for a fixture one byte over budget', () => {
  const result = spawnSync(process.execPath, [script, '--dir', fixture(5_000_001)], {
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('Load budget: 5000001 / 5000000 bytes — OVER');
});

it('fails closed for missing build output', () => {
  const dir = fixture(5);
  rmSync(dir, { recursive: true });
  const result = spawnSync(process.execPath, [script, '--dir', dir], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('ENOENT');
});
