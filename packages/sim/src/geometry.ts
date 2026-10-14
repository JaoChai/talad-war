import type { Vec2 } from './types';

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function vecClampLength(v: Vec2, max: number): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0 || len <= max) return { x: v.x, y: v.y };
  const k = max / len;
  return { x: v.x * k, y: v.y * k };
}

export function vecNormalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function pointInRect(p: Vec2, r: Rect): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
}

export function circleOverlapsRect(c: Vec2, radius: number, r: Rect): boolean {
  const nx = Math.min(Math.max(c.x, r.minX), r.maxX);
  const ny = Math.min(Math.max(c.y, r.minY), r.maxY);
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy < radius * radius;
}

export function rectCenter(r: Rect): Vec2 {
  return { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
