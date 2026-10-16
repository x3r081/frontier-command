// A bounded combat fixture, not a full-match benchmark. Each duel starts from
// the same authored flat arena and uses ordinary orders after initialization.
import { Game, INFANTRY_DIG_IN_SETUP_SECONDS } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

function firstHit({ dugIn, flank = false, attackerDefId = 'rifle' }) {
  const game = new Game({ mode: 'multiplayer', seed: 74074, replayVersion: 74 });
  game.units = []; game.buildings = []; game.bridges = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row)
    Object.assign(tile, { type: 'sand', resource: 0, walkable: true, buildable: true, elevation: 0 });
  game._createBuilding('player', 'command', 5, 5, 1);
  game._createBuilding('enemy', 'command', 55, 38, 1);
  const defender = game._createUnit('player', 'rifle', 20.5, 20.5);
  const attacker = attackerDefId === 'turret'
    ? game._createBuilding('enemy', 'turret', 23, 20, 1)
    : game._createUnit('enemy', attackerDefId, flank ? 20.5 : 23.5, flank ? 23.5 : 20.5);
  if (attackerDefId === 'turret') game._createBuilding('enemy', 'power', 50, 38, 1);
  game._refreshPower();
  const command = (owner, unit, method, ...args) => {
    game.commandOwner = owner;
    game.select(unit.id);
    const result = game[method](...args);
    if (!result.ok) throw new Error(`${method}: ${result.reason}`);
  };
  command('player', defender, 'issueSetStance', 'holdFire');
  if (attackerDefId === 'turret') command('enemy', attacker, 'setBuildingPower', attacker.id, true);
  else command('enemy', attacker, 'issueSetStance', 'holdFire');
  if (dugIn) command('player', defender, 'issueDigIn', 30.5, 20.5);
  const setupTicks = Math.ceil((INFANTRY_DIG_IN_SETUP_SECONDS + .1) / SOLO_STEP_SECONDS);
  let defenderFired = false;
  const advance = () => {
    game.update(SOLO_STEP_SECONDS);
    defenderFired ||= game.effects.some(effect => effect.type === 'projectile' && effect.sourceId === defender.id);
  };
  for (let tick = 0; tick < setupTicks; tick++) advance();
  if (attackerDefId === 'turret') command('enemy', attacker, 'setBuildingPower', attacker.id, false);
  else command('enemy', attacker, 'issueAttack', defender.id);
  const initialHp = defender.hp;
  for (let tick = 0; tick < 30 * 8 && defender.hp === initialHp; tick++) advance();
  if (defender.hp === initialHp) throw new Error('The attacker never landed its first shot.');
  return { damage: initialHp - defender.hp, defenderHp: defender.hp,
    defenderFired,
    seconds: +game.time.toFixed(3) };
}

export function runInfantryDigInPlaytest() {
  return [
    { id: 'frontal-rifle', attackerDefId: 'rifle' },
    { id: 'flanking-rifle', attackerDefId: 'rifle', flank: true },
    { id: 'frontal-cannon', attackerDefId: 'turret' },
    { id: 'frontal-tank-splash', attackerDefId: 'lightTank' },
    { id: 'frontal-rocket', attackerDefId: 'rocket' },
  ].map(({ id, ...spec }) => {
    const baseline = firstHit({ ...spec, dugIn: false });
    const entrenched = firstHit({ ...spec, dugIn: true });
    return { id, baseline, entrenched, damageRatio: +(entrenched.damage / baseline.damage).toFixed(4) };
  });
}

if (process.argv[1]?.endsWith('/infantry-dig-in-playtest.js'))
  process.stdout.write(`${JSON.stringify(runInfantryDigInPlaytest())}\n`);
