import { Game, BUILDING_DEFS, UNIT_DEFS, VETERANCY_RANKS } from './engine.js';
import { deriveCampaignVeteran, validateCampaignVeteran } from './campaignVeteran.js';

const CAMPAIGN_ROUTE_OBJECTIVE_RULES_VERSION = 46;
const ASHES_ROUTE_RULES_VERSION = 51;
const FIRST_HARVEST_RAID_RULES_VERSION = 54;
const IRON_CURRENT_RELAY_ASSAULT_RULES_VERSION = 55;

/** Stable player doctrine choices for campaign missions. */
export const CAMPAIGN_DOCTRINES = Object.freeze([
  Object.freeze({ id: 'standard', name: 'Standard', description: 'Balanced forces with standard unit attributes.' }),
  Object.freeze({ id: 'rapid', name: 'Rapid', description: 'Player units move 12% faster.' }),
  Object.freeze({ id: 'reinforced', name: 'Reinforced', description: 'Player units have 12% more maximum health.' }),
  Object.freeze({ id: 'precision', name: 'Precision', description: 'Player unit weapons deal 10% more damage.' }),
]);

/** One-shot packages funded by completed Field Orders along the campaign route. */
export const CAMPAIGN_SUPPLIES = Object.freeze([
  Object.freeze({ id: 'none', name: 'No Supply Package', description: 'Keep requisition in reserve.' }),
  Object.freeze({ id: 'reserves', name: 'Forward Reserves', description: 'Gain 500 credits and 500 extra storage capacity.' }),
  Object.freeze({ id: 'recon', name: 'Reconnaissance Sweep', description: 'Reveal a 7-tile area around an enemy objective for 20 seconds.' }),
  Object.freeze({ id: 'vanguard', name: 'Vanguard Refit', description: 'Starting armed units gain 10% maximum health and recover 20% of their new maximum health.' }),
]);

/** Trusted route payoff that carries the commander's first fork choice into Red Ledger. */
export const CAMPAIGN_ROUTE_PAYOFFS = Object.freeze([
  Object.freeze({ id: 'none', name: 'No Route Intel', description: 'No verified branch advantage.' }),
  Object.freeze({ id: 'ghost-channel', name: 'Signal Trace', description: 'Reveal the payroll courier and its escort for the first 20 seconds.' }),
  Object.freeze({ id: 'iron-current', name: 'Freight Cache', description: 'Recover a 700-credit cache at the eastern crossing with an Engineer.' }),
]);

/** Public extraction zone used by Quiet Knife's version 34 escape response. */
export const QUIET_KNIFE_ESCAPE = Object.freeze({ x: 59.5, y: 29.5, radius: 2.5 });

/** Authored story scenarios supported by campaign mode. Keep all existing IDs stable for saves. */
export const CAMPAIGN_MISSIONS = Object.freeze([
  Object.freeze({
    id: 'first-harvest', title: 'Mission 1: First Harvest', faction: 'aegis',
    briefing: 'The eastern crystal seam can sustain a larger force. Expand the refinery network and keep the Vesper raiders from breaking the line.',
    objective: 'Build a second refinery, bank 2,200 credits, and repel the warned southern Vesper raid.',
  }),
  Object.freeze({
    id: 'silent-switch', title: 'Mission 2: The Silent Switch', faction: 'aegis',
    briefing: 'A Vesper radar array controls the valley’s air corridor. Its hardened data vault will survive bombardment. Send armed cover through the pass first; keep an engineer in reserve until the array is visible, then order the capture.',
    objective: 'Capture the damaged Vesper radar array with an engineer.',
  }),
  Object.freeze({
    id: 'last-light', title: 'Mission 3: Last Light', faction: 'aegis',
    briefing: 'Vesper armor is converging on the relay. Hold the command yard until the evacuation ships arrive, or break the eastern flank column when it commits to the assault.',
    objective: 'Keep your command yard standing for 180 seconds, or destroy the eastern flank force after it arrives.',
  }),
  Object.freeze({
    id: 'black-shard', title: 'Mission 4: Black Shard', faction: 'aegis',
    briefing: 'Vesper’s signal chief is coordinating the raids from a forward relay. The relay is shielded by the central resonance network. Seize and hold the central relay long enough to collapse the shield, then destroy the forward relay before the next armored column is called in.',
    objective: 'Hold the central Resonance Relay for 8 seconds to expose the Vesper forward relay, then destroy it before your command yard falls.',
  }),
  Object.freeze({
    id: 'red-ledger', title: 'Mission 5: Red Ledger', faction: 'vesper',
    briefing: 'The Collective’s western cell has one chance to secure the shard basin. Outproduce the Aegis patrols and fund the counterstrike before they close the valley. Raid completed Aegis outposts for salvage credits. A courier buggy carries a payroll cache; intercept it for reserve credits.',
    objective: 'Keep your field command post standing. Build a second refinery and reach 4,800 credits within six minutes. Optional: destroy the courier buggy for 700 credits.',
    mechanic: 'RAID & SALVAGE ECONOMY',
  }),
  Object.freeze({
    id: 'ashes-in-transit', title: 'Mission 6: Ashes in Transit', faction: 'vesper',
    briefing: 'A defecting Aegis analyst carries the patrol codes. Choose the northern uplink for a fast five-second burst that reveals your extraction route and draws a visible Aegis intercept. Keep a flamer with the analyst, send the strike group to meet the intercept, then move out on the warning. The southern uplink takes eight seconds on a low-power channel and keeps the return route quiet. The analyst cannot be replaced.',
    objective: 'North: transmit for 5 seconds, keep an escort with the analyst, and destroy the visible interceptor before extracting. South: transmit for 8 seconds for a quiet return. Extract the analyst alive.',
  }),
  Object.freeze({
    id: 'dawnfall', title: 'Mission 7: Dawnfall', faction: 'aegis',
    briefing: 'Vesper’s command yard is shielded by the eastern relay network. Seize the central relay to collapse its defenses, then break the exposed yard and force the Collective leadership to abandon the valley.',
    objective: 'Capture and hold the central Resonance Relay for 8 seconds, then destroy the Vesper Construction Yard.',
  }),
  Object.freeze({
    id: 'eye-of-the-storm', title: 'Mission 8: Eye of the Storm', faction: 'aegis',
    briefing: 'The retreating Collective left the valley unstable. Their last strike is timed to the ion front. Secure the western relay shelter and keep the command yard online until the storm passes.',
    objective: 'Keep the command yard standing and hold the western relay shelter for 10 seconds during the first ion storm.',
  }),
  Object.freeze({
    id: 'three-points-of-light', title: 'Mission 9: Three Points of Light', faction: 'vesper',
    briefing: 'The Collective splinter command needs the relay network to coordinate a safe withdrawal. Aegis patrols are already moving to deny the crossings. Choose which pair of relays to secure first; each pair draws a different Vesper reserve.',
    objective: 'Keep your command yard standing. Capture and hold at least two Resonance Relays for 25 seconds. Your first pair determines the reserve team.',
  }),
  Object.freeze({
    id: 'quiet-knife', title: 'Mission 10: Quiet Knife', faction: 'aegis',
    briefing: 'A Vesper signal chief is waiting for extraction at the eastern outpost. Find the stealth escort; once spotted, the chief will flee for the southeast extraction zone. Issue a direct attack to intercept before the codes leave the valley.',
    objective: 'Eliminate the Vesper signal chief before the command yard falls or 300 seconds pass. Spotting the chief triggers a flight to the southeast extraction zone; issue a direct attack to intercept.',
  }),
  Object.freeze({
    id: 'last-ember', title: 'Mission 11: Last Ember', faction: 'vesper',
    briefing: 'The withdrawal route is collapsing. Aegis columns are pushing through the western pass toward the fallback beacon. Rally defenders at the chokepoint, repair the beacon under fire, and hold it even if the forward yard is lost.',
    objective: 'Protect the fallback beacon for 120 seconds.',
  }),
  Object.freeze({
    id: 'dawn-of-the-free', title: 'Mission 12: Dawn of the Free', faction: 'aegis',
    briefing: 'Vesper’s final command post is shielded by the resonance network. Seize the central relays to expose the post, then break the last Collective stronghold and end the valley campaign.',
    objective: 'Keep your command yard standing. Capture and hold two Resonance Relays for 18 seconds, then destroy the Vesper Command Yard.',
    mechanic: 'RELAY ASSAULT',
  }),
  Object.freeze({
    id: 'after-the-dawn', title: 'Bonus Operation: After the Dawn', faction: 'aegis',
    briefing: 'The valley campaign is over, but a signal engineer must recover the last evacuation record. Airlift the fixed rescue team across the flooded channel, secure the eastern landing relay with the engineer present, then bring them back to the western extraction point. Your tactical uplink marks each objective; no reinforcements are available.',
    objective: 'Hold the eastern landing relay with the engineer nearby for 12 seconds, then extract them on the west bank before 240 seconds. The engineer must survive.',
    mechanic: 'AIRLIFT RESCUE',
  }),
  Object.freeze({
    id: 'ghost-channel', title: 'Branch Operation: Ghost Channel', faction: 'aegis',
    briefing: 'A Vesper data vault is broadcasting the next strike route. Your fixed covert team must escort its signal engineer through the pass. Keep the engineer beside the hardened radar until the upload captures its key, then bring the same engineer back to the western extraction beacon before the transmission window closes. No base or reinforcements are available.',
    objective: 'Hold the engineer beside the radar vault for 8 seconds, then extract that engineer before 210 seconds. The engineer must survive.',
    mechanic: 'COVERT SIGNAL HEIST',
  }),
  Object.freeze({
    id: 'iron-current', title: 'Branch Operation: Iron Current', faction: 'aegis',
    briefing: 'Vesper armor is pushing along the current toward the supply crossing. Run the full command base and commit a 3,000-credit reserve. The last Vesper tank is driving for the eastern freight relay; keep a force there to stop the breakthrough, then secure the crossing through the final hold.',
    objective: 'Commit 3,000 credits and hold the freight relay for 22 seconds. Stop the Vesper tank assault at the relay, then keep the crossing secure for 12 more seconds. The command yard must survive.',
    mechanic: 'SUPPLY LINE DEFENSE',
  }),
]);

// The public catalog deliberately contains only display and identity fields.
// Runtime rules are kept separately so saves only need the selected stable ID.
const FIELD_ORDER_RULES = Object.freeze([
  [{ type: 'raid', target: 'buggy' }, { type: 'relay', relay: 0 }],
  [{ type: 'raid', target: 'harvester' }, { type: 'relay', relay: 1 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 0 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 1 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 2 }],
  [{ type: 'raid', target: 'buggy' }, { type: 'relay', relay: 1 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 1 }],
  [{ type: 'raid', target: 'buggy' }, { type: 'relay', relay: 1 }],
  [{ type: 'raid', target: 'buggy' }, { type: 'relaySweep', holdDuration: 10 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 1 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 0 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 2 }],
  [{ type: 'raid', target: 'buggy' }, { type: 'waypoint', x: 53.5, y: 37.5, radius: 2.5 }],
  [{ type: 'raid', target: 'buggy' }, { type: 'relay', relay: 1 }],
  [{ type: 'raid', target: 'lightTank' }, { type: 'relay', relay: 1 }],
]);

const FIELD_ORDER_TITLES = Object.freeze([
  ['Cut the Raider Screen', 'Claim the Western Signal'],
  ['Cut the Enemy Supply Line', 'Secure the Valley Relay'],
  ['Break the Armor Spearhead', 'Hold the Western Relay'],
  ['Disable the Relay Guard', 'Seize the Central Signal'],
  ['Ambush the Patrol Tank', 'Open the Eastern Signal'],
  ['Clear the Extraction Route', 'Mark the Central Crossing'],
  ['Break the Front Armor', 'Take the Central Relay'],
  ['Intercept the Storm Patrol', 'Secure the Central Shelter'],
  ['Silence the Relay Patrol', 'Complete the Relay Sweep'],
  ['Remove the Escort Tank', 'Take the Central Signal'],
  ['Stop the Assault Tank', 'Hold the Western Signal'],
  ['Break the Shield Guard', 'Secure the Eastern Signal'],
  ['Neutralize the Landing Buggy', 'Scout the Southeast Waypoint'],
  ['Silence the Vault Escort', 'Secure the Midpass Signal'],
  ['Break the Forward Tank', 'Secure the Midpass Signal'],
]);

const FIELD_TARGET_NAMES = Object.freeze({ buggy: 'enemy buggy', harvester: 'enemy harvester',
  lightTank: 'enemy tank' });

