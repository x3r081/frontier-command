const SCENES = Object.freeze({
  crystal: Object.freeze({
    src: '/assets/campaign-crystal-front-cinematic.webp', label: 'THE CRYSTAL FRONT',
    alt: 'A crystal harvester works beside a fortified refinery as distant raiders approach through the valley.',
    position: '50% 52%', mobilePosition: '50% 63%',
  }),
  signal: Object.freeze({
    src: '/assets/campaign-signal-vault-cinematic.webp', label: 'THE SIGNAL VAULT',
    alt: 'A signal engineer and stealth escort approach a guarded radar vault through a dark canyon.',
    position: '55% 52%', mobilePosition: '55% 48%',
  }),
  relay: Object.freeze({
    src: '/assets/campaign-relay-storm-cinematic.webp', label: 'THE RESONANCE FRONT',
    alt: 'Aegis armor fights around a glowing resonance relay beneath an ion storm.',
    position: '51% 49%', mobilePosition: '50% 54%',
  }),
  extraction: Object.freeze({
    src: '/assets/campaign-extraction-cinematic.webp', label: 'THE EXTRACTION ROUTE',
    alt: 'An analyst and armed escorts pass a burning aircraft wreck toward an uplink as patrols close in.',
    position: '50% 51%', mobilePosition: '50% 61%',
  }),
  airlift: Object.freeze({
    src: '/assets/campaign-airlift-cinematic.webp', label: 'THE LAST AIRLIFT',
    alt: 'A rescue dropship hovers above a flooded canyon while an engineer and escort prepare to board.',
    position: '50% 51%', mobilePosition: '50% 59%',
  }),
});

const MISSION_SCENES = Object.freeze({
  'first-harvest': 'crystal', 'red-ledger': 'crystal', 'iron-current': 'crystal',
  'silent-switch': 'signal', 'ghost-channel': 'signal', 'quiet-knife': 'signal',
  'black-shard': 'relay', dawnfall: 'relay', 'eye-of-the-storm': 'relay',
  'three-points-of-light': 'relay', 'dawn-of-the-free': 'relay', 'last-ember': 'relay',
  'ashes-in-transit': 'extraction',
  'last-light': 'airlift', 'after-the-dawn': 'airlift',
});

export function campaignArtworkForMission(missionId) {
  return SCENES[MISSION_SCENES[missionId]] || null;
}
