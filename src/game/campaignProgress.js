import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS, CAMPAIGN_SUPPLIES } from './campaign.js';
import { campaignVeteranSourceIds, validateCampaignVeteran } from './campaignVeteran.js';

export const CAMPAIGN_RECORDS_KEY = 'frontier-command-campaign-records-v1';
export const CAMPAIGN_FIELD_ORDER_RECORDS_KEY = 'frontier-command-campaign-field-orders-v1';
export const CAMPAIGN_ROUTE_RECORDS_KEY = 'frontier-command-campaign-routes-v1';
export const CAMPAIGN_ROUTE_SCHEMA_KEY = 'frontier-command-campaign-route-schema-v1';
export const CAMPAIGN_REQUISITION_RECORDS_KEY = 'frontier-command-campaign-requisition-v1';
export const CAMPAIGN_VETERAN_RECORDS_KEY = 'frontier-command-campaign-veterans-v1';
export const CAMPAIGN_DIFFICULTY_PROGRESS_KEY = 'frontier-command-campaign-difficulty-progress-v1';
const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const LEGACY_CAMPAIGN_KEY = 'frontier-command-campaign-v1';
const BRANCH_IDS = new Set(['ghost-channel', 'iron-current']);

function legacyProgress(storage) {
  const value = Number(storage.getItem(LEGACY_CAMPAIGN_KEY));
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function readRecords(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CAMPAIGN_RECORDS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/**
 * New unlocks are difficulty-scoped. Older builds only stored one global
 * counter, so the first read seeds every difficulty from that counter. This
 * deliberately preserves access already earned before this schema existed;
 * subsequent victories advance only the difficulty played.
 */
function readDifficultyProgress(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CAMPAIGN_DIFFICULTY_PROGRESS_KEY) || 'null');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries([...DIFFICULTIES].map(difficulty => {
        const value = Number(parsed[difficulty]);
        return [difficulty, Number.isInteger(value) ? Math.max(0, Math.min(CAMPAIGN_MISSIONS.length, value)) : 0];
      }));
    }
  } catch { /* Migrate from the legacy counter and mission records below. */ }

  const legacy = legacyProgress(storage);
  const records = readRecords(storage);
  const migrated = Object.fromEntries([...DIFFICULTIES].map(difficulty => {
    const completedIndexes = CAMPAIGN_MISSIONS
      .map((mission, index) => ({ mission, index }))
      .filter(({ mission, index }) => mission.id !== 'ghost-channel' && mission.id !== 'iron-current' &&
        Number(records[difficulty]?.[mission.id]) > 0)
      .map(({ index }) => index + 1);
    return [difficulty, Math.max(legacy, ...completedIndexes, 0)];
  }));
  try { storage.setItem(CAMPAIGN_DIFFICULTY_PROGRESS_KEY, JSON.stringify(migrated)); } catch { /* Read-only fallback remains usable. */ }
  return migrated;
}

/** Highest ordinary campaign operation cleared at this difficulty. */
export function campaignProgressAtDifficulty(storage, difficulty) {
  return DIFFICULTIES.has(difficulty) ? readDifficultyProgress(storage)[difficulty] || 0 : 0;
}

function advanceDifficultyProgress(storage, difficulty, nextIndex) {
  const progress = readDifficultyProgress(storage);
  progress[difficulty] = Math.max(progress[difficulty] || 0, nextIndex);
  try { storage.setItem(CAMPAIGN_DIFFICULTY_PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Legacy key remains a compatibility fallback. */ }
}

/** A victory in an older save may lack medal metadata but still advances its route. */
export function advanceCampaignLegacyCompletion(storage, difficulty, missionIndex) {
  if (!DIFFICULTIES.has(difficulty) || !Number.isInteger(missionIndex) || missionIndex < 0 ||
      missionIndex >= CAMPAIGN_MISSIONS.length || BRANCH_IDS.has(CAMPAIGN_MISSIONS[missionIndex].id)) return false;
  readDifficultyProgress(storage);
  try {
    storage.setItem(LEGACY_CAMPAIGN_KEY, String(Math.max(legacyProgress(storage), missionIndex + 1)));
    advanceDifficultyProgress(storage, difficulty, missionIndex + 1);
    return true;
  } catch { return false; }
}

function validOrderIds(missionId) {
  const index = CAMPAIGN_MISSIONS.findIndex(mission => mission.id === missionId);
  return index < 0 ? [] : CAMPAIGN_FIELD_ORDERS[index].map(order => order.id);
}

function readFieldOrderRecords(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CAMPAIGN_FIELD_ORDER_RECORDS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean = {};
    for (const difficulty of DIFFICULTIES) {
      const missions = parsed[difficulty];
      if (!missions || typeof missions !== 'object' || Array.isArray(missions)) continue;
      clean[difficulty] = {};
      for (const [missionId, values] of Object.entries(missions)) {
        const allowed = validOrderIds(missionId);
        if (!Array.isArray(values)) continue;
        const ids = [...new Set(values.filter(id => typeof id === 'string' && allowed.includes(id)))];
        if (ids.length) clean[difficulty][missionId] = ids;
      }
    }
    return clean;
  } catch { return {}; }
}

