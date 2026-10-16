// Paired controlled raid, not a normal-match balance benchmark. The setup
// isolates a fringe Research Center with one available defender beyond its
// automatic acquisition range. After setup only public player orders and the
// normal fixed-step simulation drive the fight; the rival runs its full AI.
import { Game } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

function raid(replayVersion) {
  const game = new Game({ seed: 481516, difficulty: 'normal', mapId: 'shard-valley',
    faction: 'aegis', victoryMode: 'elimination', replayVersion });
  game.units = [];
  game.relays = [];
  game.credits.enemy = 0;
  for (let y = 19; y <= 32; y++) for (let x = 25; x <= 47; x++)
    Object.assign(game.terrain[y][x], { type: 'sand', crystal: 0, elevation: 0 });
  const tech = game._createBuilding('enemy', 'tech', 30, 25, 1);
  const defender = game._createUnit('enemy', 'lightTank', 42.5, 26.5);
  const attacker = game._createUnit('player', 'lightTank', 33.5, 26.5);
  game._refreshPower();
  game._updateFog();
  game.select(attacker.id);
  const order = game.issueAttack(tech.id);
  if (!order.ok || !game.isVisible(attacker, 'enemy')) throw new Error('Raid must be visible and legally ordered.');
  let responseAt = null, firstDefenderShotAt = null;
  while (game.time < 35 && game.status === 'playing') {
    game.update(SOLO_STEP_SECONDS);
    if (responseAt === null && defender._aiDefenseTarget === attacker.id) responseAt = game.time;
    if (firstDefenderShotAt === null && game.effects.some(effect =>
      effect.type === 'projectile' && effect.sourceId === defender.id)) firstDefenderShotAt = game.time;
  }
  return { replayVersion, seconds: +game.time.toFixed(1),
    responseAt: responseAt === null ? null : +responseAt.toFixed(2),
    firstDefenderShotAt: firstDefenderShotAt === null ? null : +firstDefenderShotAt.toFixed(2),
    techAlive: tech.hp > 0, techHealth: Math.max(0, Math.round(tech.hp)),
    attackerAlive: attacker.hp > 0, defenderAlive: defender.hp > 0,
    defenderTravel: +Math.hypot(defender.x - 42.5, defender.y - 26.5).toFixed(2) };
}

for (const version of [63, 64]) console.log(JSON.stringify(raid(version)));