export const CAMPAIGN_FIELD_ORDERS = Object.freeze(CAMPAIGN_MISSIONS.map((mission, index) =>
  Object.freeze(FIELD_ORDER_RULES[index].map((rule, choice) => Object.freeze({
    id: `${mission.id}-${choice === 0 ? 'intercept' : 'signal'}`,
    title: FIELD_ORDER_TITLES[index][choice],
    objective: rule.type === 'raid'
      ? index === 0
        ? 'Order an attack on the marked enemy buggy at the eastern outpost, then destroy it.'
        : `Order an attack on the marked ${FIELD_TARGET_NAMES[rule.target]}, then destroy it.`
      : rule.type === 'waypoint'
        ? 'Fly a surviving dropship to the southeast waypoint on the east bank.'
        : rule.type === 'relaySweep'
          ? 'Capture and hold all three Resonance Relays for 10 seconds.'
          : `Capture Resonance Relay ${rule.relay + 1}.`,
    rewardText: index === 5 || index === 12 || index === 13
      ? 'Field refit: +25% maximum health and restore 35% health to surviving units.'
      : 'Supply cache: gain 650 credits.',
  })))));

/** Intel earned by completing a Field Order along the route into the next mission. */
export const CAMPAIGN_CARRYOVERS = Object.freeze([
  Object.freeze({ id: 'none', name: 'No carryover', description: 'Start with standard forces and command energy.' }),
  Object.freeze({ id: 'assault', name: 'Assault Intel', description: 'Starting armed units gain a 20% health shield for 45 seconds.' }),
  Object.freeze({ id: 'signal', name: 'Signal Intel', description: 'Start with 50 extra command energy.' }),
]);

/** Pure unlock mapping. `completedOrderIds` must come from a trusted ledger for ranked use. */
export function getCampaignCarryoverUnlocks(index, completedOrderIds = []) {
  const unlocked = ['none'];
  if (!Number.isInteger(index) || index < 1 || index >= CAMPAIGN_MISSIONS.length) return unlocked;
  const completed = new Set(completedOrderIds);
  const sourceIndexes = index === 13 || index === 14 ? [3]
    : index === 4 ? [13, 14, 3] // Black Shard remains valid for pre-fork saves.
      : [index - 1];
  if (sourceIndexes.some(source => completed.has(CAMPAIGN_FIELD_ORDERS[source]?.[0]?.id))) unlocked.push('assault');
  if (sourceIndexes.some(source => completed.has(CAMPAIGN_FIELD_ORDERS[source]?.[1]?.id))) unlocked.push('signal');
  return unlocked;
}

const campaignPriorRouteIndexes = index => {
  if (!Number.isInteger(index) || index < 0 || index >= CAMPAIGN_MISSIONS.length) return [];
  if (index <= 3) return Array.from({ length: index }, (_, i) => i);
  if (index === 13 || index === 14) return [0, 1, 2, 3];
  if (index === 4) return [0, 1, 2, 3, 13, 14];
  if (index === 12) return Array.from({ length: 12 }, (_, i) => i).concat(13, 14);
  return [0, 1, 2, 3, 13, 14, ...Array.from({ length: index - 4 }, (_, i) => i + 4)];
};

/** Requisition available for this sortie from distinct completed orders on its prior route. */
export function getCampaignRequisitionBalance(index, completedOrderIds = [], spentMissionIds = []) {
  const priorIndexes = campaignPriorRouteIndexes(index);
  if (!priorIndexes.length) return 0;
  const asValues = value => value && typeof value !== 'string' && typeof value[Symbol.iterator] === 'function'
    ? [...value] : [];
  const completed = new Set(asValues(completedOrderIds));
  const earned = new Set(priorIndexes.flatMap(i => CAMPAIGN_FIELD_ORDERS[i] || [])
    .map(order => order.id).filter(id => completed.has(id))).size;
  // A replay of an earlier operation must not reuse a token already spent in
  // a later victory. Spending is global to this difficulty's campaign ledger;
  // only earning is limited by the route leading into this sortie.
  const campaignMissionIds = new Set(CAMPAIGN_MISSIONS.map(mission => mission.id));
  const eligibleSpent = new Set(asValues(spentMissionIds).filter(id => campaignMissionIds.has(id))).size;
  return Math.max(0, Math.min(3, earned - eligibleSpent));
}

function selectedFieldOrder(game, index = game?.campaignMission) {
  if (game?.mode !== 'campaign' || !Number.isInteger(index)) return null;
  const choice = CAMPAIGN_FIELD_ORDERS[index]?.findIndex(order => order.id === game.campaignFieldOrderId) ?? -1;
  return choice < 0 ? null : { spec: CAMPAIGN_FIELD_ORDERS[index][choice],
    rule: FIELD_ORDER_RULES[index][choice] };
}

export function getCampaignFieldOrderView(game) {
  const selected = selectedFieldOrder(game);
  if (!selected) return null;
  const state = game.campaignState || {};
  const status = ['active', 'completed', 'failed'].includes(state.fieldOrderStatus)
    ? state.fieldOrderStatus : 'active';
  const rule = selected.rule;
  let progressText;
  if (status === 'completed') progressText = 'Completed';
  else if (status === 'failed') progressText = 'Failed';
  else if (rule.type === 'raid') progressText = state.fieldOrderEngaged
    ? 'Attack ordered; destroy the marked target' : 'Order a direct attack on the marked target';
  else if (rule.type === 'waypoint') progressText = 'Dropship has not reached the southeast waypoint';
  else if (rule.type === 'relaySweep') progressText =
    `All relays held: ${Math.floor(state.fieldOrderHoldElapsed || 0)} / ${rule.holdDuration} seconds`;
  else progressText = `Relay ${rule.relay + 1}: ${game.relays?.[rule.relay]?.owner === 'player' ? 'secured' : 'not secured'}`;
  const entity = rule.type === 'raid' ? game.getEntity(state.fieldOrderTargetId)
    : rule.type === 'waypoint' ? rule
      : rule.type === 'relaySweep' ? null : game.relays?.[rule.relay];
  const target = Number.isFinite(entity?.x) && Number.isFinite(entity?.y)
    ? { x: entity.x, y: entity.y } : null;
  return { ...selected.spec, status, progressText, target };
}

const live = entity => !!entity && entity.hp > 0;
const livingBuildings = (game, owner, defId) => game.buildings.filter(b => b.owner === owner && b.defId === defId && live(b));
const operationalBuildings = (game, owner, defId) => livingBuildings(game, owner, defId)
  .filter(building => building.progress >= 1 && building.powered);
const campaignObjectiveRefineries = (game, replayVersion) => {
  // Version 3 archives used the pre-fix economy objectives, which counted a
  // placed but unfinished refinery. Keep that rule only for local playback.
  return replayVersion !== null && replayVersion < 4
    ? livingBuildings(game, 'player', 'refinery')
    : operationalBuildings(game, 'player', 'refinery');
};
const livingUnits = (game, owner, defId) => game.units.filter(u => u.owner === owner && u.defId === defId && live(u));

