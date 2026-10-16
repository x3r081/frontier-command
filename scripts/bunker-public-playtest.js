// Bounded public-command route proving a paid Field Bunker build, crew boarding,
// live bunker fire, and a safe evacuation in the untouched Shard Valley skirmish.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Game, GARRISON_RULES_VERSION } from '../src/game/engine.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay } from '../src/game/replay.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const MAX_SECONDS = 150;
const ENVELOPE = { mode: 'skirmish', difficulty: 'easy', faction: 'aegis', seed: 24,
  scenarioId: 'shard-valley', victoryMode: 'elimination' };

function requireOk(result, action) {
  assert.equal(result?.ok, true, `${action}: ${result?.reason || 'command rejected'}`);
  return result;
}

function advance(game, clock, tick) {
  game.update(SOLO_STEP_SECONDS);
  clock.completedTicks++;
  tick?.();
}

function forwardSite(game, factory) {
  const enemy = game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
  const fx = factory.x + factory.w / 2, fy = factory.y + factory.h / 2;
  const ex = enemy.x + enemy.w / 2, ey = enemy.y + enemy.h / 2;
  const length = Math.hypot(ex - fx, ey - fy) || 1;
  const dx = (ex - fx) / length, dy = (ey - fy) / length;
  const candidates = [];
  for (let y = 1; y < game.height - 3; y++) for (let x = 1; x < game.width - 3; x++) {
    const edgeX = Math.max(0, factory.x - (x + 2), x - (factory.x + factory.w));
    const edgeY = Math.max(0, factory.y - (y + 2), y - (factory.y + factory.h));
    const connectedDistance = Math.hypot(edgeX, edgeY);
    if (connectedDistance > 4.5) continue;
    const cx = x + 1, cy = y + 1;
    const projection = (cx - fx) * dx + (cy - fy) * dy;
    if (projection <= 0 || !game.canPlaceBuilding('bunker', x, y).ok) continue;
    candidates.push({ x, y, projection, connectedDistance });
  }
  candidates.sort((a, b) => b.projection - a.projection || a.connectedDistance - b.connectedDistance || a.y - b.y || a.x - b.x);
  return candidates[0] || null;
}