export function campaignFieldOrderCompleted(storage, difficulty, missionId, orderId) {
  if (!DIFFICULTIES.has(difficulty) || !validOrderIds(missionId).includes(orderId)) return false;
  return readFieldOrderRecords(storage)[difficulty]?.[missionId]?.includes(orderId) || false;
}

export function campaignFieldOrderProgress(storage, difficulty, missionId) {
  const valid = validOrderIds(missionId);
  if (!DIFFICULTIES.has(difficulty) || !valid.length) return 0;
  const earned = readFieldOrderRecords(storage)[difficulty]?.[missionId] || [];
  return valid.filter(id => earned.includes(id)).length;
}

export function campaignFieldOrderTotal(storage, difficulty) {
  if (!DIFFICULTIES.has(difficulty)) return 0;
  const records = readFieldOrderRecords(storage)[difficulty] || {};
  return CAMPAIGN_MISSIONS.reduce((total, mission) => total +
    CAMPAIGN_FIELD_ORDERS[CAMPAIGN_MISSIONS.indexOf(mission)].filter(order => records[mission.id]?.includes(order.id)).length, 0);
}

function readRequisitionRecords(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CAMPAIGN_REQUISITION_RECORDS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const valid = new Set(CAMPAIGN_MISSIONS.map(mission => mission.id));
    return Object.fromEntries([...DIFFICULTIES].map(difficulty => [difficulty,
      Array.isArray(parsed[difficulty]) ? [...new Set(parsed[difficulty].filter(id => valid.has(id)))] : []]));
  } catch { return {}; }
}

/** Local victories that already spent one route requisition at this difficulty. */
export function campaignRequisitionSpentMissionIds(storage, difficulty) {
  return DIFFICULTIES.has(difficulty) ? readRequisitionRecords(storage)[difficulty] || [] : [];
}

