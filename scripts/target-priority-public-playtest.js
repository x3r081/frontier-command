// Bounded ordinary-start rules-82 target-priority route. It uses only public
// player commands and fixed simulation updates; no scenario state is edited.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Game, TARGET_PRIORITY_RULES_VERSION, UNIT_DEFS } from '../src/game/engine.js';
import { createSoloPlayback, createSoloRecorder, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MAX_SECONDS = 120;
export const TARGET_PRIORITY_PUBLIC_ROUTES = [
  { seed: 24, difficulty: 'easy', faction: 'aegis', approach: [42.5, 16.5] },
  { seed: 24, difficulty: 'normal', faction: 'aegis', approach: [42.5, 16.5] },
  { seed: 24, difficulty: 'hard', faction: 'vesper', approach: [44.5, 19.5] },
];

function publicSnapshot(game) {
  return structuredClone({ units: game.units, buildings: game.buildings, credits: game.credits,
    terrain: game.terrain, effects: game.effects, time: game.time, status: game.status });
}

function category(target) {
  if ('w' in target) return 'structures';
  const definition = UNIT_DEFS[target.defId];
  if (definition?.flying) return 'aircraft';
  if (definition?.armor === 'infantry') return 'infantry';
  return 'vehicles';
}

function currentShootableCandidates(game, shooter) {
  const weapon = UNIT_DEFS[shooter.defId]?.weapon;
  if (!weapon) return [];
  const range = game._unitWeaponRange(shooter, weapon);
  const radius = shooter.stance === 'defensive' || shooter.order?.attackMove ||
    shooter.order?.type === 'guard' || shooter.order?.type === 'patrol'
    ? game._unitSight(shooter, UNIT_DEFS[shooter.defId]?.sight || 5) : range + 0.25;
  return [...game.units, ...game.buildings].filter(target => target.owner !== shooter.owner && target.hp > 0 &&
    !target.embarkedIn && (!('w' in target) || target.progress >= 1) && game._weaponCanTarget(weapon, target) &&
    game._canDetect(shooter, target) && game.isVisible(target, shooter.owner) &&
    game._distanceToEntity(shooter.x, shooter.y, target) <= range &&
    game._distanceToEntity(shooter.x, shooter.y, target) <= radius &&
    game._hasLineOfSight(shooter.x, shooter.y, game._entityCenter(target).x, game._entityCenter(target).y));
}

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

export function runTargetPriorityPublicPlaytest(route = TARGET_PRIORITY_PUBLIC_ROUTES[1]) {
  const envelope = { mode: 'skirmish', difficulty: route.difficulty, faction: route.faction,
    seed: route.seed, scenarioId: 'shard-valley', victoryMode: 'elimination' };
  const game = new Game({ ...envelope, mapId: envelope.scenarioId,
    replayVersion: TARGET_PRIORITY_RULES_VERSION });
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const openingForce = ['scout', 'rifle', 'lightTank'].map(defId => game.units.find(unit =>
    unit.owner === 'player' && unit.defId === defId && unit.hp > 0 && !unit.embarkedIn));
  assert.ok(openingForce.every(Boolean), 'seed 24 should retain the original scout, rifle, and light tank');
  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  assert.ok(barracks, 'untouched seed-24 opening should have a player Barracks');
  const initialIds = new Set(game.units.map(unit => unit.id));
  const startingCredits = game.credits.player;

  game.select(openingForce.map(unit => unit.id));
  requireOk(game.issueMove(route.approach[0], route.approach[1], true), 'send the original opening force toward contact');
  requireOk(game.queueUnit('rocket', barracks.id), 'pay normal price for the first Rocket Trooper');
  requireOk(game.queueUnit('rocket', barracks.id), 'pay normal price for the second Rocket Trooper');
  const creditsAfterQueue = game.credits.player;
  const orderedRockets = new Set();
  const priorityShots = [];
  const timeline = [];
  const originalFire = game._fire.bind(game);
  game._fire = (source, target, weapon) => {
    if (source.owner === 'player' && source.defId === 'rocket' && source.targetPriority === 'vehicles') {
      const alternates = currentShootableCandidates(game, source).filter(candidate =>
        candidate.id !== target.id && category(candidate) !== 'vehicles');
      const shot = { time: +game.time.toFixed(2), shooterId: source.id,
        targetId: target.id, targetDefId: target.defId, targetClass: category(target),
        otherShootable: alternates.map(candidate => ({ id: candidate.id, defId: candidate.defId,
          class: category(candidate) })) };
      priorityShots.push(shot);
    }
    return originalFire(source, target, weapon);
  };
  const maxTicks = Math.round(MAX_SECONDS / SOLO_STEP_SECONDS);

  for (let tick = 0; tick < maxTicks && game.status === 'playing'; tick++) {
    game.update(SOLO_STEP_SECONDS);
    clock.completedTicks++;

    for (const rocket of game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rocket' &&
        !initialIds.has(unit.id) && unit.hp > 0 && !unit.embarkedIn && !orderedRockets.has(unit.id))) {
      game.select(rocket.id);
      requireOk(game.issueSetTargetPriority('vehicles'), 'set the paid Rocket priority to vehicles');
      requireOk(game.issueMove(route.approach[0], route.approach[1], true), 'send the paid Rocket into contact');
      orderedRockets.add(rocket.id);
      timeline.push({ type: 'paidRocketOrdered', time: +game.time.toFixed(2), unitId: rocket.id,
        destination: route.approach, priority: rocket.targetPriority });
    }

    if (priorityShots.some(shot => shot.targetClass === 'vehicles') &&
        priorityShots.some(shot => shot.targetClass !== 'vehicles' && shot.otherShootable.length === 0)) break;
  }

  recorder.dispose();
  validateSoloReplay(envelope, recorder.commands, clock.completedTicks, TARGET_PRIORITY_RULES_VERSION);
  const playback = createSoloPlayback(envelope, recorder.commands, clock.completedTicks, TARGET_PRIORITY_RULES_VERSION);
  playback.step(clock.completedTicks);
  assert.deepEqual(publicSnapshot(playback.game), publicSnapshot(game),
    'the paid public-command route should replay the same combat and economy');
  const preferredShots = priorityShots.filter(shot => shot.targetClass === 'vehicles');
  const fallbackShots = priorityShots.filter(shot => shot.targetClass !== 'vehicles' && !shot.otherShootable.length);
  timeline.push(...preferredShots.map(shot => ({ type: 'priorityShot', ...shot })),
    ...fallbackShots.map(shot => ({ type: 'ordinaryFallbackShot', ...shot })));
  return { route, seconds: +game.time.toFixed(2), startingCredits, creditsAfterQueue,
    playerCredits: game.credits.player, rocketsOrdered: [...orderedRockets], preferredShots, fallbackShots,
    commands: recorder.commands.map(({ tick, sequence, method, args, selectedIds }) =>
      ({ tick, sequence, method, args, selectedIds })), replayMatches: true, timeline };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const routeIndex = Number(process.argv.find(arg => /^--route=/.test(arg))?.split('=')[1] || 1);
  assert.ok(Number.isInteger(routeIndex) && TARGET_PRIORITY_PUBLIC_ROUTES[routeIndex], 'choose route 0, 1, or 2');
  console.log(JSON.stringify(runTargetPriorityPublicPlaytest(TARGET_PRIORITY_PUBLIC_ROUTES[routeIndex]), null, 2));
}