// Every layout uses the same tile rules as a skirmish, but has authored routes.
// Walls are deliberately broken by passes wide enough for vehicles and pathfinding.
const SCENARIOS = [
  {
    walls: [['rock', 28, 3, 30, 43, [[17, 22], [32, 38]]], ['water', 39, 29, 45, 31]],
    fields: [[10, 28, 4], [11, 42, 4], [36, 20, 3], [48, 21, 4], [55, 6, 3]],
    player: { buildings: [['command', 8, 34], ['power', 4, 35], ['refinery', 4, 40], ['barracks', 12, 40], ['factory', 14, 34]],
      units: [['harvester', 7.5, 43.5, 'harvest'], ['scout', 14.5, 32.5], ['rifle', 13.5, 38.5], ['lightTank', 18.5, 37.5]] },
    enemy: { buildings: [['command', 51, 9], ['power', 57, 10], ['refinery', 55, 15], ['barracks', 49, 15]],
      units: [['harvester', 54.5, 18.5, 'harvest'], ['rifle', 47.5, 16.5], ['buggy', 43.5, 14.5]] },
  },
  {
    walls: [['rock', 19, 19, 57, 21, [[25, 32], [40, 46]]], ['water', 33, 4, 38, 10]],
    fields: [[11, 35, 4], [23, 30, 3], [35, 27, 3], [53, 24, 3], [54, 5, 3]],
    player: { buildings: [['command', 7, 29], ['power', 3, 31], ['power', 3, 28], ['refinery', 5, 37], ['barracks', 13, 32]],
      units: [['harvester', 9.5, 39.5, 'harvest'], ['engineer', 17.5, 29.5], ['engineer', 15.5, 34.5],
        ['scout', 19.5, 27.5], ['rocket', 18.5, 31.5], ['rocket', 20.5, 29.5],
        ['rifle', 16.5, 32.5], ['lightTank', 21.5, 27.5]] },
    enemy: { buildings: [['command', 51, 7], ['power', 57, 8], ['refinery', 55, 13], ['barracks', 48, 12], ['radar', 44, 14]],
      units: [['harvester', 54.5, 16.5, 'harvest'], ['rifle', 42.5, 12.5], ['rifle', 47.5, 17.5]] },
  },
  {
    walls: [['rock', 17, 4, 19, 42, [[24, 31]]], ['rock', 45, 3, 47, 42, [[17, 24], [34, 40]]],
      ['water', 26, 11, 35, 13]],
    fields: [[27, 40, 4], [39, 38, 4], [11, 28, 3], [54, 26, 3], [54, 7, 3]],
    player: { buildings: [['command', 29, 33], ['power', 24, 36], ['power', 39, 35], ['refinery', 36, 39], ['barracks', 33, 39],
      ['factory', 25, 32], ['turret', 27, 30], ['turret', 36, 31], ['guardTower', 32, 29]],
      units: [['harvester', 39.5, 42.5, 'harvest'], ['rocket', 27.5, 28.5], ['rocket', 37.5, 29.5],
        ['rifle', 33.5, 31.5], ['lightTank', 35.5, 34.5]] },
    enemy: { buildings: [['command', 53, 8], ['power', 58, 11], ['refinery', 54, 18], ['barracks', 49, 12], ['factory', 49, 6]],
      units: [['harvester', 55.5, 22.5, 'harvest'], ['lightTank', 50.5, 25.5], ['buggy', 49.5, 28.5],
        ['rifle', 10.5, 21.5], ['rocket', 11.5, 23.5]] },
  },
  {
    walls: [['rock', 28, 4, 31, 42, [[19, 26], [34, 39]]], ['water', 17, 13, 23, 16]],
    fields: [[10, 28, 4], [18, 40, 4], [35, 30, 3], [47, 25, 3], [55, 6, 3]],
    player: { buildings: [['command', 8, 33], ['power', 4, 35], ['refinery', 4, 40], ['barracks', 13, 39], ['factory', 14, 33]],
      units: [['harvester', 7.5, 43.5, 'harvest'], ['rocket', 19.5, 31.5], ['rocket', 20.5, 33.5],
        ['buggy', 22.5, 29.5], ['guardian', 21.5, 34.5], ['scout', 23.5, 31.5],
        ['engineer', 16.5, 36.5]] },
    enemy: { buildings: [['command', 52, 8], ['power', 58, 10], ['power', 58, 20], ['refinery', 55, 15], ['barracks', 49, 14],
      ['factory', 46, 8], ['radar', 39, 20]],
      units: [['harvester', 55.5, 19.5, 'harvest'], ['rifle', 40.5, 22.5], ['lightTank', 47.5, 23.5]] },
  },
  {
    walls: [['rock', 4, 23, 60, 25, [[21, 29], [38, 45]]], ['water', 33, 9, 38, 15]],
    fields: [[14, 20, 4], [23, 14, 4], [10, 4, 3], [47, 28, 4], [55, 40, 4]],
    player: { buildings: [['command', 7, 9], ['power', 3, 10], ['refinery', 4, 16], ['barracks', 13, 9], ['factory', 16, 11]],
      units: [['harvester', 9.5, 19.5, 'harvest'], ['harvester', 18.5, 17.5, 'harvest'],
        ['flamer', 20.5, 11.5], ['buggy', 21.5, 18.5], ['scout', 20.5, 21.5]] },
    enemy: { buildings: [['command', 51, 34], ['power', 57, 35], ['refinery', 54, 40], ['barracks', 48, 39], ['factory', 46, 33]],
      units: [['harvester', 55.5, 43.5, 'harvest'], ['rifle', 45.5, 30.5], ['lightTank', 42.5, 28.5], ['buggy', 39.5, 28.5]] },
  },
  {
    walls: [['rock', 20, 3, 22, 43, [[30, 37]]], ['rock', 38, 5, 40, 45, [[13, 21]]],
      ['water', 26, 38, 35, 42]],
    fields: [[13, 42, 3], [29, 26, 3], [48, 27, 3], [56, 40, 4]],
    player: { buildings: [], units: [['engineer', 12.5, 36.5], ['flamer', 11.5, 37.5], ['buggy', 15.5, 35.5],
      ['stealthTank', 17.5, 37.5], ['scout', 16.5, 33.5]] },
    enemy: { buildings: [['command', 52, 34], ['power', 58, 35], ['refinery', 55, 40], ['barracks', 48, 39]],
      units: [['harvester', 56.5, 43.5, 'harvest'], ['scout', 30.5, 27.5], ['rifle', 34.5, 24.5],
        ['rifle', 43.5, 20.5], ['buggy', 45.5, 25.5]] },
  },
  {
    walls: [['rock', 25, 3, 27, 44, [[10, 18], [31, 38]]], ['rock', 39, 3, 41, 44, [[19, 28]]],
      ['water', 29, 40, 36, 43]],
    fields: [[12, 35, 4], [17, 14, 4], [34, 24, 4], [47, 35, 3], [55, 15, 4]],
    player: { buildings: [['command', 7, 22], ['power', 3, 23], ['advancedPower', 3, 28], ['refinery', 5, 29],
      ['barracks', 12, 28], ['factory', 13, 22], ['radar', 11, 19], ['tech', 17, 23]],
      units: [['harvester', 9.5, 33.5, 'harvest'], ['guardian', 20.5, 23.5], ['guardian', 19.5, 27.5],
        ['artillery', 18.5, 30.5], ['rocket', 18.5, 20.5], ['medic', 15.5, 31.5]] },
    enemy: { buildings: [['command', 51, 22], ['power', 58, 22], ['advancedPower', 58, 27], ['refinery', 54, 31], ['barracks', 49, 29],
      ['factory', 47, 19], ['radar', 55, 18], ['turret', 45, 20], ['turret', 45, 29], ['obelisk', 48, 24]],
      units: [['harvester', 55.5, 34.5, 'harvest'], ['lightTank', 44.5, 25.5], ['rocket', 46.5, 32.5],
        ['rifle', 47.5, 17.5]] },
  },
  {
    walls: [['rock', 22, 3, 24, 44, [[13, 19], [31, 37]]], ['rock', 39, 4, 41, 43, [[21, 28]]],
      ['water', 28, 9, 35, 12]],
    fields: [[10, 37, 4], [16, 26, 3], [31, 34, 4], [47, 27, 4], [54, 8, 3]],
    player: { buildings: [['command', 7, 34], ['power', 3, 35], ['refinery', 4, 40], ['barracks', 12, 39], ['factory', 14, 33], ['radar', 9, 29]],
      units: [['harvester', 8.5, 43.5, 'harvest'], ['rocket', 17.5, 34.5], ['rifle', 15.5, 37.5], ['guardian', 19.5, 32.5], ['medic', 13.5, 34.5]] },
    enemy: { buildings: [['command', 52, 8], ['power', 58, 9], ['refinery', 55, 14], ['barracks', 49, 13], ['factory', 47, 7]],
      units: [['harvester', 55.5, 18.5, 'harvest'], ['rifle', 45.5, 16.5], ['buggy', 42.5, 13.5], ['lightTank', 47.5, 21.5]] },
  },
  {
    walls: [['rock', 18, 3, 20, 44, [[15, 22], [33, 39]]], ['rock', 43, 3, 45, 44, [[21, 29]]],
      ['water', 27, 31, 34, 34]],
    fields: [[9, 34, 4], [25, 24, 3], [35, 17, 3], [49, 29, 4], [55, 8, 3]],
    player: { buildings: [['command', 6, 33], ['power', 2, 34], ['refinery', 3, 39], ['barracks', 11, 37], ['factory', 12, 32]],
      units: [['harvester', 7.5, 42.5, 'harvest'], ['rifle', 17.5, 29.5], ['rifle', 21.5, 27.5], ['buggy', 25.5, 23.5],
        ['scout', 30.5, 17.5], ['lightTank', 33.5, 18.5], ['rocket', 35.5, 19.5]] },
    enemy: { buildings: [['command', 53, 8], ['power', 58, 9], ['refinery', 55, 14], ['barracks', 49, 12], ['factory', 49, 5]],
      units: [['harvester', 56.5, 17.5, 'harvest'], ['rifle', 43.5, 24.5], ['buggy', 46.5, 27.5], ['rocket', 39.5, 20.5]] },
  },
  {
    walls: [['rock', 30, 3, 32, 44, [[16, 22], [34, 40]]], ['water', 17, 11, 23, 15], ['water', 40, 30, 46, 33]],
    fields: [[10, 31, 4], [16, 42, 3], [35, 27, 3], [47, 19, 4], [55, 38, 3]],
    player: { buildings: [['command', 7, 34], ['power', 3, 35], ['refinery', 4, 40], ['barracks', 13, 39], ['factory', 14, 33], ['radar', 10, 28]],
      units: [['harvester', 8.5, 43.5, 'harvest'], ['scout', 18.5, 31.5], ['stealthTank', 21.5, 29.5], ['rocket', 19.5, 35.5], ['buggy', 23.5, 33.5]] },
    enemy: { buildings: [['command', 52, 8], ['power', 58, 9], ['refinery', 55, 14], ['barracks', 49, 13], ['factory', 46, 7]],
      units: [['harvester', 55.5, 18.5, 'harvest'], ['rifle', 44.5, 22.5], ['lightTank', 47.5, 25.5],
        ['stealthTank', 45.5, 18.5], ['engineer', 45.5, 26.5]] },
  },
  {
    walls: [['rock', 23, 3, 25, 44, [[11, 17], [30, 37]]], ['rock', 43, 3, 45, 44, [[19, 27], [35, 40]]],
      ['water', 29, 7, 36, 10]],
    fields: [[10, 34, 4], [16, 21, 3], [35, 35, 4], [50, 25, 4], [55, 7, 3]],
    player: { buildings: [['command', 7, 34], ['power', 3, 35], ['refinery', 4, 40], ['barracks', 13, 39], ['factory', 14, 33], ['radar', 10, 28], ['turret', 13, 30]],
      units: [['harvester', 8.5, 43.5, 'harvest'], ['rocket', 19.5, 32.5], ['guardian', 21.5, 34.5], ['rifle', 17.5, 37.5], ['medic', 18.5, 37.5]] },
    enemy: { buildings: [['command', 52, 8], ['power', 58, 9], ['refinery', 55, 14], ['barracks', 49, 12], ['factory', 46, 7]],
      units: [['harvester', 55.5, 18.5, 'harvest'], ['rifle', 45.5, 21.5], ['buggy', 47.5, 24.5], ['lightTank', 41.5, 17.5]] },
  },
  {
    walls: [['rock', 17, 3, 19, 44, [[12, 19], [31, 37]]], ['rock', 44, 3, 46, 44, [[18, 25], [34, 40]]],
      ['water', 28, 6, 35, 9], ['water', 29, 39, 36, 42]],
    fields: [[10, 30, 4], [14, 42, 3], [26, 25, 3], [37, 22, 3], [53, 29, 4], [55, 7, 3]],
    player: { buildings: [['command', 6, 34], ['power', 2, 35], ['refinery', 3, 40], ['barracks', 11, 38],
      ['factory', 12, 32], ['radar', 8, 29]],
      units: [['harvester', 7.5, 43.5, 'harvest'], ['rifle', 19.5, 31.5], ['rifle', 21.5, 29.5],
        ['rocket', 22.5, 34.5], ['guardian', 24.5, 30.5], ['buggy', 27.5, 28.5], ['medic', 20.5, 35.5]] },
    enemy: { buildings: [['command', 52, 8], ['power', 58, 9], ['refinery', 55, 14], ['barracks', 49, 12],
      ['factory', 48, 6], ['radar', 51, 18], ['turret', 47, 20]],
      units: [['harvester', 56.5, 18.5, 'harvest'], ['rifle', 43.5, 24.5], ['rocket', 46.5, 22.5],
        ['lightTank', 42.5, 28.5], ['buggy', 40.5, 25.5]] },
  },
  {
    // A full-height flooded channel makes the airlift necessary in both directions.
    walls: [['water', 30, 0, 36, 47]],
    fields: [],
    player: { buildings: [], units: [
      ['dropship', 23.5, 28.5], ['dropship', 23.5, 33.5],
      ['engineer', 21.5, 29.5], ['rocket', 21.5, 28.5], ['rocket', 21.5, 32.5],
      ['flamer', 20.5, 30.5], ['rifle', 20.5, 33.5], ['medic', 19.5, 31.5],
    ] },
    enemy: { buildings: [], units: [
      ['rifle', 45.5, 27.5], ['rifle', 46.5, 30.5], ['rocket', 47.5, 28.5],
      ['buggy', 48.5, 32.5],
    ] },
  },
  {
    // A narrow southern return route and a northern signal pass give the fixed
    // team room to choose where to intercept the radar's mobile escort.
    walls: [['rock', 27, 7, 29, 42, [[17, 23], [31, 36]]],
      ['rock', 37, 27, 54, 29, [[43, 47]]], ['water', 8, 16, 18, 19]],
    fields: [],
    player: { buildings: [], units: [
      ['engineer', 13.5, 34.5], ['rifle', 12.5, 32.5], ['rifle', 14.5, 32.5],
      ['rocket', 15.5, 35.5], ['scout', 16.5, 31.5], ['lightTank', 18.5, 34.5],
    ] },
    enemy: { buildings: [['radar', 43, 16], ['power', 49, 16]], units: [
      ['rifle', 39.5, 19.5], ['rifle', 45.5, 21.5], ['rocket', 41.5, 21.5],
      ['buggy', 35.5, 23.5], ['lightTank', 48.5, 23.5],
    ] },
  },
  {
    // The eastern freight signal is beyond a wide canyon gap; defending the
    // harvesters alone cannot finish the operation.
    walls: [['rock', 27, 2, 30, 44, [[19, 27], [35, 39]]],
      ['water', 34, 33, 48, 35], ['water', 7, 14, 17, 17]],
    fields: [[10, 29, 4], [18, 40, 4], [23, 22, 3], [43, 24, 3], [54, 35, 4]],
    player: { buildings: [['command', 6, 32], ['power', 2, 34], ['power', 2, 30], ['refinery', 4, 39],
      ['barracks', 12, 37], ['factory', 13, 31], ['turret', 21, 30], ['guardTower', 21, 34]],
      units: [['harvester', 9.5, 42.5, 'harvest'], ['harvester', 17.5, 39.5, 'harvest'],
        ['rifle', 22.5, 27.5], ['rocket', 23.5, 30.5], ['rocket', 22.5, 35.5],
        ['lightTank', 24.5, 28.5], ['lightTank', 20.5, 33.5], ['medic', 19.5, 31.5]] },
    enemy: { buildings: [['command', 52, 8], ['power', 58, 10], ['refinery', 55, 16],
      ['barracks', 48, 14], ['factory', 47, 7], ['turret', 43, 25]],
      units: [['harvester', 56.5, 39.5, 'harvest'], ['lightTank', 41.5, 23.5],
        ['buggy', 39.5, 27.5], ['rifle', 45.5, 29.5], ['rocket', 45.5, 22.5]] },
  },
];

// A completed operation always earns its campaign star. The second recognizes
// a surviving command yard; the third rewards finishing inside the operation's
// par time. Keeping the result on Game makes it travel with ordinary saves.
const MEDAL_PAR_SECONDS = Object.freeze([300, 360, 300, 330, 300, 300, 420, 110, 170, 210, 150, 360, 160, 145, 190]);

export function getCampaignResult(game, index = game?.campaignMission) {
  if (!game || !Number.isInteger(index) || index < 0 || index >= CAMPAIGN_MISSIONS.length ||
      game.status !== 'victory' || !game.campaignComplete) return null;
  const keyAssetSurvived = index === 12 || index === 13
    ? live(game.getEntity(game.campaignState?.engineerId))
    : index === 5
    ? live(game.getEntity(game.campaignState?.escortId))
    : index === 10
      ? live(game.getEntity(game.campaignState?.fallbackId))
      : livingBuildings(game, 'player', 'command').length > 0;
  const elapsed = Math.max(0, Number(game.campaignState?.elapsed) || 0);
  const stars = 1 + Number(keyAssetSurvived) + Number(keyAssetSurvived && elapsed <= MEDAL_PAR_SECONDS[index]);
  return {
    mission: CAMPAIGN_MISSIONS[index].id,
    fieldOrderId: selectedFieldOrder(game, index)?.spec.id || 'none',
    fieldOrderStatus: selectedFieldOrder(game, index)
      ? (game.campaignState?.fieldOrderStatus || 'failed') : 'none',
    stars,
    elapsed: Math.round(elapsed),
    keyAssetSurvived,
    kills: Math.max(0, Number(game.kills?.player) || 0),
    campaignVeteran: deriveCampaignVeteran(game),
  };
}

function paintTerrain(game, layout) {
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const [type, left, top, right, bottom, gaps = []] of layout.walls) {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const vertical = bottom - top > right - left;
      const along = vertical ? y : x;
      if (gaps.some(([from, to]) => along >= from && along <= to)) continue;
      const tile = game.terrain[y][x];
      tile.type = type; tile.walkable = false; tile.buildable = false;
    }
  }
  for (const [cx, cy, radius] of layout.fields) {
    for (let y = Math.max(0, cy - radius); y <= Math.min(game.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(game.width - 1, cx + radius); x++) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance > radius || game.terrain[y][x].type !== 'sand') continue;
        const tile = game.terrain[y][x];
        tile.type = 'crystal'; tile.resource = Math.round(420 + (radius - distance) * 85);
        tile.walkable = true; tile.buildable = false;
      }
    }
  }
}