function readVeteranRecords(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CAMPAIGN_VETERAN_RECORDS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** Local practice continuity; ranked tickets independently derive this from verified victories. */
export function saveCampaignVeteran(storage, difficulty, missionId, veteran, completedAt = Date.now()) {
  if (!DIFFICULTIES.has(difficulty) || !CAMPAIGN_MISSIONS.some(mission => mission.id === missionId) ||
      !validateCampaignVeteran(veteran) || !Number.isSafeInteger(completedAt) || completedAt < 0) return false;
  try {
    const records = readVeteranRecords(storage);
    const bucket = records[difficulty] && typeof records[difficulty] === 'object' && !Array.isArray(records[difficulty])
      ? records[difficulty] : {};
    bucket[missionId] = { veteran, completedAt };
    records[difficulty] = bucket;
    storage.setItem(CAMPAIGN_VETERAN_RECORDS_KEY, JSON.stringify(records));
    return true;
  } catch { return false; }
}

/** Latest preceding local victory, including a victory that left no eligible survivor. */
export function campaignVeteranRecordForMission(storage, difficulty, missionIndex) {
  if (!DIFFICULTIES.has(difficulty)) return null;
  const bucket = readVeteranRecords(storage)[difficulty];
  if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return null;
  const chosenRoute = missionIndex === 4 ? campaignChosenBranchId(storage, difficulty) : null;
  const sources = chosenRoute ? [chosenRoute] : campaignVeteranSourceIds(missionIndex);
  return sources
    .map(sourceMissionId => ({ sourceMissionId, ...bucket[sourceMissionId] }))
    .filter(record => validateCampaignVeteran(record.veteran) &&
      Number.isSafeInteger(record.completedAt) && record.completedAt >= 0)
    .sort((a, b) => b.completedAt - a.completedAt || a.sourceMissionId.localeCompare(b.sourceMissionId))[0] || null;
}

export function campaignRecord(storage, difficulty, missionId) {
  if (!DIFFICULTIES.has(difficulty) || typeof missionId !== 'string') return 0;
  const stars = Number(readRecords(storage)[difficulty]?.[missionId]);
  return Number.isInteger(stars) ? Math.max(0, Math.min(3, stars)) : 0;
}

function readChosenBranches(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(CAMPAIGN_ROUTE_RECORDS_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean = {};
    for (const difficulty of DIFFICULTIES) {
      if (BRANCH_IDS.has(parsed[difficulty])) clean[difficulty] = parsed[difficulty];
    }
    return clean;
  } catch { return {}; }
}

/** The first branch mission completed at a difficulty, or null if neither has been completed. */
export function campaignChosenBranchId(storage, difficulty) {
  if (!DIFFICULTIES.has(difficulty)) return null;
  return readChosenBranches(storage)[difficulty] || null;
}

/**
 * Check availability by catalog index. The legacy counter remains the migration
 * source for the original linear arc; the fork itself is scoped to this difficulty.
 */
export function campaignMissionUnlocked(storage, difficulty, index) {
  if (!DIFFICULTIES.has(difficulty) || !Number.isInteger(index) || index < 0) return false;
  const progress = campaignProgressAtDifficulty(storage, difficulty);
  const legacyPreForkSave = storage.getItem(CAMPAIGN_ROUTE_SCHEMA_KEY) === null && progress >= 4;
  if (index === 13 || index === 14) {
    return legacyPreForkSave || campaignRecord(storage, difficulty, 'black-shard') > 0;
  }
  if (index === 4) {
    return legacyPreForkSave || progress >= 5 || (campaignRecord(storage, difficulty, 'ghost-channel') > 0 ||
      campaignRecord(storage, difficulty, 'iron-current') > 0);
  }
  return index <= progress;
}

/** Keep each difficulty's best medal and advance the existing legacy unlock key. */
export function saveCampaignResult(storage, difficulty, missionIndex, missionId, result, supplyId = 'none') {
  if (!DIFFICULTIES.has(difficulty) || !Number.isInteger(missionIndex) || missionIndex < 0 ||
      missionIndex >= CAMPAIGN_MISSIONS.length || CAMPAIGN_MISSIONS[missionIndex]?.id !== missionId ||
      typeof missionId !== 'string' || !result || result.mission !== missionId ||
      !Number.isInteger(result.stars) || result.stars < 1 || result.stars > 3 ||
      !CAMPAIGN_SUPPLIES.some(supply => supply.id === supplyId)) return false;
  // Initialize the new ledger before advancing the legacy counter so a fresh
  // victory cannot be mistaken for old globally shared progress on migration.
  readDifficultyProgress(storage);
  const records = readRecords(storage);
  const bucket = records[difficulty] && typeof records[difficulty] === 'object' && !Array.isArray(records[difficulty])
    ? records[difficulty] : {};
  bucket[missionId] = Math.max(campaignRecord(storage, difficulty, missionId), result.stars);
  records[difficulty] = bucket;
  try {
    storage.setItem(CAMPAIGN_RECORDS_KEY, JSON.stringify(records));
    if (result.fieldOrderStatus === 'completed' && validOrderIds(missionId).includes(result.fieldOrderId)) {
      try {
        const orderRecords = readFieldOrderRecords(storage);
        const missionOrders = new Set(orderRecords[difficulty]?.[missionId] || []);
        missionOrders.add(result.fieldOrderId);
        orderRecords[difficulty] ||= {};
        orderRecords[difficulty][missionId] = [...missionOrders];
        storage.setItem(CAMPAIGN_FIELD_ORDER_RECORDS_KEY, JSON.stringify(orderRecords));
      } catch { /* An unavailable ledger must not block medals or mission unlocks. */ }
    }
    if (supplyId !== 'none') {
      try {
        const spent = readRequisitionRecords(storage);
        spent[difficulty] = [...new Set([...(spent[difficulty] || []), missionId])];
        storage.setItem(CAMPAIGN_REQUISITION_RECORDS_KEY, JSON.stringify(spent));
      } catch { /* An unavailable local ledger must not block a medal. */ }
    }
    if (BRANCH_IDS.has(missionId)) {
      try {
        const chosen = readChosenBranches(storage);
        if (!chosen[difficulty]) {
          chosen[difficulty] = missionId;
          storage.setItem(CAMPAIGN_ROUTE_RECORDS_KEY, JSON.stringify(chosen));
        }
      } catch { /* Route history is a convenience; completion records still unlock the route. */ }
    } else {
      const unlocked = legacyProgress(storage);
      // A pre-fork save at or beyond M4 remains on its legacy route when the
      // player replays M4. Only a first-time M4 completion opts into the fork.
      if (missionId === 'black-shard' && unlocked < 4)
        storage.setItem(CAMPAIGN_ROUTE_SCHEMA_KEY, '1');
      storage.setItem(LEGACY_CAMPAIGN_KEY, String(Math.max(unlocked, missionIndex + 1)));
    }
    advanceDifficultyProgress(storage, difficulty, missionIndex + 1);
    return true;
  } catch { return false; }
}
