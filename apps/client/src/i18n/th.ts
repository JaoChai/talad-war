/**
 * UI strings, Thai first (plan Global Constraints). Task 9 extends this table
 * and enumerates every Recipe / Preview.reason from the sim unions.
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
  notRecipe: 'ยังไม่ใช่สูตร',
  teamFull: 'ทีมเต็มแล้ว',
  youWin: 'ชนะ!',
  youLose: 'แพ้!',
  draw: 'เสมอ',
} as const;

export function recipeName(recipe: 'gun' | 'bombs' | 'buddy'): string {
  if (recipe === 'gun') return th.recipeGun;
  if (recipe === 'bombs') return th.recipeBombs;
  return th.recipeBuddy;
}
