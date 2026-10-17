// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  bodyBounds,
  classVisualGeometry,
  kitAnchor,
  kitLayout,
  unionBounds,
  type BodyTransform,
  type VisualBounds,
} from '../src/render/classGeometry';
import { validateClassArt } from '../src/render/anims';

const artDir = fileURLToPath(new URL('../public/art/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(artDir, 'manifest.json'), 'utf8'));

const REST: BodyTransform = {
  x: 50,
  y: 300,
  width: 256,
  height: 256,
  originX: 0.5,
  originY: 0.984375,
  flipX: false,
};

it('computes the exact §4 source-to-screen overlay transform', () => {
  expect(classVisualGeometry(REST, { x: 128, y: 100, width: 128 })).toMatchObject({
    x: 50,
    y: 148,
    width: 256,
    height: 256,
  });
  expect(classVisualGeometry(REST, { x: 128, y: 100, width: 128 }).bounds).toEqual({
    left: -78,
    top: 20,
    right: 178,
    bottom: 276,
  });
});

it('mirrors the landmark offset, not the whole canvas, when the body flips', () => {
  const head = { x: 100, y: 100, width: 128 };
  const plain = classVisualGeometry(REST, head);
  const flipped = classVisualGeometry({ ...REST, flipX: true }, head);
  expect(flipped.x).toBeCloseTo(50 + (50 - plain.x), 10);
  expect(flipped.y).toBe(plain.y);
  expect(flipped.width).toBe(plain.width);
  // A centred landmark stays centred under flip.
  expect(classVisualGeometry(REST, { x: 128, y: 100, width: 128 }).x).toBe(
    classVisualGeometry({ ...REST, flipX: true }, { x: 128, y: 100, width: 128 }).x,
  );
});

it('follows the per-frame landmark exactly, adding no bob of its own', () => {
  const frames = manifest.classArt.headFrames.fruit_mangosteen;
  const first = classVisualGeometry(REST, frames[0]);
  const second = classVisualGeometry(REST, frames[1]);
  // Same body, different frame landmark → the accessory moves only by the
  // landmark delta, so bob comes from the body animation, never from here.
  expect(second.y - first.y).toBeCloseTo(frames[1].y - frames[0].y, 10);
  expect(second.x - first.x).toBeCloseTo(frames[1].x - frames[0].x, 10);
});

it('scales each axis with nonuniform pose squash (sx and sy independently)', () => {
  const head = { x: 100, y: 100, width: 128 };
  const squashed = classVisualGeometry({ ...REST, width: 256 * 1.1, height: 256 * 0.9 }, head);
  // sx = 1.1: the x offset (100 - 128 = -28) scales by 1.1.
  expect(squashed.x).toBeCloseTo(50 - 28 * 1.1, 10);
  // sy = 0.9: the y offset (100 - 252 = -152) scales by 0.9.
  expect(squashed.y).toBeCloseTo(300 - 152 * 0.9, 10);
  expect(squashed.width).toBeCloseTo(256 * 1.1, 10);
  expect(squashed.height).toBeCloseTo(256 * 0.9, 10);
});

it('scales the accessory from display size alone, never multiplying class scale twice', () => {
  // A Giant body already renders at 1.20x display size; the transform only
  // sees that display size, so passing it in twice would be a double scale.
  const head = { x: 128, y: 100, width: 128 };
  const giant = classVisualGeometry({ ...REST, width: 307.2, height: 307.2 }, head);
  expect(giant.width).toBeCloseTo(128 * 2 * 1.2, 10);
  expect(giant.height).toBeCloseTo(128 * 2 * 1.2, 10);
  expect(giant.x).toBe(50);
});

it('bodyBounds and unionBounds compose the drawn union, tolerating missing parts', () => {
  const body = bodyBounds(REST);
  expect(body).toEqual({ left: -78, top: 48, right: 178, bottom: 304 });
  const a: VisualBounds = { left: 0, top: 0, right: 10, bottom: 10 };
  const b: VisualBounds = { left: 5, top: -5, right: 20, bottom: 8 };
  expect(unionBounds(a, b)).toEqual({ left: 0, top: -5, right: 20, bottom: 10 });
  expect(unionBounds(a, null)).toEqual(a);
  expect(unionBounds(null, null)).toBeNull();
});

it('computed union with super cargo and overhead kit never top-clips at world y=0.45', () => {
  // Mirrors the view clamp: feet at max(stage y, 92), union of body + head +
  // cargo + badge(24) + star(16) band, 24 px reserved for the control arrow on
  // controlled bodies; the feet shift keeps the union top >= 2 + 24.
  const STAGE_SCALE = 720 / 24;
  const UNIT_DISPLAY_HEIGHT = 92;
  const feet0 = Math.max(0.45 * STAGE_SCALE, UNIT_DISPLAY_HEIGHT);
  const required = 2 + 24;
  const cargoW = 54;
  const cargoH = (cargoW * 401) / 470; // super crate art ratio
  for (const [skin, frames] of Object.entries(manifest.classArt.headFrames) as [
    string,
    { x: number; y: number; width: number }[],
  ][]) {
    expect(frames).toHaveLength(18);
    for (let frame = 0; frame < frames.length; frame += 1) {
      for (const cls of ['boxer', 'healer', 'ninja', 'giant'] as const) {
        const height = UNIT_DISPLAY_HEIGHT * manifest.classArt.classes[cls].bodyScale;
        const body: BodyTransform = {
          x: 640,
          y: feet0,
          width: height,
          height,
          originX: 0.5,
          originY: 0.984375,
          flipX: false,
        };
        const headGeom = classVisualGeometry(body, frames[frame]!);
        const cargoBottom = feet0 - (207 / 256) * height;
        const cargo: VisualBounds = {
          left: 640 - cargoW / 2,
          right: 640 + cargoW / 2,
          top: cargoBottom - cargoH,
          bottom: cargoBottom,
        };
        const drawn = kitAnchor(body, headGeom.bounds, cargo);
        // Production kit band: badge 24 px + 4 px gap above the drawn union,
        // star 16 px beside it — the same helper the decorations draw with.
        const kit = kitLayout(drawn, true, true)!.bounds;
        const union = unionBounds(drawn, kit)!;
        const delta = Math.max(0, required - union.top);
        expect(Number.isFinite(delta), `${skin}#${frame} ${cls}`).toBe(true);
        // The shift restores the top to `required` up to float noise.
        expect(union.top + delta, `${skin}#${frame} ${cls}`).toBeGreaterThanOrEqual(
          required - 1e-9,
        );
        expect(feet0 + delta, `${skin}#${frame} ${cls}`).toBeLessThan(720);
      }
    }
  }
});

it('overhead kit bottom clears body, head accessory and cargo by the 4 px gap', () => {
  // Review round 1: the badge used to anchor on the body top alone, landing on
  // top of the carried crate. §4.3: the kit anchor is the union of body, head
  // accessory and cargo, and the kit keeps a 4 px gap above that union.
  const crateArt: Record<'normal' | 'super', { width: number; height: number }> = {
    normal: manifest.props.crate,
    super: manifest.props.crate_super,
  };
  for (const cls of ['boxer', 'healer', 'ninja', 'giant'] as const) {
    const displayHeight = 92 * manifest.classArt.classes[cls].bodyScale;
    for (const kind of ['normal', 'super'] as const) {
      const body: BodyTransform = {
        x: 640,
        y: 300,
        width: displayHeight,
        height: displayHeight,
        originX: 0.5,
        originY: 0.984375,
        flipX: false,
      };
      const headBounds = classVisualGeometry(
        body,
        manifest.classArt.headFrames.fruit_mangosteen[0]!,
      ).bounds;
      // Carried crates draw 1.8 stage cells wide (view.ts carriedCargoBounds).
      const cargoW = 54;
      const cargoBottom = body.y - (207 / 256) * displayHeight;
      const cargo: VisualBounds = {
        left: 640 - cargoW / 2,
        right: 640 + cargoW / 2,
        top: cargoBottom - (cargoW * crateArt[kind].height) / crateArt[kind].width,
        bottom: cargoBottom,
      };
      const anchor = kitAnchor(body, headBounds, cargo);
      const kit = kitLayout(anchor, true, true)!;
      const minTop = Math.min(bodyBounds(body).top, headBounds.top, cargo.top);
      expect(kit.bounds.bottom, `${cls} ${kind}`).toBeLessThanOrEqual(minTop - 4 + 1e-9);
      expect(kit.bounds.bottom, `${cls} ${kind} overlaps anchor`).toBeLessThanOrEqual(
        anchor.top + 1e-9,
      );
      // Star-only kits (classless super) reserve their own drawn extent too.
      const starKit = kitLayout(anchor, false, true)!;
      expect(starKit.bounds.bottom, `${cls} ${kind} star-only`).toBeLessThanOrEqual(
        anchor.top + 1e-9,
      );
    }
  }
  // No kit, no band.
  expect(kitLayout(bodyBounds(REST), false, false)).toBeNull();
});

it('delivers 8x18 finite landmarks for every skin, including the KO frame', () => {
  const skins = Object.keys(manifest.characters).sort();
  expect(skins).toHaveLength(8);
  for (const skin of skins) {
    const frames = manifest.classArt.headFrames[skin];
    expect(frames, skin).toHaveLength(18);
    for (const f of frames) {
      expect(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.width)).toBe(true);
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThanOrEqual(256);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThanOrEqual(256);
      expect(f.width).toBeGreaterThan(0);
      expect(f.width).toBeLessThanOrEqual(256);
    }
  }
});

it('validateClassArt rejects malformed bundles and accepts the delivered one', () => {
  const valid = validateClassArt(manifest);
  expect(valid).toBeDefined();
  const missingSkin = structuredClone(manifest);
  delete missingSkin.classArt.headFrames.fruit_durian;
  expect(validateClassArt(missingSkin)).toBeUndefined();
  const shortFrames = structuredClone(manifest);
  shortFrames.classArt.headFrames.fruit_durian.pop();
  expect(validateClassArt(shortFrames)).toBeUndefined();
  const nanFrame = structuredClone(manifest);
  nanFrame.classArt.headFrames.dessert_khanomchan[3].x = Number.NaN;
  expect(validateClassArt(nanFrame)).toBeUndefined();
  const offCanvas = structuredClone(manifest);
  offCanvas.classArt.headFrames.dessert_khanomchan[3].x = 300;
  expect(validateClassArt(offCanvas)).toBeUndefined();
  const zeroWidth = structuredClone(manifest);
  zeroWidth.classArt.headFrames.fruit_longan[9].width = 0;
  expect(validateClassArt(zeroWidth)).toBeUndefined();
  const brokenPropRef = structuredClone(manifest);
  brokenPropRef.classArt.classes.ninja.head = 'class_head_missing';
  expect(validateClassArt(brokenPropRef)).toBeUndefined();
  const brokenControl = structuredClone(manifest);
  brokenControl.classArt.control.arrow = 'control_arrow_missing';
  expect(validateClassArt(brokenControl)).toBeUndefined();
});
