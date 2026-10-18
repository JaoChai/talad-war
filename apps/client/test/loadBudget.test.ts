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

const r2Props = [
  {
    key: 'class_badge_boxer',
    file: 'class_badge_boxer.webp',
    width: 64,
    height: 64,
    sha256: '53511be480e5f50751be88cef7052ab45c4769635847c494d55ac36ab2c966a3',
  },
  {
    key: 'class_badge_giant',
    file: 'class_badge_giant.webp',
    width: 64,
    height: 64,
    sha256: '5a270de2178ccd7e4691a5a1082f6f48952bcc9f2964974eef8f16833ec9f0f4',
  },
  {
    key: 'class_badge_healer',
    file: 'class_badge_healer.webp',
    width: 64,
    height: 64,
    sha256: '201b6e1553841799ee169c902485e0f33c044386932150fa347a1335e3b8a60e',
  },
  {
    key: 'class_badge_ninja',
    file: 'class_badge_ninja.webp',
    width: 64,
    height: 64,
    sha256: '705b3152cc6425ca170c8bb64edd15fbdff25ef8f6b2982dbac1e3a931760aed',
  },
  {
    key: 'class_head_boxer',
    file: 'class_head_boxer.webp',
    width: 256,
    height: 256,
    sha256: '4e14ebec2bbbe9b67b580b15305dc2ae6a55f38a975c4066625d9ce07fb3c3b8',
  },
  {
    key: 'class_head_giant',
    file: 'class_head_giant.webp',
    width: 256,
    height: 256,
    sha256: '5db2b0933c6545350c8c689c1eecc4e6cddf2224ecfa286d567a863b3f6f556e',
  },
  {
    key: 'class_head_healer',
    file: 'class_head_healer.webp',
    width: 256,
    height: 256,
    sha256: '5726f9c6976ce9ca78c09cd4265334f9d9d88cca9651fb1667c829eca35e7566',
  },
  {
    key: 'class_head_ninja',
    file: 'class_head_ninja.webp',
    width: 256,
    height: 256,
    sha256: 'eba933b524799d72719e166b2a7f617dc1e0cccea7c4f47035b6d9042747115b',
  },
  {
    key: 'class_pick_boxer',
    file: 'class_pick_boxer.webp',
    width: 128,
    height: 128,
    sha256: '0084abb42a011a22061c35e402c1ebc9dcf5b855c2971dce236352272f042a6d',
  },
  {
    key: 'class_pick_giant',
    file: 'class_pick_giant.webp',
    width: 128,
    height: 128,
    sha256: '1c73dd2f99a91703c102393d4544909886c5b121ed9d8dfca951a0a379edefce',
  },
  {
    key: 'class_pick_healer',
    file: 'class_pick_healer.webp',
    width: 128,
    height: 128,
    sha256: 'a3f313e783ee6cf88d67128d79ce2fc72f5ea67e968864e1e8f2aed9c39c37aa',
  },
  {
    key: 'class_pick_ninja',
    file: 'class_pick_ninja.webp',
    width: 128,
    height: 128,
    sha256: 'a507a99c0c50977bbefebd472e3c5910581df6bd39d0b19b1d9c0c173b29adb8',
  },
  {
    key: 'control_arrow',
    file: 'control_arrow.webp',
    width: 48,
    height: 48,
    sha256: '0442ff15705948d8c05d40c7b538ce170345483738daa045493a858f9d3c7f37',
  },
  {
    key: 'control_ring',
    file: 'control_ring.webp',
    width: 128,
    height: 64,
    sha256: 'b1b0cd49c920aaeb3e17189efb499582a72eba36e275d87d9e0af870aacc1b67',
  },
  {
    key: 'control_switch',
    file: 'control_switch.webp',
    width: 96,
    height: 96,
    sha256: '8620239436edefd330fc30249eb5116768b58fe1be856ea4cf96161cc09c6adb',
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

it.each(r2Props)(
  'registers approved R2 $key dimensions and filename',
  ({ key, file, width, height }) => {
    expect(manifest.props[key]).toEqual({ file, width, height });
  },
);

it.each(r2Props)('installs R2 $file byte-for-byte', ({ file, sha256 }) => {
  const path = join(artDir, file);
  expect(existsSync(path), `${file} exists`).toBe(true);
  expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(sha256);
});

it('keeps the delivered R2 art bundle at its receipt total', () => {
  const total = r2Props.reduce((sum, { file }) => sum + statSync(join(artDir, file)).size, 0);
  expect(total).toBe(66_732);
});

it('delivers the approved classArt schema', () => {
  expect(manifest.classArt).toBeDefined();
  expect(Object.keys(manifest.classArt.headFrames).sort()).toEqual(
    Object.keys(manifest.characters).sort(),
  );
  expect(Object.keys(manifest.classArt.classes).sort()).toEqual([
    'boxer',
    'giant',
    'healer',
    'ninja',
  ]);
  for (const [id, c] of Object.entries(manifest.classArt.classes)) {
    expect(c).toEqual({
      head: `class_head_${id}`,
      badge: `class_badge_${id}`,
      pick: `class_pick_${id}`,
      anchor: [0.5, 0.5],
      fitWidth: 128,
      bodyScale: id === 'giant' ? 1.2 : 1,
    });
  }
  expect(manifest.classArt.control).toEqual({
    ring: 'control_ring',
    arrow: 'control_arrow',
    switchIcon: 'control_switch',
  });
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
  // Strip ONLY the R1 and R2 additions: the canonical pre-R1 projection of
  // characters, arena and all 16 old props must keep its exact old hash.
  delete legacy.classArt;
  for (const { key } of [...r1Props, ...r2Props]) delete legacy.props[key];
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
