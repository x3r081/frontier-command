import { Game, MAP_WIDTH, MAP_HEIGHT, SKIRMISH_MAPS, UNIT_DEFS, BUILDING_DEFS, COMMAND_ABILITIES,
  DOCTRINE_DEFS, TACTICAL_PACKAGE_DEFS, UNIT_PROMOTION_DEFS, UNIT_PROMOTION_RULES_VERSION,
  aiCommanderProfileForSeed } from './engine.js';
import { CAMPAIGN_MISSIONS, CAMPAIGN_DOCTRINES, CAMPAIGN_FIELD_ORDERS, CAMPAIGN_CARRYOVERS, CAMPAIGN_SUPPLIES, CAMPAIGN_ROUTE_PAYOFFS, createCampaignGame, updateCampaign } from './campaign.js';
import { validateCampaignVeteran } from './campaignVeteran.js';
import { SOLO_STEP_SECONDS } from './soloClock.js';

export const SOLO_REPLAY_VERSION = 57;
export const MAX_SOLO_COMMANDS = 10000;
export const MAX_SOLO_TICKS = 30 * 60 * 60 * 3;
const MAX_SELECTION = 128;
const ID = /^(?:u|b)[1-9][0-9]{0,8}$/;
const point = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const xPoint = value => point(value) && value < MAP_WIDTH;
const yPoint = value => point(value) && value < MAP_HEIGHT;
const entityId = value => typeof value === 'string' && ID.test(value);
const relayId = value => typeof value === 'string' && /^relay[1-9][0-9]{0,2}$/.test(value);
const defId = (value, defs) => typeof value === 'string' && Object.hasOwn(defs, value);
const noArgs = args => args.length === 0;
const xy = args => args.length === 2 && xPoint(args[0]) && yPoint(args[1]);
const oneId = args => args.length === 1 && entityId(args[0]);
const wreckId = value => typeof value === 'string' && /^wreck[1-9][0-9]{0,8}$/.test(value);

// Only public, player-issued gameplay commands belong in a replay. Selection is
// captured as command context rather than recorded as a separate command.
export const SOLO_COMMAND_METHODS = Object.freeze({
  issueMove: args => args.length >= 2 && args.length <= 4 && xPoint(args[0]) && yPoint(args[1]) &&
    (args.length < 3 || typeof args[2] === 'boolean') &&
    (args.length < 4 || typeof args[3] === 'boolean'),
  issueForceMove: args => (args.length === 2 || args.length === 3) &&
    xPoint(args[0]) && yPoint(args[1]) && (args.length < 3 || typeof args[2] === 'boolean'),
  issueAttack: args => (args.length === 1 || args.length === 2) &&
    entityId(args[0]) && (args.length < 2 || typeof args[1] === 'boolean'),
  issueFollow: oneId,
  issueBoard: oneId,
  issueUnload: xy,
  issueForceFire: xy,
  issueHarvest: noArgs,
  issueBloomExpedition: noArgs,
  issueReturnCargo: noArgs,
  issueStop: noArgs,
  issueGuard: noArgs,
  issueSetStance: args => args.length === 1 && ['aggressive', 'defensive', 'holdFire'].includes(args[0]),
  issuePromoteUnit: args => args.length === 2 && entityId(args[0]) &&
    typeof args[1] === 'string' && Object.hasOwn(UNIT_PROMOTION_DEFS, args[1]),
  useUnitAbility: args => args.length === 2 && entityId(args[0]) &&
    ['brace', 'ghostRun'].includes(args[1]),
  issuePatrol: xy,
  issueScatter: noArgs,
  issueDeploy: args => noArgs(args) || (args.length === 1 && (args[0] === null || entityId(args[0]))),
  issueEngineer: oneId,
  issueRecoverWreck: args => args.length === 1 && wreckId(args[0]),
  issueServiceAtWorkshop: oneId,
  startConstruction: args => args.length === 1 && defId(args[0], BUILDING_DEFS),
  cancelConstruction: noArgs,
  issueBuild: args => args.length === 3 && defId(args[0], BUILDING_DEFS) && xPoint(args[1]) && yPoint(args[2]),
  queueUnit: args => args.length === 1 && defId(args[0], UNIT_DEFS),
  chooseDoctrine: args => args.length === 1 && defId(args[0], DOCTRINE_DEFS),
  chooseTacticalPackage: args => args.length === 1 && defId(args[0], TACTICAL_PACKAGE_DEFS),
  setRelayProtocol: args => args.length === 2 && relayId(args[0]) &&
    ['shelter', 'overdrive', 'logistics'].includes(args[1]),
  cancelQueuedUnit: args => (args.length === 1 || args.length === 2) && entityId(args[0]) &&
    (args.length === 1 || Number.isSafeInteger(args[1]) && args[1] >= -1 && args[1] <= 4),
  setRally: args => args.length === 3 && entityId(args[0]) && xPoint(args[1]) && yPoint(args[2]),
  toggleRepair: oneId,
  sellBuilding: oneId,
  useSuperweapon: xy,
  useCommandAbility: args => args.length === 3 && typeof args[0] === 'string' &&
    Object.hasOwn(COMMAND_ABILITIES, args[0]) && xPoint(args[1]) && yPoint(args[2]),
});

