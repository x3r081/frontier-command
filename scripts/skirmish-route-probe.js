import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';

const seeds = process.argv.slice(2).map(Number);
const cases = seeds.length ? seeds : [1, 44];

function run(seed, difficulty, mapId, faction) {
  const game = new Game({ seed, difficulty, mapId, faction });
  const sent = new Set();
  // Relay marker positions and initial neutral ownership are public. Later
  // ownership is updated only when the marker is inside currently visible fog.
  const relayIntel = new Map(game.relays.map(relay => [relay.id, null]));
  let commandAt = 0;

  while (game.status === 'playing' && game.time < 1800) {
    if (game.time >= commandAt) {
      commandAt = game.time + 2;
      for (const relay of game.relays) {
        if (game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] === 2)
          relayIntel.set(relay.id, relay.owner);
      }
      const factory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
      // Light tanks are available to both factions without later tech.
      if (factory?.queue.length < 4 && game.canQueueUnit('lightTank').ok) game.queueUnit('lightTank');

      const combat = game.units.filter(u => u.owner === 'player' &&
        ['lightTank', 'guardian', 'stealthTank', 'rifle', 'scout'].includes(u.defId));
      for (const unit of combat) {
        if (sent.has(unit.id)) continue;
        const target = [...game.relays].sort((a, b) => {
          const aCount = combat.filter(u => Math.hypot(u.x - a.x, u.y - a.y) < 4).length;
          const bCount = combat.filter(u => Math.hypot(u.x - b.x, u.y - b.y) < 4).length;
          return (relayIntel.get(a.id) === 'player') - (relayIntel.get(b.id) === 'player') || aCount - bCount ||
            Math.hypot(unit.x - a.x, unit.y - a.y) - Math.hypot(unit.x - b.x, unit.y - b.y);
        })[0];
        game.select(unit.id);
        game.issueMove(target.x, target.y, true);
        sent.add(unit.id);
      }

      // Redirect defenders only when the last observed marker says it is not ours.
      for (const relay of game.relays) {
        if (relayIntel.get(relay.id) === 'player') continue;
        const defenders = combat.filter(u => Math.hypot(u.x - relay.x, u.y - relay.y) < 2.8);
        if (defenders.length) {
          game.select(defenders.map(u => u.id));
          game.issueMove(relay.x, relay.y, true);
        }
      }
    }
    game.update(1);
  }

  return { seed, difficulty, mapId, faction, status: game.status, time: game.time,
    observedRelays: [...relayIntel.values()].filter(owner => owner === 'player').length,
    ownUnits: game.units.filter(u => u.owner === 'player').length };
}

const results = [];
for (const difficulty of ['easy', 'normal', 'hard']) {
  for (const map of SKIRMISH_MAPS) {
    for (const faction of ['aegis', 'vesper']) {
      for (const seed of cases) results.push(run(seed, difficulty, map.id, faction));
    }
  }
}

for (const result of results) console.log(`${result.difficulty} ${result.mapId} ${result.faction} seed=${result.seed}: ` +
  `${result.status} at ${result.time.toFixed(0)}s; observed player relays=${result.observedRelays}; own units=${result.ownUnits}`);

console.log('\nOutcome matrix (victory / defeat / still playing):');
for (const difficulty of ['easy', 'normal', 'hard']) for (const map of SKIRMISH_MAPS) {
  for (const faction of ['aegis', 'vesper']) {
    const group = results.filter(r => r.difficulty === difficulty && r.mapId === map.id && r.faction === faction);
    const count = status => group.filter(r => r.status === status).length;
    console.log(`${difficulty.padEnd(6)} ${map.id.padEnd(14)} ${faction.padEnd(6)} ` +
      `${count('victory')}/${count('defeat')}/${count('playing')} of ${group.length}`);
  }
}
