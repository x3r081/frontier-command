// Bounded combat comparison: a vehicle is destroyed through ordinary attack
// orders, then its wreck is either retained or salvaged before the test shot.
import { Game } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

export function playWreckCoverEncounter({ salvage = false, flank = false, attackerDefId = 'rifle',
  targetDefId = 'rifle', replayVersion = 75 } = {}) {
  const game = new Game({ mode: 'multiplayer', seed: 75075, replayVersion });
  game.units = []; game.buildings = []; game.bridges = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row)
    Object.assign(tile, { type: 'sand', resource: 0, walkable: true, buildable: true, elevation: 0 });
  game._createBuilding('player', 'command', 5, 5, 1);
  game._createBuilding('enemy', 'command', 55, 38, 1);
  const target = game._createUnit('player', targetDefId, 20.5, 20.5);
  const hull = game._createUnit('enemy', 'buggy', 21.5, 20.5);
  const destroyer = game._createUnit('player', 'guardian', 22.5, 25.5);
  const engineer = game._createUnit('player', 'engineer', 21.5, 22);
  const attacker = attackerDefId === 'turret'
    ? game._createBuilding('enemy', 'turret', 24, 20, 1)
    : game._createUnit('enemy', attackerDefId, flank ? 20.5 : 24.5, flank ? 24.5 : 20.5);
  if (attackerDefId === 'turret') game._createBuilding('enemy', 'power', 50, 38, 1);
  game._refreshPower();
  const issue = (owner, entity, method, ...args) => {
    game.commandOwner = owner; game.select(entity.id);
    const result = game[method](...args);
    if (!result?.ok) throw new Error(`${method}: ${result?.reason}`);
  };
  for (const unit of [target, hull, destroyer])
    issue(unit.owner, unit, 'issueSetStance', 'holdFire');
  if (attackerDefId === 'turret') issue('enemy', attacker, 'setBuildingPower', attacker.id, true);
  else issue('enemy', attacker, 'issueSetStance', 'holdFire');
  for (let tick = 0; tick < 10; tick++) game.update(SOLO_STEP_SECONDS);
  issue('player', destroyer, 'issueAttack', hull.id);
  const advance = () => game.update(SOLO_STEP_SECONDS);
  for (let tick = 0; tick < 30 * 35 && hull.hp > 0; tick++) advance();
  const wreck = game.wrecks.find(item => Math.hypot(item.x - 21.5, item.y - 20.5) < .1);
  if (hull.hp > 0 || !wreck) throw new Error('The ordinary attack did not create the test wreck.');
  issue('player', destroyer, 'issueStop');
  if (salvage) issue('player', engineer, 'issueRecoverWreck', wreck.id);
  // Equal elapsed time in both variants; the real Engineer channel owns removal.
  for (let tick = 0; tick < 30 * 7; tick++) advance();
  if (salvage && game.wrecks.some(item => item.id === wreck.id))
    throw new Error('The Engineer did not finish salvaging the hull.');
  if (attackerDefId === 'turret') issue('enemy', attacker, 'setBuildingPower', attacker.id, false);
  else issue('enemy', attacker, 'issueAttack', target.id);
  const initialHp = target.hp;
  for (let tick = 0; tick < 30 * 8 && target.hp === initialHp; tick++) advance();
  if (target.hp === initialHp) throw new Error('The attacker did not land a shot.');
  game.commandOwner = 'player'; game.select(target.id);
  return { game, target, wreck, summary: { damage: +(initialHp - target.hp).toFixed(6),
    coverImpacts: game.effects.filter(effect => effect.type === 'wreckCover').length,
    wreckRetained: game.wrecks.some(item => item.id === wreck.id),
    seconds: +game.time.toFixed(3) } };
}

export function runWreckCoverPlaytest() {
  return [
    { id: 'frontal-rifle' },
    { id: 'flanking-rifle', flank: true },
    { id: 'frontal-cannon', attackerDefId: 'turret' },
    { id: 'frontal-tank-splash', attackerDefId: 'lightTank' },
    { id: 'frontal-rocket', attackerDefId: 'rocket' },
    { id: 'vehicle-target', targetDefId: 'lightTank' },
    { id: 'archived-v74', replayVersion: 74 },
  ].map(({ id, ...spec }) => {
    const exposed = playWreckCoverEncounter({ ...spec, salvage: true }).summary;
    const sheltered = playWreckCoverEncounter(spec).summary;
    return { id, exposed, sheltered, damageRatio: +(sheltered.damage / exposed.damage).toFixed(4) };
  });
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('/wreck-cover-playtest.js'))
  process.stdout.write(`${JSON.stringify(runWreckCoverPlaytest())}\n`);