function placeForces(game, layout) {
  game.units = []; game.buildings = []; game.effects = []; game.selection = [];
  game.events = game.events.filter(event => event.type === 'mission');
  game.fog = Array.from({ length: game.height }, () => Array(game.width).fill(0));
  game._nextEntityId = 1;
  paintTerrain(game, layout);
  for (const owner of ['player', 'enemy']) {
    for (const [defId, x, y] of layout[owner].buildings) {
      const { w, h } = BUILDING_DEFS[defId];
      // A built structure has a clear footprint even where a field reaches it.
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        const tile = game.terrain[yy][xx];
        tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
      }
      game._createBuilding(owner, defId, x, y, 1);
    }
    for (const [defId, x, y, order] of layout[owner].units) {
      const tile = game.terrain[Math.floor(y)][Math.floor(x)];
      if (!tile.walkable) { tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true; }
      game._createUnit(owner, defId, x, y, order ? { type: order } : undefined);
    }
  }
  game._placeRelays(); game._refreshPower(); game._updateFog();
}

function setMission(game, index) {
  const metadata = CAMPAIGN_MISSIONS[index];
  game.campaignMission = index;
  game.campaignComplete = false;
  game.campaignState = { elapsed: 0 };
  game.mission = { title: metadata.title, briefing: metadata.briefing, objective: metadata.objective };
  // Replace the constructor's generic campaign event so UI listeners see the authored briefing.
  const initialMissionEvent = [...game.events].reverse().find(event => event.type === 'mission');
  if (initialMissionEvent) Object.assign(initialMissionEvent, game.mission);
}

function prepareMission(game, index, replayVersion = null) {
  placeForces(game, SCENARIOS[index]);
  setMission(game, index);
  const state = game.campaignState;

  if (index === 0) {
    game.credits.player = 3000;
    state.refineryTarget = 2;
    if (replayVersion === null || replayVersion >= FIRST_HARVEST_RAID_RULES_VERSION) {
      state.firstHarvestRaidRulesVersion = FIRST_HARVEST_RAID_RULES_VERSION;
      state.firstHarvestRaidPoint = { x: 23.5, y: 34.5, radius: 3 };
      state.firstHarvestRaidUnitIds = [];
      state.firstHarvestRaidWarned = false;
      state.firstHarvestRaidFired = false;
      state.firstHarvestRaidAttackOrdered = false;
      state.firstHarvestRaidResponseOrdered = false;
      state.firstHarvestRaidRepelled = false;
      state.firstHarvestRaidOrderStartEventIndex = null;
      state.firstHarvestRaidOrderEventIndex = null;
    } else {
      game.mission = { ...game.mission, objective: 'Build a second refinery and bank 2,200 credits.' };
      const initialMissionEvent = [...game.events].reverse().find(event => event.type === 'mission');
      if (initialMissionEvent) initialMissionEvent.objective = game.mission.objective;
    }
    return;
  }

  if (index === 1) {
    const radar = livingBuildings(game, 'enemy', 'radar')[0];
    radar.hp = Math.round(radar.maxHp * 0.68);
    radar.captureOnly = true;
    radar.repairing = false;
    for (const engineer of game.units.filter(unit => unit.owner === 'player' && unit.defId === 'engineer')) {
      game._setCampaignUnitBaseHealth(engineer, 210);
    }
    state.targetId = radar.id;
    game.credits.player = 3000;
    game._refreshPower(); game._updateFog();
    return;
  }

  if (index === 2) {
    game.credits.player = 4600;
    state.duration = 180;
    game._refreshPower();
    return;
  }

  if (index === 3) {
    const relay = livingBuildings(game, 'enemy', 'radar')[0];
    relay.hp = Math.round(relay.maxHp * 0.82);
    relay.campaignShielded = true;
    state.targetId = relay.id;
    state.phase = 'secure-relay';
    state.relayId = game.relays[1].id;
    state.holdDuration = 8;
    state.holdElapsed = 0;
    state.deadline = 420;
    game.credits.player = 4300;
    game._refreshPower(); game._updateFog();
    return;
  }

  if (index === 4) {
    game.credits.player = 2500;
    state.refineryTarget = 2;
    state.deadline = 360;
    state.courierId = livingUnits(game, 'enemy', 'buggy')[0]?.id ?? null;
    state.courierRewardClaimed = false;
    state.signalTraceRemaining = game.campaignRoutePayoffId === 'ghost-channel' ? 20 : 0;
    state.signalTraceUnitIds = state.courierId ? game.units.filter(unit => unit.owner === 'enemy' && live(unit) &&
      (unit.id === state.courierId || Math.hypot(unit.x - game.getEntity(state.courierId).x,
        unit.y - game.getEntity(state.courierId).y) <= 8)).map(unit => unit.id) : [];
    if (game.campaignRoutePayoffId === 'iron-current') {
      game._createUnit('player', 'engineer', 19.5, 20.5);
      const freightCache = { id: `wreck${game._nextWreckId++}`, x: 40.5, y: 22.5, value: 700,
        faction: 'vesper', expiresAt: game.time + 3600, campaignFreightCache: true };
      game.wrecks.push(freightCache);
      state.freightCacheId = freightCache.id;
    }
    return;
  }

  if (index === 5) {
    const analyst = livingUnits(game, 'player', 'engineer')[0];
    // The exposed transmission stop and eastern ambush leave the analyst
    // vulnerable even when the escort leads the crossing.
    game._setCampaignUnitBaseHealth(analyst, 160);
    state.escortId = analyst.id;
    state.extraction = { x: 48, y: 17, radius: 2.2 };
    state.transmissionUplinks = [
      { id: 'north', x: 30.5, y: 27.5, radius: 2.2 },
      { id: 'south', x: 30.5, y: 32, radius: 2.2 },
    ];
    state.phase = 'transmit-codes';
    state.transmissionUplinkId = null;
    state.transmissionElapsed = 0;
    state.transmissionDuration = 8;
    state.ashesUplinkRulesVersion = 48;
    state.extractionInterceptWarned = false;
    state.extractionInterceptWarningElapsed = 0;
    state.extractionInterceptFired = false;
    state.extractionInterceptUnitIds = [];
    game.credits.player = 0;
    game._updateFog();
    return;
  }

  if (index === 6) {
    game.credits.player = 5200;
    state.targetId = livingBuildings(game, 'enemy', 'command')[0]?.id ?? null;
    state.phase = 'secure-relay';
    state.relayId = game.relays[1].id;
    state.holdDuration = 8;
    state.holdElapsed = 0;
    const command = game.getEntity(state.targetId);
    if (command) command.campaignShielded = true;
    game._updateFog();
    return;
  }

  if (index === 7) {
    game.credits.player = 5000;
    state.stormCycles = 1;
    state.shelterHoldElapsed = 0;
    game.storm.phase = 'calm'; game.storm.phaseTime = 0; game.storm.cycle = 0;
    game._updateFog();
    return;
  }

  if (index === 8) {
    game.credits.player = 4200;
    state.relayTargetCount = 2;
    state.holdDuration = 25;
    state.holdElapsed = 0;
    state.relayPairChoice = 'none';
    state.relayReserveUnitIds = [];
    // The opening squad stages outside both relay capture circles. Players
    // choose which crossing to take and must actually issue relay orders.
    const staging = [
      ['rifle', 21.5, 27.5, 16.5, 31.5],
      ['scout', 30.5, 17.5, 26.5, 16.5],
      ['lightTank', 33.5, 18.5, 27.5, 20.5],
    ];
    for (const [defId, fromX, fromY, x, y] of staging) {
      const unit = game.units.find(u => u.owner === 'player' && u.defId === defId && u.x === fromX && u.y === fromY);
      if (unit) { unit.x = x; unit.y = y; }
    }
    game._refreshPower(); game._updateFog();
    return;
  }

  if (index === 9) {
    const target = livingUnits(game, 'enemy', 'engineer')[0];
    game._setCampaignUnitBaseHealth(target, 160);
    state.targetId = target?.id ?? null;
    state.deadline = 300;
    game.credits.player = 3600;
    game._updateFog();
    return;
  }

  if (index === 10) {
    const fallback = livingBuildings(game, 'player', 'radar')[0];
    state.fallbackId = fallback?.id ?? null;
    state.duration = 120;
    state.assaultWaveOneFired = false;
    state.assaultWaveTwoFired = false;
    state.assaultWaveThreeFired = false;
    state.reliefSquadFired = false;
    game.credits.player = 3800;
    game._updateFog();
    return;
  }

  if (index === 11) {
    state.relayTargetCount = 2;
    state.holdDuration = 18;
    state.holdElapsed = 0;
    state.phase = 'secure-relays';
    state.targetId = livingBuildings(game, 'enemy', 'command')[0]?.id ?? null;
    const command = game.getEntity(state.targetId);
    if (command) command.campaignShielded = true;
    game.credits.player = 5200;
    game._updateFog();
    return;
  }

  if (index === 12) {
    const engineer = livingUnits(game, 'player', 'engineer')[0];
    state.engineerId = engineer?.id ?? null;
    state.relayId = game.relays[2].id;
    state.phase = 'secure-landing';
    state.holdDuration = 12;
    state.holdElapsed = 0;
    state.extractionPatrolWarned = false;
    state.extractionPatrolWarningElapsed = 0;
    state.extractionPatrolFired = false;
    state.extraction = { x: 21.5, y: 29.5, radius: 2.5 };
    state.deadline = 240;
    game.credits.player = 0;
    game.credits.enemy = 0;
    game._updateFog();
    return;
  }

  if (index === 13) {
    const engineer = livingUnits(game, 'player', 'engineer')[0];
    const vault = livingBuildings(game, 'enemy', 'radar')[0];
    game._setCampaignUnitBaseHealth(engineer, 135);
    vault.campaignShielded = true;
    state.engineerId = engineer.id;
    state.targetId = vault.id;
    state.phase = 'capture-vault';
    state.hackDuration = 8;
    state.hackElapsed = 0;
    state.extraction = { x: 13.5, y: 34.5, radius: 2.5 };
    state.deadline = 210;
    game.credits.player = 0;
    game.credits.enemy = 0;
    game._updateFog();
    return;
  }

  if (index === 14) {
    state.phase = 'fund-reserve';
    state.reserveTarget = 3000;
    state.reserveCommitted = false;
    state.relayId = game.relays[2].id;
    state.holdDuration = 22;
    state.postAssaultHoldDuration = 12;
    state.postAssaultHoldElapsed = 0;
    state.holdElapsed = 0;
    state.assaultWaveOneFired = false;
    state.assaultWaveTwoFired = false;
    state.assaultWaveThreeFired = false;
    state.assaultWaveThreeUnitId = null;
    state.assaultWaveThreeEscortUnitId = null;
    state.enemyRelayHoldElapsed = 0;
    state.reserveGuardUnitId = null;
    state.reserveEscortUnitIds = [];
    if (replayVersion === null || replayVersion >= IRON_CURRENT_RELAY_ASSAULT_RULES_VERSION) {
      state.ironCurrentRulesVersion = IRON_CURRENT_RELAY_ASSAULT_RULES_VERSION;
    } else {
      game.mission = { ...game.mission,
        briefing: 'Vesper armor is pushing along the current toward the supply crossing. Run the full command base, harvest enough crystal to commit a 3,000-credit reserve, then secure the eastern freight relay for 22 seconds while your yard holds against the counterattacks.',
        objective: 'Commit 3,000 credits, hold the freight relay for 22 seconds, destroy the final Vesper tank, then keep the relay secure for 12 seconds. The command yard must survive.' };
      const initialMissionEvent = [...game.events].reverse().find(event => event.type === 'mission');
      if (initialMissionEvent) initialMissionEvent.objective = game.mission.objective;
    }
    game.credits.player = 1800;
    game._refreshPower(); game._updateFog();
    return;
  }

  game.credits.player = 5200;
  state.targetId = livingBuildings(game, 'enemy', 'command')[0]?.id ?? null;
  game._updateFog();
}

/** Create a playable scenario Game for a zero-based campaign mission index.
 * `seed` may be supplied by a server run ticket; omitted seeds keep the
 * historical per-mission defaults used by existing callers and saves.
 */