function validSelection(ids) {
  return Array.isArray(ids) && ids.length <= MAX_SELECTION && ids.every(entityId) &&
    new Set(ids).size === ids.length;
}

export function validateSoloEnvelope(envelope, replayVersion = SOLO_REPLAY_VERSION) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      !['skirmish', 'campaign'].includes(envelope.mode) ||
      !['easy', 'normal', 'hard'].includes(envelope.difficulty) ||
      !['aegis', 'vesper'].includes(envelope.faction) ||
      !Number.isInteger(envelope.seed) || envelope.seed < 1 || envelope.seed > 0xffffffff ||
      typeof envelope.scenarioId !== 'string') throw new TypeError('Invalid solo run envelope.');
  const scenarios = envelope.mode === 'campaign' ? CAMPAIGN_MISSIONS : SKIRMISH_MAPS;
  const scenarioIndex = scenarios.findIndex(item => item.id === envelope.scenarioId);
  if (scenarioIndex < 0) throw new TypeError('Unknown solo run scenario.');
  if (envelope.mode === 'campaign' && envelope.faction !== scenarios[scenarioIndex].faction)
    throw new TypeError('Campaign faction does not match its mission.');
  if (envelope.mode === 'campaign') {
    const doctrineId = envelope.doctrineId === undefined ? 'standard' : envelope.doctrineId;
    if (typeof doctrineId !== 'string' || !CAMPAIGN_DOCTRINES.some(doctrine => doctrine.id === doctrineId))
      throw new TypeError('Invalid campaign doctrine.');
    const fieldOrderId = envelope.fieldOrderId === undefined ? 'none' : envelope.fieldOrderId;
    if (typeof fieldOrderId !== 'string' ||
        fieldOrderId !== 'none' && !CAMPAIGN_FIELD_ORDERS[scenarioIndex].some(order => order.id === fieldOrderId))
      throw new TypeError('Invalid campaign field order for this mission.');
    const carryoverId = envelope.carryoverId === undefined ? 'none' : envelope.carryoverId;
    if (!CAMPAIGN_CARRYOVERS.some(carryover => carryover.id === carryoverId) ||
        scenarioIndex === 0 && carryoverId !== 'none')
      throw new TypeError('Invalid campaign carryover for this mission.');
    const supplyId = envelope.supplyId === undefined ? 'none' : envelope.supplyId;
    if (typeof supplyId !== 'string' || !CAMPAIGN_SUPPLIES.some(supply => supply.id === supplyId) ||
        scenarioIndex === 0 && supplyId !== 'none')
      throw new TypeError('Invalid campaign supply package for this mission.');
    const routePayoffId = envelope.routePayoffId === undefined ? 'none' : envelope.routePayoffId;
    if (!CAMPAIGN_ROUTE_PAYOFFS.some(payoff => payoff.id === routePayoffId) ||
        ![4, 5].includes(scenarioIndex) && routePayoffId !== 'none' ||
        scenarioIndex === 5 && routePayoffId !== 'none' && replayVersion < 51)
      throw new TypeError('Invalid campaign route payoff for this mission.');
    if (Object.hasOwn(envelope, 'campaignVeteran') &&
        (!validateCampaignVeteran(envelope.campaignVeteran) ||
          scenarioIndex === 0 && envelope.campaignVeteran !== null))
      throw new TypeError('Invalid campaign veteran for this mission.');
  } else {
    const skirmishOpening = envelope.skirmishOpening === undefined ? 'established' : envelope.skirmishOpening;
    if (!['established', 'command-rig'].includes(skirmishOpening))
      throw new TypeError('Invalid skirmish opening.');
    const victoryMode = envelope.victoryMode === undefined ? 'dominion' : envelope.victoryMode;
    if (!['dominion', 'elimination'].includes(victoryMode))
      throw new TypeError('Invalid skirmish victory mode.');
    if (Object.hasOwn(envelope, 'doctrineId'))
      throw new TypeError('Skirmish runs cannot have a campaign doctrine.');
    if (Object.hasOwn(envelope, 'fieldOrderId'))
      throw new TypeError('Skirmish runs cannot have a campaign field order.');
    if (Object.hasOwn(envelope, 'carryoverId'))
      throw new TypeError('Skirmish runs cannot have campaign carryover.');
    if (Object.hasOwn(envelope, 'supplyId'))
      throw new TypeError('Skirmish runs cannot have campaign supplies.');
    if (Object.hasOwn(envelope, 'routePayoffId'))
      throw new TypeError('Skirmish runs cannot have a campaign route payoff.');
    if (Object.hasOwn(envelope, 'campaignVeteran'))
      throw new TypeError('Skirmish runs cannot have a campaign veteran.');
  }
  if (envelope.mode === 'campaign' && Object.hasOwn(envelope, 'skirmishOpening'))
    throw new TypeError('Campaign runs cannot have a skirmish opening.');
  if (envelope.mode === 'campaign' && Object.hasOwn(envelope, 'victoryMode'))
    throw new TypeError('Campaign runs cannot have a skirmish victory mode.');
  return scenarioIndex;
}

