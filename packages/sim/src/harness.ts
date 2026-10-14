/** CLI harness: the only node-facing entry of the sim package. */
function parseGames(argv: string[]): number {
  const flagIndex = argv.indexOf('--games');
  const raw = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

const games = parseGames(process.argv.slice(2));
console.log(JSON.stringify({ games, placeholder: true }));
