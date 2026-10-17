import type { HeadFrame } from './anims';

/**
 * Pure §4.3 overlay geometry — no Phaser, no state. The view and the
 * ClassDecorations adapter both consume these calculations so the clamp guard
 * and the actual sprite placement can never disagree.
 */

/** Screen-space transform of one drawn unit body (Phaser sprite values). */
export interface BodyTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  originX: number;
  originY: number;
  flipX: boolean;
}

/** Axis-aligned rectangle in logical stage pixels. */
export interface VisualBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Drawn rectangle of a sprite with the given transform. */
export function bodyBounds(body: BodyTransform): VisualBounds {
  return {
    left: body.x - body.width * body.originX,
    top: body.y - body.height * body.originY,
    right: body.x + body.width * (1 - body.originX),
    bottom: body.y + body.height * (1 - body.originY),
  };
}

/**
 * §4.3 overlay transform. The body's current frame selects the skin's head
 * landmark; the accessory scales from the body's DISPLAY size alone (pose
 * squash and the Giant 1.20x are already inside it), mirrors its landmark
 * offset when the body flips and adds no motion of its own.
 */
export function classVisualGeometry(
  body: BodyTransform,
  head: HeadFrame,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  bounds: VisualBounds;
} {
  const sx = body.width / 256;
  const sy = body.height / 256;
  const offsetX = head.x - body.originX * 256;
  const offsetY = head.y - body.originY * 256;
  const x = body.x + (body.flipX ? -offsetX : offsetX) * sx;
  const y = body.y + offsetY * sy;
  const width = (head.width / 128) * 256 * sx;
  const height = (head.width / 128) * 256 * sy;
  const bounds: VisualBounds = {
    left: x - width / 2,
    top: y - height / 2,
    right: x + width / 2,
    bottom: y + height / 2,
  };
  return { x, y, width, height, bounds };
}

/** Smallest rectangle covering both inputs; missing parts are skipped. */
export function unionBounds(a: VisualBounds | null, b: VisualBounds | null): VisualBounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}
