// Adaptive deterministic public-order relay playtest. Decisions use player-owned
// state, current fog, and public relay locations/last observed ownership only.
import { Game, SKIRMISH_MAPS } from '../src/game/engine.js';

const args = process.argv.slice(2);
const victoryMode = args.includes('--elimination') ? 'elimination' : undefined;
const difficulty = args.find(arg => arg.startsWith('--difficulty='))?.split('=')[1] || 'normal';
const seeds = args.find(arg => arg.startsWith('--seeds='))?.split('=')[1].split(',').map(Number) || [481516];
const compact = args.includes('--compact');
const diagnostics = args.includes('--postrun-diagnostics');
const techInvestment = args.includes('--tech-investment');
const defendRetake = args.includes('--defend-retake');
const extensionSeconds = Number(args.find(arg => arg.startsWith('--extension='))?.split('=')[1] || 0);
const factionFlags = args.filter(arg => ['--aegis', '--vesper'].includes(arg)).map(arg => arg.slice(2));
const maps = args.filter(arg => !arg.startsWith('--')).length
  ? args.filter(arg => !arg.startsWith('--')) : ['shard-valley', 'twin-passes'];
const factions = factionFlags.length ? factionFlags : ['aegis', 'vesper'];

function simulate(mapId, faction, seed) {
  const game = new Game({ seed, difficulty, mapId, faction, ...(victoryMode ? { victoryMode } : {}) });
  const lastRelayOwner = new Map(game.relays.map(r => [r.id, null]));
  const observedEnemyIntel = new Map();
  const events = [];
  game.onEvent = event => {
    if (['relayCaptured', 'relayNeutralized', 'doctrineReady', 'doctrineResearch', 'commandAbility', 'stormcallPulse', 'stormcallCanceled',
      'constructionReady', 'unitReady', 'relayDominionStarted', 'relayDominionBroken', 'relayDominionComplete', 'victory', 'defeat'].includes(event.type) &&
      (!['unitReady', 'constructionReady', 'doctrineReady', 'doctrineResearch'].includes(event.type) || event.owner === 'player')) {
      events.push(event);
      if (event.type === 'relayCaptured' && event.owner === 'player') playerRelayCaptureTimes.push(+event.time.toFixed(0));
      if (event.type === 'relayDominionStarted') {
        dominionStarts.push({ owner: event.owner, time: +event.time.toFixed(0) });
        if (event.owner === 'enemy' && firstEnemyMajorityAt === null) firstEnemyMajorityAt = +event.time.toFixed(0);
      }
    }
  };
  let nextOrders = 0, nextBuild = 8, nextCommand = 0;
  // Established skirmish openings already include a refinery and power plant.
  // Seed the progression flags from the actual opening so radar/tech research
  // can proceed instead of waiting forever for an impossible duplicate build.
  let expansionQueued = techInvestment && game.hasBuilding('player', 'refinery');
  let powerQueued = techInvestment && game.hasBuilding('player', 'power');
  let radarQueued = techInvestment && game.hasBuilding('player', 'radar');
  let techQueued = techInvestment && game.hasBuilding('player', 'tech');
  let backupPowerQueued = techInvestment && game.buildings.filter(b => b.owner === 'player' &&
    ['power', 'advancedPower'].includes(b.defId)).length > 1;
  let doctrineStarted = !!game.research.player.doctrine;
  let techProduced = false, queuedHarvesters = 0;
  const sentToRelay = new Map();
  const relayAssignments = new Map();
  const retakeTargets = new Set();
  const threatenedRelayTargets = new Set();
  const dispatchedRetakeTargets = new Set();
  const relayPolicyEvents = [];
  const playerRelayCaptureTimes = [];
  const dominionStarts = [];
  let peakPlayerRelays = 0, firstEnemyMajorityAt = null, firstKnownEnemyMajorityAt = null;
  const ownStart = game.buildings.find(b => b.owner === 'player' && b.defId === 'command');
  const home = { x: ownStart.x + ownStart.w / 2, y: ownStart.y + ownStart.h / 2 };
  const center = { x: game.width / 2, y: game.height / 2 };
  const directionLength = Math.hypot(center.x - home.x, center.y - home.y);
  const direction = { x: (center.x - home.x) / directionLength, y: (center.y - home.y) / directionLength };
  const route = [...game.relays].filter(r => (r.x - home.x) * direction.x + (r.y - home.y) * direction.y > 4)
    .sort((a, b) => (a.x - home.x) * direction.x + (a.y - home.y) * direction.y -
      ((b.x - home.x) * direction.x + (b.y - home.y) * direction.y))
    .map(r => ({ x: r.x, y: r.y }));
  route.push(center);
  for (let step = 1; step <= 3; step++) {
    const x = center.x + direction.x * step * 8, y = center.y + direction.y * step * 8;
    if (x > 1 && x < game.width - 1 && y > 1 && y < game.height - 1) route.push({ x, y });
  }
  let assaultStarted = false, routeIndex = 0, attackOrders = 0;
  let contactEpisodes = 0, quietSeconds = 0, longestQuietSeconds = 0, lastContactAt = null, inContact = false;
  const decisionPoints = [];
  let nextDecisionPoint = 30;
  const sweep = [];
  if (extensionSeconds > 0) {
    for (let y = 4; y < game.height - 2; y += 8) for (let x = 4; x < game.width - 2; x += 8) {
      if ((x - home.x) * direction.x + (y - home.y) * direction.y < directionLength * 0.6) continue;
      sweep.push({ x, y });
    }
    sweep.sort((a, b) => Math.hypot(a.x - route.at(-1).x, a.y - route.at(-1).y) -
      Math.hypot(b.x - route.at(-1).x, b.y - route.at(-1).y));
  }
  let sweepIndex = 0;
  const sweepIntelIds = new Set();
  const place = (defId) => {
    for (let y = 1; y < game.height - 4; y++) for (let x = 1; x < game.width - 4; x++) {
      const d = game.buildingDefs[defId];
      let revealed = true;
      for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++)
        if (game.fog[yy][xx] !== 2) revealed = false;
      if (!revealed) continue;
      if (game.canPlaceBuilding(defId, x, y).ok) return game.issueBuild(defId, x, y);
    }
    return { ok: false, reason: 'No legal revealed connected build site.' };
  };
  const build = (id) => {
    if (!game.construction) {
      const result = game.startConstruction(id);
      if (!result.ok) return result;
    }
    if (game.construction?.defId !== id || !game.construction.ready) return { ok: true, pending: true };
    return place(id);
  };
  const move = (unit, target) => {
    game.select(unit.id); return game.issueMove(target.x, target.y, true);
  };
  while (game.status === 'playing' && game.time < 900 + extensionSeconds) {
    if (game.time >= nextOrders) {
      nextOrders = game.time + 3;
      for (const r of game.relays) if (game.fog[Math.floor(r.y)]?.[Math.floor(r.x)] === 2) {
        const previousOwner = lastRelayOwner.get(r.id);
        if (previousOwner === 'player' && r.owner !== 'player') {
          retakeTargets.add(r.id);
          relayPolicyEvents.push({ time: +game.time.toFixed(0), type: 'lost', relayId: r.id, owner: r.owner });
        } else if (r.owner === 'player' && retakeTargets.has(r.id)) {
          retakeTargets.delete(r.id);
          dispatchedRetakeTargets.delete(r.id);
          relayPolicyEvents.push({ time: +game.time.toFixed(0), type: 'retaken', relayId: r.id });
        }
        lastRelayOwner.set(r.id, r.owner);
      }
      const army = game.units.filter(u => u.owner === 'player' && u.hp > 0 && !u.embarkedIn &&
        ['lightTank', 'guardian', 'stealthTank', 'rifle', 'rocket', 'scout', 'flamer'].includes(u.defId));
      const knownEnemyMajority = [...lastRelayOwner.values()].filter(owner => owner === 'enemy').length >= 2;
      if (knownEnemyMajority && firstKnownEnemyMajorityAt === null) firstKnownEnemyMajorityAt = +game.time.toFixed(0);
      const targetFor = unit => [...game.relays].sort((a, b) => {
        const rank = relay => {
          const owner = lastRelayOwner.get(relay.id);
          if (defendRetake && (retakeTargets.has(relay.id) || threatenedRelayTargets.has(relay.id))) return 0;
          if (knownEnemyMajority) return owner === 'enemy' ? 0 : owner === 'player' ? 2 : 1;
          return owner === 'player' ? 2 : owner === 'enemy' ? 0 : 1;
        };
        return rank(a) - rank(b) || (sentToRelay.get(a.id) || 0) - (sentToRelay.get(b.id) || 0) ||
          Math.hypot(unit.x - a.x, unit.y - a.y) - Math.hypot(unit.x - b.x, unit.y - b.y);
      })[0];
      const armored = army.filter(u => ['lightTank', 'guardian', 'stealthTank'].includes(u.defId));
      // Project the starting force early; pivot toward known enemy-held relays as soon as they form a majority.
      if (!assaultStarted && (game.time >= 24 || knownEnemyMajority) && army.length >= 3) assaultStarted = true;
      const visibleEnemies = game.visibleEnemies.filter(e => e.owner === 'enemy' && e.hp > 0);
      for (const e of visibleEnemies) observedEnemyIntel.set(e.id, { defId: e.defId,
        kind: e.w ? 'building' : 'unit', x: +(e.x + (e.w || 0) / 2).toFixed(1),
        y: +(e.y + (e.h || 0) / 2).toFixed(1), seenAt: +game.time.toFixed(0) });
      if (defendRetake) for (const relay of game.relays) {
        const playerOwns = lastRelayOwner.get(relay.id) === 'player';
        const threatened = playerOwns && visibleEnemies.some(enemy =>
          Math.hypot(enemy.x + (enemy.w || 0) / 2 - relay.x, enemy.y + (enemy.h || 0) / 2 - relay.y) <= 5);
        if (threatened && !threatenedRelayTargets.has(relay.id)) {
          threatenedRelayTargets.add(relay.id);
          relayPolicyEvents.push({ time: +game.time.toFixed(0), type: 'threatened', relayId: relay.id });
        } else if (!threatened && game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] === 2 &&
          threatenedRelayTargets.delete(relay.id)) {
          relayPolicyEvents.push({ time: +game.time.toFixed(0), type: 'threat-cleared', relayId: relay.id });
        }
      }
      if (extensionSeconds > 0 && game.time >= 900) {
        const rememberedTargets = [...observedEnemyIntel.entries()].filter(([id]) => !sweepIntelIds.has(id));
        for (const [id] of rememberedTargets) sweepIntelIds.add(id);
        if (rememberedTargets.length)
          sweep.splice(sweepIndex, 0, ...rememberedTargets.map(([, seen]) => ({ x: seen.x, y: seen.y, lastSeen: true })));
      }
      const attackingUnitIds = new Set();
      if (visibleEnemies.length && army.length) {
        const target = visibleEnemies.sort((a, b) => {
          const ac = { x: a.x + (a.w || 0) / 2, y: a.y + (a.h || 0) / 2 };
          const bc = { x: b.x + (b.w || 0) / 2, y: b.y + (b.h || 0) / 2 };
          return Math.hypot(ac.x - center.x, ac.y - center.y) - Math.hypot(bc.x - center.x, bc.y - center.y);
        })[0];
        const tx = target.x + (target.w || 0) / 2, ty = target.y + (target.h || 0) / 2;
        const attackers = army.filter(unit => Math.hypot(unit.x - tx, unit.y - ty) < 9);
        if (attackers.length) {
          game.select(attackers.map(u => u.id));
          if (game.issueAttack(target.id).ok) {
            attackOrders++;
            for (const unit of attackers) attackingUnitIds.add(unit.id);
          }
        }
      }
      relayAssignments.clear();
      // Leave one nearest ground unit at each safely held relay. This prevents
      // the whole force from abandoning a captured relay and makes a retake
      // begin immediately when a visible enemy contests it.
      const reserveTargets = [];
      const reserved = new Set();
      for (const relay of game.relays) {
        if (lastRelayOwner.get(relay.id) !== 'player' || retakeTargets.has(relay.id) ||
            threatenedRelayTargets.has(relay.id)) continue;
        const guard = army.filter(unit => !reserved.has(unit.id) && !attackingUnitIds.has(unit.id))
          .sort((a, b) => Math.hypot(a.x - relay.x, a.y - relay.y) - Math.hypot(b.x - relay.x, b.y - relay.y))[0];
        if (guard) { reserved.add(guard.id); reserveTargets.push({ unit: guard, x: relay.x, y: relay.y }); }
      }
      const reserveUnits = reserveTargets.map(target => target.unit);
      const reserveIds = new Set(reserveUnits.map(unit => unit.id));
      const guardsToSet = [];
      for (const { unit, ...target } of reserveTargets) {
        if (attackingUnitIds.has(unit.id)) continue;
        if (Math.hypot(unit.x - target.x, unit.y - target.y) > 2.0) {
          if (unit.order?.type !== 'move' || Math.hypot(unit.order.x - target.x, unit.order.y - target.y) > 2.0)
            move(unit, target);
        } else if (unit.order?.type !== 'guard') guardsToSet.push(unit.id);
      }
      if (guardsToSet.length) { game.select(guardsToSet); game.issueGuard(); }
      for (const unit of army) {
        if (reserveIds.has(unit.id)) continue;
        const relay = targetFor(unit);
        if (!relay) continue;
        relayAssignments.set(unit.id, relay.id);
        if (defendRetake && retakeTargets.has(relay.id) && !dispatchedRetakeTargets.has(relay.id)) {
          dispatchedRetakeTargets.add(relay.id);
          relayPolicyEvents.push({ time: +game.time.toFixed(0), type: 'retake-order', relayId: relay.id });
        }
        // Preserve a live attack order for this cycle; otherwise the rally move would immediately overwrite it.
        if (!attackingUnitIds.has(unit.id) && Math.hypot(unit.x - relay.x, unit.y - relay.y) > 2.0 &&
          (unit.order?.type !== 'move' || Math.hypot(unit.order.x - relay.x, unit.order.y - relay.y) > 2.0))
          move(unit, relay);
        sentToRelay.set(relay.id, (sentToRelay.get(relay.id) || 0) + 1);
      }

    }
    if (game.time >= nextBuild) {
      nextBuild = game.time + 7;
      if (game.construction?.ready) place(game.construction.defId);
      const barracks = game.buildings.find(b => b.owner === 'player' && b.defId === 'barracks');
      const techPathComplete = game.hasBuilding('player', 'tech');
      if ((!techInvestment || techPathComplete) && barracks && barracks.queue.length < 2 &&
        game.canQueueUnit('rocket').ok) game.queueUnit('rocket');
      const factory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
      if ((!techInvestment || techPathComplete) && factory && factory.queue.length < 2) {
        const elite = faction === 'aegis' ? 'guardian' : 'stealthTank';
        techProduced ||= game.units.some(u => u.owner === 'player' && u.defId === elite);
        if (queuedHarvesters < 1 && game.canQueueUnit('harvester').ok)
          queuedHarvesters += Number(game.queueUnit('harvester').ok);
        else if (game.canQueueUnit('lightTank').ok) game.queueUnit('lightTank');
        if (game.hasBuilding('player', 'tech') && !techProduced && factory.queue.length < 2 && game.canQueueUnit(elite).ok)
          techProduced = game.queueUnit(elite).ok;
      }
      const canInvestInTech = techInvestment && game.credits.player >= 1000;
      if (!expansionQueued && game.canBuild('refinery').ok && !game.construction) {
        const result = build('refinery'); if (result.ok) expansionQueued = true;
      } else if (expansionQueued && game.hasBuilding('player', 'refinery') && !powerQueued &&
        game.canBuild('power').ok && !game.construction) {
        const result = build('power'); if (result.ok) powerQueued = true;
      } else if (powerQueued && game.hasBuilding('player', 'power') && !radarQueued &&
        canInvestInTech && game.canBuild('radar').ok && !game.construction) {
        const result = build('radar'); if (result.ok) radarQueued = true;
      } else if (radarQueued && game.hasBuilding('player', 'radar') && !backupPowerQueued &&
        game.power.player.ratio < 1 && game.canBuild('power').ok && !game.construction) {
        const result = build('power'); if (result.ok) backupPowerQueued = true;
      } else if (radarQueued && game.hasBuilding('player', 'radar') && !techQueued &&
        backupPowerQueued && game.power.player.ratio >= 1 && canInvestInTech &&
        game.canBuild('tech').ok && !game.construction) {
        const result = build('tech'); if (result.ok) techQueued = true;
      }
      if (game.hasBuilding('player', 'tech') && !doctrineStarted && game.credits.player >= 900) {
        const result = game.chooseDoctrine('signal'); if (result.ok) doctrineStarted = true;
      }
    }
    if (game.time >= nextCommand) {
      nextCommand = game.time + 3;
      const relay = game.relays.find(r => lastRelayOwner.get(r.id) === 'player' &&
        game.fog[Math.floor(r.y)]?.[Math.floor(r.x)] === 2);
      if (relay && (game.storm.phase === 'warning' || game.storm.phase === 'surge') &&
        game.canUseCommandAbility('stormcall', relay.x, relay.y).ok) game.useCommandAbility('stormcall', relay.x, relay.y);
      const threatened = game.units.find(u => u.owner === 'player' && u.hp > 0 &&
        ['lightTank', 'guardian', 'stealthTank'].includes(u.defId) && u.hp < u.maxHp * 0.75 &&
        game.fog[Math.floor(u.y)]?.[Math.floor(u.x)] === 2);
      if (threatened && game.canUseCommandAbility('shield', threatened.x, threatened.y).ok)
        game.useCommandAbility('shield', threatened.x, threatened.y);
      const factory = game.buildings.find(b => b.owner === 'player' && b.defId === 'factory');
      if (factory && (factory.queue.length || game.construction) &&
        game.canUseCommandAbility('overcharge', factory.x + 1.5, factory.y + 1.5).ok)
        game.useCommandAbility('overcharge', factory.x + 1.5, factory.y + 1.5);
      const scanTarget = game.time >= 900 && sweep[sweepIndex] ? sweep[sweepIndex] : route[routeIndex];
      if (assaultStarted && scanTarget && game.canUseCommandAbility('scan', scanTarget.x, scanTarget.y).ok)
        game.useCommandAbility('scan', scanTarget.x, scanTarget.y);
    }
    game.update(1);
    if (game.time >= nextDecisionPoint && game.status === 'playing') {
      const playerUnits = game.units.filter(u => u.owner === 'player' && u.hp > 0);
      const armyByType = {};
      for (const unit of playerUnits) armyByType[unit.defId] = (armyByType[unit.defId] || 0) + 1;
      decisionPoints.push({ time: +game.time.toFixed(0), credits: Math.round(game.credits.player),
        commandYardAlive: game.buildings.some(b => b.owner === 'player' && b.defId === 'command' && b.hp > 0),
        buildings: game.buildings.filter(b => b.owner === 'player' && b.hp > 0).map(b => b.defId),
        construction: game.construction ? { defId: game.construction.defId,
          progress: Math.round(game.construction.progress), ready: game.construction.ready } : null,
        productionQueues: game.buildings.filter(b => b.owner === 'player' && b.hp > 0 && b.queue.length)
          .map(b => ({ defId: b.defId, queue: b.queue.map(item => item.defId || item) })),
        power: { production: game.power.player.production, consumption: game.power.player.consumption,
          ratio: +game.power.player.ratio.toFixed(2) },
        armyByType, knownRelayOwners: game.relays.map(r => game.fog[Math.floor(r.y)]?.[Math.floor(r.x)] === 2
          ? r.owner : lastRelayOwner.get(r.id)),
        visibleEnemyCount: game.visibleEnemies.filter(e => e.owner === 'enemy' && e.hp > 0).length,
        doctrine: game.research.player.doctrine });
      nextDecisionPoint += 30;
    }
    peakPlayerRelays = Math.max(peakPlayerRelays, game.relays.filter(r => r.owner === 'player' && !r.contested).length);
    const contactNow = game.visibleEnemies.some(e => e.owner === 'enemy' && e.hp > 0);
    if (contactNow) {
      if (!inContact) contactEpisodes++;
      lastContactAt = game.time;
      quietSeconds = 0;
      inContact = true;
    } else {
      quietSeconds += 1;
      longestQuietSeconds = Math.max(longestQuietSeconds, quietSeconds);
      inContact = false;
    }
  }
  const visibleEnemies = game.visibleEnemies.filter(e => e.owner === 'enemy' && e.hp > 0);
  const strategy = techInvestment ? 'tech-rush' : defendRetake ? 'defend-retake' : 'relay-rush';
  const result = { seed, difficulty, mapId, faction, strategy,
    victoryMode: game.victoryMode, status: game.status, time: +game.time.toFixed(0), playerUnits: game.units.filter(u => u.owner === 'player').length,
    playerCredits: Math.round(game.credits.player), buildings: game.buildings.filter(b => b.owner === 'player').map(b => b.defId),
    techUnits: game.units.filter(u => u.owner === 'player' && ['guardian', 'stealthTank'].includes(u.defId)).length,
    doctrine: game.research.player.doctrine, relays: [...lastRelayOwner.values()].filter(x => x === 'player').length,
    playerRelayCaptureTimes, firstEnemyMajorityAt, firstKnownEnemyMajorityAt, dominionStarts, peakPlayerRelays,
    relayPolicyEvents,
    decisionPoints,
    techUnitsProduced: events.filter(e => e.type === 'unitReady' &&
      ['guardian', 'stealthTank'].includes(e.defId)).length,
    commandEnergy: Math.round(game.commandEnergy.player), abilities: events.filter(e => e.type === 'commandAbility').length,
    assaultOrders: attackOrders, assaultStarted, routeIndex, routeLength: route.length,
    stormEvents: events.filter(e => e.type.startsWith('stormcall')).map(e => e.type),
    events: events.map(e => `${e.time.toFixed(0)}:${e.type}${e.abilityId ? ':' + e.abilityId : ''}${e.defId ? ':' + e.defId : ''}${e.id ? ':' + e.id : ''}`),
    visibleEnemyCount: visibleEnemies.length, exploredTiles: game.fog.flat().filter(v => v > 0).length,
    currentVisibleTiles: game.fog.flat().filter(v => v === 2).length,
    leadPositions: game.units.filter(u => u.owner === 'player' && ['scout', 'lightTank', 'guardian', 'stealthTank'].includes(u.defId))
      .slice(0, 5).map(u => [u.defId, +u.x.toFixed(1), +u.y.toFixed(1)]),
    sweepIndex, sweepLength: sweep.length, contactEpisodes,
    quietSinceLastContact: lastContactAt === null ? +game.time.toFixed(0) : +(game.time - lastContactAt).toFixed(0),
    longestNoContactSeconds: longestQuietSeconds,
    noContactStalemate: game.status === 'playing' && (lastContactAt === null || game.time - lastContactAt >= 120) };
  if (diagnostics) {
    const enemyAssets = [...game.units, ...game.buildings].filter(e => e.owner === 'enemy' && e.hp > 0).map(e => {
      const x = e.x + (e.w || 0) / 2, y = e.y + (e.h || 0) / 2;
      const fogState = game.fog[Math.floor(y)]?.[Math.floor(x)] ?? 0;
      return { id: e.id, kind: e.w ? 'building' : 'unit', defId: e.defId,
        operational: e.w ? ['command', 'barracks', 'factory', 'helipad', 'superweapon', 'warhead'].includes(e.defId)
          : !!game.unitDefs[e.defId]?.weapon || ['mcv', 'engineer'].includes(e.defId),
        x: +x.toFixed(1), y: +y.toFixed(1), hp: Math.round(e.hp), maxHp: e.maxHp,
        fogState, currentVisibility: fogState === 2, lastSeen: observedEnemyIntel.get(e.id) || null };
    });
    const finalRoutePoint = route.at(-1);
    result.postrunDiagnostics = { enemyAssets,
      enemyUnits: enemyAssets.filter(e => e.kind === 'unit').length,
      enemyBuildings: enemyAssets.filter(e => e.kind === 'building').length,
      operationalEnemyUnits: enemyAssets.filter(e => e.kind === 'unit' && e.operational).length,
      operationalEnemyBuildings: enemyAssets.filter(e => e.kind === 'building' && e.operational).length,
      nearestEnemyToFinalRoutePoint: enemyAssets.length ? Math.min(...enemyAssets.map(e =>
        Math.hypot(e.x - finalRoutePoint.x, e.y - finalRoutePoint.y))) : null,
      finalRoutePoint, playerCommandYardAlive: game.buildings.some(b => b.owner === 'player' && b.defId === 'command'),
      playerUnitsAlive: game.units.filter(u => u.owner === 'player').length,
      playerBuildings: game.buildings.filter(b => b.owner === 'player').map(b => b.defId),
      postrunCanQueueInfantry: ['rifle', 'rocket'].map(id => ({ id, ...game.canQueueUnit(id) })) };
  }
  return result;
}