function campaignVeteranSpawnPoint(game) {
  const force = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    !unit.embarkedIn && UNIT_DEFS[unit.defId]?.weapon);
  const anchorX = force.length ? force.reduce((sum, unit) => sum + unit.x, 0) / force.length : 12.5;
  const anchorY = force.length ? force.reduce((sum, unit) => sum + unit.y, 0) / force.length : 36.5;
  const candidates = [];
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    if (!game._isPassable(x, y)) continue;
    const px = x + 0.5, py = y + 0.5;
    if (game.units.some(unit => unit.hp > 0 && !unit.embarkedIn &&
      Math.hypot(unit.x - px, unit.y - py) < 0.85)) continue;
    const distance = Math.hypot(px - anchorX, py - anchorY);
    candidates.push({ x: px, y: py, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  const chosen = candidates.find(point => point.distance <= 5) || candidates[0];
  if (!chosen) throw new Error('No safe tile is available for the campaign veteran.');
  return { x: chosen.x, y: chosen.y };
}

function spawnCampaignVeteran(game, veteran, carryoverId, supplyId) {
  if (!veteran) return;
  const point = campaignVeteranSpawnPoint(game);
  const unit = game._createUnit('player', veteran.defId, point.x, point.y);
  const rank = VETERANCY_RANKS[veteran.veterancy];
  unit.faction = veteran.faction;
  unit.veterancy = veteran.veterancy;
  unit.xp = rank.xp;
  unit.kills = 0;
  unit.maxHp = UNIT_DEFS[unit.defId].health * rank.healthMultiplier *
    game._campaignUnitMultiplier('player', 'reinforced', 1.12);
  if (supplyId === 'vanguard') unit.maxHp = Math.round(unit.maxHp * 1.1);
  unit.hp = unit.maxHp;
  unit.promotion = veteran.promotion;
  if (carryoverId === 'assault') {
    unit.shieldHp = unit.maxHp * 0.2;
    unit.shieldUntil = game.time + 45;
  }
}

export function createCampaignGame(index = 0, difficulty = 'normal', seed = 80217 + index * 9721,
  doctrineId = 'standard', fieldOrderId = 'none', carryoverId = 'none', supplyId = 'none', routePayoffId = 'none',
  campaignVeteran = null, replayVersion = null) {
  if (!Number.isInteger(index) || index < 0 || index >= CAMPAIGN_MISSIONS.length) {
    throw new RangeError(`Unknown campaign mission index: ${index}`);
  }
  if (!CAMPAIGN_DOCTRINES.some(doctrine => doctrine.id === doctrineId)) {
    throw new RangeError(`Unknown campaign doctrine: ${doctrineId}`);
  }
  if (fieldOrderId !== 'none' && !CAMPAIGN_FIELD_ORDERS[index].some(order => order.id === fieldOrderId)) {
    throw new RangeError(`Unknown field order for campaign mission ${index}: ${fieldOrderId}`);
  }
  if (!CAMPAIGN_CARRYOVERS.some(carryover => carryover.id === carryoverId) || index === 0 && carryoverId !== 'none') {
    throw new RangeError(`Unknown carryover for campaign mission ${index}: ${carryoverId}`);
  }
  if (!CAMPAIGN_SUPPLIES.some(supply => supply.id === supplyId) || index === 0 && supplyId !== 'none') {
    throw new RangeError(`Unknown campaign supply package for mission ${index}: ${supplyId}`);
  }
  const routePayoffSupported = index === 4 || index === 5 &&
    (replayVersion === null || replayVersion >= ASHES_ROUTE_RULES_VERSION);
  if (!CAMPAIGN_ROUTE_PAYOFFS.some(payoff => payoff.id === routePayoffId) ||
      routePayoffId !== 'none' && !routePayoffSupported) {
    throw new RangeError(`Unknown campaign route payoff for mission ${index}: ${routePayoffId}`);
  }
  if (!validateCampaignVeteran(campaignVeteran) || index === 0 && campaignVeteran !== null) {
    throw new RangeError(`Invalid campaign veteran for mission ${index}.`);
  }
  const game = new Game({ seed, difficulty, faction: CAMPAIGN_MISSIONS[index].faction,
    mode: 'campaign', campaignDoctrineId: doctrineId });
  game.campaignVeteran = campaignVeteran;
  game.campaignRoutePayoffId = routePayoffId;
  prepareMission(game, index, replayVersion);
  if (index === 5 && routePayoffId !== 'none' &&
      (replayVersion === null || replayVersion >= ASHES_ROUTE_RULES_VERSION)) {
    const state = game.campaignState;
    state.ashesRouteRulesVersion = ASHES_ROUTE_RULES_VERSION;
    state.transmissionUplinks = state.transmissionUplinks.filter(item =>
      routePayoffId === 'ghost-channel' ? item.id === 'north' : item.id === 'south');
    if (routePayoffId === 'iron-current') {
      // Keep the cache beside the low-power channel so the analyst can recover
      // it with the existing Engineer wreck interaction before extraction.
      const cache = { id: `wreck${game._nextWreckId++}`, x: 34.5, y: 32.5, value: 250,
        faction: 'aegis', expiresAt: game.time + 3600, campaignAshesSupplyCache: true };
      game.wrecks.push(cache);
      state.routeCacheId = cache.id;
      state.routeCacheRecovered = false;
    } else {
      state.ghostShadowPoint = { x: 35.5, y: 25.5, radius: 2.2 };
      state.ghostShadowElapsed = 0;
      state.ghostShadowDuration = 3;
      state.ghostShadowDeployed = false;
    }
  }
  if (index === 4 && routePayoffId !== 'none') {
    // New unversioned sorties and their saves opt into the route-specific
    // objective. Old unversioned saves lack this marker and retain the prior
    // economy-only completion rule.
    game.campaignState.routeObjectiveRulesVersion = CAMPAIGN_ROUTE_OBJECTIVE_RULES_VERSION;
  }
  game.campaignFieldOrderId = fieldOrderId;
  game.campaignCarryoverId = carryoverId;
  game.campaignSupplyId = supplyId;
  if (carryoverId === 'assault') {
    for (const unit of game.units) {
      if (unit.owner === 'player' && game.unitDefs[unit.defId]?.weapon) {
        unit.shieldHp = unit.maxHp * 0.2;
        unit.shieldUntil = game.time + 45;
      }
    }
  } else if (carryoverId === 'signal') {
    game.commandEnergy.player = Math.min(100, game.commandEnergy.player + 50);
  }
  if (supplyId === 'reserves') {
    game.creditCapacity.player += 500;
    game.credits.player = Math.min(game.creditCapacity.player, game.credits.player + 500);
  } else if (supplyId === 'recon') {
    const enemies = [...game.units, ...game.buildings].filter(entity => entity.owner === 'enemy' && entity.hp > 0 &&
      (!('w' in entity) || entity.progress >= 1));
    const objective = game.getEntity(game.campaignState?.targetId);
    let target = objective?.owner === 'enemy' && objective.hp > 0 ? objective : null;
    if (!target && enemies.length) {
      const playerUnits = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0);
      const px = playerUnits.reduce((sum, unit) => sum + unit.x, 0) / Math.max(1, playerUnits.length);
      const py = playerUnits.reduce((sum, unit) => sum + unit.y, 0) / Math.max(1, playerUnits.length);
      target = enemies.sort((a, b) => {
        const ac = game._entityCenter(a), bc = game._entityCenter(b);
        return Math.hypot(ac.x - px, ac.y - py) - Math.hypot(bc.x - px, bc.y - py) || a.id.localeCompare(b.id);
      })[0];
    }
    if (target) {
      const center = game._entityCenter(target);
      game.scans.push({ owner: 'player', x: center.x, y: center.y, radius: 7, until: game.time + 20 });
      for (const unit of game.units) if (unit.owner === 'enemy' && Math.hypot(unit.x - center.x, unit.y - center.y) <= 7)
        unit.revealedUntil = Math.max(unit.revealedUntil || 0, game.time + 20);
      game._updateFog();
    }
  } else if (supplyId === 'vanguard') {
    for (const unit of game.units) {
      if (unit.owner !== 'player' || !game.unitDefs[unit.defId]?.weapon) continue;
      unit.maxHp = Math.round(unit.maxHp * 1.1);
      unit.hp = Math.min(unit.maxHp, unit.hp + Math.round(unit.maxHp * 0.2));
    }
  }
  spawnCampaignVeteran(game, campaignVeteran, carryoverId, supplyId);
  if (fieldOrderId !== 'none') {
    const { rule } = selectedFieldOrder(game, index);
    game.campaignState.fieldOrderStatus = 'active';
    if (rule.type === 'raid') {
      game.campaignState.fieldOrderTargetId = livingUnits(game, 'enemy', rule.target)[0]?.id ?? null;
      game.campaignState.fieldOrderEngaged = false;
    } else if (rule.type === 'relaySweep') {
      game.campaignState.fieldOrderHoldElapsed = 0;
    }
  }
  return game;
}

function failMission(game, reason) {
  if (selectedFieldOrder(game) && game.campaignState?.fieldOrderStatus === 'active')
    game.campaignState.fieldOrderStatus = 'failed';
  game.status = 'defeat'; game.winner = 'enemy';
  game._event('defeat', { winner: 'enemy', reason, campaignMission: game.campaignMission });
  return false;
}