export function runBunkerPublicPlaytest(faction = 'aegis') {
  const game = new Game({ ...ENVELOPE, faction, mapId: ENVELOPE.scenarioId,
    replayVersion: GARRISON_RULES_VERSION });
  const clock = { completedTicks: 0 };
  const recorder = createSoloRecorder(game, clock);
  const events = [];
  const originalOnEvent = game.onEvent;
  game.onEvent = event => {
    originalOnEvent?.(event);
    if (['constructionReady', 'unitReady', 'victory', 'defeat'].includes(event.type))
      events.push({ type: event.type, defId: event.defId || null, time: +game.time.toFixed(1) });
  };

  const barracks = game.buildings.find(building => building.owner === 'player' && building.defId === 'barracks');
  const factory = game.buildings.find(building => building.owner === 'player' && building.defId === 'factory');
  const openingRifles = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rifle');
  const scout = game.units.find(unit => unit.owner === 'player' && unit.defId === 'scout');
  const tank = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  assert.ok(barracks && factory && openingRifles.length >= 2 && scout && tank,
    `${faction}: expected untouched established opening roster`);

  // Keep the unassigned defenders on the forward factory approach.
  game.select([openingRifles[1].id, scout.id, tank.id]);
  requireOk(game.issueGuard(), 'guard the factory approach');

  const startingCredits = game.credits.player;
  requireOk(game.startConstruction('bunker'), 'pay for Field Bunker');
  requireOk(game.queueUnit('rocket', barracks.id), 'pay for first rocket crew');
  requireOk(game.queueUnit('rocket', barracks.id), 'pay for second rocket crew');
  const purchases = [
    { item: 'Field Bunker', cost: game.buildingDefs.bunker.cost },
    { item: 'Rocket Infantry', count: 2, cost: game.unitDefs.rocket.cost * 2 },
  ];
  assert.equal(game.credits.player, startingCredits - purchases.reduce((sum, row) => sum + row.cost, 0));

  let site = null, bunker = null, crewIds = [], housedAt = null, firedAt = null, checkpointSerialized = null;
  let boardingXp = {}, checkpointAt = null, checkpointXp = {}, focusTargetId = null, focusTargetHpBefore = null;
  let postShotProjectiles = 0, crewProjectileCount = 0, targetDamageAtEnd = 0;
  const projectileTargets = {};
  let bunkerHpAtCheckpoint = null, bunkerHpAtEvacuation = null, crewHpAtCheckpoint = {}, crewHpAtEvacuation = {};
  const crewProjectileIds = new Set();
  let previousFireUntil = 0, shotPulses = 0, evacuatedAt = null, moveIssued = false, homeReachedAt = null;
  const deadline = MAX_SECONDS * 30;
  for (let tick = 0; tick < deadline && game.status === 'playing'; tick++) {
    if (game.construction?.defId === 'bunker' && game.construction.ready && !bunker) {
      site = forwardSite(game, factory);
      if (site) {
        const result = game.issueBuild('bunker', site.x, site.y);
        if (result.ok) {
          bunker = game.getEntity(result.id);
          events.push({ type: 'bunkerPlaced', time: +game.time.toFixed(1), x: site.x, y: site.y });
        }
      }
    }

    if (bunker && !crewIds.length) {
      const rockets = game.units.filter(unit => unit.owner === 'player' && unit.defId === 'rocket' &&
        unit.hp > 0 && !unit.embarkedIn).sort((a, b) => a.id.localeCompare(b.id));
      if (rockets.length >= 2 && openingRifles[0].hp > 0 && !openingRifles[0].embarkedIn) {
        crewIds = [rockets[0].id, rockets[1].id, openingRifles[0].id];
        boardingXp = Object.fromEntries(crewIds.map(id => [id, game.getEntity(id)?.xp || 0]));
        game.select(crewIds);
        const order = game.issueGarrison(bunker.id);
        if (order.ok) events.push({ type: 'crewBoardedOrder', time: +game.time.toFixed(1), crewIds: [...crewIds] });
        else crewIds = [];
      }
    }

    if (bunker?.garrisonIds?.length === 3 && housedAt === null) {
      housedAt = +game.time.toFixed(1);
      events.push({ type: 'fullOccupancy', time: housedAt, garrisonIds: [...bunker.garrisonIds] });
    }

    const oldFireUntil = previousFireUntil;
    advance(game, clock);
    if (bunker && bunker.garrisonFireUntil > oldFireUntil + 1e-7) {
      shotPulses++;
      if (firedAt === null) firedAt = +game.time.toFixed(1);
    }
    if (bunker) previousFireUntil = bunker.garrisonFireUntil || 0;

    for (const effect of game.effects) {
      if (effect.type !== 'projectile' || !crewIds.includes(effect.sourceId) || crewProjectileIds.has(effect.id)) continue;
      crewProjectileIds.add(effect.id);
      crewProjectileCount++;
      const targetKey = effect.targetId || 'untargeted';
      projectileTargets[targetKey] = (projectileTargets[targetKey] || 0) + 1;
      if (checkpointAt !== null) {
        postShotProjectiles++;
      }
    }

    if (bunker?.garrisonIds?.length === 3 && shotPulses > 0 && !checkpointSerialized) {
      // This is the root's live UI QA save: original AI/terrain/economy plus a
      // paid, completed bunker with three visibly firing occupants.
      checkpointSerialized = game.serialize();
      checkpointAt = +game.time.toFixed(1);
      checkpointXp = Object.fromEntries(crewIds.map(id => [id, game.getEntity(id)?.xp || 0]));
      crewHpAtCheckpoint = Object.fromEntries(crewIds.map(id => [id, game.getEntity(id)?.hp || 0]));
      bunkerHpAtCheckpoint = bunker.hp;
      events.push({ type: 'healthyCheckpoint', time: +game.time.toFixed(1), bytes: checkpointSerialized.length });
    }

    // Focus the nearest ordinary visible enemy when the bunker crew can attack
    // it; this public order is optional if no eligible target is visible yet.
    if (checkpointAt !== null && !focusTargetId) {
      const candidates = game.visibleEnemies.filter(enemy => enemy.owner === 'enemy' && enemy.hp > 0)
        .sort((a, b) => Math.hypot((a.x + (a.w || 0) / 2) - (bunker.x + 1),
          (a.y + (a.h || 0) / 2) - (bunker.y + 1)) -
          Math.hypot((b.x + (b.w || 0) / 2) - (bunker.x + 1),
            (b.y + (b.h || 0) / 2) - (bunker.y + 1)) || a.id.localeCompare(b.id));
      for (const enemy of candidates) {
        game.select(bunker.id);
        const attack = game.issueAttack(enemy.id);
        if (attack.ok) {
          focusTargetId = enemy.id;
          focusTargetHpBefore = enemy.hp;
          events.push({ type: 'bunkerFocus', time: +game.time.toFixed(1), targetId: enemy.id,
            defId: enemy.defId, hp: enemy.hp });
          break;
        }
      }
    }

    const crewXpNow = crewIds.reduce((sum, id) => sum + (game.getEntity(id)?.xp || 0), 0);
    const crewXpBefore = crewIds.reduce((sum, id) => sum + (boardingXp[id] || 0), 0);
    const engagementElapsed = firedAt === null ? 0 : game.time - firedAt;
    const engagementProven = crewXpNow > crewXpBefore && postShotProjectiles >= 3;
    const engagementExpired = engagementElapsed >= 35;
    if (checkpointSerialized && evacuatedAt === null && engagementElapsed >= 8 &&
        (engagementProven || engagementExpired || game.status !== 'playing')) {
      bunkerHpAtEvacuation = bunker?.hp || 0;
      crewHpAtEvacuation = Object.fromEntries(crewIds.map(id => [id, game.getEntity(id)?.hp || 0]));
      if (focusTargetId) targetDamageAtEnd = Math.max(0, focusTargetHpBefore - (game.getEntity(focusTargetId)?.hp || 0));
      game.select(bunker.id);
      requireOk(game.issueEvacuateGarrison(bunker.id), 'evacuate the full bunker');
      evacuatedAt = +game.time.toFixed(1);
      events.push({ type: 'bunkerEvacuated', time: evacuatedAt, engagementElapsed: +engagementElapsed.toFixed(1),
        crewXpGain: +((crewXpNow - crewXpBefore).toFixed(1)), projectiles: postShotProjectiles,
        focusedTargetDamage: targetDamageAtEnd });
    } else if (evacuatedAt !== null && !moveIssued) {
      const survivors = crewIds.filter(id => {
        const unit = game.getEntity(id);
        return unit?.hp > 0 && !unit.embarkedIn;
      });
      if (survivors.length) {
        game.select(survivors);
        requireOk(game.issueMove(factory.x + factory.w / 2, factory.y + factory.h / 2), 'move evacuated crew home');
        moveIssued = true;
        events.push({ type: 'crewSentHome', time: +game.time.toFixed(1), survivors: survivors.length });
      }
    }
    if (moveIssued && homeReachedAt === null) {
      const survivors = crewIds.map(id => game.getEntity(id)).filter(unit => unit?.hp > 0);
      const homeX = factory.x + factory.w / 2, homeY = factory.y + factory.h / 2;
      if (survivors.length && survivors.every(unit => Math.hypot(unit.x - homeX, unit.y - homeY) <= 3)) {
        homeReachedAt = +game.time.toFixed(1);
        events.push({ type: 'crewReachedFactory', time: homeReachedAt, survivors: survivors.length });
      }
    }
    if (homeReachedAt !== null) break;
  }

  recorder.dispose();
  const replayEnvelope = { ...ENVELOPE, faction };
  validateSoloReplay(replayEnvelope, recorder.commands, clock.completedTicks, GARRISON_RULES_VERSION);
  const playback = createSoloPlayback(replayEnvelope, recorder.commands, clock.completedTicks, GARRISON_RULES_VERSION);
  playback.step(clock.completedTicks);
  for (const key of ['units', 'buildings', 'credits', 'terrain', 'effects', 'time', 'status'])
    assert.deepEqual(playback.game[key], game[key], `${faction}: ${key} must replay exactly through combat and evacuation`);
  const livingCrew = crewIds.filter(id => game.getEntity(id)?.hp > 0).length;
  const result = {
    faction, seed: ENVELOPE.seed, rules: GARRISON_RULES_VERSION, exactReplay: true,
    purchases, site, bunkerId: bunker?.id || null,
    timeline: events,
    shots: { bunkerFirePulses: shotPulses, firstAt: firedAt },
    outcome: { status: game.status, time: +game.time.toFixed(1), occupancy: bunker?.garrisonIds?.length || 0,
      evacuatedAt, homeReachedAt, livingCrew, reason: homeReachedAt !== null ? 'full crew fired, checkpoint saved, and surviving crew reached the factory' :
        checkpointSerialized ? 'full crew fired, checkpoint saved, and evacuation ordered' :
        !site ? 'no legal forward site' : game.status !== 'playing' ? `battle ended: ${game.status}` : 'route reached its time bound before full occupancy and fire' },
    engagement: {
      secondsHeldAfterFirstShot: firedAt !== null && evacuatedAt !== null ? +(evacuatedAt - firedAt).toFixed(1) : 0,
      engagementVerified: firedAt !== null && evacuatedAt !== null && evacuatedAt - firedAt >= 8 &&
        crewProjectileCount >= 3 && crewIds.some(id => (game.getEntity(id)?.xp || 0) > (boardingXp[id] || 0)),
      crewProjectiles: crewProjectileCount, crewProjectilesAfterCheckpoint: postShotProjectiles,
      projectileTargets,
      focusTargetId, focusShots: focusTargetId ? (projectileTargets[focusTargetId] || 0) : 0,
      focusedTargetHpBefore: focusTargetHpBefore,
      focusedTargetHpAfter: focusTargetId ? game.getEntity(focusTargetId)?.hp ?? 0 : null,
      focusedTargetDamage: focusTargetId ? Math.max(0, (focusTargetHpBefore || 0) - (game.getEntity(focusTargetId)?.hp || 0)) : 0,
      crewXpAtBoarding: boardingXp,
      crewXpAtCheckpoint: checkpointXp,
      crewXpAtEnd: Object.fromEntries(crewIds.map(id => [id, game.getEntity(id)?.xp || 0])),
      crewXpGain: crewIds.reduce((sum, id) => sum + (game.getEntity(id)?.xp || 0) - (boardingXp[id] || 0), 0),
      crewKills: Object.fromEntries(crewIds.map(id => [id, game.getEntity(id)?.kills || 0])),
      bunkerHpAtCheckpoint, bunkerHpAtEvacuation,
      crewHpAtCheckpoint, crewHpAtEvacuation,
    },
    checkpointSerialized,
    checkpointBytes: checkpointSerialized?.length || 0,
    commands: recorder.commands,
    completedTicks: clock.completedTicks,
  };
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const requested = process.argv.slice(2).filter(arg => ['--aegis', '--vesper'].includes(arg)).map(arg => arg.slice(2));
  const factions = requested.length ? requested : ['aegis', 'vesper'];
  for (const faction of factions) {
    const result = runBunkerPublicPlaytest(faction);
    const { checkpointSerialized, commands, ...summary } = result;
    console.log(JSON.stringify({ ...summary, commandCount: commands.length }));
  }
}