for (const mapId of maps) {
  if (!SKIRMISH_MAPS.some(m => m.id === mapId)) { console.error(`Unknown map: ${mapId}`); process.exitCode = 1; continue; }
  for (const faction of factions) for (const seed of seeds) {
    const result = simulate(mapId, faction, seed);
    if (!compact) console.log(JSON.stringify(result));
    else console.log(JSON.stringify({ seed: result.seed, difficulty: result.difficulty, mapId: result.mapId,
      faction: result.faction, victoryMode: result.victoryMode, status: result.status, time: result.time,
      strategy: result.strategy,
      doctrine: result.doctrine, techUnits: result.techUnits, techUnitsProduced: result.techUnitsProduced,
      playerUnits: result.playerUnits,
      assaultStarted: result.assaultStarted, assaultOrders: result.assaultOrders,
      playerRelayCaptureTimes: result.playerRelayCaptureTimes, firstEnemyMajorityAt: result.firstEnemyMajorityAt, firstKnownEnemyMajorityAt: result.firstKnownEnemyMajorityAt, dominionStarts: result.dominionStarts, peakPlayerRelays: result.peakPlayerRelays,
      decisionPoints: result.decisionPoints,
      relayPolicyEvents: result.relayPolicyEvents,
      strategicEvents: result.events.filter(event => /constructionReady|doctrineReady|relayCaptured|relayNeutralized|relayDominion/.test(event)),
      routeProgress: `${result.routeIndex}/${result.routeLength - 1}`, relays: result.relays,
      contactEpisodes: result.contactEpisodes, quietSinceLastContact: result.quietSinceLastContact,
      longestNoContactSeconds: result.longestNoContactSeconds, noContactStalemate: result.noContactStalemate }));
  }
}