export function validateSoloReplay(envelope, commands, completedTicks, replayVersion = SOLO_REPLAY_VERSION) {
  validateSoloEnvelope(envelope, replayVersion);
  if (!Number.isSafeInteger(completedTicks) || completedTicks < 0 || completedTicks > MAX_SOLO_TICKS)
    throw new RangeError('Invalid solo replay tick horizon.');
  if (!Array.isArray(commands) || commands.length > MAX_SOLO_COMMANDS)
    throw new RangeError('Invalid solo replay command count.');
  let previousTick = -1;
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    if (!command || typeof command !== 'object' || Array.isArray(command) ||
        !Number.isSafeInteger(command.tick) || command.tick < 0 || command.tick >= completedTicks ||
        command.tick < previousTick || command.sequence !== i ||
        !Object.hasOwn(SOLO_COMMAND_METHODS, command.method) ||
        !Array.isArray(command.args) || !SOLO_COMMAND_METHODS[command.method](command.args) ||
        !validSelection(command.selectedIds)) throw new TypeError(`Invalid solo command at index ${i}.`);
    previousTick = command.tick;
  }
  return true;
}

/** Wrap one Game instance. `dispose()` restores its original methods. */
export function createSoloRecorder(game, clock) {
  if (!(game instanceof Game) || !clock || !Number.isSafeInteger(clock.completedTicks) || clock.completedTicks < 0)
    throw new TypeError('A Game and SoloClock are required.');
  const commands = [];
  const originals = new Map();
  let disposed = false;
  for (const method of Object.keys(SOLO_COMMAND_METHODS)) {
    const original = game[method];
    if (typeof original !== 'function') throw new TypeError(`Missing Game command ${method}.`);
    originals.set(method, original);
    game[method] = function (...args) {
      const tick = clock.completedTicks;
      const selectedIds = [...this.selection];
      const playerCommand = this.commandOwner === 'player' && this.status === 'playing';
      const result = original.apply(this, args);
      if (playerCommand && result?.ok === true) {
        if (commands.length >= MAX_SOLO_COMMANDS || tick > MAX_SOLO_TICKS ||
            !SOLO_COMMAND_METHODS[method](args) || !validSelection(selectedIds))
          throw new RangeError('Solo command cannot be recorded.');
        commands.push({ tick, sequence: commands.length, method, args: [...args], selectedIds });
      }
      return result;
    };
  }
  return {
    commands,
    dispose() {
      if (disposed) return;
      for (const [method, original] of originals) game[method] = original;
      disposed = true;
    },
  };
}

