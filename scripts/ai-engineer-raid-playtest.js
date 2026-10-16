// Reproducible full-AI capture-raid probe. The paired rule runs keep the
// generated bases and armies intact; only the stated corridor is normalized.
import { BUILDING_DEFS, Game, UNIT_DEFS } from '../src/game/engine.js';
import { SOLO_STEP_SECONDS } from '../src/game/soloClock.js';

const END_TIME = 180;
const STEP_FRAMES = Math.round(1 / SOLO_STEP_SECONDS);

function expansionCashGoal(game) {
  const count = id => game.buildings.filter(building => building.owner === 'enemy' && building.hp > 0 &&
    building.progress >= 1 && building.defId === id).length;
  const yards = game.buildings.filter(building => building.owner === 'enemy' && building.defId === 'command' &&
    building.hp > 0);
  const outpost = yards.find(building => building.id === game._aiExpansionTarget?.yardId) || yards[1];
  const outpostRefinery = outpost && game.buildings.some(building => building.owner === 'enemy' &&
    building.defId === 'refinery' && building.hp > 0 && building.progress >= 1 &&
    Math.hypot(Math.max(0, outpost.x - (building.x + building.w)), Math.max(0, building.x - (outpost.x + outpost.w)),
      Math.max(0, outpost.y - (building.y + building.h)), Math.max(0, building.y - (outpost.y + building.h))) <= 8);
  const refineryInProgress = game.buildings.some(building => building.owner === 'enemy' &&
    building.defId === 'refinery' && building.hp > 0 && building.progress < 1);
  if (game._aiUnderRelayDominionPressure() || !game._aiExpansionEnabled() ||
      game.time < (game._aiSiegeDirectorActive() ? 70 : 90)) return 0;
  if (count('refinery') < 2 && !refineryInProgress && count('factory') && count('refinery'))
    return BUILDING_DEFS.refinery.cost + 200;
  if (count('refinery') >= 2 && !count('radar')) return BUILDING_DEFS.radar.cost + 200;
  if (count('refinery') >= 2 && count('radar') && !count('tech')) return BUILDING_DEFS.tech.cost + 200;
  if (game._aiExpansionTarget && !outpostRefinery)
    return game._aiExpansionTarget.stage === 'funding' ? UNIT_DEFS.mcv.cost + 200 : BUILDING_DEFS.refinery.cost + 200;
  return 0;
}

