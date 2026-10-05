import { CAMPAIGN_FIELD_ORDERS, CAMPAIGN_MISSIONS } from './campaign.js';
import {
  campaignChosenBranchId, campaignFieldOrderCompleted, campaignMissionUnlocked,
  campaignProgressAtDifficulty, campaignRecord,
} from './campaignProgress.js';

const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);

/** A read-only campaign view. Profile records never become local ranked claims. */
export function campaignDossierView(storage, dossier, profileId, difficulty) {
  const localProgress = campaignProgressAtDifficulty(storage, difficulty);
  const verified = DIFFICULTIES.has(difficulty) && profileId && dossier?.profileId === profileId
    ? dossier.difficulties?.[difficulty] : null;
  const completed = new Set(Array.isArray(verified?.completedMissionIds) ? verified.completedMissionIds : []);
  const unlocked = new Set(Array.isArray(verified?.unlockedMissionIds) ? verified.unlockedMissionIds : []);
  const verifiedMedals = verified?.medalsByMission || {};
  const verifiedOrders = verified?.fieldOrdersByMission || {};
  const localBranchId = campaignChosenBranchId(storage, difficulty);
  const verifiedBranchId = ['ghost-channel', 'iron-current'].includes(verified?.chosenBranchId)
    ? verified.chosenBranchId : null;
  const mission = index => {
    const definition = CAMPAIGN_MISSIONS[index];
    if (!definition) return null;
    const localStars = campaignRecord(storage, difficulty, definition.id);
    const rawVerifiedStars = Number(verifiedMedals[definition.id]);
    const verifiedStars = completed.has(definition.id) && Number.isInteger(rawVerifiedStars)
      ? Math.max(1, Math.min(3, rawVerifiedStars)) : completed.has(definition.id) ? 1 : 0;
    const localCompleted = localStars > 0 ||
      !['ghost-channel', 'iron-current'].includes(definition.id) && index < localProgress;
    const verifiedCompleted = completed.has(definition.id);
    return {
      id: definition.id,
      unlocked: campaignMissionUnlocked(storage, difficulty, index) || unlocked.has(definition.id),
      completed: localCompleted || verifiedCompleted,
      localCompleted, verifiedCompleted,
      localStars, verifiedStars, stars: Math.max(localStars, verifiedStars),
      localUnlocked: campaignMissionUnlocked(storage, difficulty, index),
      verifiedUnlocked: unlocked.has(definition.id),
    };
  };
  const fieldOrder = (index, orderId) => {
    const definition = CAMPAIGN_MISSIONS[index];
    if (!definition || !CAMPAIGN_FIELD_ORDERS[index]?.some(order => order.id === orderId))
      return { earned: false, local: false, verified: false };
    const local = campaignFieldOrderCompleted(storage, difficulty, definition.id, orderId);
    const remote = completed.has(definition.id) &&
      Array.isArray(verifiedOrders[definition.id]) && verifiedOrders[definition.id].includes(orderId);
    return { earned: local || remote, local, verified: remote };
  };
  const fieldOrderTotal = CAMPAIGN_MISSIONS.reduce((count, _definition, index) => count +
    (CAMPAIGN_FIELD_ORDERS[index] || []).filter(order => fieldOrder(index, order.id).earned).length, 0);
  return {
    source: verified ? 'profile' : 'local',
    chosenBranchId: verifiedBranchId || localBranchId,
    verifiedBranchId, localBranchId,
    mission, fieldOrder, fieldOrderTotal,
  };
}