/** Advance a recorded run one fixed simulation tick at a time for the viewer. */
export function createSoloPlayback(envelope, commands, completedTicks, replayVersion = SOLO_REPLAY_VERSION) {
  if (!Number.isInteger(replayVersion) || replayVersion < 1 || replayVersion > SOLO_REPLAY_VERSION)
    throw new RangeError('Unsupported solo replay version.');
  if (replayVersion < 7 && Array.isArray(commands) &&
      commands.some(command => command?.method === 'setRelayProtocol'))
    throw new TypeError('Relay Protocol commands require replay version 7.');
  if (replayVersion < 49 && Array.isArray(commands) &&
      commands.some(command => command?.method === 'setRelayProtocol' && command.args?.[1] === 'logistics'))
    throw new TypeError('Logistics relay protocol requires replay version 49.');
  if (replayVersion < 52 && Array.isArray(commands) &&
      commands.some(command => command?.method === 'issueBloomExpedition'))
    throw new TypeError('Bloom expeditions require replay version 52.');
  if (replayVersion < 56 && Array.isArray(commands) && commands.some(command =>
      command?.method === 'issueMove' && command.args?.length === 4 ||
      command?.method === 'issueForceMove' && command.args?.length === 3 ||
      command?.method === 'issueAttack' && command.args?.length === 2))
    throw new TypeError('Queued orders require replay version 56.');
  if (replayVersion < 9 && envelope?.supplyId !== undefined && envelope.supplyId !== 'none')
    throw new TypeError('Campaign supply packages require replay version 9.');
  if (replayVersion < 10 && Array.isArray(commands) &&
      commands.some(command => command?.method === 'issueRecoverWreck'))
    throw new TypeError('Wreck recovery commands require replay version 10.');
  if (replayVersion < 21 && Array.isArray(commands) &&
      commands.some(command => command?.method === 'issueServiceAtWorkshop'))
    throw new TypeError('Workshop service orders require replay version 21.');
  if (replayVersion < 23 && envelope?.routePayoffId !== undefined && envelope.routePayoffId !== 'none')
    throw new TypeError('Campaign route payoffs require replay version 23.');
  if (replayVersion < 30 && envelope?.campaignVeteran != null)
    throw new TypeError('Campaign veterans require replay version 30.');
  if (replayVersion < 31 && Array.isArray(commands) &&
      commands.some(command => command?.method === 'chooseTacticalPackage' ||
        command?.method === 'useCommandAbility' && ['breach', 'interdict', 'rally'].includes(command.args?.[0])))
    throw new TypeError('Tactical packages require replay version 31.');
  if (replayVersion < UNIT_PROMOTION_RULES_VERSION && Array.isArray(commands) &&
      commands.some(command => command?.method === 'issuePromoteUnit'))
    throw new TypeError(`Unit promotions require replay version ${UNIT_PROMOTION_RULES_VERSION}.`);
  if (replayVersion < 36 && Array.isArray(commands) &&
      commands.some(command => command?.method === 'useUnitAbility'))
    throw new TypeError('Faction field abilities require replay version 36.');
  validateSoloReplay(envelope, commands, completedTicks, replayVersion);
  const scenarioIndex = validateSoloEnvelope(envelope, replayVersion);
  const createGame = () => {
    const replayGame = envelope.mode === 'campaign'
      ? createCampaignGame(scenarioIndex, envelope.difficulty, envelope.seed,
        envelope.doctrineId ?? 'standard', envelope.fieldOrderId ?? 'none', envelope.carryoverId ?? 'none',
        envelope.supplyId ?? 'none', envelope.routePayoffId ?? 'none', envelope.campaignVeteran ?? null,
        replayVersion)
      : new Game({ mode: 'skirmish', difficulty: envelope.difficulty, faction: envelope.faction,
        seed: envelope.seed, mapId: envelope.scenarioId,
        aiCommanderProfileId: aiCommanderProfileForSeed(envelope.seed, replayVersion).id,
        replayVersion,
        skirmishOpening: envelope.skirmishOpening ?? 'established',
        victoryMode: envelope.victoryMode ?? 'dominion',
        mapVariant: replayVersion < 11 ? 0 : undefined,
        legacyCanyonRingVariant1: replayVersion < 44 && envelope.scenarioId === 'canyon-ring' });
    // AI behavior can evolve across releases. Keep archived local replays on
    // the rules they recorded, including after a viewer reset or timeline seek.
    replayGame.replayVersion = replayVersion;
    if (envelope.mode === 'campaign' && scenarioIndex === 4 && replayVersion < 46) {
      // Version 46 moved the Iron Current freight cache to a reachable north
      // approach. Earlier command logs targeted the original east crossing.
      delete replayGame.campaignState.routeObjectiveRulesVersion;
      if (replayGame.campaignRoutePayoffId === 'iron-current') {
        const freightCache = replayGame.wrecks.find(wreck => wreck.id === replayGame.campaignState.freightCacheId);
        if (freightCache) { freightCache.x = 42.5; freightCache.y = 27.5; }
      }
    }
    if (envelope.mode === 'campaign' && scenarioIndex === 2 && replayVersion < 42) {
      replayGame.mission = { ...replayGame.mission,
        briefing: 'Vesper armor is converging on the relay. Hold the command yard until the evacuation ships arrive.',
        objective: 'Keep your command yard standing for 180 seconds.' };
    }
    if (envelope.mode === 'campaign' && scenarioIndex === 5 && replayVersion < 43) {
      // The version 43 patrol-code stop lengthens this fixed-force crossing.
      // Archived runs began with a 105-HP analyst and a direct extraction.
      const analyst = replayGame.getEntity(replayGame.campaignState?.escortId);
      if (analyst) replayGame._setCampaignUnitBaseHealth(analyst, 105);
      replayGame.mission = { ...replayGame.mission,
        briefing: 'A defecting Aegis analyst carries the patrol codes. Get the analyst across the valley to the extraction beacon; the route is exposed and the escort cannot be replaced.',
        objective: 'Escort the analyst to the extraction beacon and keep them alive.' };
    }
    if (envelope.mode === 'campaign' && scenarioIndex === 5 && replayVersion >= 43 && replayVersion < 48) {
      // The original patrol-code stop used the same eight-second upload at
      // either site and did not call an extraction intercept. Keep its briefing
      // accurate while the recorded commands play under their historical rule.
      const oldSouthUplink = replayGame.campaignState?.transmissionUplinks?.find(item => item.id === 'south');
      if (oldSouthUplink) oldSouthUplink.y = 34.5;
      replayGame.mission = { ...replayGame.mission,
        briefing: 'A defecting Aegis analyst carries the patrol codes. Escort the analyst to either uplink and hold there for eight uninterrupted seconds, then reach the extraction beacon. Lead with the armed escort through the eastern ambush; the analyst cannot be replaced.',
        objective: 'Transmit at either uplink for eight uninterrupted seconds, then extract the analyst alive.' };
      const missionEvent = replayGame.events.find(event => event.type === 'mission');
      if (missionEvent) Object.assign(missionEvent, replayGame.mission);
    }
    if (envelope.mode === 'campaign' && scenarioIndex === 3 && replayVersion < 35) {
      // Black Shard's central relay stage begins with a shielded forward
      // array. Older runs could damage that array immediately, including on
      // their first recorded tick.
      const target = replayGame.getEntity(replayGame.campaignState?.targetId);
      if (target) target.campaignShielded = false;
      replayGame.mission = { ...replayGame.mission,
        briefing: 'Vesper’s signal chief is coordinating the raids from a forward relay. Destroy the array before the next armored column is called in.',
        objective: 'Destroy the Vesper forward relay before your command yard falls.' };
    }
    if (envelope.mode === 'campaign' && scenarioIndex === 6 && replayVersion < 33) {
      // Dawnfall's new relay stage starts with a shielded command yard. An
      // archived run must begin with its original vulnerable yard, before the
      // first simulation tick or a replay seek applies any orders.
      const target = replayGame.getEntity(replayGame.campaignState?.targetId);
      if (target) target.campaignShielded = false;
      replayGame.mission = { ...replayGame.mission,
        briefing: 'Break the Vesper command network and force its leadership to abandon the valley.',
        objective: 'Destroy the Vesper Construction Yard while keeping your command yard standing.' };
    }
    if (envelope.mode === 'campaign' && scenarioIndex === 9 && replayVersion < 34) {
      replayGame.mission = { ...replayGame.mission,
        briefing: 'A Vesper signal chief is waiting at a guarded eastern outpost. Find the escort and strike before the evacuation codes leave the valley.',
        objective: 'Eliminate the Vesper signal chief before the command yard falls or 300 seconds pass.' };
    }
    return replayGame;
  };
  let game = createGame();
  let cursor = 0;
  let tick = 0;
  const playback = {
    get game() { return game; },
    get tick() { return tick; },
    get completedTicks() { return completedTicks; },
    get finished() { return tick >= completedTicks; },
    reset() { game = createGame(); cursor = 0; tick = 0; return game; },
    step(count = 1) {
      if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid replay step count.');
      const limit = Math.min(completedTicks, tick + count);
      while (tick < limit) {
        if (game.status !== 'playing') throw new Error('Replay extends beyond the terminal tick.');
        while (cursor < commands.length && commands[cursor].tick === tick) {
          const command = commands[cursor++];
          const selected = game.select(command.selectedIds);
          if (selected.ids.length !== command.selectedIds.length ||
              selected.ids.some((id, index) => id !== command.selectedIds[index]))
            throw new Error(`Invalid replay selection at sequence ${command.sequence}.`);
          const outcome = game[command.method](...command.args);
          if (outcome?.ok !== true) throw new Error(`Replay command failed at sequence ${command.sequence}.`);
        }
        game.update(SOLO_STEP_SECONDS);
        if (envelope.mode === 'campaign') updateCampaign(game, scenarioIndex, SOLO_STEP_SECONDS, replayVersion);
        tick++;
      }
      return game;
    },
    seek(targetTick) {
      if (!Number.isSafeInteger(targetTick) || targetTick < 0 || targetTick > completedTicks)
        throw new RangeError('Invalid replay target tick.');
      if (targetTick < tick) playback.reset();
      return playback.step(targetTick - tick);
    }
  };
  return playback;
}

/** Replay through exactly `completedTicks` updates from the locked run setup. */
export function replaySoloRun(envelope, commands, completedTicks) {
  const playback = createSoloPlayback(envelope, commands, completedTicks);
  const game = playback.step(completedTicks);
  return { game, completedTicks, seconds: completedTicks * SOLO_STEP_SECONDS,
    status: game.status, winner: game.winner, kills: game.kills.player,
    campaignResult: game.campaignResult || null };
}