function run(replayVersion, response = 'none') {
  const game = new Game({ seed: 24, difficulty: 'normal', mapId: 'shard-valley', faction: 'aegis',
    victoryMode: 'elimination', replayVersion, aiCommanderProfileId: 'siege-director' });
  game.time = 120;
  for (let y = 16; y <= 23; y++) for (let x = 34; x <= 44; x++)
    Object.assign(game.terrain[y][x], { type: 'sand', walkable: true, buildable: true,
      crystal: 0, elevation: 0, resource: 0 });

  const target = game._createBuilding('player', 'refinery', 38, 18, 1);
  target.hp = target.maxHp * 0.7;
  const defender = game.units.find(unit => unit.owner === 'player' && unit.defId === 'lightTank');
  if (!defender) throw new Error('Seed 24 no longer has the expected player light tank.');
  defender.x = 36.5; defender.y = 21.5;
  defender.stance = 'holdFire';
  defender.order = { type: 'idle' };
  let interceptUnit = response === 'intercept' ? defender : null;
  if (response === 'interceptBuggy') {
    interceptUnit = game._createUnit('player', 'buggy', 41.5, 21.5);
    interceptUnit.stance = 'holdFire';
    interceptUnit.order = { type: 'idle' };
  }
  game.credits.player = 7000;
  if (response === 'interceptBuggy') game.credits.player -= 450;
  game.credits.enemy = 7000;
  game._refreshPower();
  game._updateFog();

  const timeline = [];
  const mark = (type, details = {}) => timeline.push({ t: +game.time.toFixed(2), type, ...details });
  const result = { replayVersion, response, startedAt: game.time,
    initialTargetHp: Math.round(target.hp), initialPlayerTank: defender.id };
  let raidId = null, queuedAt = null, spawnedAt = null, spottedAt = null, capturedAt = null;
  let minTargetHp = target.hp;
  let reportedEconomyProtection = false;
  const hpTrace = [];
  const targetDamageByOwner = {};
  const originalApplyDamage = game._applyDamage.bind(game);
  game._applyDamage = (entity, damage, damageType, attackerOwner, sourceId, ...rest) => {
    const before = entity?.id === target.id ? entity.hp : null;
    const value = originalApplyDamage(entity, damage, damageType, attackerOwner, sourceId, ...rest);
    if (before != null && before > target.hp) {
      const key = attackerOwner || 'environment';
      targetDamageByOwner[key] = (targetDamageByOwner[key] || 0) + before - target.hp;
    }
    return value;
  };
  const originalRaidTick = game._aiEngineerCaptureRaidTick.bind(game);
  game._aiEngineerCaptureRaidTick = (options = {}) => {
    const before = game._aiEngineerRaidState?.active;
    const beforeTarget = before && game.getEntity(before.targetId);
    const beforeEngineer = before && game.units.some(unit => unit._aiEngineerRaid?.raidId === before.raidId && unit.hp > 0);
    const beforeQueue = before && game.buildings.some(building => building.queue?.some(item =>
      item.aiEngineerRaid?.raidId === before.raidId));
    const targetValid = before && game._aiEngineerRaidTargetValid(beforeTarget);
    const protectedEconomy = !!options.protectedEconomy;
    const combatUnits = options.combatUnits || [];
    const priorityBusy = before && game._aiEngineerRaidPriorityBusy(combatUnits);
    const harvesterReserve = game._aiEconomyReserve('enemy');
    const reserveRecovery = !!before && !beforeEngineer && !!beforeQueue && harvesterReserve > 0 &&
      game.credits.enemy < harvesterReserve;
    const homeAssets = [...game.buildings, ...game.units].filter(entity => entity.owner === 'enemy' && entity.hp > 0 &&
      ['command', 'refinery', 'factory'].includes(entity.defId));
    const nearbyPlayerThreats = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
      UNIT_DEFS[unit.defId]?.weapon && game.isVisible(unit, 'enemy')).flatMap(unit => homeAssets
      .map(asset => ({ unit, asset, distance: Math.hypot(unit.x - (asset.x + (asset.w || 0) / 2),
        unit.y - (asset.y + (asset.h || 0) / 2)) }))
      .filter(entry => entry.distance < 8).map(entry => ({ unitId: entry.unit.id,
        defId: entry.unit.defId, assetId: entry.asset.id, asset: entry.asset.defId,
        distance: +entry.distance.toFixed(1) })));
    const defenseUnits = combatUnits.filter(unit => unit._aiDefenseTarget || unit.order?.aiDefense)
      .map(unit => unit.id);
    const relayPressure = game._aiUnderRelayDominionPressure();
    const commandRecovery = !!game._aiCommandRecovery;
    const commandAlive = game.hasBuilding('enemy', 'command');
    const timedOut = before && before.deadline <= game.time;
    const resultValue = originalRaidTick(options);
    if (before && options.protectedEconomy && !reportedEconomyProtection) {
      reportedEconomyProtection = true;
      mark('economyProtectingActiveRaid', { credits: Math.round(game.credits.enemy),
        expansionCashGoal: expansionCashGoal(game), expansionStage: game._aiExpansionTarget?.stage ?? null,
        commandRecovery: game._aiCommandRecovery?.stage ?? null,
        harvesterReserve: game._aiEconomyReserve('enemy') });
    }
    if (before && !game._aiEngineerRaidState?.active) {
      const targetStatus = !beforeTarget ? 'missing' : beforeTarget.hp <= 0 ? 'destroyed' :
        beforeTarget.owner !== 'player' ? 'owner-changed' : beforeTarget.progress < 1 ? 'incomplete' :
        beforeTarget.hp / beforeTarget.maxHp > 0.75 ? 'repaired-above-threshold' :
        !game.isVisible(beforeTarget, 'enemy') ? 'currently-concealed' : 'eligible';
      mark('raidReleased', { raidId: before.raidId,
        releaseSnapshot: { timedOut: !!timedOut, targetValid: !!targetValid, targetStatus,
          priorityBusy: !!priorityBusy, priorityInputs: { relayPressure, commandRecovery, commandAlive,
            defenseUnits, nearbyPlayerThreats }, reserveRecovery, hadTaggedEngineer: !!beforeEngineer,
          hadTaggedQueue: !!beforeQueue },
        targetHp: Math.round(beforeTarget?.hp ?? 0), protectedEconomyInput: protectedEconomy,
        protectedEconomyAffectsActiveRaid: false });
    }
    return resultValue;
  };
  game.onEvent = event => {
    if (event.type === 'engineerRaidSpotted') {
      spottedAt ??= game.time;
      mark('spotted', { unitId: event.unitId, targetId: event.targetId,
        sector: [event.sectorX, event.sectorY] });
      if (response === 'repair') {
        const command = game.toggleRepair(target.id);
        mark('playerRepair', { ok: command.ok, active: command.active });
      } else if (response === 'intercept') {
        const raider = game.getEntity(event.unitId);
        const selected = game.select(interceptUnit.id);
        const command = game.issueAttack(raider.id);
        mark('playerAttack', { selected: selected?.ok ?? !!selected,
          ok: command.ok, reason: command.reason ?? null, raiderId: raider.id,
          unitId: interceptUnit.id, defId: interceptUnit.defId });
      } else if (response === 'interceptBuggy') {
        const raider = game.getEntity(event.unitId);
        const selected = game.select(interceptUnit.id);
        const command = game.issueAttack(raider.id);
        mark('playerAttack', { selected: selected?.ok ?? !!selected,
          ok: command.ok, reason: command.reason ?? null, raiderId: raider.id,
          unitId: interceptUnit.id, defId: interceptUnit.defId });
      }
    } else if (event.type === 'buildingCaptured' && event.id === target.id) {
      capturedAt ??= game.time;
      mark('captured', { owner: event.owner, by: event.by });
    }
  };

  let nextSample = Math.ceil(game.time);
  for (let frame = 0; frame < (END_TIME - 120) * STEP_FRAMES && game.status === 'playing'; frame++) {
    game.update(SOLO_STEP_SECONDS);
    minTargetHp = Math.min(minTargetHp, target.hp);
    const active = game._aiEngineerRaidState?.active;
    if (active && active.raidId !== raidId) {
      raidId = active.raidId;
      mark('raidReserved', { raidId, targetId: active.targetId, deadline: active.deadline });
    }
    const taggedQueue = game.buildings.flatMap(building => (building.queue || []).map(item =>
      ({ building, item }))).find(entry => entry.item.aiEngineerRaid?.raidId === raidId);
    if (taggedQueue && queuedAt === null) {
      queuedAt = game.time;
      mark('taggedEngineerQueued', { buildingId: taggedQueue.building.id,
        progress: +taggedQueue.item.progress.toFixed(3) });
    }
    if (raidId && spawnedAt === null) {
      const raider = game.units.find(unit => unit._aiEngineerRaid?.raidId === raidId);
      if (raider) {
        spawnedAt = game.time;
        mark('engineerSpawned', { unitId: raider.id, x: +raider.x.toFixed(1), y: +raider.y.toFixed(1) });
      }
    }
    if (game.time >= nextSample) {
      if (target.hp > 0) {
        hpTrace.push([+game.time.toFixed(2), Math.round(target.hp)]);
      }
      nextSample += 5;
    }
    if (target.hp <= 0 && !result.targetDestroyedAt) {
      result.targetDestroyedAt = +game.time.toFixed(2);
      mark('targetDestroyed', { owner: target.owner });
    }
  }

  result.endedAt = +game.time.toFixed(2);
  result.target = { owner: target.owner, hp: Math.round(target.hp), minHp: Math.round(minTargetHp),
    repairing: target.repairing, damageByOwner: Object.fromEntries(Object.entries(targetDamageByOwner)
      .map(([owner, damage]) => [owner, Math.round(damage)])) };
  result.target.hpTrace = hpTrace;
  result.raid = { raidId, queuedAt: queuedAt == null ? null : +queuedAt.toFixed(2),
    spawnedAt: spawnedAt == null ? null : +spawnedAt.toFixed(2),
    spottedAt: spottedAt == null ? null : +spottedAt.toFixed(2),
    capturedAt: capturedAt == null ? null : +capturedAt.toFixed(2),
    endingState: game._aiEngineerRaidState?.active ?? null,
    cooldownUntil: game._aiEngineerRaidState?.cooldownUntil ?? null,
    liveTaggedEngineers: game.units.filter(unit => unit._aiEngineerRaid?.raidId === raidId && unit.hp > 0).length,
    taggedQueueJobs: game.buildings.flatMap(building => building.queue || [])
      .filter(item => item.aiEngineerRaid?.raidId === raidId).length };
  result.timeline = timeline;
  return result;
}

const runs = [run(69), run(70), run(70, 'repair'), run(70, 'intercept'), run(70, 'interceptBuggy')];
console.log(JSON.stringify({ setup: { seed: 24, difficulty: 'normal', map: 'shard-valley', faction: 'aegis',
  victoryMode: 'elimination', commanderProfile: 'siege-director', startTime: 120, endTime: END_TIME,
  credits: { player: 7000, enemy: 7000 }, target: 'player refinery at 38,18; 70% HP',
  defender: 'player light tank at 36.5,21.5; holdFire and idle',
  buggyInterception: 'separate v70 case; authored Buggy at 41.5,21.5, holdFire and idle; subtract $450 from player credits',
  flattenedTiles: 'x34..44, y16..23 only', ai: 'all handlers enabled; original bases and armies retained' }, runs }, null, 2));
