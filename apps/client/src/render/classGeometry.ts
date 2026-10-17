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

/** §4.3 overhead kit metrics (logical stage px). */
export const BADGE_SIZE = 24;
export const STAR_SIZE = 16;
export const OVERHEAD_GAP = 4;

/**
 * The one rectangle the feet clamp reserves headroom for and the decorations
 * anchor the kit on: the union of body, head accessory and carried cargo.
 * Both call sites consume this exact function so they cannot drift apart.
 */
export function kitAnchor(
  body: BodyTransform,
  head: VisualBounds | null,
  cargo: VisualBounds | null,
): VisualBounds {
  let anchor = bodyBounds(body);
  if (head) anchor = unionBounds(anchor, head)!;
  if (cargo) anchor = unionBounds(anchor, cargo)!;
  return anchor;
}

/** Placement of the overhead kit: badge above the anchor, star to its right. */
export interface KitLayout {
  centreX: number;
  badgeY: number;
  starX: number;
  starY: number;
  bounds: VisualBounds;
}

/**
 * §4.3 overhead kit over the anchor union: the 24×24 badge keeps a 4 px gap
 * above the union top, the 16×16 super star sits to its right with 4 px. The
 * returned bounds are the exact drawn kit extent (null when nothing is drawn),
 * which the clamp also uses as its reserved band.
 */
export function kitLayout(anchor: VisualBounds, badge: boolean, star: boolean): KitLayout | null {
  if (!badge && !star) return null;
  const centreX = (anchor.left + anchor.right) / 2;
  const badgeY = anchor.top - OVERHEAD_GAP - BADGE_SIZE / 2;
  const starX = centreX + BADGE_SIZE / 2 + OVERHEAD_GAP + STAR_SIZE / 2;
  const badgeRect: VisualBounds | null = badge
    ? {
        left: centreX - BADGE_SIZE / 2,
        top: anchor.top - OVERHEAD_GAP - BADGE_SIZE,
        right: centreX + BADGE_SIZE / 2,
        bottom: anchor.top - OVERHEAD_GAP,
      }
    : null;
  const starRect: VisualBounds | null = star
    ? {
        left: centreX + BADGE_SIZE / 2 + OVERHEAD_GAP,
        top: badgeY - STAR_SIZE / 2,
        right: centreX + BADGE_SIZE / 2 + OVERHEAD_GAP + STAR_SIZE,
        bottom: badgeY + STAR_SIZE / 2,
      }
    : null;
  const bounds = unionBounds(badgeRect, starRect)!;
  return { centreX, badgeY, starX, starY: badgeY, bounds };
}
