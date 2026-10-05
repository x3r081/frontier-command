import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';

// Deterministic map audit. Resource in a tile is the spendable crystal stock.
// Nearest refinery is a geometric proxy for access, not a pathing/travel-time estimate.
const seeds = [80217, 80218, 80219, 80220, 80221];
const round = n => Math.round(n);
function snapshot(game) {
  const fields = [];
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    const t = game.terrain[y][x];
    if (t.type === 'crystal' && t.resource > 0) fields.push({ x: x + .5, y: y + .5, amount: t.resource });
  }
  const refs = ['player', 'enemy'].map(owner => game.buildings.find(b => b.owner === owner && b.defId === 'refinery'));
  const distTo = (p, b) => Math.hypot(p.x - (b.x + b.w / 2), p.y - (b.y + b.h / 2));
  const totals = { player: 0, enemy: 0, contested: 0 };
  for (const field of fields) {
    const a = distTo(field, refs[0]), b = distTo(field, refs[1]);
    totals[a + 2 <= b ? 'player' : b + 2 <= a ? 'enemy' : 'contested'] += field.amount;
  }
  return { tiles: fields.length, total: round(fields.reduce((s, f) => s + f.amount, 0)), zones: Object.fromEntries(Object.entries(totals).map(([k,v]) => [k, round(v)])) };
}

for (const map of SKIRMISH_MAPS) {
  const rows = seeds.map(seed => {
    const game = new Game({ seed, mapId: map.id, mode: 'skirmish' });
    const initial = snapshot(game);
    // Keep the native player harvester and refinery; run their real harvest and
    // docking logic without combat/AI. Keep the opposing economy inert.
    const harvester = game.units.find(u => u.owner === 'player' && u.defId === 'harvester');
    const openingCredits = game.credits.player;
    // Avoid the normal 6,000-credit storage cap throttling this measurement.
    game.creditCapacity.player = 1_000_000_000;
    let harvestTime = 0;
    for (let tick = 0; tick < 3000; tick++) {
      game.time += .5;
      game._updateHarvester(harvester, .5);
      harvestTime += .5;
      if (harvestTime >= 3) { harvestTime -= 3; game._regrowCrystals(); }
    }
    return { seed, initial, after1500sControlledHarvestAndRegrowth: snapshot(game),
      playerCreditsEarned: round(game.credits.player - openingCredits), playerCargoAtEnd: round(harvester.cargo) };
  });
  const avg = key => Math.round(rows.reduce((s, r) => s + r[key].total, 0) / rows.length);
  const avgZone = (key, stage) => Math.round(rows.reduce((s, r) => s + r[stage].zones[key], 0) / rows.length);
  console.log(JSON.stringify({ map: map.id, samples: rows.length, meanInitial: avg('initial'),
    meanInitialZones: Object.fromEntries(['player', 'enemy', 'contested'].map(k => [k, avgZone(k, 'initial')])),
    meanAfter1500sControlledHarvestAndRegrowth: Math.round(rows.reduce((s,r)=>s+r.after1500sControlledHarvestAndRegrowth.total,0)/rows.length),
    meanFinalZones: Object.fromEntries(['player', 'enemy', 'contested'].map(k => [k, avgZone(k, 'after1500sControlledHarvestAndRegrowth')])),
    meanPlayerCreditsEarned: Math.round(rows.reduce((s,r)=>s+r.playerCreditsEarned,0)/rows.length),
    samples: rows.map(r => ({ seed: r.seed, initial: r.initial, final: r.after1500sControlledHarvestAndRegrowth,
      creditsEarned: r.playerCreditsEarned })) }));
}