function updateFieldOrder(game, index, dt) {
  const selected = selectedFieldOrder(game, index);
  if (!selected) return;
  const state = game.campaignState;
  if (state.fieldOrderStatus !== 'active') return;
  const { rule, spec } = selected;
  let achieved = false;
  if (rule.type === 'raid') {
    const target = game.getEntity(state.fieldOrderTargetId);
    achieved = !!state.fieldOrderEngaged && !!state.fieldOrderTargetId && (!target || !live(target));
  } else if (rule.type === 'relaySweep') {
    state.fieldOrderHoldElapsed = game.relays.every(relay => relay.owner === 'player' && !relay.contested)
      ? (state.fieldOrderHoldElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
      : 0;
    achieved = state.fieldOrderHoldElapsed + 1e-9 >= rule.holdDuration;
  } else if (rule.type === 'waypoint') {
    achieved = game.units.some(unit => unit.owner === 'player' && unit.defId === 'dropship' && live(unit) &&
      Math.hypot(unit.x - rule.x, unit.y - rule.y) <= rule.radius);
  } else {
    const relay = game.relays[rule.relay];
    achieved = relay?.owner === 'player';
  }
  if (!achieved) return;
  state.fieldOrderStatus = 'completed';
  if (index === 5 || index === 12 || index === 13) {
    for (const unit of game.units) {
      if (unit.owner !== 'player' || !live(unit)) continue;
      const originalMax = unit.maxHp;
      unit.maxHp = Math.round(unit.maxHp * 1.25);
      unit.hp = Math.min(unit.maxHp, unit.hp + Math.round(originalMax * 0.35));
    }
  } else {
    game.credits.player += 650;
  }
  game._event('campaignIntel', { message: `${spec.title} complete. ${spec.rewardText}`,
    fieldOrderId: spec.id, reward: index === 5 || index === 12 || index === 13 ? 'refit' : 650 });
}

function ironCurrentRelayAssaultRulesActive(state, replayVersion) {
  return replayVersion === null
    ? state.ironCurrentRulesVersion === IRON_CURRENT_RELAY_ASSAULT_RULES_VERSION
    : replayVersion >= IRON_CURRENT_RELAY_ASSAULT_RULES_VERSION;
}

function deployIronCurrentAssault(game, state, relayAssaultRules) {
  const yard = livingBuildings(game, 'player', 'command')[0];
  const refinery = livingBuildings(game, 'player', 'refinery')[0];
  if (!yard) return;
  if (!state.assaultWaveOneFired && state.elapsed + 1e-9 >= 35) {
    state.assaultWaveOneFired = true;
    const targetId = (refinery || yard).id;
    game._createUnit('enemy', 'buggy', 32.5, 36.5, { type: 'attack', targetId });
    game._createUnit('enemy', 'rifle', 33.5, 37.5, { type: 'attack', targetId });
    game._event('campaignReinforcement', { message: 'Vesper raiders are cutting toward the refinery.' });
  }
  if (!state.assaultWaveTwoFired && state.elapsed + 1e-9 >= 55) {
    state.assaultWaveTwoFired = true;
    game._createUnit('enemy', 'lightTank', 33.5, 23.5, { type: 'attack', targetId: yard.id });
    game._event('campaignReinforcement', { message: 'A Vesper armor column is entering the northern canyon.' });
  }
  if (!state.assaultWaveThreeFired && state.elapsed + 1e-9 >= 70) {
    state.assaultWaveThreeFired = true;
    const relay = game.relays.find(item => item.id === state.relayId);
    const finalTankOrder = relayAssaultRules && relay
      ? { type: 'move', x: relay.x, y: relay.y, attackMove: true }
      : { type: 'attack', targetId: yard.id };
    const finalTank = game._createUnit('enemy', 'lightTank', 29.5, 35.5, finalTankOrder);
    state.assaultWaveThreeUnitId = finalTank.id;
    if (relayAssaultRules) {
      state.enemyRelayHoldElapsed = 0;
      const escort = game._createUnit('enemy', 'rocket', 30.5, 36.5,
        { type: 'move', x: relay.x, y: relay.y, attackMove: true });
      state.assaultWaveThreeEscortUnitId = escort.id;
      game._event('campaignReinforcement', { message: 'Vesper’s final armor group is driving for the freight relay. The crossing is under direct threat.' });
    } else {
      game._event('campaignReinforcement', { message: 'A Vesper light tank is pushing toward the command yard.' });
    }
  }
}

function deployLastEmberReinforcements(game, state) {
  const target = game.getEntity(state.fallbackId);
  if (!target) return;
  const attack = { type: 'attack', targetId: target.id };
  if (!state.assaultWaveOneFired && state.elapsed + 1e-9 >= 26) {
    state.assaultWaveOneFired = true;
    game._createUnit('enemy', 'rifle', 29.5, 33.5, attack);
    game._createUnit('enemy', 'buggy', 31.5, 35.5, attack);
    game._event('campaignReinforcement', { message: 'Aegis assault team breached the western pass.' });
  }
  if (!state.assaultWaveTwoFired && state.elapsed + 1e-9 >= 66) {
    state.assaultWaveTwoFired = true;
    game._createUnit('enemy', 'lightTank', 27.5, 32.5, attack);
    game._createUnit('enemy', 'lightTank', 28.5, 35.5, attack);
    game._createUnit('enemy', 'rifle', 29.5, 33.5, attack);
    game._createUnit('enemy', 'rocket', 30.5, 35.5, attack);
    game._event('campaignReinforcement', { message: 'Aegis heavy relief column is attacking the fallback beacon.' });
  }
  if (!state.reliefSquadFired && state.elapsed + 1e-9 >= 88) {
    state.reliefSquadFired = true;
    game._createUnit('player', 'flamer', 13.5, 39.5, { type: 'guard', x: 11.5, y: 30.5 });
    game._createUnit('player', 'flamer', 15.5, 39.5, { type: 'guard', x: 11.5, y: 30.5 });
    game._createUnit('player', 'rocket', 17.5, 39.5, { type: 'guard', x: 11.5, y: 30.5 });
    game._event('campaignReinforcement', { message: 'Vesper relief squad reached the fallback beacon.' });
  }
  if (!state.assaultWaveThreeFired && state.elapsed + 1e-9 >= 100) {
    state.assaultWaveThreeFired = true;
    game._createUnit('enemy', 'lightTank', 22.5, 32.5, attack);
    game._createUnit('enemy', 'lightTank', 23.5, 35.5, attack);
    game._createUnit('enemy', 'rocket', 24.5, 33.5, attack);
    game._event('campaignReinforcement', { message: 'Aegis final column is pushing through the western pass.' });
  }
}

function deployStormAssault(game, state) {
  const yard = livingBuildings(game, 'player', 'command')[0];
  if (!yard) return;
  const attack = { type: 'attack', targetId: yard.id };
  if (!state.stormAssaultOneFired && state.elapsed + 1e-9 >= 25) {
    state.stormAssaultOneFired = true;
    game._createUnit('enemy', 'lightTank', 26.5, 34.5, attack);
    game._createUnit('enemy', 'rocket', 25.5, 36.5, attack);
    game._event('campaignReinforcement', { message: 'Vesper armor is crossing the southern storm gap.' });
  }
  if (!state.stormAssaultTwoFired && state.elapsed + 1e-9 >= 48) {
    state.stormAssaultTwoFired = true;
    game._createUnit('enemy', 'lightTank', 25.5, 33.5, attack);
    game._createUnit('enemy', 'lightTank', 26.5, 36.5, attack);
    game._event('campaignReinforcement', { message: 'The final strike is advancing on the command yard.' });
  }
}

function commitThreePointsRelayReserve(game, state, replayVersion) {
  if (replayVersion !== null && replayVersion < 24) return;
  state.relayPairChoice ??= 'none';
  if (state.relayPairChoice !== 'none') return;
  const held = game.relays.map((relay, index) => ({ relay, index }))
    .filter(({ relay }) => relay.owner === 'player' && !relay.contested);
  if (held.length < 2) return;

  const pair = held.slice(0, 2).map(item => item.index).sort((a, b) => a - b);
  const key = pair.join('-');
  const packages = {
    '0-1': { id: 'yard-guard', name: 'Yard Guard', units: [
      ['rocket', 10.5, 36.5, { type: 'guard', x: 10.5, y: 36.5 }],
      ['rifle', 11.5, 38.5, { type: 'guard', x: 11.5, y: 38.5 }],
    ] },
    '1-2': { id: 'eastern-armor', name: 'Eastern Armor', units: [
      ['lightTank', 35.5, 24.5, { type: 'move', x: game.relays[2].x, y: game.relays[2].y, attackMove: true }],
      ['rocket', 36.5, 26.5, { type: 'move', x: game.relays[2].x, y: game.relays[2].y, attackMove: true }],
    ] },
    '0-2': { id: 'crossing-screen', name: 'Crossing Screen', units: [
      ['scout', 28.5, 25.5, { type: 'move', x: game.relays[1].x, y: game.relays[1].y, attackMove: true }],
      ['buggy', 29.5, 27.5, { type: 'move', x: game.relays[1].x, y: game.relays[1].y, attackMove: true }],
    ] },
  };
  const reserve = packages[key];
  if (!reserve) return;
  state.relayPairChoice = reserve.id;
  state.relayReserveUnitIds = reserve.units.map(([defId, x, y, order]) =>
    game._createUnit('player', defId, x, y, order).id);
  game._event('campaignReinforcement', { message: `${reserve.name} reserve reached the relay network.` });
}

function deployLastLightFlank(game, state) {
  const arrival = game.difficulty === 'easy' ? 140 : 150;
  if (state.lastLightFlankFired || state.elapsed + 1e-9 < arrival) return;
  const yard = livingBuildings(game, 'player', 'command')[0];
  if (!yard) return;
  state.lastLightFlankFired = true;
  const attack = { type: 'attack', targetId: yard.id };
  const flankIds = [
    game._createUnit('enemy', 'lightTank', 38.5, 33.5, attack).id,
    game._createUnit('enemy', 'lightTank', 39.5, 34.5, attack).id,
    game._createUnit('enemy', 'rocket', 39.5, 32.5, attack).id,
  ];
  if (game.difficulty === 'easy') {
    flankIds.push(game._createUnit('enemy', 'lightTank', 38.5, 35.5, attack).id);
    flankIds.push(game._createUnit('enemy', 'rocket', 40.5, 33.5, attack).id);
  }
  if (game.difficulty === 'hard') {
    flankIds.push(game._createUnit('enemy', 'lightTank', 38.5, 35.5, attack).id);
  }
  state.lastLightFlankUnitIds = flankIds;
  game._event('campaignReinforcement', { message: 'Vesper armor has broken through the eastern flank.' });
}

function firstHarvestRaidRulesActive(state, replayVersion) {
  return replayVersion === null
    ? state.firstHarvestRaidRulesVersion === FIRST_HARVEST_RAID_RULES_VERSION
    : replayVersion >= FIRST_HARVEST_RAID_RULES_VERSION;
}

function updateFirstHarvestRaid(game, state) {
  const point = state.firstHarvestRaidPoint || { x: 23.5, y: 34.5, radius: 3 };
  if (!state.firstHarvestRaidWarned && state.elapsed >= 7) {
    state.firstHarvestRaidWarned = true;
    state.firstHarvestRaidOrderStartEventIndex = game.events.length;
    game._event('campaignThreatWarning', { message: 'Vesper raiders are staging at the southern pass. Protect the Harvester; the lead buggy will strike in twelve seconds.',
      targetId: null, marker: { ...point } });
  }
  if (!state.firstHarvestRaidFired && state.elapsed >= 19) {
    const harvester = livingUnits(game, 'player', 'harvester')[0];
    const refinery = operationalBuildings(game, 'player', 'refinery')[0];
    const target = harvester || refinery || livingBuildings(game, 'player', 'command')[0];
    if (!target) return;
    const lead = game._createUnit('enemy', 'buggy', point.x, point.y,
      { type: 'attack', targetId: target.id });
    const raider = game._createUnit('enemy', 'rifle', point.x + 1, point.y,
      { type: 'attack', targetId: target.id });
    const escort = game._createUnit('enemy', 'lightTank', point.x, point.y + 1,
      { type: 'attack', targetId: target.id });
    state.firstHarvestRaidTargetId = lead.id;
    state.firstHarvestRaidUnitIds = [lead.id, raider.id, escort.id];
    state.firstHarvestRaidCurrentTargetId = target.id;
    state.firstHarvestRaidFired = true;
    game.scans.push({ owner: 'player', x: point.x, y: point.y, radius: 8, until: game.time + 18 });
    game._updateFog();
    game._event('campaignReinforcement', { message: 'The Vesper raid has reached the southern pass. Focus fire on its lead buggy before the Harvester is overrun.',
      targetId: lead.id, marker: { ...point } });
  }
  if (!state.firstHarvestRaidFired) return;

  const currentTarget = game.getEntity(state.firstHarvestRaidCurrentTargetId);
  if (!live(currentTarget)) {
    const replacement = livingUnits(game, 'player', 'harvester')[0] ||
      operationalBuildings(game, 'player', 'refinery')[0] || livingBuildings(game, 'player', 'command')[0];
    if (replacement) {
      state.firstHarvestRaidCurrentTargetId = replacement.id;
      for (const id of state.firstHarvestRaidUnitIds || []) {
        const unit = game.getEntity(id);
        if (!live(unit)) continue;
        unit.order = { type: 'attack', targetId: replacement.id };
        unit.path = []; unit._pathGoal = null;
      }
    }
  }

  const raidIds = new Set(state.firstHarvestRaidUnitIds || []);
  if (!state.firstHarvestRaidAttackOrdered || !state.firstHarvestRaidResponseOrdered) {
    const startIndex = Number.isInteger(state.firstHarvestRaidOrderEventIndex)
      ? state.firstHarvestRaidOrderEventIndex
      : Number.isInteger(state.firstHarvestRaidOrderStartEventIndex)
        ? state.firstHarvestRaidOrderStartEventIndex : game.events.length;
    const playerIds = new Set(game.units.filter(unit => unit.owner === 'player').map(unit => unit.id));
    for (const event of game.events.slice(startIndex)) {
      if (event.type !== 'order' || !Array.isArray(event.ids) ||
          !event.ids.some(id => playerIds.has(id))) continue;
      if (event.order === 'attack' && raidIds.has(event.targetId)) {
        state.firstHarvestRaidAttackOrdered = true;
        state.firstHarvestRaidResponseOrdered = true;
      } else if (['move', 'attackMove', 'forceMove'].includes(event.order) &&
          Number.isFinite(event.x) && Number.isFinite(event.y) &&
          Math.hypot(event.x - point.x, event.y - point.y) <= 10) {
        state.firstHarvestRaidResponseOrdered = true;
      } else if (event.order === 'guard' && event.ids.some(id => {
        const unit = game.getEntity(id);
        return unit?.owner === 'player' && UNIT_DEFS[unit.defId]?.weapon &&
          Math.hypot(unit.x - point.x, unit.y - point.y) <= 10;
      })) {
        state.firstHarvestRaidResponseOrdered = true;
      }
    }
    state.firstHarvestRaidOrderEventIndex = game.events.length;
  }
  state.firstHarvestRaidRepelled = raidIds.size > 0 && [...raidIds].every(id => !live(game.getEntity(id)));
}

/** Advance mission-specific win conditions after Game.update(dt). */
export function updateCampaign(game, index = game?.campaignMission, dt = 0, replayVersion = game?.replayVersion ?? null) {
  if (!game || !Number.isInteger(index) || index < 0 || index >= CAMPAIGN_MISSIONS.length) return false;
  if (game.campaignMission !== index || game.campaignComplete) return false;

  // Saves made before the campaign expansion may not have a scenario state.
  // Reconstruct harmless defaults while keeping the saved mission's stable index.
  const state = game.campaignState || (game.campaignState = { elapsed: 0 });
  if (index === 5 && replayVersion === null && Array.isArray(state.transmissionUplinks) &&
      !Number.isInteger(state.ashesUplinkRulesVersion)) state.ashesUplinkRulesVersion = 47;
  const ashesRouteRules = index === 5 && (replayVersion === null
    ? state.ashesRouteRulesVersion >= ASHES_ROUTE_RULES_VERSION : replayVersion >= ASHES_ROUTE_RULES_VERSION);
  const ashesTradeoffRules = index === 5 && (replayVersion === null
    ? state.ashesUplinkRulesVersion >= 48 : replayVersion >= 48);
  if (selectedFieldOrder(game, index)) state.fieldOrderStatus ??= 'active';
  if (game.status === 'defeat') {
    if (selectedFieldOrder(game, index) && state.fieldOrderStatus === 'active') state.fieldOrderStatus = 'failed';
    return false;
  }
  if (Number.isFinite(dt) && dt > 0) state.elapsed = (state.elapsed || 0) + Math.min(dt, 10);
  updateFieldOrder(game, index, dt);
  if (index === 4 && game.campaignRoutePayoffId === 'ghost-channel' &&
      (replayVersion === null || replayVersion >= 23)) {
    state.signalTraceRemaining = Math.max(0, 20 - (state.elapsed || 0));
    if (state.signalTraceRemaining > 0) {
      for (const id of state.signalTraceUnitIds || []) {
        const unit = game.getEntity(id);
        if (!live(unit) || unit.owner !== 'enemy') continue;
        const radius = 5;
        for (let y = Math.max(0, Math.floor(unit.y - radius)); y <= Math.min(game.height - 1, Math.ceil(unit.y + radius)); y++)
          for (let x = Math.max(0, Math.floor(unit.x - radius)); x <= Math.min(game.width - 1, Math.ceil(unit.x + radius)); x++)
            if (Math.hypot(x + 0.5 - unit.x, y + 0.5 - unit.y) <= radius) game.fog[y][x] = 2;
      }
    }
  }

  let complete = false;
  if (index === 0) {
    const refineries = campaignObjectiveRefineries(game, replayVersion);
    const raidRulesActive = firstHarvestRaidRulesActive(state, replayVersion);
    if (raidRulesActive) {
      if (!livingBuildings(game, 'player', 'command').length)
        return failMission(game, 'The command yard was lost before the refinery line could be secured.');
      updateFirstHarvestRaid(game, state);
    }
    complete = refineries.length >= (state.refineryTarget || 2) && game.credits.player >= 2200 &&
      (!raidRulesActive || state.firstHarvestRaidRepelled === true);
  } else if (index === 1) {
    const target = game.getEntity(state.targetId);
    if (!target || !live(target)) return failMission(game, 'The radar array was destroyed before it could be captured.');
    const hasCommandYard = livingBuildings(game, 'player', 'command').length > 0;
    const hasMcv = livingUnits(game, 'player', 'mcv').length > 0;
    const hasQueuedMcv = game.buildings.some(building => building.owner === 'player' && building.hp > 0 &&
      building.queue?.some(item => item.defId === 'mcv'));
    const hasMcvFactory = ['factory', 'tech'].every(defId => game.buildings.some(building =>
      building.owner === 'player' && building.defId === defId && building.hp > 0));
    const canRestoreBarracks = hasCommandYard || game.construction?.defId === 'barracks' ||
      hasMcv || hasQueuedMcv || hasMcvFactory;
    if (target.owner !== 'player' && !livingUnits(game, 'player', 'engineer').length &&
      !livingBuildings(game, 'player', 'barracks').length && !canRestoreBarracks)
      return failMission(game, 'The engineers and every route to rebuild the command chain were lost before the radar could be captured.');
    complete = target.owner === 'player' && target.defId === 'radar';
  } else if (index === 2) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The command yard was destroyed.');
    deployLastLightFlank(game, state);
    const flankBreakoutRules = replayVersion === null || replayVersion >= 42;
    const flankUnits = (state.lastLightFlankUnitIds || []).map(id => game.getEntity(id));
    const flankRepelled = state.lastLightFlankFired && flankUnits.length > 0 && flankUnits.every(unit => !live(unit));
    complete = (flankBreakoutRules && flankRepelled) || state.elapsed >= (state.duration || 180);
  } else if (index === 3) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The command yard was destroyed.');
    const target = game.getEntity(state.targetId);
    const stagedObjective = replayVersion === null || replayVersion >= 35;
    if (!stagedObjective) {
      // Black Shard's original direct-destruction condition remains intact for
      // existing solo replays; the relay breach is a version 35 rule.
      if (target) target.campaignShielded = false;
      complete = !target || !live(target);
    } else if (state.phase === 'secure-relay') {
      const relay = game.relays.find(item => item.id === state.relayId);
      state.holdElapsed = relay?.owner === 'player' && !relay.contested
        ? (state.holdElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      if (state.holdElapsed + 1e-9 >= (state.holdDuration || 8)) {
        state.phase = 'destroy-relay';
        if (target) {
          target.campaignShielded = false;
          target.hp = Math.min(target.hp, target.maxHp * 0.7);
        }
        game._event('campaignIntel', { message: 'Central relay secured. The forward relay shield collapsed; strike the exposed signal array.' });
      }
    }
    if (stagedObjective && state.phase === 'destroy-relay') complete = !target || !live(target);
    if (!complete && state.elapsed >= (state.deadline || 420)) return failMission(game, 'The forward relay transmitted the Vesper attack plan.');
  } else if (index === 4) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The field command post was lost.');
    const courier = state.courierId ? game.getEntity(state.courierId) : null;
    const routeObjectiveRulesActive = replayVersion === null
      ? state.routeObjectiveRulesVersion === CAMPAIGN_ROUTE_OBJECTIVE_RULES_VERSION
      : replayVersion >= CAMPAIGN_ROUTE_OBJECTIVE_RULES_VERSION;
    const ghostRouteIntercept = routeObjectiveRulesActive && game.campaignRoutePayoffId === 'ghost-channel';
    if (ghostRouteIntercept && !state.courierAttackOrdered && state.courierId) {
      state.courierAttackOrdered = game.events.some(event => event.type === 'order' && event.order === 'attack' &&
        event.targetId === state.courierId && Array.isArray(event.ids) && event.ids.length > 0);
    }
    const courierDestroyed = courier ? !live(courier) : game.events.some(event => event.type === 'unitLost' &&
      event.id === state.courierId && event.owner === 'enemy');
    const courierIntercepted = ghostRouteIntercept
      ? courierDestroyed && state.courierAttackOrdered
      : !!courier && !live(courier);
    if (!state.courierRewardClaimed && courierIntercepted) {
      state.courierRewardClaimed = true;
      game.credits.player += 700;
      game._event('campaignIntel', { message: 'Payroll cache recovered: +700 credits.', reward: 700 });
    }
    if (routeObjectiveRulesActive && game.campaignRoutePayoffId === 'iron-current' && !state.freightCacheRecovered) {
      state.freightCacheRecovered = game.events.some(event => event.type === 'wreckRecovered' &&
        event.id === state.freightCacheId && event.owner === 'player');
    }
    const refineries = campaignObjectiveRefineries(game, replayVersion);
    const economyObjectiveMet = refineries.length >= (state.refineryTarget || 2) && game.credits.player >= 4800;
    const routeObjectiveMet = !routeObjectiveRulesActive ||
      (game.campaignRoutePayoffId === 'ghost-channel' ? state.courierRewardClaimed :
        game.campaignRoutePayoffId === 'iron-current' ? state.freightCacheRecovered === true : true);
    complete = economyObjectiveMet && routeObjectiveMet;
    if (!complete && state.elapsed >= (state.deadline || 360)) return failMission(game, 'Aegis patrols sealed the shard basin before the reserve was funded.');
  } else if (index === 5) {
    const escort = game.getEntity(state.escortId);
    if (!live(escort)) return failMission(game, 'The analyst was lost in the crossing.');
    const stagedObjective = replayVersion === null
      ? Array.isArray(state.transmissionUplinks) : replayVersion >= 43;
    const { x, y, radius } = state.extraction || { x: 48, y: 17, radius: 2.2 };
    if (!stagedObjective) {
      complete = Math.hypot(escort.x - x, escort.y - y) <= radius;
    } else {
      const uplinks = state.transmissionUplinks || [];
      // A current-rule save resumes its existing phase; older saves keep the
      // archived direct-extraction objective above.
      state.phase ||= 'transmit-codes';
      let extractionInterceptWarnedNow = false;
      if (state.phase === 'transmit-codes') {
        let uplink = uplinks.find(item => item.id === state.transmissionUplinkId);
        if (!uplink) {
          uplink = uplinks.find(item => Math.hypot(escort.x - item.x, escort.y - item.y) <= item.radius);
          if (uplink) {
            state.transmissionUplinkId = uplink.id;
            state.transmissionElapsed = 0;
            if (ashesTradeoffRules) state.transmissionDuration = uplink.id === 'north' ? 5 : 8;
          }
        }
        const holding = Boolean(uplink) && !escort.embarkedIn &&
          Math.hypot(escort.x - uplink.x, escort.y - uplink.y) <= uplink.radius;
        state.transmissionElapsed = holding
          ? (state.transmissionElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
          : 0;
        if (uplink && state.transmissionElapsed + 1e-9 >= (state.transmissionDuration || 8)) {
          if (ashesRouteRules && game.campaignRoutePayoffId === 'ghost-channel') {
            state.phase = 'deploy-signal-shadow';
            state.ghostShadowElapsed = 0;
            game._event('campaignIntel', { message: 'North burst complete. Move an armed escort to the marked signal-shadow point and hold it for three seconds to draw the intercept away from the analyst.' });
          } else if (ashesRouteRules && game.campaignRoutePayoffId === 'iron-current') {
            state.phase = 'recover-supply-cache';
            game._event('campaignIntel', { message: 'Low-power transmission complete. Recover the marked supply cache with an Engineer before extracting.' });
          } else {
            state.phase = 'extract-analyst';
          }
          if (!ashesRouteRules && ashesTradeoffRules && uplink.id === 'north' && !state.extractionInterceptWarned) {
            state.extractionInterceptWarned = true;
            state.extractionInterceptWarningElapsed = 0;
            extractionInterceptWarnedNow = true;
            game._event('campaignThreatWarning', { message: 'Northern burst exposed the extraction route. Aegis intercept team will reach the beacon in five seconds; keep escorts forward.' });
          } else if (ashesRouteRules) {
            // Route-specific intel above describes the next objective.
          } else if (ashesTradeoffRules && uplink.id === 'south') {
            game._event('campaignIntel', { message: 'Low-power southern transmission complete. Aegis has not traced the extraction route; bring the analyst home.' });
          } else {
            game._event('campaignIntel', { message: `Patrol codes transmitted at the ${uplink.id} uplink. Get the analyst to the extraction beacon.` });
          }
        }
      }
      if (ashesRouteRules && state.phase === 'deploy-signal-shadow') {
        const point = state.ghostShadowPoint || { x: 35.5, y: 25.5, radius: 2.2 };
        const escortAtPoint = game.units.some(unit => unit.owner === 'player' && live(unit) && !unit.embarkedIn &&
          UNIT_DEFS[unit.defId]?.weapon && Math.hypot(unit.x - point.x, unit.y - point.y) <= point.radius);
        state.ghostShadowElapsed = escortAtPoint
          ? (state.ghostShadowElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0) : 0;
        if (state.ghostShadowElapsed + 1e-9 >= (state.ghostShadowDuration || 3)) {
          state.ghostShadowDeployed = true;
          state.phase = 'extract-analyst';
          state.extractionInterceptWarned = true;
          state.extractionInterceptWarningElapsed = 0;
          extractionInterceptWarnedNow = true;
          game._event('campaignThreatWarning', { message: 'Signal shadow deployed. Aegis followed the decoy; the interceptor will reach the extraction beacon in five seconds.' });
        }
      }
      if (ashesRouteRules && state.phase === 'recover-supply-cache') {
        state.routeCacheRecovered = game.events.some(event => {
          if (event.type !== 'wreckRecovered' || event.id !== state.routeCacheId || event.owner !== 'player') return false;
          const unit = game.getEntity(event.unitId);
          return unit?.owner === 'player' && unit.defId === 'engineer';
        });
        if (state.routeCacheRecovered) {
          state.phase = 'extract-analyst';
          game._event('campaignIntel', { message: 'Supply cache secured. Extract the analyst.' });
        }
      }
      if (state.phase === 'extract-analyst') {
        if (ashesTradeoffRules && state.transmissionUplinkId === 'north' &&
            state.extractionInterceptWarned && !state.extractionInterceptFired && !extractionInterceptWarnedNow) {
          state.extractionInterceptWarningElapsed = (state.extractionInterceptWarningElapsed || 0) +
            (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0);
          if (state.extractionInterceptWarningElapsed + 1e-9 >= 5) {
            state.extractionInterceptFired = true;
            const interceptOrder = { type: 'move', x, y, attackMove: true };
            const interceptIds = [game._createUnit('enemy', 'buggy', 49.5, 13.5, interceptOrder).id];
            state.extractionInterceptUnitIds = interceptIds;
            game.scans.push({ owner: 'player', x, y, radius: 8, until: game.time + 20 });
            game._updateFog();
            game._event('campaignReinforcement', { message: 'Aegis intercept team reached the extraction corridor.' });
          }
        }
        const northInterceptCleared = !ashesTradeoffRules || state.transmissionUplinkId !== 'north' ||
          state.extractionInterceptFired && (state.extractionInterceptUnitIds || []).every(id => !live(game.getEntity(id)));
        const routeObjectiveMet = !ashesRouteRules || game.campaignRoutePayoffId === 'none' ||
          (game.campaignRoutePayoffId === 'ghost-channel' ? state.ghostShadowDeployed === true :
            state.routeCacheRecovered === true);
        complete = routeObjectiveMet && northInterceptCleared && !escort.embarkedIn && Math.hypot(escort.x - x, escort.y - y) <= radius;
      }
    }
  } else if (index === 6) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The command yard was destroyed before the offensive was complete.');
    const target = state.targetId ? game.getEntity(state.targetId) : livingBuildings(game, 'enemy', 'command')[0];
    const stagedObjective = replayVersion === null || replayVersion >= 33;
    if (!stagedObjective) {
      // Dawnfall's original objective is preserved for existing solo replays.
      if (target) target.campaignShielded = false;
      complete = !target || !live(target);
    } else if (state.phase === 'secure-relay') {
      const relay = game.relays.find(item => item.id === state.relayId);
      state.holdElapsed = relay?.owner === 'player' && !relay.contested
        ? (state.holdElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      if (state.holdElapsed + 1e-9 >= (state.holdDuration || 8)) {
        state.phase = 'destroy-command';
        if (target) {
          target.campaignShielded = false;
          target.hp = Math.min(target.hp, target.maxHp * 0.7);
        }
        game._event('campaignIntel', { message: 'Central relay secured. The resonance shield collapsed and exposed the Vesper command yard.' });
      }
    }
    if (stagedObjective && state.phase === 'destroy-command') complete = !target || !live(target);
  } else if (index === 7) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The command yard was lost in the ion front.');
    deployStormAssault(game, state);
    const shelter = game.relays[0];
    state.shelterHoldElapsed = shelter?.owner === 'player' && !shelter.contested
      ? (state.shelterHoldElapsed || 0) + (['surge', 'recovery'].includes(game.storm?.phase) &&
        Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
      : 0;
    if (game.storm?.cycle >= (state.stormCycles || 1) && state.shelterHoldElapsed < 10)
      return failMission(game, 'The western relay shelter was not secured through the ion front.');
    complete = game.storm?.cycle >= (state.stormCycles || 1) && state.shelterHoldElapsed >= 10;
  } else if (index === 8) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The relay network collapsed when the command yard fell.');
    commitThreePointsRelayReserve(game, state, replayVersion);
    const held = game.relays.filter(relay => relay.owner === 'player' && !relay.contested).length;
    state.holdElapsed = held >= (state.relayTargetCount || 2)
      ? (state.holdElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
      : 0;
    complete = state.holdElapsed >= (state.holdDuration || 25);
  } else if (index === 9) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The command yard fell before the signal chief was stopped.');
    const target = state.targetId ? game.getEntity(state.targetId) : null;
    const mobileChiefRules = replayVersion === null || replayVersion >= 34;
    if (mobileChiefRules) {
      state.chiefEscapePhase ??= 'waiting';
      if (live(target) && state.chiefEscapePhase === 'waiting' && game.isVisible(target)) {
        state.chiefEscapePhase = 'alerted';
        state.chiefEscapeDelayRemaining = 1;
        game._event('campaignIntel', { message: 'Signal chief spotted! They are running for the southeast extraction zone. Issue a direct attack and intercept them before they escape.',
          targetId: target.id, extraction: { ...QUIET_KNIFE_ESCAPE } });
      } else if (live(target) && state.chiefEscapePhase === 'alerted') {
        state.chiefEscapeDelayRemaining = Math.max(0, (state.chiefEscapeDelayRemaining || 0) -
          (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0));
        if (state.chiefEscapeDelayRemaining <= 1e-9) {
          state.chiefEscapeDelayRemaining = 0;
          state.chiefEscapePhase = 'escaping';
          target.order = { type: 'move', x: QUIET_KNIFE_ESCAPE.x, y: QUIET_KNIFE_ESCAPE.y };
        }
      }
      if (live(target) && state.chiefEscapePhase === 'escaping' &&
          Math.hypot(target.x - QUIET_KNIFE_ESCAPE.x, target.y - QUIET_KNIFE_ESCAPE.y) <= QUIET_KNIFE_ESCAPE.radius) {
        state.chiefEscapePhase = 'escaped';
        return failMission(game, 'The signal chief reached the southeast extraction zone and escaped with the evacuation codes.');
      }
      if (!live(target) && state.chiefEscapePhase !== 'escaped') state.chiefEscapePhase = 'intercepted';
    }
    complete = !target || !live(target);
    if (!complete && state.elapsed >= (state.deadline || 300)) return failMission(game, 'The signal chief escaped with the evacuation codes.');
  } else if (index === 10) {
    const fallback = state.fallbackId ? game.getEntity(state.fallbackId) : null;
    if (!live(fallback)) return failMission(game, 'The fallback beacon was destroyed before the transports cleared the valley.');
    deployLastEmberReinforcements(game, state);
    complete = state.elapsed + 1e-9 >= (state.duration || 120);
  } else if (index === 11) {
    if (!livingBuildings(game, 'player', 'command').length) return failMission(game, 'The command yard fell before the final assault could be launched.');
    if (state.phase === 'secure-relays') {
      const held = game.relays.filter(relay => relay.owner === 'player' && !relay.contested).length;
      state.holdElapsed = held >= (state.relayTargetCount || 2)
        ? (state.holdElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      if (state.holdElapsed + 1e-9 >= (state.holdDuration || 18)) {
        state.phase = 'destroy-command';
        const target = state.targetId ? game.getEntity(state.targetId) : null;
        if (target) {
          target.campaignShielded = false;
          // The network collapse feeds back into the exposed command yard and
          // weakens its hardened shell for the final assault.
          target.hp = Math.min(target.hp, target.maxHp * 0.55);
        }
        game._event('campaignIntel', { message: 'The relay shield collapsed and damaged the Vesper command yard’s armor. The yard is exposed.' });
      }
    }
    if (state.phase === 'destroy-command') {
      const target = state.targetId ? game.getEntity(state.targetId) : null;
      complete = !target || !live(target);
    }
  } else if (index === 12) {
    const engineer = state.engineerId ? game.getEntity(state.engineerId) : null;
    if (!live(engineer)) return failMission(game, 'The signal engineer was lost.');
    const relay = game.relays.find(item => item.id === state.relayId);
    let extractionPatrolWarnedNow = false;
    if (state.phase === 'secure-landing') {
      state.holdElapsed = relay?.owner === 'player' && !relay.contested &&
        !engineer.embarkedIn && Math.hypot(engineer.x - relay.x, engineer.y - relay.y) <= 2.3
        ? (state.holdElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      if (state.holdElapsed + 1e-9 >= (state.holdDuration || 12)) {
        state.phase = 'extract-engineer';
        game._event('campaignIntel', { message: 'Landing relay secured. Bring the signal engineer back across the channel.' });
        // Version 4 local replays retain their original extraction encounter.
        if ((replayVersion === null || replayVersion >= 5) &&
            game.difficulty === 'hard' && !state.extractionPatrolFired && !state.extractionPatrolWarned) {
          state.extractionPatrolWarned = true;
          state.extractionPatrolWarningElapsed = 0;
          extractionPatrolWarnedNow = true;
          game._event('campaignThreatWarning', { message: 'East-bank patrol sighted. Vesper forces will reach the landing in five seconds. Board the engineer and ready the squad.' });
        }
      }
    }
    if (state.phase === 'extract-engineer') {
      // Persist the warning clock so a save during the five-second response
      // window cannot reset or duplicate the patrol deployment.
      if ((replayVersion === null || replayVersion >= 5) && game.difficulty === 'hard' &&
          state.extractionPatrolWarned && !state.extractionPatrolFired && !extractionPatrolWarnedNow) {
        state.extractionPatrolWarningElapsed = (state.extractionPatrolWarningElapsed || 0) +
          (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0);
        if (state.extractionPatrolWarningElapsed + 1e-9 >= 5) {
          state.extractionPatrolFired = true;
          const patrolOrder = { type: 'move', x: relay.x, y: relay.y, attackMove: true };
          game._createUnit('enemy', 'buggy', 45.5, 27.5, patrolOrder);
          game._createUnit('enemy', 'rifle', 46.5, 28.5, patrolOrder);
          game._event('campaignReinforcement', { message: 'Vesper reserve patrol has reached the east-bank landing.' });
        }
      }
      const { x, y, radius } = state.extraction;
      complete = !engineer.embarkedIn && Math.hypot(engineer.x - x, engineer.y - y) <= radius;
    }
    if (!complete && state.elapsed + 1e-9 >= (state.deadline || 240))
      return failMission(game, 'The evacuation record was lost when the recovery window closed.');
  } else if (index === 13) {
    const engineer = state.engineerId ? game.getEntity(state.engineerId) : null;
    if (!live(engineer)) return failMission(game, 'The signal engineer was lost before extraction.');
    const vault = state.targetId ? game.getEntity(state.targetId) : null;
    if (state.phase === 'capture-vault') {
      if (!live(vault)) return failMission(game, 'The radar vault was lost before its key could be captured.');
      const centerX = vault.x + vault.w / 2;
      const centerY = vault.y + vault.h / 2;
      state.hackElapsed = !engineer.embarkedIn &&
        Math.hypot(engineer.x - centerX, engineer.y - centerY) <= 2.3
        ? (state.hackElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      if (state.hackElapsed + 1e-9 >= (state.hackDuration || 8)) {
        vault.owner = 'player'; vault.faction = game.faction;
        vault.campaignShielded = false; vault.repairing = false; vault.queue = [];
        state.phase = 'extract-engineer';
        game._refreshPower();
        game._event('buildingCaptured', { id: vault.id, owner: 'player', by: engineer.id });
        game._event('campaignIntel', { message: 'Vault key captured. Extract the signal engineer at the western beacon.' });
      }
    }
    if (state.phase === 'extract-engineer') {
      const { x, y, radius } = state.extraction;
      complete = vault?.owner === 'player' && !engineer.embarkedIn &&
        Math.hypot(engineer.x - x, engineer.y - y) <= radius;
    }
    if (!complete && state.elapsed + 1e-9 >= (state.deadline || 210))
      return failMission(game, 'The vault transmission window closed before extraction.');
  } else if (index === 14) {
    if (!livingBuildings(game, 'player', 'command').length)
      return failMission(game, 'The command yard fell before the freight signal was secured.');
    const relayAssaultRules = ironCurrentRelayAssaultRulesActive(state, replayVersion);
    deployIronCurrentAssault(game, state, relayAssaultRules);
    const activeFreightRelay = game.relays.find(item => item.id === state.relayId);
    if (relayAssaultRules && state.assaultWaveThreeFired) {
      state.enemyRelayHoldElapsed = activeFreightRelay?.owner === 'enemy' && !activeFreightRelay.contested
        ? (state.enemyRelayHoldElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      if (state.enemyRelayHoldElapsed + 1e-9 >= (state.enemyRelayHoldDuration || 20))
        return failMission(game, 'Vesper seized the freight relay and cut the supply line.');
    }
    if (state.phase === 'fund-reserve' && game.credits.player >= (state.reserveTarget || 3000)) {
      game.credits.player -= state.reserveTarget || 3000;
      state.reserveCommitted = true;
      state.phase = 'hold-freight';
      const guard = game._createUnit('player', 'rocket', 21.5, 34.5, { type: 'guard', x: 21.5, y: 34.5 });
      state.reserveGuardUnitId = guard.id;
      const freightRelay = game.relays.find(relay => relay.id === state.relayId);
      const guardianOrders = relayAssaultRules
        ? [{ type: 'guard', x: 21.5, y: 32.5 }, { type: 'guard', x: 22.5, y: 35.5 }]
        : [
          { type: 'move', x: freightRelay.x, y: freightRelay.y, attackMove: true },
          { type: 'move', x: freightRelay.x, y: freightRelay.y, attackMove: true },
        ];
      state.reserveEscortUnitIds = [
        game._createUnit('player', 'guardian', 21.5, 32.5, guardianOrders[0]).id,
        game._createUnit('player', 'guardian', 22.5, 35.5, guardianOrders[1]).id,
      ];
      game._event('campaignIntel', { message: relayAssaultRules
        ? 'Freight reserve committed. A rocket squad guards the yard; Guardian armor remains available for the relay defense.'
        : 'Freight reserve committed. A rocket squad holds the yard while Guardian armor reinforces the relay force.' });
    }
    if (state.phase === 'hold-freight') {
      const relay = game.relays.find(item => item.id === state.relayId);
      const initialFreightHoldComplete = (state.holdElapsed || 0) + 1e-9 >= (state.holdDuration || 22);
      state.holdElapsed = relay?.owner === 'player' && !relay.contested
        ? (state.holdElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      const finalTank = state.assaultWaveThreeUnitId ? game.getEntity(state.assaultWaveThreeUnitId) : null;
      const finalEscort = state.assaultWaveThreeEscortUnitId ? game.getEntity(state.assaultWaveThreeEscortUnitId) : null;
      const finalAssaultCleared = state.assaultWaveThreeFired && !live(finalTank) &&
        (!relayAssaultRules || !live(finalEscort));
      const sequentialHoldRules = replayVersion === null || replayVersion >= 15;
      const postAssaultHoldMayAdvance = (!sequentialHoldRules || initialFreightHoldComplete) && finalAssaultCleared;
      state.postAssaultHoldElapsed = postAssaultHoldMayAdvance &&
        relay?.owner === 'player' && !relay.contested
        ? (state.postAssaultHoldElapsed || 0) + (Number.isFinite(dt) && dt > 0 ? Math.min(dt, 10) : 0)
        : 0;
      complete = state.holdElapsed + 1e-9 >= (state.holdDuration || 22) &&
        state.postAssaultHoldElapsed + 1e-9 >= (state.postAssaultHoldDuration || 12);
    }
  }

  // Campaign objectives differ from total elimination. Suppress the engine's
  // early player victory until this mission's authored condition is met.
  if (!complete && game.status === 'victory' && game.winner === 'player') {
    game.status = 'playing'; game.winner = null;
    game.events = game.events.filter(event => event.type !== 'victory');
  }
  if (!complete) return false;

  if (selectedFieldOrder(game, index) && state.fieldOrderStatus === 'active') state.fieldOrderStatus = 'failed';
  game.campaignComplete = true;
  game.status = 'victory'; game.winner = 'player';
  game.campaignResult = getCampaignResult(game, index);
  game._event('victory', { winner: 'player', time: game.time, campaignMission: index });
  game._event('missionComplete', { mission: CAMPAIGN_MISSIONS[index].id, title: CAMPAIGN_MISSIONS[index].title });
  return true;
}
