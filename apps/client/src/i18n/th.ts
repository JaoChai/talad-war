/**
 * UI strings, Thai first (plan Global Constraints). Task 9 extends this table:
 * every Recipe, every Preview.reason and every SquadCommand resolves through
 * this table or the helpers below (test/i18n.test.ts pins the coverage).
 * `preview_empty` maps to '' on purpose — an empty pad hides the preview.
 */
import type { ItemId, Recipe, UnitClass } from '@talad/sim';

export const th = {
  gameName: 'ตลาดวอร์',
  titleTagline: 'ขนลัง • สร้างทีม • ถล่มแผง!',
  play: 'เล่น',
  playAgain: 'เล่นอีก',
  home: 'หน้าแรก',
  soundOn: 'เสียง: เปิด',
  soundOff: 'เสียง: ปิด',
  howto: 'วิธีเล่น',
  next: 'ถัดไป',
  skip: 'ข้าม',
  howtoMove: 'ขยับ แล้วขนลัง',
  howtoMoveBody: 'ลากจอยเพื่อเดิน หรือใช้ WASD กด หยิบ/วาง หรือ E เพื่อขนลังไปที่แท่นของทีม',
  howtoBuild: 'เรียงลัง แล้วกด เปิด!',
  howtoBuildBody:
    'บนแท่นของทีม: 1 ลังได้ปืน • 2 ลังข้างกันได้ระเบิด • 2 ลังซ้อนกันได้ลูกทีม • 4 ลังเต็มพื้นได้บาซูก้ามะพร้าว • 2 เสาซ้อนคู่ได้ลูกทีมอาชีพ เลือกด้วยปุ่มหรือ 1–4 • ลังดาวทำให้ของพิเศษ',
  howtoWin: 'ถล่มแผงอีกฝั่งให้พัง!',
  howtoWinBody:
    'กด ยิง หรือคลิกเมาส์เพื่อโจมตี ชวนลูกทีมบุก ทำลายแผงศัตรูเพื่อชนะ กด สลับตัว หรือ R เพื่อควบคุมลูกทีมคนถัดไป',
  fruitTeam: 'ทีมผลไม้',
  dessertTeam: 'ทีมขนม',
  fruitWins: 'ทีมผลไม้ชนะ!',
  dessertWins: 'ทีมขนมชนะ!',
  drawResult: 'เสมอ!',
  results: 'สรุปผลการแข่งขัน',
  cratesPlaced: 'ลังที่วาง',
  itemsBuilt: 'ของที่สร้าง',
  stallDamage: 'ความเสียหายแผง',
  rotate: 'หมุนจอเป็นแนวนอน',
  rotateBody: 'พักเกมไว้ให้แล้ว หมุนจอแล้วเล่นต่อได้เลย',
  fire: 'ยิง',
  pickDrop: 'หยิบ/วาง',
  throwBomb: 'โยน',
  open: 'เปิด!',
  willGet: 'จะได้: ',
  recipeGun: 'ปืนฉีดน้ำ',
  recipeBombs: 'ระเบิด',
  recipeBuddy: 'ลูกทีม',
  recipeHeavy: 'บาซูก้ามะพร้าว',
  recipeClass: 'ลูกทีมอาชีพ',
  classBoxer: 'นักมวย',
  classHealer: 'หมอยา',
  classNinja: 'นินจา',
  classGiant: 'ยักษ์',
  chooseClass: 'เลือกอาชีพ',
  classOpening: 'กำลังสร้างลูกทีม…',
  switchUnit: 'สลับตัว',
  switchUnavailable: 'ไม่มีลูกทีมที่สลับได้',
  controlledUnit: 'ตัวที่ควบคุม',
  itemUnarmed: 'มือเปล่า',
  itemCrate: 'ลัง',
  preview_notRecipe: 'ยังไม่ใช่สูตร',
  preview_teamFull: 'ทีมเต็มแล้ว',
  preview_empty: '',
  attack: 'บุก',
  guard: 'เฝ้าแผง',
  fetch: 'ไปขนลัง',
  fruitStallName: 'เลือดแผงฝั่งผลไม้',
  dessertStallName: 'เลือดแผงฝั่งของหวาน',
  timerLabel: 'เวลาที่แข่ง',
  youWin: 'ชนะ!',
  youLose: 'แพ้!',
  draw: 'เสมอ',
} as const;

export type TextKey = keyof typeof th;

export function t(key: TextKey): string {
  return th[key];
}

const recipeNames: Record<Recipe, string> = {
  gun: th.recipeGun,
  bombs: th.recipeBombs,
  buddy: th.recipeBuddy,
  heavy: th.recipeHeavy,
  class: th.recipeClass,
};

const classNames: Record<UnitClass, string> = {
  boxer: th.classBoxer,
  healer: th.classHealer,
  ninja: th.classNinja,
  giant: th.classGiant,
};

export function className(classId: UnitClass): string {
  return classNames[classId];
}

const itemNames: Record<ItemId, string> = {
  unarmed: th.itemUnarmed,
  gun: th.recipeGun,
  heavy: th.recipeHeavy,
  bombs: th.recipeBombs,
  crate: th.itemCrate,
};

export function recipeName(recipe: Recipe): string {
  return recipeNames[recipe];
}

export function itemName(item: ItemId): string {
  return itemNames[item];
}

export function qualityName(name: string, superItem: boolean): string {
  return superItem ? `${name} พิเศษ` : name;
}

export function commandName(command: 'attack' | 'guard' | 'fetch'): string {
  if (command === 'attack') return th.attack;
  if (command === 'guard') return th.guard;
  return th.fetch;
}
