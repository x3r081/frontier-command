/** Campaign display order. Mission catalog indices remain append-only for save/replay compatibility. */
export const CAMPAIGN_ROUTE_ORDERED_IDS = Object.freeze([
  'first-harvest',
  'silent-switch',
  'last-light',
  'black-shard',
  'ghost-channel',
  'iron-current',
  'red-ledger',
  'ashes-in-transit',
  'dawnfall',
  'eye-of-the-storm',
  'three-points-of-light',
  'quiet-knife',
  'last-ember',
  'dawn-of-the-free',
  'after-the-dawn',
]);

const NEXT_CHOICES = Object.freeze({
  'first-harvest': Object.freeze(['silent-switch']),
  'silent-switch': Object.freeze(['last-light']),
  'last-light': Object.freeze(['black-shard']),
  'black-shard': Object.freeze(['ghost-channel', 'iron-current']),
  'ghost-channel': Object.freeze(['red-ledger']),
  'iron-current': Object.freeze(['red-ledger']),
  'red-ledger': Object.freeze(['ashes-in-transit']),
  'ashes-in-transit': Object.freeze(['dawnfall']),
  dawnfall: Object.freeze(['eye-of-the-storm']),
  'eye-of-the-storm': Object.freeze(['three-points-of-light']),
  'three-points-of-light': Object.freeze(['quiet-knife']),
  'quiet-knife': Object.freeze(['last-ember']),
  'last-ember': Object.freeze(['dawn-of-the-free']),
  'dawn-of-the-free': Object.freeze(['after-the-dawn']),
  'after-the-dawn': Object.freeze([]),
});

/** Return stable mission IDs immediately reachable after a completed mission. */
export function campaignNextChoices(missionId) {
  return NEXT_CHOICES[missionId] || Object.freeze([]);
}
