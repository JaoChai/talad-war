// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';

const artDir = fileURLToPath(new URL('../public/art/', import.meta.url));
const manifestText = readFileSync(join(artDir, 'manifest.json'), 'utf8');
const manifest = JSON.parse(manifestText);
const r1Props = [
  {
    key: 'crate_super',
    file: 'prop_crate_super.webp',
    width: 470,
    height: 401,
    sha256: '22cf816ba5fbaccc6ab2e7fa154243d118bac5d6546a97157e7fdfc2331c2593',
  },
  {
    key: 'crate_super_air',
    file: 'prop_crate_super_air.webp',
    width: 430,
    height: 425,
    sha256: 'b2c69fa5e801b9d05990a5724ab7c88d76491be7dd11ed5d365382086c5be2a6',
  },
  {
    key: 'shot_coconut',
    file: 'prop_shot_coconut.webp',
    width: 278,
    height: 207,
    sha256: '3aa97503f99a5d1fcb34b9e2c196efaeaed14524fa3487911f9899a267c06e27',
  },
  {
    key: 'badge_super',
    file: 'prop_badge_super.webp',
    width: 216,
    height: 202,
    sha256: '2574f8665f72abb91e4949208b0d5f63a059eafba698d2686961ec6e5c8e1e82',
  },
];

it.each(r1Props)(
  'registers approved $key dimensions and filename',
  ({ key, file, width, height }) => {
    expect(manifest.props[key]).toEqual({ file, width, height });
  },
);

it.each(r1Props)('installs $file byte-for-byte', ({ file, sha256 }) => {
  const path = join(artDir, file);
  expect(existsSync(path), `${file} exists`).toBe(true);
  expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(sha256);
});

it('keeps every manifest-referenced art file on disk', () => {
  const entries = [
    ...Object.values(manifest.characters),
    ...Object.values(manifest.props),
    manifest.arena,
  ] as { file: string }[];
  for (const { file } of entries) {
    expect(existsSync(join(artDir, file)), file).toBe(true);
    expect(statSync(join(artDir, file)).isFile(), file).toBe(true);
  }
});

it('retains all legacy manifest fields and rejects duplicate prop keys', () => {
  // JSON.parse silently discards duplicate keys: inspect the original JSON too.
  for (const key of Object.keys(manifest.props)) {
    expect(manifestText.match(new RegExp(`"${key}"\\s*:`, 'g')), key).toHaveLength(1);
  }
  const legacy = structuredClone(manifest);
  for (const { key } of r1Props) delete legacy.props[key];
  expect(Object.keys(legacy.props)).toHaveLength(16);
  // Canonical pre-R1 manifest, including characters, arena and all old props.
  expect(createHash('sha256').update(JSON.stringify(legacy)).digest('hex')).toBe(
    '4f5b42c65cfe7b89247c0f283451732070b3f8426a581373714d7dc3edf6b1fa',
  );
});

it('keeps all real public art, including unreferenced files, within 3,000,000 bytes', () => {
  function bytes(dir: string): number {
    return readdirSync(dir).reduce((total, name) => {
      const path = join(dir, name);
      return total + (statSync(path).isDirectory() ? bytes(path) : statSync(path).size);
    }, 0);
  }
  const actualArtBytes = bytes(artDir);
  expect(actualArtBytes).toBeGreaterThan(0);
  expect(actualArtBytes).toBeLessThanOrEqual(3_000_000);
});

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
