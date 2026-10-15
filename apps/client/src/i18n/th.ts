/**
 * UI strings, Thai first (plan Global Constraints). Task 9 extends this table:
 * every Recipe, every Preview.reason and every SquadCommand resolves through
 * this table or the helpers below (test/i18n.test.ts pins the coverage).
 * `preview_empty` maps to '' on purpose — an empty pad hides the preview.
 */
export const th = {
  fire: 'ยิง',
  pickDrop: 'หยิบ/วาง',
  throwBomb: 'โยน',
  open: 'เปิด!',
  willGet: 'จะได้: ',
  recipeGun: 'ปืนฉีดน้ำ',
  recipeBombs: 'ระเบิด',
  recipeBuddy: 'ลูกทีม',
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

export function recipeName(recipe: 'gun' | 'bombs' | 'buddy'): string {
  if (recipe === 'gun') return th.recipeGun;
  if (recipe === 'bombs') return th.recipeBombs;
  return th.recipeBuddy;
}

export function commandName(command: 'attack' | 'guard' | 'fetch'): string {
  if (command === 'attack') return th.attack;
  if (command === 'guard') return th.guard;
  return th.fetch;
}
