/**
 * Crystalline Front — deterministic, dependency-free real-time strategy rules.
 * Coordinates are measured in tiles. Unit x/y are tile-centre positions;
 * building x/y are the top-left of their footprint. update(dt) takes seconds.
 */

export const TILE_SIZE = 32;
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 48;
export const RELAY_DOMINION_SECONDS = 90;
export const CADET_RELAY_DOMINION_SECONDS = 120;
export const RELAY_DOMINION_MAJORITY = 2;
const ELIMINATION_ACTIVE_BUILDINGS = new Set(['command', 'barracks', 'factory', 'helipad', 'superweapon', 'warhead']);
const MAX_LAST_SEEN_HOSTILE_UNITS = 96;
const relayDominionDuration = (mode, difficulty) =>
  mode === 'skirmish' && difficulty === 'easy' ? CADET_RELAY_DOMINION_SECONDS : RELAY_DOMINION_SECONDS;
const skirmishObjective = (victoryMode, holdSeconds) => victoryMode === 'elimination'
  ? 'Eliminate enemy combat units, powered defenses, and active industry.'
  : `Destroy enemy forces or hold two of three relays for ${holdSeconds} seconds.`;
export const AEGIS_REFINERY_BONUS_RADIUS = 6;
export const AEGIS_REFINERY_EXTRACTION_MULTIPLIER = 1.2;
export const AEGIS_RELAY_RECOVERY_RATE = 1;
export const RELAY_OVERDRIVE_RELOAD_MULTIPLIER = 0.85;
export const VESPER_AMBUSH_SUPPRESSION_SECONDS = 2;
export const ION_STORM_PHASE_SECONDS = Object.freeze({ calm: 31, warning: 10, surge: 24, recovery: 8 });
export const STORMCALL_PULSE_RADIUS = 3.2;
export const STORMCALL_PULSE_DAMAGE = 65;
export const RELAY_LOGISTICS_YIELD_RATE = 0.1;
export const RELAY_LOGISTICS_RULES_VERSION = 49;
export const STORMGLASS_BLOOM_RULES_VERSION = 50;
export const BLOOM_EXPEDITION_RULES_VERSION = 52;
export const STORMGLASS_BLOOM_DURATION = 90;
export const STORMGLASS_BLOOM_RADIUS = 3.5;
export const STORMGLASS_BLOOM_PREMIUM_RATE = 0.35;
export const STORMGLASS_BLOOM_ENRICHMENT = 180;
export const WRECK_LIFETIME_SECONDS = 120;
export const WRECK_RECOVERY_SECONDS = 4;
export const MAX_BATTLEFIELD_WRECKS = 32;
export const GROUND_ARMOR_FRONT_DAMAGE_MULTIPLIER = 0.85;
export const GROUND_ARMOR_REAR_DAMAGE_MULTIPLIER = 1.2;
export const GROUND_ARMOR_ARC_RADIANS = Math.PI / 3;
export const WALL_COVER_DAMAGE_MULTIPLIER = 0.72;
export const UNIT_PROMOTION_RULES_VERSION = 29;
export const UNIT_ABILITY_RULES_VERSION = 36;
export const DOCTRINE_REPLACEMENT_RULES_VERSION = 42;
export const AI_COMMANDER_PROFILE_RULES_VERSION = 47;
export const SIEGE_DIRECTOR_RULES_VERSION = 53;
export const SIEGE_EXPANSION_RULES_VERSION = 54;
export const AI_HARVESTER_RETREAT_RULES_VERSION = 56;
export const QUEUED_ORDERS_RULES_VERSION = 56;
export const MAX_QUEUED_ORDERS = 8;
export const AI_ECONOMY_RECON_RULES_VERSION = 48;
export const DOCTRINE_REPLACEMENT_COST = 1350;
export const DOCTRINE_REPLACEMENT_TIME = 60;
export const AI_COMMANDER_PROFILES = Object.freeze([
  Object.freeze({ id: 'raider', name: 'Raider', description: 'Fields fast buggy screens and commits more units to harvester raids.' }),
  Object.freeze({ id: 'relay-marshal', name: 'Relay Marshal', description: 'Commits a larger reserve to capture and defend relays.' }),
  Object.freeze({ id: 'siege-director', name: 'Siege Director', description: 'Expands toward a second front, then escorts artillery against observed defenses.' }),
]);
export const aiCommanderProfileForSeed = (seed, replayVersion = SIEGE_DIRECTOR_RULES_VERSION) => {
  const normalizedSeed = (Number(seed) >>> 0) || 80217;
  // Preserve the original two-profile seed assignment in old saves/replays.
  const profileCount = replayVersion >= SIEGE_DIRECTOR_RULES_VERSION ? 3 : 2;
  return AI_COMMANDER_PROFILES[normalizedSeed % profileCount];
};
const RELAY_RESPONSE_RULES_VERSION = 37;
export const SALVAGE_DROP_RULES_VERSION = 38;
const RELAY_DOMINION_COUNTERATTACK_RULES_VERSION = 39;
const RELAY_DOMINION_RECON_RULES_VERSION = 40;
const ECONOMY_RECOVERY_RULES_VERSION = 41;
const RELAY_RESPONSE_PERSISTENCE_RULES_VERSION = 41;
const RELAY_DOMINION_TARGET_COMMITMENT_RULES_VERSION = 43;
const RELAY_DOMINION_EXPANSION_PAUSE_RULES_VERSION = 45;
export const SALVAGE_DROP_WARNING_AT = 75;
export const SALVAGE_DROP_FLIGHT_SECONDS = 12;
export const SALVAGE_DROP_LIFETIME_SECONDS = 90;
export const SALVAGE_DROP_CAPTURE_SECONDS = 5;
export const SALVAGE_DROP_CAPTURE_RADIUS = 1.8;
export const SALVAGE_DROP_CREDIT_REWARD = 450;
export const SALVAGE_DROP_ENERGY_REWARD = 20;
export const GUARDIAN_BRACE_SECONDS = 7;
export const GUARDIAN_BRACE_RADIUS = 2.6;
export const GUARDIAN_BRACE_DAMAGE_MULTIPLIER = 0.75;
export const SPECTER_GHOST_RUN_SECONDS = 6;
export const SPECTER_GHOST_RUN_SPEED_MULTIPLIER = 1.65;
export const FACTION_TANK_ABILITY_COOLDOWN = 30;
export const UNIT_PROMOTION_DEFS = Object.freeze({
  bulwark: Object.freeze({ id: 'bulwark', name: 'Bulwark', damageTakenMultiplier: 0.85,
    description: 'Takes 15% less damage after armor, facing, and cover modifiers.' }),
  rangefinder: Object.freeze({ id: 'rangefinder', name: 'Rangefinder', rangeBonus: 1,
    description: 'Weapon range increased by 1 tile.' }),
});
export const unitWeaponRange = (unit, weaponDef, replayVersion = null) =>
  (weaponDef?.range || 0) + (unit?.promotion === 'rangefinder' &&
    (replayVersion == null || replayVersion >= UNIT_PROMOTION_RULES_VERSION)
    ? UNIT_PROMOTION_DEFS.rangefinder.rangeBonus : 0);
export const isUnitPromotionEligible = unit => !!unit && unit.hp > 0 && unit.veterancy === 2 &&
  !!UNIT_DEFS[unit.defId]?.weapon && !UNIT_DEFS[unit.defId]?.flying;
const WRECK_RECOVERY_RANGE = 0.85;

export const SKIRMISH_MAPS = Object.freeze([
  Object.freeze({ id: 'shard-valley', name: 'Shard Valley',
    description: 'Open diagonal approach with scattered rock, water, and contested central crystal.' }),
  Object.freeze({ id: 'twin-passes', name: 'Twin Passes',
    description: 'A tall rock divide creates two crossings and separated crystal lanes.' }),
  Object.freeze({ id: 'delta-crossing', name: 'Delta Crossing',
    description: 'A flooded middle ground funnels armies through two destructible bridges; airlift and engineers can reopen the fight.' }),
  Object.freeze({ id: 'canyon-ring', name: 'Canyon Ring',
    description: 'A broken canyon spine circles the central basin, with northern and southern passages.' }),
  Object.freeze({ id: 'storm-basin', name: 'Storm Basin',
    description: 'A broad storm scar divides the basin, leaving two crystal-rich causeways between bases.' }),
]);

export const FACTIONS = Object.freeze({
  aegis: { id: 'aegis', name: 'Aegis Directorate', color: '#4bc7f0', dark: '#176682', accent: '#b7f6ff' },
  vesper: { id: 'vesper', name: 'Vesper Collective', color: '#f17b62', dark: '#8d342d', accent: '#ffd4ae' },
});

const weapon = (damage, range, cooldown, projectileSpeed, damageType, splash = 0, target = 'ground') =>
  ({ damage, range, cooldown, projectileSpeed, damageType, splash, target });

export const UNIT_DEFS = Object.freeze({
  scout: { id: 'scout', name: 'Pathfinder', faction: 'all', role: 'recon', producer: 'barracks', cost: 150, buildTime: 6,
    health: 75, armor: 'infantry', speed: 2.65, sight: 8, radius: 0.22, weapon: weapon(9, 3.2, 0.55, 11, 'ballistic'),
    description: 'Fast reconnaissance infantry with a wide field of view.' },
  rifle: { id: 'rifle', name: 'Rifle Squad', faction: 'all', role: 'infantry', producer: 'barracks', cost: 100, buildTime: 5,
    health: 110, armor: 'infantry', speed: 1.5, sight: 5.5, radius: 0.27, weapon: weapon(14, 3.4, 0.75, 12, 'ballistic'),
    description: 'Affordable frontline infantry.' },
  rocket: { id: 'rocket', name: 'Rocket Trooper', faction: 'all', role: 'antiarmor', producer: 'barracks', cost: 300, buildTime: 9,
    health: 85, armor: 'infantry', speed: 1.25, sight: 6, radius: 0.25, weapon: weapon(37, 5, 1.75, 7, 'explosive', 0.5, 'both'),
    description: 'Long-range missiles excel against armor and structures.' },
  engineer: { id: 'engineer', name: 'Engineer', faction: 'all', role: 'engineer', producer: 'barracks', cost: 450, buildTime: 11,
    health: 70, armor: 'infantry', speed: 1.35, sight: 5, radius: 0.24, weapon: null,
    description: 'Captures damaged enemy structures and restores friendly ones.' },
  harvester: { id: 'harvester', name: 'Crystal Harvester', faction: 'all', role: 'harvester', producer: 'factory', cost: 1250, buildTime: 23,
    health: 610, armor: 'heavy', speed: 0.92, sight: 5, radius: 0.42, capacity: 700, weapon: null,
    description: 'Collects crystal and delivers it to a refinery for credits. Aegis harvesters extract 20% faster within 6 tiles of a powered refinery.' },
  mcv: { id: 'mcv', name: 'Mobile Command Rig', faction: 'all', role: 'mcv', producer: 'factory', cost: 3500, buildTime: 52,
    health: 840, armor: 'heavy', speed: 0.78, sight: 6, radius: 0.48, requires: ['tech'], weapon: null,
    description: 'Deploys into a new Construction Yard on clear ground.' },
  buggy: { id: 'buggy', name: 'Recon Buggy', faction: 'all', role: 'recon', producer: 'factory', cost: 450, buildTime: 11,
    health: 220, armor: 'light', speed: 2.2, sight: 7, radius: 0.35, weapon: weapon(18, 4.3, 0.55, 13, 'ballistic'),
    description: 'Fast raider useful for flanking and scouting.' },
  apc: { id: 'apc', name: 'Armored Carrier', faction: 'all', role: 'transport', producer: 'factory', cost: 600, buildTime: 15,
    health: 390, armor: 'heavy', speed: 1.65, sight: 6, radius: 0.39, capacity: 3, weapon: null,
    description: 'Carries up to three infantry through ground combat. Unarmed.' },
  dropship: { id: 'dropship', name: 'Airlift Dropship', faction: 'all', role: 'transport', producer: 'helipad', cost: 900, buildTime: 22,
    health: 360, armor: 'light', speed: 2.8, sight: 7, radius: 0.4, flying: true, capacity: 4, weapon: null,
    description: 'Unarmed aircraft that carries up to four infantry over any terrain.' },
  lightTank: { id: 'lightTank', name: 'Striker Tank', faction: 'all', role: 'armor', producer: 'factory', cost: 700, buildTime: 16,
    health: 440, armor: 'heavy', speed: 1.45, sight: 6, radius: 0.38, weapon: weapon(49, 5.2, 1.45, 10, 'cannon', 0.35),
    description: 'Reliable assault tank. Its front armor resists fire; protect its exposed rear.' },
  artillery: { id: 'artillery', name: 'Siege Crawler', faction: 'all', role: 'siege', producer: 'factory', cost: 950, buildTime: 22,
    health: 260, armor: 'light', speed: 0.92, sight: 7, radius: 0.39, requires: ['radar'],
    weapon: weapon(83, 8.3, 3.2, 6.4, 'explosive', 1.45), description: 'Long-range splash artillery. Face its armored front toward threats.' },
  guardian: { id: 'guardian', name: 'Guardian Tank', faction: 'aegis', role: 'armor', producer: 'factory', cost: 1300, buildTime: 28,
    health: 790, armor: 'heavy', speed: 1.05, sight: 6, radius: 0.44, requires: ['tech'],
    weapon: weapon(86, 5.7, 1.9, 11, 'cannon', 0.6), description: 'Aegis heavy tank with a reinforced front and vulnerable rear. Brace anchors it for 7 seconds and reduces nearby allied vehicle direct-fire damage by 25%; splash bypasses the field.' },
  medic: { id: 'medic', name: 'Field Medic', faction: 'aegis', role: 'medic', producer: 'barracks', cost: 360, buildTime: 11,
    health: 90, armor: 'infantry', speed: 1.55, sight: 5.5, radius: 0.24, requires: ['radar'], weapon: null,
    description: 'Heals nearby friendly infantry.' },
  orca: { id: 'orca', name: 'Kestrel Gunship', faction: 'aegis', role: 'aircraft', producer: 'helipad', cost: 1250, buildTime: 27,
    health: 320, armor: 'light', speed: 3.2, sight: 8, radius: 0.4, flying: true, ammoMax: 6, rearmRate: 0.52,
    weapon: weapon(68, 5.4, 0.95, 11, 'explosive', 0.45), description: 'Fast anti-armor aircraft with limited ammunition.' },
  flamer: { id: 'flamer', name: 'Pyro Trooper', faction: 'vesper', role: 'infantry', producer: 'barracks', cost: 280, buildTime: 9,
    health: 120, armor: 'infantry', speed: 1.4, sight: 5, radius: 0.27,
    weapon: weapon(26, 2.9, 0.7, 8, 'flame', 0.7), description: 'Incendiary infantry effective against groups and structures.' },
  stealthTank: { id: 'stealthTank', name: 'Specter Tank', faction: 'vesper', role: 'armor', producer: 'factory', cost: 1100, buildTime: 25,
    health: 380, armor: 'light', speed: 1.75, sight: 7, radius: 0.38, requires: ['tech'], stealth: true,
    weapon: weapon(63, 5.5, 1.65, 9, 'explosive', 0.4), description: 'Stealth tank with an exposed rear. Its first concealed hit suppresses a mobile ground target’s weapon for 2 seconds. Ghost Run boosts speed for 6 seconds but disables firing and other orders until it ends.' },
  apache: { id: 'apache', name: 'Wraith Gunship', faction: 'vesper', role: 'aircraft', producer: 'helipad', cost: 1200, buildTime: 26,
    health: 290, armor: 'light', speed: 3.45, sight: 8, radius: 0.4, flying: true, ammoMax: 8, rearmRate: 0.65,
    weapon: weapon(27, 4.8, 0.47, 13, 'ballistic'), description: 'Rapid-fire aircraft specializing in exposed infantry.' },
});

export const BUILDING_DEFS = Object.freeze({
  wall: { id: 'wall', name: 'Defense Wall', cost: 60, buildTime: 3, w: 1, h: 1, health: 360, armor: 'structure', sight: 0,
    power: 0, requires: ['command'], blocksGround: true, victoryCritical: false,
    description: 'Blocks ground movement and protects nearby friendly ground units from direct fire behind it. Splash and flanking attacks bypass cover. Does not count as a base structure.' },
  command: { id: 'command', name: 'Construction Yard', cost: 0, buildTime: 0, w: 3, h: 3, health: 1600, armor: 'structure', sight: 7,
    power: 0, requires: [], description: 'Builds structures and anchors a base.' },
  power: { id: 'power', name: 'Power Plant', cost: 300, buildTime: 12, w: 2, h: 2, health: 560, armor: 'structure', sight: 4,
    power: 120, requires: ['command'], description: 'Provides electricity for the base.' },
  advancedPower: { id: 'advancedPower', name: 'Fusion Plant', cost: 750, buildTime: 24, w: 2, h: 3, health: 740, armor: 'structure', sight: 4,
    power: 220, requires: ['tech'], description: 'Produces a large amount of power.' },
  refinery: { id: 'refinery', name: 'Crystal Refinery', cost: 1400, buildTime: 27, w: 3, h: 2, health: 1050, armor: 'structure', sight: 5,
    power: -35, requires: ['power'], description: 'Converts harvested crystal into credits, unloading one harvester at a time. Powered Aegis refineries boost nearby extraction by 20% within 6 tiles.' },
  barracks: { id: 'barracks', name: 'Barracks', cost: 500, buildTime: 18, w: 2, h: 2, health: 670, armor: 'structure', sight: 5,
    power: -25, requires: ['power'], description: 'Trains infantry units.' },
  factory: { id: 'factory', name: 'War Factory', cost: 1200, buildTime: 30, w: 3, h: 3, health: 1190, armor: 'structure', sight: 5,
    power: -45, requires: ['refinery'], description: 'Assembles vehicles and harvesters.' },
  serviceBay: { id: 'serviceBay', name: 'Field Workshop', cost: 1150, buildTime: 25, w: 2, h: 2, health: 700, armor: 'structure', sight: 5,
    power: -30, requires: ['factory'], description: 'Repairs nearby friendly ground vehicles when powered.' },
  radar: { id: 'radar', name: 'Radar Array', cost: 800, buildTime: 22, w: 2, h: 2, health: 550, armor: 'structure', sight: 8,
    power: -55, requires: ['barracks'], description: 'Enables radar and advanced units when powered.' },
  turret: { id: 'turret', name: 'Sentinel Turret', cost: 650, buildTime: 19, w: 1, h: 1, health: 670, armor: 'structure', sight: 7,
    power: -35, requires: ['barracks'], weapon: weapon(43, 6.2, 1.2, 12, 'cannon'), description: 'Automated defense against ground forces.' },
  guardTower: { id: 'guardTower', name: 'Aegis Watchtower', faction: 'aegis', cost: 550, buildTime: 17, w: 1, h: 1,
    health: 550, armor: 'structure', sight: 7, power: -20, requires: ['barracks'],
    weapon: weapon(24, 5.7, 0.65, 15, 'ballistic'), description: 'Quick-firing Aegis defense against infantry.' },
  aaTower: { id: 'aaTower', name: 'Skyshield Battery', faction: 'aegis', cost: 850, buildTime: 23, w: 1, h: 1,
    health: 590, armor: 'structure', sight: 8, power: -40, requires: ['radar'],
    weapon: weapon(72, 7.5, 1.35, 16, 'explosive', 0.35, 'air'), description: 'Protects Aegis bases from enemy aircraft.' },
  sam: { id: 'sam', name: 'Vesper SAM Site', faction: 'vesper', cost: 720, buildTime: 21, w: 2, h: 1,
    health: 620, armor: 'structure', sight: 8, power: -30, requires: ['radar'],
    weapon: weapon(66, 7.8, 1.45, 12, 'explosive', 0.45, 'air'), description: 'Long-range surface-to-air defense.' },
  obelisk: { id: 'obelisk', name: 'Vesper Obelisk', faction: 'vesper', cost: 1550, buildTime: 33, w: 2, h: 2,
    health: 830, armor: 'structure', sight: 8, power: -130, requires: ['tech'],
    weapon: weapon(180, 7.2, 3, 26, 'ion'), description: 'Devastating powered beam against ground armor.' },
  helipad: { id: 'helipad', name: 'Helipad', cost: 1050, buildTime: 26, w: 2, h: 2, health: 680, armor: 'structure', sight: 6,
    power: -28, requires: ['radar'], description: 'Produces gunships and Airlift Dropship transports.' },
  silo: { id: 'silo', name: 'Crystal Silo', cost: 300, buildTime: 13, w: 2, h: 2, health: 540, armor: 'structure', sight: 4,
    power: -8, requires: ['refinery'], description: 'Increases credit storage capacity.' },
  tech: { id: 'tech', name: 'Research Center', cost: 1450, buildTime: 34, w: 3, h: 2, health: 760, armor: 'structure', sight: 6,
    power: -75, requires: ['radar', 'factory'], description: 'Unlocks elite units, fusion power, and field research.' },
  superweapon: { id: 'superweapon', name: 'Ion Spire', faction: 'aegis', cost: 2200, buildTime: 52, w: 3, h: 3, health: 980, armor: 'structure', sight: 7,
    power: -115, requires: ['tech'], description: 'Charges an ion strike capable of leveling a fortified position.' },
  warhead: { id: 'warhead', name: 'Warhead Temple', faction: 'vesper', cost: 2400, buildTime: 56, w: 3, h: 3,
    health: 1050, armor: 'structure', sight: 7, power: -125, requires: ['tech'],
    description: 'Charges a devastating nuclear strike with lingering fallout.' },
});

export const COMMAND_ABILITIES = Object.freeze({
  scan: { id: 'scan', name: 'Tactical Scan', cost: 25, cooldown: 26, radius: 7,
    description: 'Reveal terrain and hidden units for 11 seconds.' },
  overcharge: { id: 'overcharge', name: 'Overcharge', cost: 40, cooldown: 45, radius: 5,
    description: 'Accelerate nearby production and weapon systems for 13 seconds.' },
  shield: { id: 'shield', name: 'Shield Pulse', cost: 45, cooldown: 48, radius: 4.5,
    description: 'Absorb damage for nearby friendly units for 10 seconds.' },
  stormcall: { id: 'stormcall', name: 'Relay Stormcall', cost: 55, cooldown: 95, radius: 6,
    description: 'Steer a storm to a point near a secure relay. On arrival during a surge, one ion pulse strikes nearby enemies; contesting the relay cancels the call.' },
  breach: { id: 'breach', name: 'Breach Window', cost: 65, cooldown: 105, radius: 5,
    package: 'breach', description: 'Mark a visible assault zone for 12 seconds. Friendly ground fire against structures is stronger inside it.' },
  interdict: { id: 'interdict', name: 'Interdiction Pulse', cost: 55, cooldown: 90, radius: 3.5,
    package: 'interdict', description: 'Suppress visible enemy mobile weapons in a small area for 3 seconds.' },
  rally: { id: 'rally', name: 'Rally Signal', cost: 60, cooldown: 100, radius: 4,
    package: 'rally', description: 'Heal, clear suppression, and rally nearby armed ground units toward the chosen visible point.' },
});

export const DOCTRINE_DEFS = Object.freeze({
  logistics: Object.freeze({ id: 'logistics', name: 'Logistics Network', cost: 900, researchTime: 48,
    description: 'Harvesters gather crystal 25% faster.' }),
  siege: Object.freeze({ id: 'siege', name: 'Siege Protocol', cost: 900, researchTime: 48,
    description: 'Friendly attacks deal 20% more damage to structures.' }),
  signal: Object.freeze({ id: 'signal', name: 'Signal Lattice', cost: 900, researchTime: 48,
    description: 'Command energy regenerates 25% faster and command ability cooldowns recover 20% faster.' }),
});
const DOCTRINE_IDS = Object.keys(DOCTRINE_DEFS);

export const TACTICAL_PACKAGE_DEFS = Object.freeze({
  breach: Object.freeze({ id: 'breach', name: 'Breach Window', cost: 700, researchTime: 38,
    description: 'Unlocks a short assault zone that rewards positioning ground forces before a structure push.' }),
  interdict: Object.freeze({ id: 'interdict', name: 'Interdiction Pulse', cost: 700, researchTime: 38,
    description: 'Unlocks a visible-area pulse that suppresses enemy mobile weapons briefly.' }),
  rally: Object.freeze({ id: 'rally', name: 'Rally Signal', cost: 700, researchTime: 38,
    description: 'Unlocks a field rally that heals, clears suppression, and orders nearby armed ground forces toward a chosen point.' }),
});
const TACTICAL_PACKAGE_IDS = Object.keys(TACTICAL_PACKAGE_DEFS);

const ARMOR_MULTIPLIER = {
  ballistic: { infantry: 1, light: 0.46, heavy: 0.22, structure: 0.32 },
  explosive: { infantry: 0.8, light: 1.18, heavy: 1.12, structure: 1.2 },
  cannon: { infantry: 0.66, light: 1, heavy: 1, structure: 0.85 },
  flame: { infantry: 1.5, light: 0.55, heavy: 0.25, structure: 0.9 },
  ion: { infantry: 1, light: 1, heavy: 1, structure: 1 },
};

// XP is earned from health actually removed from enemies. Structure damage earns
// less XP so a repairable base cannot train an army as quickly as field combat.
export const VETERANCY_RANKS = Object.freeze([
  Object.freeze({ name: 'Rookie', xp: 0, damageMultiplier: 1, healthMultiplier: 1 }),
  Object.freeze({ name: 'Veteran', xp: 180, damageMultiplier: 1.05, healthMultiplier: 1.05 }),
  Object.freeze({ name: 'Elite', xp: 450, damageMultiplier: 1.1, healthMultiplier: 1.1 }),
]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const segmentBoxEntry = (x0, y0, x1, y1, box) => {
  let enter = 0, exit = 1;
  for (const [start, delta, low, high] of [
    [x0, x1 - x0, box.x, box.x + box.w], [y0, y1 - y0, box.y, box.y + box.h],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (start < low || start > high) return null;
      continue;
    }
    const a = (low - start) / delta, b = (high - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return null;
  }
  return enter > 0 && enter < 1 ? enter : null;
};
const opposite = owner => owner === 'player' ? 'enemy' : 'player';
const ownerFaction = (game, owner) => owner === 'player' ? game.faction : game.enemyFaction;
const CAMPAIGN_DOCTRINE_IDS = new Set(['standard', 'rapid', 'reinforced', 'precision']);
const CAMPAIGN_SUPPLY_IDS = new Set(['none', 'reserves', 'recon', 'vanguard']);

class MinHeap {
  constructor() { this.items = []; }
  push(node) {
    const a = this.items; let i = a.length; a.push(node);
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= node.f) break; a[i] = a[p]; i = p; }
    a[i] = node;
  }
  pop() {
    const a = this.items; const first = a[0]; const end = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const l = i * 2 + 1; if (l >= a.length) break;
        const r = l + 1; const child = r < a.length && a[r].f < a[l].f ? r : l;
        if (a[child].f >= end.f) break;
        a[i] = a[child]; i = child;
      }
      a[i] = end;
    }
    return first;
  }
  get length() { return this.items.length; }
}

export class Game {
  constructor({ seed = 80217, difficulty = 'normal', faction = 'aegis', mode = 'skirmish', mapId = 'shard-valley',
    campaignDoctrineId = 'standard', skirmishOpening = 'established', victoryMode = 'dominion', mapVariant,
    legacyCanyonRingVariant1 = false, aiCommanderProfileId, replayVersion } = {}) {
    this.seed = (Number(seed) >>> 0) || 80217;
    this.randomState = this.seed;
    const selectedCommanderProfile = AI_COMMANDER_PROFILES.find(profile => profile.id === aiCommanderProfileId) ||
      aiCommanderProfileForSeed(this.seed);
    this.aiCommanderProfileId = mode === 'skirmish' ? selectedCommanderProfile.id : null;
    this.aiCommanderProfileName = mode === 'skirmish' ? selectedCommanderProfile.name : null;
    this.difficulty = ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal';
    this.mode = mode;
    this.replayVersion = replayVersion;
    this.unitAbilityRulesVersion = UNIT_ABILITY_RULES_VERSION;
    this.aiCommanderProfileRulesVersion = AI_COMMANDER_PROFILE_RULES_VERSION;
    this.siegeDirectorRulesVersion = SIEGE_DIRECTOR_RULES_VERSION;
    this.siegeExpansionRulesVersion = SIEGE_EXPANSION_RULES_VERSION;
    this.aiHarvesterRetreatRulesVersion = AI_HARVESTER_RETREAT_RULES_VERSION;
    this.aiEconomyReconRulesVersion = AI_ECONOMY_RECON_RULES_VERSION;
    this.relayLogisticsRulesVersion = RELAY_LOGISTICS_RULES_VERSION;
    this.stormglassBloomRulesVersion = STORMGLASS_BLOOM_RULES_VERSION;
    this.bloomExpeditionRulesVersion = BLOOM_EXPEDITION_RULES_VERSION;
    this.relayResponseRulesVersion = RELAY_RESPONSE_RULES_VERSION;
    this.salvageDropRulesVersion = SALVAGE_DROP_RULES_VERSION;
    this.relayDominionCounterattackRulesVersion = RELAY_DOMINION_COUNTERATTACK_RULES_VERSION;
    this.relayDominionReconRulesVersion = RELAY_DOMINION_RECON_RULES_VERSION;
    this.economyRecoveryRulesVersion = ECONOMY_RECOVERY_RULES_VERSION;
    this.relayResponsePersistenceRulesVersion = RELAY_RESPONSE_PERSISTENCE_RULES_VERSION;
    this.doctrineReplacementRulesVersion = DOCTRINE_REPLACEMENT_RULES_VERSION;
    this.relayDominionTargetCommitmentRulesVersion = RELAY_DOMINION_TARGET_COMMITMENT_RULES_VERSION;
    this.relayDominionExpansionPauseRulesVersion = RELAY_DOMINION_EXPANSION_PAUSE_RULES_VERSION;
    this.salvageDrop = null;
    this.skirmishOpening = mode === 'skirmish' && skirmishOpening === 'command-rig' ? 'command-rig' : 'established';
    this.victoryMode = ['skirmish', 'multiplayer'].includes(mode) && victoryMode === 'elimination' ? 'elimination' : 'dominion';
    this.campaignDoctrineId = mode === 'campaign' && CAMPAIGN_DOCTRINE_IDS.has(campaignDoctrineId)
      ? campaignDoctrineId : 'standard';
    this.mapId = ['skirmish', 'multiplayer'].includes(mode) && SKIRMISH_MAPS.some(map => map.id === mapId)
      ? mapId : 'shard-valley';
    const variantMap = ['twin-passes', 'canyon-ring'].includes(this.mapId);
    this.mapVariant = variantMap ? (mapVariant === 0 || mapVariant === 1
      ? mapVariant : (this.seed >>> 1) & 1) : 0;
    this.legacyCanyonRingVariant1 = this.mapId === 'canyon-ring' && this.mapVariant === 1 &&
      legacyCanyonRingVariant1 === true;
    this.commandOwner = 'player';
    this.faction = FACTIONS[faction] ? faction : 'aegis';
    this.enemyFaction = this.faction === 'aegis' ? 'vesper' : 'aegis';
    this.width = MAP_WIDTH;
    this.height = MAP_HEIGHT;
    this.tileSize = TILE_SIZE;
    this.unitDefs = UNIT_DEFS;
    this.buildingDefs = BUILDING_DEFS;
    this.units = [];
    this.buildings = [];
    this.effects = [];
    this.events = [];
    this.onEvent = null;
    this.selection = [];
    this.fog = Array.from({ length: this.height }, () => Array(this.width).fill(0));
    this.credits = { player: this.difficulty === 'hard' ? 2800 : 3800, enemy: this.difficulty === 'easy' ? 2200 : 3600 };
    this.creditCapacity = { player: 6000, enemy: 6000 };
    this.salvageEarned = { player: 0, enemy: 0 };
    this.power = { player: { production: 0, consumption: 0, ratio: 1 }, enemy: { production: 0, consumption: 0, ratio: 1 } };
    this.radar = { player: false, enemy: false };
    this.construction = null;
    this.enemyConstruction = null;
    this.superweapon = { player: 0, enemy: 0 };
    this.commandEnergy = { player: 30, enemy: 30 };
    this.research = { player: { doctrine: null, project: null, tactical: null, tacticalProject: null, replacementUsed: false },
      enemy: { doctrine: null, project: null, tactical: null, tacticalProject: null, replacementUsed: false } };
    this.commandCooldowns = { player: { scan: 0, overcharge: 0, shield: 0, stormcall: 0, breach: 0, interdict: 0, rally: 0 },
      enemy: { scan: 0, overcharge: 0, shield: 0, stormcall: 0, breach: 0, interdict: 0, rally: 0 } };
    this.scans = [];
    this.breachZones = [];
    this.relays = [];
    this.bridges = [];
    this.wrecks = [];
    this._nextWreckId = 1;
    this.relayDominion = { owner: null, elapsed: 0, required: relayDominionDuration(this.mode, this.difficulty),
      majority: RELAY_DOMINION_MAJORITY };
    this.storm = { x: 30, y: 24, radius: 5.5, phase: 'calm', phaseTime: 0, cycle: 0, waypoint: 0,
      growthTimer: 0, damageTimer: 0, bloom: null };
    this.time = 0;
    this.status = 'playing';
    this.winner = null;
    this.kills = { player: 0, enemy: 0 };
    this.mission = mode === 'campaign'
      ? { title: 'Operation First Light', briefing: 'Establish the crystal economy, secure the valley, and destroy the Vesper command yard.', objective: 'Destroy the enemy base.' }
      : { title: `${mode === 'multiplayer' ? 'Multiplayer' : 'Skirmish'} at ${SKIRMISH_MAPS.find(map => map.id === this.mapId).name}`,
        briefing: SKIRMISH_MAPS.find(map => map.id === this.mapId).description,
        objective: skirmishObjective(this.victoryMode, this.relayDominion.required) };
    this._nextEntityId = 1;
    this._nextEffectId = 1;
    this._fogTimer = 0;
    this._powerTimer = 0;
    this._resourceTimer = 0;
    this._aiTimer = 0;
    this._aiWaveTimer = this.difficulty === 'hard' ? 30 : this.difficulty === 'easy' ? 65 : 47;
    this._aiWaveNumber = 0;
    this._aiIntel = [];
    this._aiScoutStep = 0;
    this._aiRelayTarget = null;
    this._aiRelayCommittedTargetId = null;
    this._aiRelayCommittedTargetLastSeenAt = null;
    this._aiRelayReconTarget = null;
    this.lastSeenHostileUnits = [];
    this.terrain = this._makeTerrain();
    if (['skirmish', 'multiplayer'].includes(this.mode) && this.mapId === 'delta-crossing') this._placeDeltaBridges();
    this._placeStartingBases();
    this._placeRelays();
    if (this.mode === 'skirmish' && this.mapId === 'delta-crossing' && this.skirmishOpening !== 'command-rig')
      this._placeDeltaAirlifts();
    this._refreshPower();
    this._updateFog();
    this._event('mission', { title: this.mission.title, briefing: this.mission.briefing });
  }

  _rand() {
    let x = this.randomState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 4294967296;
  }

  _event(type, data = {}) {
    const event = { type, time: this.time, ...data };
    this.events.push(event);
    if (this.events.length > 240) this.events.splice(0, this.events.length - 240);
    if (typeof this.onEvent === 'function') this.onEvent(event);
  }

  _makeTerrain() {
    if (this.mapId !== 'shard-valley') return this._makeAlternateTerrain();
    const grid = Array.from({ length: this.height }, (_, y) =>
      Array.from({ length: this.width }, (_, x) => ({ type: 'sand', resource: 0, walkable: true, buildable: true,
        shade: Math.round(this._rand() * 3), detail: this._rand() })));
    const protectedArea = (x, y) =>
      dist(x, y, 10, 37) < 10 || dist(x, y, 51, 11) < 10 || Math.abs((y - 36) + (x - 10) * 0.58) < 3.2;
    for (let i = 0; i < 22; i++) {
      const cx = 3 + this._rand() * (this.width - 6);
      const cy = 3 + this._rand() * (this.height - 6);
      const rx = 0.8 + this._rand() * 2.5;
      const ry = 0.7 + this._rand() * 2.2;
      const type = this._rand() < 0.23 ? 'water' : 'rock';
      for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
        for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
          if (!this._inBounds(x, y) || protectedArea(x, y)) continue;
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1 + (this._rand() - 0.5) * 0.3) continue;
          grid[y][x].type = type; grid[y][x].walkable = false; grid[y][x].buildable = false;
        }
      }
    }
    const rebalanceEconomy = this.replayVersion == null || this.replayVersion >= 57;
    const fields = [[10, 27, 4], [20, 40, 3], [47, 20, 4], [38, 8, 3], [31, 24, 5], [25, 15, 3],
      rebalanceEconomy ? [31, 37, 3] : [37, 34, 3]];
    for (const [cx, cy, radius] of fields) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          if (!this._inBounds(x, y) || protectedArea(x, y) && dist(x, y, cx, cy) > 2) continue;
          const chance = 0.9 - dist(x, y, cx, cy) / (radius + 1);
          if (this._rand() > chance) continue;
          const tile = grid[y][x]; tile.type = 'crystal'; tile.resource = 300 + Math.floor(this._rand() * 450);
          tile.walkable = true; tile.buildable = false;
        }
      }
    }
    return grid;
  }

  _makeAlternateTerrain() {
    const grid = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => ({ type: 'sand', resource: 0, walkable: true, buildable: true,
        shade: Math.round(this._rand() * 3), detail: this._rand() })));
    const wall = (type, left, top, right, bottom, gaps = [], vertical = true) => {
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const along = vertical ? y : x;
        if (gaps.some(([from, to]) => along >= from && along <= to)) continue;
        const tile = grid[y][x];
        tile.type = type; tile.walkable = false; tile.buildable = false;
      }
    };
    let fields;
    if (this.mapId === 'twin-passes') {
      wall('rock', 28, 2, 31, 45, this.mapVariant === 1 ? [[11, 17], [34, 40]] : [[15, 21], [31, 38]]);
      wall('water', 17, 12, 23, 15, [], false);
      wall('water', 40, 32, 46, 35, [], false);
      fields = this.mapVariant === 1
        ? [[13, 29, 4], [50, 18, 4], [19, 40, 3], [44, 7, 3], [24, 18, 3], [39, 29, 3]]
        : [[13, 29, 4], [50, 18, 4], [19, 40, 3], [44, 7, 3], [25, 24, 3], [38, 23, 3]];
    } else if (this.mapId === 'delta-crossing') {
      wall('water', 0, 21, 63, 24, [[20, 22], [41, 43]], false);
      wall('rock', 26, 4, 29, 17);
      wall('rock', 34, 29, 37, 43);
      fields = [[12, 30, 4], [51, 17, 4], [21, 40, 3], [42, 7, 3], [23, 20, 3], [40, 27, 3]];
    } else if (this.mapId === 'canyon-ring') {
      wall('rock', 29, 2, 34, 45, this.mapVariant === 1
        ? (this.legacyCanyonRingVariant1 ? [[11, 17], [30, 36]] : [[20, 24], [35, 37]])
        : [[8, 14], [33, 39]]);
      wall('rock', 20, 17, 28, 20, [], false);
      wall('rock', 35, 27, 43, 30, [], false);
      fields = this.mapVariant === 1
        ? [[12, 29, 4], [51, 18, 4], [21, 40, 3], [42, 7, 3], [25, 16, 3], [39, 32, 3]]
        : [[12, 29, 4], [51, 18, 4], [21, 40, 3], [42, 7, 3], [25, 12, 3], [39, 36, 3]];
    } else {
      wall('water', 3, 20, 60, 26, [[12, 18], [45, 51]], false);
      wall('rock', 23, 4, 26, 15);
      wall('rock', 37, 32, 40, 44);
      fields = [[12, 29, 4], [51, 18, 4], [20, 40, 3], [43, 7, 3], [30, 16, 4], [34, 32, 4]];
    }
    const occupiedAtStart = (x, y) =>
      [[8, 34, 3, 3], [4, 35, 2, 2], [4, 40, 3, 2], [12, 40, 2, 2], [14, 34, 3, 3],
        [51, 9, 3, 3], [57, 10, 2, 2], [55, 15, 3, 2], [49, 15, 2, 2], [45, 9, 3, 3]]
        .some(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh);
    for (const [cx, cy, radius] of fields) {
      for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
        if (!this._inBounds(x, y) || occupiedAtStart(x, y)) continue;
        const distance = dist(x, y, cx, cy);
        if (distance > radius || grid[y][x].type !== 'sand') continue;
        // Seeded deposits vary within the authored route variant and base clearances.
        if (distance > 1.5 && this._rand() > 0.95 - distance / (radius + 3) * 0.28) continue;
        const tile = grid[y][x];
        tile.type = 'crystal'; tile.resource = 350 + Math.floor(this._rand() * 400);
        tile.walkable = true; tile.buildable = false;
      }
    }
    return grid;
  }

  _inBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  _tile(x, y) { return this._inBounds(x, y) ? this.terrain[y][x] : null; }

  _placeDeltaBridges() {
    this.bridges = [[20, 21], [41, 21]].map(([x, y], index) => {
      const bridge = { id: `b${900000001 + index}`, defId: 'bridge', owner: null, x, y, w: 3, h: 4,
        hp: 720, maxHp: 720, destroyed: false, armor: 'structure' };
      for (let ty = y; ty < y + bridge.h; ty++) for (let tx = x; tx < x + bridge.w; tx++) {
        const tile = this._tile(tx, ty);
        if (tile) { tile.type = 'bridge'; tile.bridgeId = bridge.id; tile.walkable = true; tile.buildable = false; }
      }
      return bridge;
    });
  }

  _placeStartingBases() {
    if (this.skirmishOpening === 'command-rig') {
      this.credits.player = 3200;
      this.credits.enemy = 3200;
      // Rig footprints are clear and their nearby escorts are outside the 3x3 deployment area.
      this._createUnit('player', 'mcv', 9.5, 35.5);
      this._createUnit('player', 'harvester', 7.5, 42.5, { type: 'harvest' });
      this._createUnit('player', 'buggy', 14.5, 38.5);
      this._createUnit('enemy', 'mcv', 52.5, 10.5);
      this._createUnit('enemy', 'harvester', 54.5, 18.5, { type: 'harvest' });
      this._createUnit('enemy', 'buggy', 43.5, 12.5);
      return;
    }
    const p = [
      ['command', 8, 34], ['power', 4, 35], ['refinery', 4, 40], ['barracks', 12, 40], ['factory', 14, 34],
    ];
    const e = [
      ['command', 51, 9], ['power', 57, 10], ['refinery', 55, 15], ['barracks', 49, 15], ['factory', 45, 9],
    ];
    for (const [defId, x, y] of p) this._createBuilding('player', defId, x, y, 1);
    for (const [defId, x, y] of e) this._createBuilding('enemy', defId, x, y, 1);
    this._createUnit('player', 'harvester', 7.5, 42.5, { type: 'harvest' });
    this._createUnit('player', 'rifle', 12.5, 37.5);
    this._createUnit('player', 'rifle', 13.5, 38.5);
    this._createUnit('player', 'scout', 12.5, 34.5);
    this._createUnit('player', 'lightTank', 18.5, 37.5);
    this._createUnit('enemy', 'harvester', 54.5, 18.5, { type: 'harvest' });
    this._createUnit('enemy', 'rifle', 48.5, 14.5);
    this._createUnit('enemy', 'rifle', 49.5, 13.5);
    this._createUnit('enemy', 'scout', 45.5, 14.5);
    this._createUnit('enemy', 'lightTank', 43.5, 12.5);
    if (this.difficulty === 'easy') this.units.find(u => u.owner === 'enemy' && u.defId === 'lightTank').hp *= 0.75;
  }

  _placeDeltaAirlifts() {
    // Equal, immediately usable airlift groups on opposite banks. The Cadet
    // carrier stays available but does not receive the higher difficulty AI orders.
    const starts = [
      { owner: 'player', x: 17.5, y: 38.5, infantry: [[17.5, 39.5], [18.5, 38.5]] },
      { owner: 'enemy', x: 47.5, y: 18.5, infantry: [[47.5, 19.5], [48.5, 18.5]] },
    ];
    for (const start of starts) {
      const carrier = this._createUnit(start.owner, 'dropship', start.x, start.y);
      const squad = start.infantry.map(([x, y]) => this._createUnit(start.owner, 'rifle', x, y));
      if (start.owner === 'enemy' && this.difficulty !== 'easy') {
        carrier._aiTransportSquadIds = squad.map(unit => unit.id);
        carrier._aiTransportStartedAt = this.time;
        for (const unit of squad) unit.order = { type: 'board', carrierId: carrier.id };
      }
    }
  }

  _placeRelays() {
    const sites = this.mapId === 'twin-passes' ? (this.mapVariant === 1
      ? [[23, 16], [34, 25], [40, 34]] : [[23, 19], [34, 25], [40, 37]])
      : this.mapId === 'delta-crossing' ? [[21, 18], [31, 27], [43, 30]]
        : this.mapId === 'canyon-ring' ? (this.mapVariant === 1
          ? [[23, 17], [35, 24], [40, 33]] : [[23, 18], [35, 24], [40, 35]])
          : this.mapId === 'storm-basin' ? [[21, 18], [32, 29], [43, 30]]
        : [[22, 27], [31, 18], [42, 29]];
    this.relays = sites.map(([cx, cy], index) => {
      let best = null;
      for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
        const tile = this._tile(x, y);
        if (!tile?.walkable || tile.type !== 'sand' ||
          this.buildings.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) continue;
        const score = dist(x, y, cx, cy);
        if (!best || score < best.score) best = { x, y, score };
      }
      const x = best?.x ?? cx, y = best?.y ?? cy;
      const tile = this._tile(x, y);
      if (tile) tile.buildable = false;
      return { id: `relay${index + 1}`, x: x + 0.5, y: y + 0.5, owner: null, progress: 0,
        contested: false, protocol: 'shelter', protocolCooldown: 0 };
    });
  }

  _salvageDropEnabled() {
    return ['skirmish', 'multiplayer'].includes(this.mode) &&
      (this.replayVersion == null || this.replayVersion >= SALVAGE_DROP_RULES_VERSION);
  }

  _chooseSalvageDropSite() {
    const groundStarts = ['player', 'enemy'].map(owner => this.units.find(unit => unit.owner === owner &&
      unit.hp > 0 && !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon));
    const haveBothStarts = groundStarts.every(Boolean);
    const components = haveBothStarts ? this._groundComponents() : null;
    const componentAt = (x, y) => components[Math.floor(y) * this.width + Math.floor(x)];
    const startComponents = haveBothStarts ? groundStarts.map(unit => componentAt(unit.x, unit.y)) : [];
    const shared = haveBothStarts && startComponents[0] >= 0 && startComponents[0] === startComponents[1];
    const candidates = [];
    const centerX = haveBothStarts ? (groundStarts[0].x + groundStarts[1].x) / 2 : this.width / 2;
    const centerY = haveBothStarts ? (groundStarts[0].y + groundStarts[1].y) / 2 : this.height / 2;
    const anchorPoints = [
      ...this.buildings.filter(building => building.hp > 0 && building.defId === 'command')
        .map(building => ({ x: building.x + 1.5, y: building.y + 1.5, radius: 10 })),
      ...this.relays.map(relay => ({ x: relay.x, y: relay.y, radius: 3.2 })),
    ];
    for (let y = 5; y < this.height - 5; y++) for (let x = 5; x < this.width - 5; x++) {
      if (!this._isPassable(x, y) || this.terrain[y][x].type !== 'sand') continue;
      if (shared && componentAt(x + 0.5, y + 0.5) !== startComponents[0]) continue;
      if (anchorPoints.some(point => dist(x + 0.5, y + 0.5, point.x, point.y) < point.radius)) continue;
      if (this.units.some(unit => unit.hp > 0 && !unit.embarkedIn &&
        dist(unit.x, unit.y, x + 0.5, y + 0.5) < 1.35)) continue;
      const score = dist(x + 0.5, y + 0.5, centerX, centerY);
      // Stable integer mixing makes equally suitable sites vary by match seed,
      // map, and variant without consuming the simulation RNG stream.
      let tie = (this.seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b) ^
        Math.imul(this.mapVariant + 1, 0xc2b2ae35)) >>> 0;
      for (const char of this.mapId) tie = Math.imul(tie ^ char.charCodeAt(0), 0x01000193) >>> 0;
      candidates.push({ x: x + 0.5, y: y + 0.5, score, tie });
    }
    candidates.sort((a, b) => a.score - b.score || a.tie - b.tie || a.y - b.y || a.x - b.x);
    const best = candidates[0];
    if (best) return { x: best.x, y: best.y };

    // Keep a valid fallback even in unusual/custom scenarios with no armed
    // starting force, modified terrain, or unusually dense map occupation.
    // Relax the preferred sand/spacing filters, but preserve passability and
    // avoid live units; tie-breaking remains deterministic.
    const fallback = [];
    for (let y = 1; y < this.height - 1; y++) for (let x = 1; x < this.width - 1; x++) {
      if (!this._isPassable(x, y) || this.units.some(unit => unit.hp > 0 && !unit.embarkedIn &&
        dist(unit.x, unit.y, x + 0.5, y + 0.5) < 1.35)) continue;
      const anchorPenalty = anchorPoints.reduce((penalty, point) =>
        penalty + Math.max(0, point.radius - dist(x + 0.5, y + 0.5, point.x, point.y)) * 4, 0);
      let tie = (this.seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b) ^
        Math.imul(this.mapVariant + 1, 0xc2b2ae35)) >>> 0;
      for (const char of this.mapId) tie = Math.imul(tie ^ char.charCodeAt(0), 0x01000193) >>> 0;
      fallback.push({ x: x + 0.5, y: y + 0.5,
        score: dist(x + 0.5, y + 0.5, centerX, centerY) + anchorPenalty, tie });
    }
    fallback.sort((a, b) => a.score - b.score || a.tie - b.tie || a.y - b.y || a.x - b.x);
    return fallback[0] ? { x: fallback[0].x, y: fallback[0].y } : null;
  }

  _updateSalvageDrop(dt) {
    if (!this._salvageDropEnabled()) return;
    if (!this.salvageDrop && this.time >= SALVAGE_DROP_WARNING_AT) {
      const site = this._chooseSalvageDropSite();
      if (!site) return;
      this.salvageDrop = { phase: 'incoming', ...site, warningAt: SALVAGE_DROP_WARNING_AT,
        landsAt: SALVAGE_DROP_WARNING_AT + SALVAGE_DROP_FLIGHT_SECONDS,
        expiresAt: SALVAGE_DROP_WARNING_AT + SALVAGE_DROP_FLIGHT_SECONDS + SALVAGE_DROP_LIFETIME_SECONDS,
        captureOwner: null, captureProgress: 0, claimedBy: null, contested: false };
      this._event('salvageDropIncoming', { x: site.x, y: site.y, landsAt: this.salvageDrop.landsAt,
        expiresAt: this.salvageDrop.expiresAt, message: 'A public salvage cache is inbound at the marked site.' });
    }
    const drop = this.salvageDrop;
    if (!drop || ['claimed', 'expired'].includes(drop.phase)) return;
    if (drop.phase === 'incoming' && this.time >= drop.landsAt) {
      drop.phase = 'active';
      this._event('salvageDropLanded', { x: drop.x, y: drop.y, expiresAt: drop.expiresAt,
        message: 'The public salvage cache has landed.' });
    }
    if (drop.phase !== 'active') return;
    if (this.time >= drop.expiresAt) {
      drop.phase = 'expired'; drop.captureOwner = null; drop.captureProgress = 0; drop.contested = false;
      this._event('salvageDropExpired', { x: drop.x, y: drop.y,
        message: 'The public salvage cache expired unclaimed.' });
      this._restoreAiSalvageOrder();
      return;
    }
    const present = { player: false, enemy: false };
    for (const unit of this.units) {
      if (unit.hp <= 0 || unit.embarkedIn || UNIT_DEFS[unit.defId]?.flying || !UNIT_DEFS[unit.defId]?.weapon ||
        dist(unit.x, unit.y, drop.x, drop.y) > SALVAGE_DROP_CAPTURE_RADIUS) continue;
      present[unit.owner] = true;
    }
    drop.contested = present.player && present.enemy;
    if (present.player === present.enemy) return;
    const owner = present.player ? 'player' : 'enemy';
    if (drop.captureOwner !== owner) { drop.captureOwner = owner; drop.captureProgress = 0; }
    drop.captureProgress = Math.min(SALVAGE_DROP_CAPTURE_SECONDS, drop.captureProgress + dt);
    if (drop.captureProgress + 1e-9 < SALVAGE_DROP_CAPTURE_SECONDS) return;
    const creditValue = Math.min(SALVAGE_DROP_CREDIT_REWARD,
      Math.max(0, this.creditCapacity[owner] - this.credits[owner]));
    const energyValue = Math.min(SALVAGE_DROP_ENERGY_REWARD, Math.max(0, 100 - this.commandEnergy[owner]));
    this.credits[owner] += creditValue;
    this.commandEnergy[owner] += energyValue;
    drop.phase = 'claimed'; drop.claimedBy = owner;
    drop.contested = false;
    this._event('salvageDropClaimed', { owner, x: drop.x, y: drop.y, credits: creditValue,
      commandEnergy: energyValue, message: `${owner === 'player' ? 'Your forces' : 'Enemy forces'} secured the public salvage cache.` });
    this._restoreAiSalvageOrder();
  }

  _restoreAiSalvageOrder() {
    for (const unit of this.units) if (unit._aiSalvageDropOrder) {
      unit.order = unit._aiSalvageDropOrder;
      unit._aiSalvageDropOrder = null;
      unit.path = []; unit._pathGoal = null;
    }
  }

  _aiSalvageDrop() {
    const drop = this.salvageDrop;
    if (!this._salvageDropEnabled() || !drop || !['incoming', 'active'].includes(drop.phase)) {
      this._restoreAiSalvageOrder(); return;
    }
    if (this.relayDominion?.owner === 'player' || this.units.some(unit => unit.owner === 'enemy' &&
      unit.hp > 0 && (unit._aiDefenseTarget || unit._aiRelayResponseRelayId))) {
      this._restoreAiSalvageOrder();
      return;
    }
    const assigned = this.units.find(unit => unit.owner === 'enemy' && unit._aiSalvageDropOrder);
    if (assigned) return;
    const components = this._groundComponents();
    const componentAt = (x, y) => components[Math.floor(y) * this.width + Math.floor(x)];
    const available = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 && !unit.embarkedIn &&
      !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon &&
      !unit._aiDefenseTarget && !unit._aiRelayResponseRelayId && !unit._aiRaidTarget &&
      (unit.order?.type === 'idle' || unit.order?.type === 'move'));
    const reachable = available.filter(unit => componentAt(unit.x, unit.y) >= 0 &&
      componentAt(unit.x, unit.y) === componentAt(drop.x, drop.y));
    reachable.sort((a, b) => dist(a.x, a.y, drop.x, drop.y) - dist(b.x, b.y, drop.x, drop.y) || a.id.localeCompare(b.id));
    const unit = reachable[0];
    if (!unit) return;
    unit._aiSalvageDropOrder = structuredClone(unit.order || { type: 'idle' });
    unit.order = { type: 'move', x: drop.x, y: drop.y, attackMove: true, aiSalvageDrop: true };
    unit.path = []; unit._pathGoal = null;
  }

  _updateRelays(dt) {
    for (const relay of this.relays) {
      relay.protocolCooldown = Math.max(0, (Number.isFinite(relay.protocolCooldown) ? relay.protocolCooldown : 0) - dt);
      let player = 0, enemy = 0;
      for (const u of this.units) {
        if (u.hp <= 0 || u.embarkedIn || UNIT_DEFS[u.defId].flying || dist(u.x, u.y, relay.x, relay.y) > 2.3) continue;
        if (u.owner === 'player') player++;
        else enemy++;
      }
      relay.contested = player > 0 && enemy > 0;
      if (relay.contested || player === enemy) continue;
      const side = player > enemy ? 'player' : 'enemy';
      const direction = side === 'player' ? 1 : -1;
      const count = Math.min(3, Math.max(player, enemy));
      const previous = relay.progress;
      relay.progress = clamp(previous + direction * dt * 0.035 * (1 + (count - 1) * 0.45), -1, 1);
      if (relay.owner && relay.owner !== side && previous * relay.progress <= 0) {
        relay.owner = null;
        relay.protocol = 'shelter'; relay.protocolCooldown = 0;
        this._event('relayNeutralized', { id: relay.id, x: relay.x, y: relay.y,
          message: 'A resonance relay has been neutralized.' });
      }
      if (!relay.owner && Math.abs(relay.progress) >= 1) {
        relay.owner = side;
        relay.protocol = 'shelter'; relay.protocolCooldown = 0;
        this._event('relayCaptured', { id: relay.id, owner: side, x: relay.x, y: relay.y,
          message: `${side === 'player' ? 'Your forces' : 'Enemy forces'} captured a resonance relay.` });
        if (side === 'player') this._updateFog();
      }
    }
    for (const owner of ['player', 'enemy']) {
      const held = this.relays.filter(r => r.owner === owner).length;
      const overdrive = this._relayProtocolsEnabled() ? this.relays.filter(r => r.owner === owner &&
        r.protocol === 'overdrive' && !this._relayIsContested(r)).length * 0.45 : 0;
      const baseline = (0.32 + held * 0.36) *
        (this.research?.[owner]?.doctrine === 'signal' ? 1.25 : 1);
      this.commandEnergy[owner] = Math.min(100, this.commandEnergy[owner] + dt * (baseline + overdrive));
    }
    // Aegis relay shelters double as forward triage stations. Keep this behind
    // a replay rules gate so archived matches retain their original outcomes.
    if ((this.replayVersion == null || this.replayVersion >= 18)) {
      for (const relay of this.relays) {
        if (!relay.owner || relay.contested || relay.protocol !== 'shelter' ||
          ownerFaction(this, relay.owner) !== 'aegis') continue;
        for (const unit of this.units) {
          if (unit.owner !== relay.owner || unit.hp <= 0 || unit.embarkedIn ||
            UNIT_DEFS[unit.defId]?.armor !== 'infantry' || unit.hp >= unit.maxHp ||
            dist(unit.x, unit.y, relay.x, relay.y) > 2.3) continue;
          unit.hp = Math.min(unit.maxHp, unit.hp + dt * AEGIS_RELAY_RECOVERY_RATE);
        }
      }
    }
  }

  _relayIsContested(relay) {
    if (relay.contested) return true;
    // A held relay is unsafe for Stormcall as soon as an opposing ground unit
    // reaches its capture radius, even before the next relay update tick.
    if (relay.owner === 'player' || relay.owner === 'enemy') return this.units.some(unit =>
      unit.hp > 0 && !unit.embarkedIn && !UNIT_DEFS[unit.defId].flying &&
      unit.owner !== relay.owner && dist(unit.x, unit.y, relay.x, relay.y) <= 2.3);
    let player = false, enemy = false;
    for (const unit of this.units) {
      if (unit.hp <= 0 || unit.embarkedIn || UNIT_DEFS[unit.defId].flying ||
        dist(unit.x, unit.y, relay.x, relay.y) > 2.3) continue;
      if (unit.owner === 'player') player = true;
      else if (unit.owner === 'enemy') enemy = true;
      if (player && enemy) return true;
    }
    return false;
  }

  _updateRelayDominion(dt) {
    if (this.status !== 'playing' || (this.mode !== 'skirmish' && this.mode !== 'multiplayer') ||
      (['skirmish', 'multiplayer'].includes(this.mode) && this.victoryMode === 'elimination')) return;
    const dominion = this.relayDominion;
    const playerHeld = this.relays.filter(relay => relay.owner === 'player' && !relay.contested).length;
    const enemyHeld = this.relays.filter(relay => relay.owner === 'enemy' && !relay.contested).length;
    const owner = this.relays.length >= dominion.majority
      ? playerHeld >= dominion.majority ? 'player' : enemyHeld >= dominion.majority ? 'enemy' : null
      : null;
    if (owner !== dominion.owner) {
      if (dominion.owner) this._event('relayDominionBroken', { owner: dominion.owner,
        message: `${dominion.owner === 'player' ? 'Your' : 'Enemy'} relay dominion was broken.` });
      dominion.owner = owner;
      dominion.elapsed = 0;
      if (owner) this._event('relayDominionStarted', { owner, required: dominion.required,
        message: `${owner === 'player' ? 'Your forces' : 'Enemy forces'} control the relay majority.` });
      return;
    }
    if (!owner) return;
    dominion.elapsed = Math.min(dominion.required, dominion.elapsed + dt);
    if (dominion.elapsed + 1e-9 < dominion.required) return;
    this.winner = owner;
    this.status = owner === 'player' ? 'victory' : 'defeat';
    this._event('relayDominionComplete', { owner, winner: owner, elapsed: dominion.elapsed,
      message: `${owner === 'player' ? 'Your forces' : 'Enemy forces'} achieved Relay Dominion.` });
    this._event(this.status, { winner: owner, time: this.time, reason: 'relayDominion' });
  }

  _stormSight(x, y, sight) {
    return this.storm.phase === 'surge' && dist(x, y, this.storm.x, this.storm.y) < this.storm.radius
      ? sight * 0.58 : sight;
  }

  _stormglassBloomEnabled() {
    return ['skirmish', 'multiplayer'].includes(this.mode) &&
      (this.replayVersion == null || this.replayVersion >= STORMGLASS_BLOOM_RULES_VERSION);
  }

  _openStormglassBloom() {
    if (!this._stormglassBloomEnabled()) return null;

    // Favor a crystal patch close to the moving storm and roughly equidistant
    // from both starting economies. Restrict it to ground components reached
    // by at least one starting force so the public opportunity is actionable.
    const components = this._groundComponents();
    const componentAt = (x, y) => {
      const tx = Math.floor(x), ty = Math.floor(y);
      return tx < 0 || ty < 0 || tx >= this.width || ty >= this.height
        ? -1 : components[ty * this.width + tx];
    };
    const starts = ['player', 'enemy'].map(owner => this.units.find(unit => unit.owner === owner &&
      unit.hp > 0 && !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon));
    const startComponents = starts.filter(Boolean).map(unit => componentAt(unit.x, unit.y)).filter(id => id >= 0);
    const candidates = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const tile = this.terrain[y][x];
      if (tile.type !== 'crystal' || tile.resource <= 0 || !tile.walkable) continue;
      const component = componentAt(x + 0.5, y + 0.5);
      if (component < 0 || (startComponents.length && !startComponents.includes(component))) continue;
      const stormDistance = dist(x + 0.5, y + 0.5, this.storm.x, this.storm.y);
      if (stormDistance > this.storm.radius + 5.5) continue;
      const patchStock = this.terrain.slice(Math.max(0, y - 2), Math.min(this.height, y + 3))
        .reduce((sum, row, rowIndex) => sum + row.slice(Math.max(0, x - 2), Math.min(this.width, x + 3))
          .reduce((subtotal, neighbor, columnIndex) => {
            const nx = Math.max(0, x - 2) + columnIndex;
            const ny = Math.max(0, y - 2) + rowIndex;
            return subtotal + (neighbor.type === 'crystal' && dist(nx + 0.5, ny + 0.5, x + 0.5, y + 0.5) <= 2.5
              ? neighbor.resource : 0);
          }, 0), 0);
      const startDistances = starts.filter(Boolean).map(unit => dist(x + 0.5, y + 0.5, unit.x, unit.y));
      const frontierPenalty = startDistances.length > 1 ? Math.abs(startDistances[0] - startDistances[1]) : 0;
      candidates.push({ x, y, score: stormDistance + frontierPenalty * 0.3 - Math.min(patchStock, 1800) / 1800 });
    }
    candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
    const patch = candidates[0];
    if (!patch) return null;

    const x = patch.x + 0.5, y = patch.y + 0.5;
    for (let yy = Math.max(0, patch.y - Math.ceil(STORMGLASS_BLOOM_RADIUS));
      yy <= Math.min(this.height - 1, patch.y + Math.ceil(STORMGLASS_BLOOM_RADIUS)); yy++) {
      for (let xx = Math.max(0, patch.x - Math.ceil(STORMGLASS_BLOOM_RADIUS));
        xx <= Math.min(this.width - 1, patch.x + Math.ceil(STORMGLASS_BLOOM_RADIUS)); xx++) {
        const tile = this.terrain[yy][xx];
        if (tile.type === 'crystal' && tile.resource > 0 && dist(xx + 0.5, yy + 0.5, x, y) <= STORMGLASS_BLOOM_RADIUS)
          tile.resource = Math.min(1100, tile.resource + STORMGLASS_BLOOM_ENRICHMENT);
      }
    }

    const bloom = { x, y, radius: STORMGLASS_BLOOM_RADIUS,
      until: this.time + STORMGLASS_BLOOM_DURATION };
    this.storm.bloom = bloom;
    this._event('stormglassBloom', { ...bloom, enrichment: STORMGLASS_BLOOM_ENRICHMENT,
      premiumRate: STORMGLASS_BLOOM_PREMIUM_RATE,
      message: 'Stormglass Bloom detected: enriched crystal is charged until delivered.' });
    return bloom;
  }

  _enrichStormCrystals() {
    const storm = this.storm;
    for (let i = 0; i < 16; i++) {
      const angle = this._rand() * Math.PI * 2;
      const radius = Math.sqrt(this._rand()) * storm.radius;
      const x = Math.floor(storm.x + Math.cos(angle) * radius);
      const y = Math.floor(storm.y + Math.sin(angle) * radius);
      const tile = this._tile(x, y);
      if (!tile?.walkable || this.relays.some(r => Math.floor(r.x) === x && Math.floor(r.y) === y)) continue;
      if (tile.type === 'crystal') {
        tile.resource = Math.min(1100, tile.resource + 20 + this._rand() * 24);
      } else if (tile.type === 'sand' &&
        !this.buildings.some(b => b.hp > 0 && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) &&
        this._rand() < 0.22) {
        tile.type = 'crystal'; tile.resource = 110 + Math.floor(this._rand() * 85); tile.buildable = false;
      }
    }
  }

  _updateStorm(dt) {
    const storm = this.storm;
    if (storm.bloom && (!this._stormglassBloomEnabled() || this.time >= storm.bloom.until)) {
      const expired = storm.bloom;
      storm.bloom = null;
      if (this._stormglassBloomEnabled()) this._event('stormglassBloomEnded', {
        x: expired.x, y: expired.y, message: 'The Stormglass Bloom has faded.' });
    }
    storm.phaseTime += dt;
    if (storm.phaseTime >= ION_STORM_PHASE_SECONDS[storm.phase]) {
      storm.phaseTime -= ION_STORM_PHASE_SECONDS[storm.phase];
      storm.phase = { calm: 'warning', warning: 'surge', surge: 'recovery', recovery: 'calm' }[storm.phase];
      if (storm.phase === 'calm') storm.cycle++;
      this._event('stormPhase', { phase: storm.phase, x: storm.x, y: storm.y,
        message: storm.phase === 'warning' ? 'Ion storm forming over the valley.' :
          storm.phase === 'surge' ? 'Ion storm surge: exposed forces are at risk.' :
          storm.phase === 'recovery' ? 'The ion storm is dissipating.' : 'Ion storm cleared.' });
      if (storm.phase === 'surge') this._openStormglassBloom();
    }
    if (storm.lure && (this.time >= storm.lure.until ||
      (storm.phase !== 'warning' && storm.phase !== 'surge'))) delete storm.lure;
    if (storm.lure?.relayId) {
      const relay = this.relays.find(r => r.id === storm.lure.relayId);
      const contested = relay && this._relayIsContested(relay);
      if (!relay || relay.owner !== storm.lure.owner || contested) {
        this._event('stormcallCanceled', { owner: storm.lure.owner, x: storm.lure.x, y: storm.lure.y,
          relayId: storm.lure.relayId, reason: contested ? 'contested' : 'lost',
          message: contested ? 'Relay Stormcall canceled: the relay is contested.' :
            'Relay Stormcall canceled: the relay was lost.' });
        delete storm.lure;
      }
    }
    if (storm.phase === 'warning' || storm.phase === 'surge') {
      const route = [[31, 24], [22, 29], [33, 24], [43, 18], [38, 32]];
      const target = storm.lure ? [storm.lure.x, storm.lure.y] : route[storm.waypoint % route.length];
      const distance = dist(storm.x, storm.y, target[0], target[1]);
      if (!storm.lure && distance < 0.4) storm.waypoint = (storm.waypoint + 1) % route.length;
      else if (!storm.lure || distance > 0.6) {
        const step = Math.min(storm.lure ? distance - 0.6 : distance,
          dt * (storm.lure ? 1.1 : storm.phase === 'surge' ? 0.65 : 0.34));
        storm.x += (target[0] - storm.x) / distance * step;
        storm.y += (target[1] - storm.y) / distance * step;
      }
    }
    if (storm.phase !== 'surge') return;
    if (storm.lure?.relayId && !storm.lure.pulseResolved &&
      dist(storm.x, storm.y, storm.lure.x, storm.lure.y) <= 0.600001) {
      const { owner, x, y, relayId } = storm.lure;
      storm.lure.pulseResolved = true;
      for (const unit of this.units) if (unit.hp > 0 && !unit.embarkedIn && unit.owner !== owner &&
        dist(unit.x, unit.y, x, y) <= STORMCALL_PULSE_RADIUS)
        this._applyDamage(unit, STORMCALL_PULSE_DAMAGE, 'ion', owner, null);
      this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'ion', x, y,
        radius: 1.4, ttl: 0.6, maxTtl: 0.6, owner, source: 'stormcall' });
      this._event('stormcallPulse', { owner, x, y, relayId, radius: STORMCALL_PULSE_RADIUS,
        message: `${owner === 'player' ? 'Your' : 'Enemy'} relay discharged an ion pulse.` });
    }
    storm.growthTimer += dt;
    while (storm.growthTimer >= 1) { storm.growthTimer -= 1; this._enrichStormCrystals(); }
    storm.damageTimer += dt;
    while (storm.damageTimer >= 0.5) {
      storm.damageTimer -= 0.5;
      for (const u of this.units) {
        if (u.hp <= 0 || dist(u.x, u.y, storm.x, storm.y) > storm.radius) continue;
        if (this.relays.some(r => r.owner === u.owner && !r.contested &&
          (!this._relayProtocolsEnabled() || (r.protocol || 'shelter') === 'shelter') && dist(u.x, u.y, r.x, r.y) <= 2.3)) continue;
        const damage = UNIT_DEFS[u.defId].flying ? 12 : UNIT_DEFS[u.defId].armor === 'infantry' ? 6 : 4;
        this._applyDamage(u, damage, 'ion', null, null);
      }
    }
  }

  _createBuilding(owner, defId, x, y, progress = 1) {
    const d = BUILDING_DEFS[defId];
    const b = { id: `b${this._nextEntityId++}`, owner, faction: ownerFaction(this, owner), defId,
      x: Math.floor(x), y: Math.floor(y), w: d.w, h: d.h, hp: d.health, maxHp: d.health,
      progress, queue: [], rally: { x: x + d.w / 2, y: y + d.h + 2 }, repairing: false, powered: true,
      cooldown: 0, facing: owner === 'player' ? -Math.PI / 4 : Math.PI * 0.75, selected: false };
    this.buildings.push(b);
    this._event('buildingCreated', { id: b.id, owner, defId, x: b.x, y: b.y });
    return b;
  }

  _createUnit(owner, defId, x, y, order = { type: 'idle' }) {
    const d = UNIT_DEFS[defId];
    const maxHp = d.health * this._campaignUnitMultiplier(owner, 'reinforced', 1.12);
    const u = { id: `u${this._nextEntityId++}`, owner, faction: ownerFaction(this, owner), defId, x, y,
      hp: maxHp, maxHp, facing: owner === 'player' ? -Math.PI / 4 : Math.PI * 0.75,
      order: { ...order }, stance: 'aggressive', path: [], selected: false, cooldown: this._rand() * 0.3,
      cargo: 0, veterancy: 0, xp: 0, kills: 0, promotion: null, revealedUntil: 0, _pathGoal: null, _repath: 0,
      _harvestTile: null, _healCooldown: 0, ammo: d.ammoMax ?? null, _resumeOrder: null,
      _stormglassCargo: 0,
      _unloadRefineryId: null, _unloadApproach: null, _unloadRemaining: 0, _unloadProgress: 0,
      suppressedUntil: 0, embarkedIn: null, passengerIds: [], abilityCooldown: 0,
      braceUntil: 0, ghostRunUntil: 0 };
    this.units.push(u);
    this._event('unitCreated', { id: u.id, owner, defId, x, y });
    return u;
  }

  _campaignUnitMultiplier(owner, doctrineId, bonus) {
    return this.mode === 'campaign' && owner === 'player' && this.campaignDoctrineId === doctrineId ? bonus : 1;
  }

  _setCampaignUnitBaseHealth(unit, baseHealth) {
    const oldMaxHp = unit.maxHp;
    unit.maxHp = baseHealth * this._campaignUnitMultiplier(unit.owner, 'reinforced', 1.12);
    unit.hp = oldMaxHp > 0 ? unit.hp / oldMaxHp * unit.maxHp : unit.maxHp;
  }

  getEntity(id) { return this.units.find(u => u.id === id) || this.buildings.find(b => b.id === id) ||
    this.bridges.find(bridge => bridge.id === id) || null; }
  get selectedUnits() { return this.selection.map(id => this.units.find(u => u.id === id)).filter(u => u && !u.embarkedIn); }
  get selectedBuildings() { return this.selection.map(id => this.buildings.find(b => b.id === id)).filter(Boolean); }
  get visibleEnemies() { return [...this.units, ...this.buildings].filter(e => e.owner === 'enemy' && this.isVisible(e)); }
  getLastSeenHostileUnits() {
    if (this.mode !== 'skirmish' || this.victoryMode !== 'elimination') return [];
    const currentlyVisibleIds = new Set(this._visibleEliminationHostiles().map(unit => unit.id));
    return this.lastSeenHostileUnits.filter(contact => !currentlyVisibleIds.has(contact.entityId))
      .map(contact => ({ ...contact }));
  }

  _visibleEliminationHostiles() {
    if (this.mode !== 'skirmish' || this.victoryMode !== 'elimination') return [];
    return this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 && !unit.embarkedIn &&
      (UNIT_DEFS[unit.defId]?.weapon || ['mcv', 'engineer'].includes(unit.defId)) && this.isVisible(unit, 'player'));
  }

  _refreshLastSeenHostileUnits() {
    if (this.mode !== 'skirmish' || this.victoryMode !== 'elimination') {
      this.lastSeenHostileUnits = [];
      return new Set();
    }
    const contacts = Array.isArray(this.lastSeenHostileUnits) ? this.lastSeenHostileUnits : [];
    const visible = new Map();
    for (const unit of this._visibleEliminationHostiles()) {
      visible.set(unit.id, unit);
      const existing = contacts.find(contact => contact.entityId === unit.id);
      const record = { entityId: unit.id, defId: unit.defId, x: unit.x, y: unit.y, lastSeenAt: this.time };
      if (existing) Object.assign(existing, record);
      else contacts.push(record);
    }
    const fresh = contacts.filter(contact => {
      const tileX = Math.floor(contact.x), tileY = Math.floor(contact.y);
      // Only clear a marker when its remembered tile is currently in vision.
      // In particular, never query getEntity() or otherwise infer hidden survival.
      if (this.fog[tileY]?.[tileX] !== 2) return true;
      const unit = visible.get(contact.entityId);
      return !!unit && Math.floor(unit.x) === tileX && Math.floor(unit.y) === tileY;
    });
    this.lastSeenHostileUnits = fresh.slice(-MAX_LAST_SEEN_HOSTILE_UNITS);
  }

  get minimap() { return { terrain: this.terrain, fog: this.fog, units: this.units, buildings: this.buildings,
    relays: this.relays, bridges: this.bridges, storm: this.storm, width: this.width, height: this.height }; }

  isVisible(entity, viewer = 'player') {
    if (!entity || entity.embarkedIn) return false;
    if (entity.owner === viewer) return true;
    const x = clamp(Math.floor(entity.x + (entity.w || 0) / 2), 0, this.width - 1);
    const y = clamp(Math.floor(entity.y + (entity.h || 0) / 2), 0, this.height - 1);
    if (viewer === 'player' && this.fog[y][x] !== 2) return false;
    if (viewer === 'enemy') {
      const ex = entity.x + (entity.w || 0) / 2, ey = entity.y + (entity.h || 0) / 2;
      const seenBy = [...this.units, ...this.buildings].some(e => {
        if (e.owner !== viewer || e.hp <= 0 || e.embarkedIn || (e.w && e.progress < 1)) return false;
        const ox = e.x + (e.w || 0) / 2, oy = e.y + (e.h || 0) / 2;
        const sight = this._stormSight(ox, oy, UNIT_DEFS[e.defId]?.sight || BUILDING_DEFS[e.defId]?.sight || 5);
        return dist(ox, oy, ex, ey) <= sight && this._hasLineOfSight(ox, oy, ex, ey);
      }) || this.relays.some(r => r.owner === viewer && dist(r.x, r.y, ex, ey) <= this._stormSight(r.x, r.y, 6) &&
        this._hasLineOfSight(r.x, r.y, ex, ey)) || this.scans.some(scan => scan.owner === viewer &&
        scan.until > this.time && dist(scan.x, scan.y, ex, ey) <= scan.radius);
      if (!seenBy) return false;
    }
    const d = UNIT_DEFS[entity.defId];
    if (!d?.stealth || entity.revealedUntil > this.time) return true;
    if (this.scans.some(scan => scan.owner === viewer && scan.until > this.time &&
      dist(scan.x, scan.y, entity.x, entity.y) <= scan.radius)) return true;
    return this.units.some(u => u.owner === viewer && !u.embarkedIn &&
      dist(u.x, u.y, entity.x, entity.y) < 2.5);
  }

  select(ids) {
    const owner = this.commandOwner || 'player';
    const list = Array.isArray(ids) ? ids : [ids];
    const selected = [];
    for (const id of list) {
      const e = this.getEntity(id);
      if (e?.owner === owner && !e.embarkedIn && !selected.includes(id)) selected.push(id);
    }
    this.selection = selected;
    for (const e of [...this.units, ...this.buildings]) e.selected = selected.includes(e.id);
    this._event('selection', { ids: [...selected] });
    return { ok: true, ids: [...selected] };
  }

  _validatePoint(x, y) {
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  _queueOrIssueUnitOrder(unit, nextOrder, queue) {
    const current = unit.order;
    if (queue && ['move', 'forceMove', 'attack'].includes(current?.type)) {
      current.queue = [...(Array.isArray(current.queue) ? current.queue : []), nextOrder];
      return;
    }
    unit.order = nextOrder;
    unit.path = [];
    unit._pathGoal = null;
  }

  _advanceQueuedOrder(unit, order) {
    if (!Array.isArray(order?.queue) || !order.queue.length) return false;
    const [next, ...remaining] = order.queue;
    unit.order = remaining.length ? { ...next, queue: remaining } : { ...next };
    unit.path = [];
    unit._pathGoal = null;
    unit._jamWaypoint = null;
    unit._jamSeconds = 0;
    return true;
  }

  _canQueueUnitOrders(units) {
    return units.every(unit => !['move', 'forceMove', 'attack'].includes(unit.order?.type) ||
      (unit.order?.queue?.length || 0) < MAX_QUEUED_ORDERS);
  }

  issueMove(x, y, attackMove = false, queue = false) {
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Destination is outside the map.' };
    if (queue && this.replayVersion != null && this.replayVersion < QUEUED_ORDERS_RULES_VERSION)
      return { ok: false, reason: 'Queued orders are unavailable in this replay.' };
    const units = this._selectedCommandUnits();
    if (!units.length) return { ok: false, reason: 'Select units first.' };
    if (queue && !this._canQueueUnitOrders(units))
      return { ok: false, reason: `A squad can queue at most ${MAX_QUEUED_ORDERS} orders.` };
    const tile = this._tile(Math.floor(x), Math.floor(y));
    const movers = units.filter(u => !(u.defId === 'harvester' && tile?.resource > 0 && !attackMove && !queue));
    const destinations = this._formationDestinations(movers, x, y);
    for (const u of units) {
      if (this.mode === 'campaign' && this.campaignMission === 1 && u.owner === 'player' && u.defId === 'mcv' &&
        !this.hasBuilding('player', 'command') && !this.hasBuilding('player', 'barracks') &&
        !u._campaignRecoveryUntil) {
        u._campaignRecoveryUntil = this.time + 70;
        this._event('campaignIntel', { message: 'Emergency command recovery authorized. The MCV has temporary protection while it reaches a deployment site.' });
      }
      if (u.defId === 'harvester') this._releaseHarvesterDock(u);
      if (u.defId === 'harvester' && tile?.resource > 0 && !attackMove && !queue) {
        u.order = { type: 'harvest', x: Math.floor(x), y: Math.floor(y) };
        u._harvestPhase = 'field';
        u._harvestTile = { x: Math.floor(x), y: Math.floor(y) };
      } else {
        const point = destinations.get(u.id) || { x, y };
        this._queueOrIssueUnitOrder(u, { type: 'move', ...point, attackMove: !!attackMove }, queue);
      }
      if (!queue) { u.path = []; u._pathGoal = null; }
    }
    this._event('order', { order: attackMove ? 'attackMove' : 'move', queued: !!queue,
      ids: units.map(u => u.id), x, y });
    return { ok: true };
  }

  issueForceMove(x, y, queue = false) {
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Destination is outside the map.' };
    if (queue && this.replayVersion != null && this.replayVersion < QUEUED_ORDERS_RULES_VERSION)
      return { ok: false, reason: 'Queued orders are unavailable in this replay.' };
    const units = this._selectedCommandUnits();
    if (!units.length) return { ok: false, reason: 'Select units first.' };
    if (queue && !this._canQueueUnitOrders(units))
      return { ok: false, reason: `A squad can queue at most ${MAX_QUEUED_ORDERS} orders.` };
    const destinations = this._formationDestinations(units, x, y);
    for (const u of units) {
      this._queueOrIssueUnitOrder(u, { type: 'forceMove', ...(destinations.get(u.id) || { x, y }) }, queue);
    }
    this._event('order', { order: 'forceMove', queued: !!queue, ids: units.map(u => u.id), x, y });
    return { ok: true };
  }

  _formationDestinations(units, x, y) {
    const result = new Map();
    if (units.length < 2) return result; // Preserve exact single-unit destinations.
    const centerX = units.reduce((sum, u) => sum + u.x, 0) / units.length;
    const centerY = units.reduce((sum, u) => sum + u.y, 0) / units.length;
    const extent = Math.max(1, ...units.map(u => dist(u.x, u.y, centerX, centerY)));
    const scale = Math.min(1, Math.max(1, Math.sqrt(units.length) * 0.85) / extent);
    const selected = new Set(units.map(u => u.id));
    const reserved = new Set();
    const components = units.some(u => !UNIT_DEFS[u.defId].flying) ? this._groundComponents() : null;
    const occupied = [new Map(), new Map()]; // ground, air; indexed by tile for local checks
    for (const other of this.units) {
      if (other.hp <= 0 || other.embarkedIn || selected.has(other.id)) continue;
      const bucket = occupied[UNIT_DEFS[other.defId].flying ? 1 : 0];
      const key = Math.floor(other.y) * this.width + Math.floor(other.x);
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push(other);
    }
    // Position and id give the same assignment regardless of selection order.
    const ordered = [...units].sort((a, b) => a.y - b.y || a.x - b.x ||
      Number(a.id.slice(1)) - Number(b.id.slice(1)));
    for (const u of ordered) {
      const flying = !!UNIT_DEFS[u.defId].flying;
      const preferredX = x + (u.x - centerX) * scale;
      const preferredY = y + (u.y - centerY) * scale;
      const start = Math.floor(u.y) * this.width + Math.floor(u.x);
      const component = flying ? -1 : components[start];
      let best = null;
      // Avoid stationary units first. If every reachable tile is occupied, use
      // the best passable slot and let normal unit separation handle it.
      for (const allowOccupied of [false, true]) {
        for (let ty = 0; ty < this.height; ty++) for (let tx = 0; tx < this.width; tx++) {
          const index = ty * this.width + tx;
          if (!flying && (component < 0 || components[index] !== component)) continue;
          const px = tx + 0.5, py = ty + 0.5;
          if (reserved.has(index)) continue;
          if (!allowOccupied) {
            let blocked = false;
            const bucket = occupied[flying ? 1 : 0];
            for (let yy = Math.max(0, ty - 1); yy <= Math.min(this.height - 1, ty + 1) && !blocked; yy++) {
              for (let xx = Math.max(0, tx - 1); xx <= Math.min(this.width - 1, tx + 1) && !blocked; xx++) {
                for (const other of bucket.get(yy * this.width + xx) || []) {
                  if (dist(px, py, other.x, other.y) <
                    UNIT_DEFS[other.defId].radius + UNIT_DEFS[u.defId].radius + 0.15) {
                    blocked = true; break;
                  }
                }
              }
            }
            if (blocked) continue;
          }
          const score = (px - preferredX) ** 2 + (py - preferredY) ** 2 +
            0.08 * ((px - x) ** 2 + (py - y) ** 2);
          if (!best || score < best.score) best = { x: px, y: py, score, index };
        }
        if (best) break;
      }
      if (best) { reserved.add(best.index); result.set(u.id, { x: best.x, y: best.y }); }
      else result.set(u.id, { x: u.x, y: u.y });
    }
    return result;
  }

  _groundComponents() {
    const size = this.width * this.height;
    const components = new Int32Array(size);
    components.fill(-1);
    const passable = new Uint8Array(size);
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++)
      passable[y * this.width + x] = this._isPassable(x, y) ? 1 : 0;
    const queue = new Int32Array(size);
    let nextComponent = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let start = 0; start < size; start++) {
      if (!passable[start] || components[start] >= 0) continue;
      let head = 0, tail = 0;
      queue[tail++] = start;
      components[start] = nextComponent;
      while (head < tail) {
        const index = queue[head++];
        const cx = index % this.width, cy = Math.floor(index / this.width);
        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (!this._inBounds(nx, ny)) continue;
          const neighbor = ny * this.width + nx;
          if (!passable[neighbor] || components[neighbor] >= 0) continue;
          if (dx && dy && (!passable[cy * this.width + nx] || !passable[ny * this.width + cx])) continue;
          components[neighbor] = nextComponent;
          queue[tail++] = neighbor;
        }
      }
      nextComponent++;
    }
    return components;
  }

  issueAttack(targetId, queue = false) {
    const owner = this.commandOwner || 'player';
    if (queue && this.replayVersion != null && this.replayVersion < QUEUED_ORDERS_RULES_VERSION)
      return { ok: false, reason: 'Queued orders are unavailable in this replay.' };
    const target = this.getEntity(targetId);
    if (!target || target.hp <= 0 || target.owner === owner) return { ok: false, reason: 'Choose a living enemy target.' };
    if (!this.isVisible(target, owner)) return { ok: false, reason: 'Target is outside current vision.' };
    const units = this._selectedCommandUnits().filter(u => this._weaponCanTarget(UNIT_DEFS[u.defId].weapon, target));
    if (!units.length) return { ok: false, reason: 'Selected units cannot attack.' };
    if (queue && !this._canQueueUnitOrders(units))
      return { ok: false, reason: `A squad can queue at most ${MAX_QUEUED_ORDERS} orders.` };
    for (const u of units) this._queueOrIssueUnitOrder(u, { type: 'attack', targetId }, queue);
    if (owner === 'player' && this.mode === 'campaign' &&
      this.campaignFieldOrderId?.endsWith('-intercept') &&
      this.campaignState?.fieldOrderStatus === 'active' &&
      targetId === this.campaignState.fieldOrderTargetId)
      this.campaignState.fieldOrderEngaged = true;
    this._event('order', { order: 'attack', queued: !!queue, ids: units.map(u => u.id), targetId });
    return { ok: true };
  }

  issueFollow(targetId) {
    const owner = this.commandOwner || 'player';
    const target = this.getEntity(targetId);
    if (!target || target.hp <= 0 || target.embarkedIn || target.owner !== owner)
      return { ok: false, reason: 'Choose a friendly target.' };
    const units = this._selectedCommandUnits();
    if (!units.length) return { ok: false, reason: 'Select units first.' };
    if (units.some(u => u.id === targetId))
      return { ok: false, reason: 'A unit cannot follow itself.' };
    for (const u of units) {
      u.order = { type: 'follow', targetId };
      u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'follow', ids: units.map(u => u.id), targetId });
    return { ok: true };
  }

  issueBoard(carrierId) {
    const owner = this.commandOwner || 'player';
    const carrier = this.getEntity(carrierId);
    const carrierDef = carrier && UNIT_DEFS[carrier.defId];
    if (!carrier || carrierDef?.role !== 'transport' || carrier.hp <= 0 || carrier.owner !== owner || carrier.embarkedIn)
      return { ok: false, reason: 'Choose a friendly carrier.' };
    const infantry = this._selectedCommandUnits().filter(u => UNIT_DEFS[u.defId].armor === 'infantry');
    if (!infantry.length) return { ok: false, reason: 'Select infantry to board.' };
    const reserved = this.units.filter(u => u.hp > 0 && !u.embarkedIn && u.order?.type === 'board' &&
      u.order.carrierId === carrierId && !infantry.includes(u)).length;
    if (carrier.passengerIds.length + reserved + infantry.length > carrierDef.capacity)
      return { ok: false, reason: 'Carrier has insufficient space.' };
    for (const u of infantry) { u.order = { type: 'board', carrierId }; u.path = []; u._pathGoal = null; }
    this._event('order', { order: 'board', ids: infantry.map(u => u.id), carrierId });
    return { ok: true };
  }

  issueUnload(x, y) {
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Destination is outside the map.' };
    if (!this._isPassable(Math.floor(x), Math.floor(y))) return { ok: false, reason: 'Destination must be passable ground.' };
    const carriers = this._selectedCommandUnits().filter(u => UNIT_DEFS[u.defId]?.role === 'transport' && u.passengerIds.length);
    if (!carriers.length) return { ok: false, reason: 'Select a loaded carrier.' };
    const destinations = this._formationDestinations(carriers, x, y);
    for (const u of carriers) {
      let destination = destinations.get(u.id) || { x, y };
      if (!this._isPassable(Math.floor(destination.x), Math.floor(destination.y))) {
        const tile = this._nearestPassable(Math.floor(destination.x), Math.floor(destination.y), Math.floor(u.x), Math.floor(u.y));
        if (tile) destination = { x: tile[0] + 0.5, y: tile[1] + 0.5 };
        else destination = { x, y };
      }
      u.order = { type: 'unload', ...destination };
      u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'unload', ids: carriers.map(u => u.id), x, y });
    return { ok: true };
  }

  issueForceFire(x, y) {
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Target is outside the map.' };
    const units = this._selectedCommandUnits().filter(u => {
      const weaponDef = UNIT_DEFS[u.defId].weapon;
      return weaponDef && weaponDef.target !== 'air';
    });
    if (!units.length) return { ok: false, reason: 'Select armed units that can attack ground.' };
    for (const u of units) {
      u.order = { type: 'forceFire', x, y };
      u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'forceFire', ids: units.map(u => u.id), x, y });
    return { ok: true };
  }

  issueHarvest() {
    const units = this._selectedCommandUnits().filter(u => u.defId === 'harvester');
    if (!units.length) return { ok: false, reason: 'Select a harvester.' };
    for (const u of units) {
      this._releaseHarvesterDock(u);
      u.order = { type: 'harvest' }; u._harvestPhase = 'field';
      u.path = []; u._pathGoal = null; u._harvestTile = null;
    }
    this._event('order', { order: 'harvest', ids: units.map(u => u.id) });
    return { ok: true };
  }

  issueBloomExpedition() {
    if (this.replayVersion != null && this.replayVersion < BLOOM_EXPEDITION_RULES_VERSION)
      return { ok: false, reason: `Bloom expeditions require replay version ${BLOOM_EXPEDITION_RULES_VERSION}.` };
    const bloom = this._stormglassBloomEnabled() ? this.storm?.bloom : null;
    if (!bloom || bloom.until <= this.time)
      return { ok: false, reason: 'There is no active Stormglass Bloom.' };
    const selected = this._selectedCommandUnits();
    const harvesters = selected.filter(unit => unit.defId === 'harvester' &&
      unit._harvestPhase !== 'return' &&
      unit.cargo < UNIT_DEFS.harvester.capacity);
    const escorts = selected.filter(unit => unit.defId !== 'harvester' && !UNIT_DEFS[unit.defId]?.flying &&
      UNIT_DEFS[unit.defId]?.weapon && UNIT_DEFS[unit.defId].weapon.target !== 'air');
    if (!harvesters.length) return { ok: false, reason: 'Select a harvesting Harvester.' };
    if (escorts.length < harvesters.length)
      return { ok: false, reason: 'Select at least one armed ground escort per Harvester.' };
    const owner = this.commandOwner || 'player';
    const refineries = this.buildings.filter(building => building.owner === owner && building.defId === 'refinery' &&
      building.hp > 0 && building.progress >= 1);
    if (!refineries.length) return { ok: false, reason: 'A completed Refinery is required for the expedition.' };

    const reservedTiles = new Set();
    const assignments = [];
    for (const harvester of harvesters) {
      const candidates = [];
      for (let y = Math.max(0, Math.floor(bloom.y - bloom.radius));
        y <= Math.min(this.height - 1, Math.ceil(bloom.y + bloom.radius)); y++) {
        for (let x = Math.max(0, Math.floor(bloom.x - bloom.radius));
          x <= Math.min(this.width - 1, Math.ceil(bloom.x + bloom.radius)); x++) {
          const tile = this._tile(x, y), key = `${x},${y}`;
          if (reservedTiles.has(key) || tile?.type !== 'crystal' || tile.resource < 180 || !tile.walkable ||
            dist(x + 0.5, y + 0.5, bloom.x, bloom.y) > bloom.radius) continue;
          const route = this._findPath(harvester.x, harvester.y, x + 0.5, y + 0.5);
          if (!route.length) continue;
          const routeDistance = route.reduce((total, point, index) => total +
            (index ? dist(route[index - 1].x, route[index - 1].y, point.x, point.y) :
              dist(harvester.x, harvester.y, point.x, point.y)), 0);
          const hasDockRoute = refineries.some(refinery => {
            for (let dockY = refinery.y - 1; dockY <= refinery.y + refinery.h; dockY++)
              for (let dockX = refinery.x - 1; dockX <= refinery.x + refinery.w; dockX++) {
                if (dockX >= refinery.x && dockX < refinery.x + refinery.w &&
                    dockY >= refinery.y && dockY < refinery.y + refinery.h) continue;
                if (!this._isPassable(dockX, dockY) || this._distanceToEntity(dockX + 0.5,
                  dockY + 0.5, refinery) > 0.95) continue;
                if (this._findPath(x + 0.5, y + 0.5, dockX + 0.5, dockY + 0.5).length) return true;
              }
            return false;
          });
          if (!hasDockRoute) continue;
          const eta = routeDistance / UNIT_DEFS.harvester.speed;
          if (eta + Math.min(UNIT_DEFS.harvester.capacity - harvester.cargo, tile.resource) / 112 + 4 >
            bloom.until - this.time) continue;
          candidates.push({ x, y, resource: tile.resource, routeDistance });
        }
      }
      candidates.sort((a, b) => a.routeDistance - b.routeDistance || b.resource - a.resource ||
        a.y - b.y || a.x - b.x);
      if (!candidates.length) return { ok: false, reason: 'No reachable Bloom crystal can be harvested before it fades.' };
      const tile = candidates[0];
      reservedTiles.add(`${tile.x},${tile.y}`);
      assignments.push({ harvester, tile });
    }

    const remainingEscorts = [...escorts];
    const escortAssignments = assignments.map(({ harvester }) => {
      remainingEscorts.sort((a, b) => dist(a.x, a.y, harvester.x, harvester.y) -
        dist(b.x, b.y, harvester.x, harvester.y) || a.id.localeCompare(b.id));
      return { harvester, escorts: [remainingEscorts.shift()] };
    });
    for (const escort of remainingEscorts) {
      const assignment = escortAssignments.map(item => ({ item,
        distance: dist(escort.x, escort.y, item.harvester.x, item.harvester.y) }))
        .sort((a, b) => a.distance - b.distance || a.item.harvester.id.localeCompare(b.item.harvester.id))[0];
      assignment.item.escorts.push(escort);
    }

    for (const { harvester, tile } of assignments) {
      this._releaseHarvesterDock(harvester);
      harvester._harvestTile = { x: tile.x, y: tile.y };
      harvester._harvestPhase = 'field';
      harvester.order = { type: 'harvest', x: tile.x, y: tile.y, bloomExpedition: true };
      harvester.path = []; harvester._pathGoal = null;
    }
    for (const { harvester, escorts: assigned } of escortAssignments) for (const escort of assigned) {
      escort.order = { type: 'follow', targetId: harvester.id, bloomExpeditionEscort: true,
        resumeOrder: escort.order ? { ...escort.order } : { type: 'idle' },
        resumePath: Array.isArray(escort.path) ? escort.path.map(point => ({ ...point })) : [],
        resumePathGoal: escort._pathGoal ? { ...escort._pathGoal } : null };
      escort.path = []; escort._pathGoal = null;
    }
    const result = { ok: true, harvesterIds: assignments.map(item => item.harvester.id),
      escortIds: escortAssignments.flatMap(item => item.escorts.map(escort => escort.id)),
      tiles: assignments.map(item => ({ x: item.tile.x, y: item.tile.y })) };
    this._event('order', { order: 'bloomExpedition', ...result });
    return result;
  }

  _restoreBloomEscort(escort) {
    const order = escort.order;
    if (!order?.bloomExpeditionEscort) return;
    escort.order = order.resumeOrder && typeof order.resumeOrder === 'object'
      ? { ...order.resumeOrder } : { type: 'idle' };
    escort.path = Array.isArray(order.resumePath) ? order.resumePath.map(point => ({ ...point })) : [];
    escort._pathGoal = order.resumePathGoal ? { ...order.resumePathGoal } : null;
  }

  _cancelBloomExpedition(harvester) {
    if (!harvester.order?.bloomExpedition) return;
    const loaded = harvester.cargo > 0;
    harvester.order = { type: 'harvest' };
    harvester._harvestTile = null;
    harvester._harvestPhase = loaded ? 'return' : 'field';
    harvester.path = []; harvester._pathGoal = null;
    for (const escort of this.units) if (escort.order?.bloomExpeditionEscort &&
      escort.order.targetId === harvester.id) this._restoreBloomEscort(escort);
  }

  _updateBloomExpeditions() {
    for (const harvester of this.units) {
      if (!harvester.order?.bloomExpedition) continue;
      const tile = Number.isInteger(harvester.order.x) && Number.isInteger(harvester.order.y)
        ? this._tile(harvester.order.x, harvester.order.y) : null;
      const bloom = this._stormglassBloomEnabled() ? this.storm?.bloom : null;
      if (harvester.hp <= 0 || !bloom || bloom.until <= this.time || !tile || tile.type !== 'crystal' ||
        tile.resource <= 0 || dist(harvester.order.x + 0.5, harvester.order.y + 0.5,
          bloom.x, bloom.y) > bloom.radius) this._cancelBloomExpedition(harvester);
    }
    for (const escort of this.units) if (escort.order?.bloomExpeditionEscort) {
      const harvester = this.getEntity(escort.order.targetId);
      if (!harvester || harvester.hp <= 0 || !harvester.order?.bloomExpedition)
        this._restoreBloomEscort(escort);
    }
  }

  issueReturnCargo() {
    const owner = this.commandOwner || 'player';
    if (!this.hasBuilding(owner, 'refinery'))
      return { ok: false, reason: 'A completed refinery is required.' };
    const units = this._selectedCommandUnits().filter(u => u.defId === 'harvester' && u.cargo > 0);
    if (!units.length) return { ok: false, reason: 'Select a loaded harvester.' };
    for (const u of units) {
      u.order = { type: 'harvest' };
      u._harvestPhase = 'return';
      u._harvestTile = null;
      u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'returnCargo', ids: units.map(u => u.id) });
    return { ok: true };
  }

  issueStop() {
    const units = this._selectedCommandUnits();
    if (!units.length) return { ok: false, reason: 'Select units first.' };
    for (const u of units) {
      if (u.defId === 'harvester') this._releaseHarvesterDock(u);
      u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'stop', ids: units.map(u => u.id) });
    return { ok: true };
  }

  issueSetStance(stance) {
    if (!['aggressive', 'defensive', 'holdFire'].includes(stance))
      return { ok: false, reason: 'Choose aggressive, defensive, or holdFire stance.' };
    const units = this._selectedCommandUnits().filter(u => UNIT_DEFS[u.defId].weapon);
    if (!units.length) return { ok: false, reason: 'Select armed units first.' };
    for (const u of units) {
      u.stance = stance;
      u._stanceChase = null;
    }
    this._event('order', { order: 'setStance', ids: units.map(u => u.id), stance });
    return { ok: true };
  }

  issuePromoteUnit(unitId, promotionId) {
    if (this.replayVersion != null && this.replayVersion < UNIT_PROMOTION_RULES_VERSION)
      return { ok: false, reason: 'Unit promotions are unavailable in this replay.' };
    const owner = this.commandOwner || 'player';
    const unit = this.units.find(candidate => candidate.id === unitId);
    if (!unit || unit.owner !== owner)
      return { ok: false, reason: 'Choose one of your own units.' };
    if (!isUnitPromotionEligible(unit))
      return { ok: false, reason: 'Only living Elite armed ground units can be promoted.' };
    if (unit.promotion)
      return { ok: false, reason: 'This unit already has a promotion.' };
    if (!Object.hasOwn(UNIT_PROMOTION_DEFS, promotionId))
      return { ok: false, reason: 'Choose Bulwark or Rangefinder.' };
    unit.promotion = promotionId;
    this._event('unitPromoted', { id: unit.id, owner, promotion: promotionId,
      message: `${UNIT_DEFS[unit.defId].name} promoted to ${UNIT_PROMOTION_DEFS[promotionId].name}.` });
    return { ok: true, promotionId };
  }

  _selectedCommandUnits() {
    const owner = this.commandOwner || 'player';
    return this.selectedUnits.filter(u => u.owner === owner && u.hp > 0);
  }

  issueGuard() {
    const units = this._selectedCommandUnits();
    if (!units.length) return { ok: false, reason: 'Select units first.' };
    for (const u of units) {
      u.order = { type: 'guard', x: u.x, y: u.y };
      u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'guard', ids: units.map(u => u.id) });
    return { ok: true };
  }

  issuePatrol(x, y) {
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Destination is outside the map.' };
    const units = this._selectedCommandUnits();
    if (!units.length) return { ok: false, reason: 'Select units first.' };
    const destinations = units.map(u => {
      if (UNIT_DEFS[u.defId].flying) return { x, y };
      const tile = this._nearestPassable(Math.floor(x), Math.floor(y), Math.floor(u.x), Math.floor(u.y));
      if (!tile) return null;
      const path = this._findPath(u.x, u.y, tile[0] + 0.5, tile[1] + 0.5);
      return path.length ? { x: tile[0] + 0.5, y: tile[1] + 0.5 } : null;
    });
    if (destinations.some(p => !p)) return { ok: false, reason: 'No path to patrol destination.' };
    for (const [i, u] of units.entries()) {
      u.order = { type: 'patrol', ax: u.x, ay: u.y, bx: destinations[i].x, by: destinations[i].y, leg: 1 };
      u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'patrol', ids: units.map(u => u.id), x, y });
    return { ok: true };
  }

  issueScatter() {
    const units = this._selectedCommandUnits();
    if (!units.length) return { ok: false, reason: 'Select units first.' };
    const owner = this.commandOwner || 'player';
    const center = units.reduce((p, u) => ({ x: p.x + u.x / units.length, y: p.y + u.y / units.length }), { x: 0, y: 0 });
    const assigned = [];
    const orders = units.map((u, index) => {
      const threats = [...this.units, ...this.buildings].filter(e => e.owner !== owner && e.hp > 0 &&
        this.isVisible(e, owner) && dist(u.x, u.y, this._entityCenter(e).x, this._entityCenter(e).y) <= 9);
      let awayX = 0, awayY = 0;
      for (const threat of threats) {
        const p = this._entityCenter(threat);
        const dx = u.x - p.x, dy = u.y - p.y;
        const weight = 1 / Math.max(1, dx * dx + dy * dy);
        awayX += dx * weight; awayY += dy * weight;
      }
      if (!threats.length) { awayX = u.x - center.x; awayY = u.y - center.y; }
      if (Math.hypot(awayX, awayY) < 0.01) {
        const angle = index * 2.399963;
        awayX = Math.cos(angle); awayY = Math.sin(angle);
      }
      const heading = Math.atan2(awayY, awayX);
      const candidates = [];
      for (const radius of [3, 4.5, 6]) for (let step = -4; step <= 4; step++) {
        const angle = heading + step * Math.PI / 8;
        const cx = clamp(u.x + Math.cos(angle) * radius, 0.5, this.width - 0.5);
        const cy = clamp(u.y + Math.sin(angle) * radius, 0.5, this.height - 0.5);
        if (!UNIT_DEFS[u.defId].flying && !this._isPassable(Math.floor(cx), Math.floor(cy))) continue;
        const separation = assigned.length ? Math.min(...assigned.map(p => dist(cx, cy, p.x, p.y))) : 6;
        const threatDistance = threats.length ? Math.min(...threats.map(e => {
          const p = this._entityCenter(e); return dist(cx, cy, p.x, p.y);
        })) : 0;
        const score = Math.cos(angle - heading) * 4 + Math.min(separation, 5) * 1.2 +
          Math.min(threatDistance, 12) * 0.8 - Math.abs(radius - 4.5) * 0.3;
        candidates.push({ x: cx, y: cy, score });
      }
      candidates.sort((a, b) => b.score - a.score);
      const destination = candidates.find(p => {
        if (UNIT_DEFS[u.defId].flying) return true;
        const path = this._findPath(u.x, u.y, p.x, p.y);
        if (!path.length) return false;
        let length = 0, previous = u;
        for (const waypoint of path) {
          length += dist(previous.x, previous.y, waypoint.x, waypoint.y);
          previous = waypoint;
        }
        return length <= dist(u.x, u.y, p.x, p.y) * 1.8 + 2;
      });
      if (destination) assigned.push(destination);
      return destination ? { type: 'scatter', x: destination.x, y: destination.y } : null;
    });
    if (!assigned.length) return { ok: false, reason: 'No safe scatter destination.' };
    for (const [i, u] of units.entries()) if (orders[i]) {
      u.order = orders[i]; u.path = []; u._pathGoal = null;
    }
    this._event('order', { order: 'scatter', ids: units.filter((_, i) => orders[i]).map(u => u.id) });
    return { ok: true };
  }

  canDeployMCV(unitId = null) {
    const u = unitId ? this.getEntity(unitId) : this.selectedUnits.find(unit => unit.defId === 'mcv');
    if (!u || u.defId !== 'mcv' || u.owner !== (this.commandOwner || 'player')) return { ok: false, reason: 'Select a Mobile Command Rig.' };
    return this._canDeployMCV(u);
  }

  _canDeployMCV(u) {
    const x = Math.floor(u.x) - 1, y = Math.floor(u.y) - 1;
    if (!this._inBounds(x, y) || !this._inBounds(x + 2, y + 2)) return { ok: false, reason: 'Too close to the map edge.' };
    for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) {
      if (!this.terrain[yy][xx].buildable) return { ok: false, reason: 'Clear terrain is required to deploy.' };
    }
    for (const b of this.buildings) if (b.hp > 0 && x < b.x + b.w && x + 3 > b.x && y < b.y + b.h && y + 3 > b.y)
      return { ok: false, reason: 'Another structure blocks deployment.' };
    for (const other of this.units) if (other.id !== u.id && other.hp > 0 && other.x >= x - 0.2 &&
      other.x <= x + 3.2 && other.y >= y - 0.2 && other.y <= y + 3.2)
      return { ok: false, reason: 'Move nearby units away first.' };
    return { ok: true, x, y, unit: u };
  }

  _deployMCV(unit, owner) {
    const check = this._canDeployMCV(unit);
    if (!check.ok) return check;
    const { x, y } = check;
    this.units = this.units.filter(u => u.id !== unit.id);
    const b = this._createBuilding(owner, 'command', x, y, 1);
    b.hp = Math.max(b.maxHp * 0.55, b.maxHp * unit.hp / unit.maxHp);
    if (owner === 'player' && this.mode === 'campaign' && this.campaignMission === 1 && unit._campaignRecoveryUntil &&
      !this.hasBuilding('player', 'barracks')) {
      b._campaignEmergencyPower = 180;
      b._campaignRecoveryUntil = this.time + 35;
      this._event('campaignIntel', { message: 'Emergency generator online. The rebuilt command yard has backup power and protection for 35 seconds.' });
    }
    this._refreshPower();
    if (owner === (this.commandOwner || 'player')) this.select([b.id]);
    this._event('mcvDeployed', { id: b.id, fromId: unit.id, owner, x, y, message: 'Mobile Command Rig deployed.' });
    return { ok: true, id: b.id };
  }

  issueDeploy(unitId = null) {
    const unit = unitId ? this.getEntity(unitId) : this.selectedUnits.find(candidate => candidate.defId === 'mcv');
    if (!unit || unit.defId !== 'mcv' || unit.owner !== (this.commandOwner || 'player'))
      return { ok: false, reason: 'Select a Mobile Command Rig.' };
    return this._deployMCV(unit, this.commandOwner || 'player');
  }

  hasBuilding(owner, defId) {
    return this.buildings.some(b => b.owner === owner && b.defId === defId && b.hp > 0 && b.progress >= 1);
  }

  chooseDoctrine(id) {
    const owner = this.commandOwner || 'player';
    const doctrine = DOCTRINE_DEFS[id];
    if (!doctrine) return { ok: false, reason: 'Unknown doctrine.' };
    if (!this.research?.[owner]) return { ok: false, reason: 'Invalid research owner.' };
    const state = this.research[owner];
    const replacing = !!state.doctrine;
    if (replacing && !['skirmish', 'multiplayer'].includes(this.mode))
      return { ok: false, reason: 'Doctrine replacement is available only in skirmish and multiplayer.' };
    if (replacing && this.replayVersion != null && this.replayVersion < DOCTRINE_REPLACEMENT_RULES_VERSION)
      return { ok: false, reason: `Doctrine replacement requires replay version ${DOCTRINE_REPLACEMENT_RULES_VERSION}.` };
    if (state.project) return { ok: false, reason: 'A doctrine is already researching.' };
    if (replacing && state.replacementUsed) return { ok: false, reason: 'The one doctrine replacement has already been used.' };
    if (replacing && state.doctrine === id) return { ok: false, reason: 'Choose a different doctrine to replace the active one.' };
    const center = this.buildings.some(b => b.owner === owner && b.defId === 'tech' && b.hp > 0 && b.progress >= 1 && b.powered);
    if (!center) return { ok: false, reason: 'A completed powered Research Center is required.' };
    const cost = replacing ? DOCTRINE_REPLACEMENT_COST : doctrine.cost;
    if (this.credits[owner] < cost) return { ok: false, reason: 'Insufficient credits.' };
    this.credits[owner] -= cost;
    state.project = { id, progress: 0 };
    if (replacing) state.replacementUsed = true;
    this._event('doctrineResearch', { owner, id, progress: 0 });
    return { ok: true };
  }

  chooseTacticalPackage(id) {
    const owner = this.commandOwner || 'player';
    const packageDef = TACTICAL_PACKAGE_DEFS[id];
    if (!packageDef) return { ok: false, reason: 'Unknown tactical package.' };
    if (this.replayVersion != null && this.replayVersion < 31)
      return { ok: false, reason: 'Tactical packages are unavailable in this replay.' };
    const state = this.research?.[owner];
    if (!state || !state.doctrine) return { ok: false, reason: 'Complete a doctrine first.' };
    if (state.tactical || state.tacticalProject) return { ok: false, reason: 'A tactical package is already chosen or researching.' };
    const center = this.buildings.some(b => b.owner === owner && b.defId === 'tech' && b.hp > 0 && b.progress >= 1 && b.powered);
    if (!center) return { ok: false, reason: 'A completed powered Research Center is required.' };
    if (this.credits[owner] < packageDef.cost) return { ok: false, reason: 'Insufficient credits.' };
    this.credits[owner] -= packageDef.cost;
    state.tacticalProject = { id, progress: 0 };
    this._event('tacticalPackageResearch', { owner, id, progress: 0 });
    return { ok: true };
  }

  _updateResearch(dt) {
    for (const owner of ['player', 'enemy']) {
      const state = this.research[owner];
      if (!state) continue;
      if (!state.project && !state.tacticalProject) continue;
      const center = this.buildings.some(b => b.owner === owner && b.defId === 'tech' && b.hp > 0 && b.progress >= 1 && b.powered);
      if (!center) continue;
      if (state.project) {
        const doctrine = DOCTRINE_DEFS[state.project.id];
        if (!doctrine) state.project = null;
        else {
          const researchTime = state.doctrine ? DOCTRINE_REPLACEMENT_TIME : doctrine.researchTime;
          state.project.progress = Math.min(1, state.project.progress + dt / researchTime);
          if (state.project.progress >= 1) {
            state.doctrine = state.project.id;
            state.project = null;
            this._event('doctrineReady', { owner, id: state.doctrine });
          }
        }
      }
      if (!state.tacticalProject) continue;
      const tactical = TACTICAL_PACKAGE_DEFS[state.tacticalProject.id];
      if (!tactical) { state.tacticalProject = null; continue; }
      state.tacticalProject.progress = Math.min(1, state.tacticalProject.progress + dt / tactical.researchTime);
      if (state.tacticalProject.progress >= 1) {
        state.tactical = state.tacticalProject.id;
        state.tacticalProject = null;
        this._event('tacticalPackageReady', { owner, id: state.tactical });
      }
    }
  }

  canBuild(defId, owner = 'player') {
    const d = BUILDING_DEFS[defId];
    if (!d || defId === 'command') return { ok: false, reason: 'Unknown or unavailable structure.' };
    if (d.faction && d.faction !== ownerFaction(this, owner)) return { ok: false, reason: 'Structure is unavailable to this faction.' };
    if (!this.hasBuilding(owner, 'command')) return { ok: false, reason: 'A construction yard is required.' };
    for (const req of d.requires || []) if (!this.hasBuilding(owner, req))
      return { ok: false, reason: `Requires ${BUILDING_DEFS[req]?.name || req}.` };
    if (this.credits[owner] < d.cost) return { ok: false, reason: 'Insufficient credits.' };
    return { ok: true };
  }

  _tileVisibleToOwner(owner, x, y) {
    const tx = x + 0.5, ty = y + 0.5;
    const canSee = entity => {
      if (entity.owner !== owner || entity.hp <= 0 || entity.embarkedIn ||
        (entity.w && entity.progress < 1)) return false;
      const center = this._entityCenter(entity);
      const sight = this._stormSight(center.x, center.y,
        UNIT_DEFS[entity.defId]?.sight || BUILDING_DEFS[entity.defId]?.sight || 5);
      return dist(center.x, center.y, tx, ty) <= sight &&
        this._hasLineOfSight(center.x, center.y, tx, ty);
    };
    return this.units.some(canSee) || this.buildings.some(canSee) ||
      this.relays.some(relay => relay.owner === owner &&
        dist(relay.x, relay.y, tx, ty) <= this._stormSight(relay.x, relay.y, 6) &&
        this._hasLineOfSight(relay.x, relay.y, tx, ty)) ||
      this.scans.some(scan => scan.owner === owner && scan.until > this.time &&
        dist(scan.x, scan.y, tx, ty) <= scan.radius);
  }

  canPlaceBuilding(defId, x, y, owner = 'player') {
    const d = BUILDING_DEFS[defId];
    x = Math.floor(x); y = Math.floor(y);
    if (!d || !this._inBounds(x, y) || !this._inBounds(x + d.w - 1, y + d.h - 1))
      return { ok: false, reason: 'Outside the map.' };
    for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
      if (!this.terrain[yy][xx].buildable) return { ok: false, reason: 'Terrain cannot support a structure.' };
      const visible = this.mode === 'multiplayer' ? this._tileVisibleToOwner(owner, xx, yy) :
        owner !== 'player' || this.fog[yy][xx] === 2;
      if (!visible) return { ok: false, reason: 'Reveal the area before building.' };
    }
    for (const b of this.buildings) {
      if (b.hp <= 0) continue;
      if (x < b.x + b.w && x + d.w > b.x && y < b.y + b.h && y + d.h > b.y)
        return { ok: false, reason: 'Footprint is occupied.' };
    }
    for (const u of this.units) {
      if (u.hp > 0 && u.x >= x - 0.3 && u.x <= x + d.w + 0.3 && u.y >= y - 0.3 && u.y <= y + d.h + 0.3)
        return { ok: false, reason: 'Move units away from the build site.' };
    }
    let connected = false;
    for (const b of this.buildings) {
      if (b.owner !== owner || b.progress < 1 || b.hp <= 0) continue;
      const dx = Math.max(0, b.x - (x + d.w), x - (b.x + b.w));
      const dy = Math.max(0, b.y - (y + d.h), y - (b.y + b.h));
      if (Math.hypot(dx, dy) <= 4.5) { connected = true; break; }
    }
    if (!connected) return { ok: false, reason: 'Place within your base perimeter.' };
    return { ok: true };
  }

  startConstruction(defId) {
    const owner = this.commandOwner || 'player';
    const key = owner === 'player' ? 'construction' : 'enemyConstruction';
    if (this.status !== 'playing') return { ok: false, reason: 'The battle is over.' };
    if (this[key]) return { ok: false, reason: 'Another structure is already in production.' };
    const check = this.canBuild(defId, owner);
    if (!check.ok) return check;
    const d = BUILDING_DEFS[defId];
    this.credits[owner] -= d.cost;
    this[key] = { defId, progress: 0, ready: false, cost: d.cost };
    this._event('constructionStarted', { defId });
    return { ok: true };
  }

  cancelConstruction() {
    const owner = this.commandOwner || 'player';
    const key = owner === 'player' ? 'construction' : 'enemyConstruction';
    if (!this[key]) return { ok: false, reason: 'Nothing is being built.' };
    const { defId, cost, progress } = this[key];
    this.credits[owner] = Math.min(this.creditCapacity[owner], this.credits[owner] + Math.round(cost * (1 - progress * 0.3)));
    this[key] = null;
    this._event('constructionCancelled', { defId });
    return { ok: true };
  }

  issueBuild(defId, x, y) {
    const owner = this.commandOwner || 'player';
    const key = owner === 'player' ? 'construction' : 'enemyConstruction';
    const construction = this[key];
    if (this.status !== 'playing') return { ok: false, reason: 'The battle is over.' };
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Outside the map.' };
    if (construction && construction.defId !== defId)
      return { ok: false, reason: 'Finish or cancel the current structure first.' };
    if (construction && !construction.ready)
      return { ok: false, reason: 'Structure is still under construction.' };
    const placement = this.canPlaceBuilding(defId, x, y, owner);
    if (!placement.ok) return placement;
    if (construction) {
      const b = this._createBuilding(owner, defId, x, y, 1);
      this[key] = null;
      this._onBuildingComplete(b);
      return { ok: true, id: b.id };
    }
    const check = this.canBuild(defId, owner);
    if (!check.ok) return check;
    this.credits[owner] -= BUILDING_DEFS[defId].cost;
    const b = this._createBuilding(owner, defId, x, y, 0);
    this._event('constructionStarted', { defId, id: b.id, x: b.x, y: b.y });
    return { ok: true, id: b.id };
  }

  canQueueUnit(defId, owner = 'player') {
    const d = UNIT_DEFS[defId];
    if (!d || (d.faction !== 'all' && d.faction !== ownerFaction(this, owner)))
      return { ok: false, reason: 'Unit is unavailable to this faction.' };
    for (const req of d.requires || []) if (!this.hasBuilding(owner, req))
      return { ok: false, reason: `Requires ${BUILDING_DEFS[req]?.name || req}.` };
    const producers = this.buildings.filter(b => b.owner === owner && b.defId === d.producer && b.progress >= 1 && b.hp > 0 &&
      (defId !== 'dropship' || b.powered));
    if (!producers.length) return { ok: false, reason: `Requires ${BUILDING_DEFS[d.producer]?.name || d.producer}.` };
    if (this.credits[owner] < d.cost) return { ok: false, reason: 'Insufficient credits.' };
    return { ok: true, producers };
  }

  _queueUnit(owner, defId) {
    const check = this.canQueueUnit(defId, owner);
    if (!check.ok) return check;
    const producer = [...check.producers].sort((a, b) => a.queue.length - b.queue.length)[0];
    if (producer.queue.length >= 5) return { ok: false, reason: 'Production queue is full.' };
    this.credits[owner] -= UNIT_DEFS[defId].cost;
    producer.queue.push({ defId, progress: 0 });
    this._event('unitQueued', { owner, buildingId: producer.id, defId });
    return { ok: true, buildingId: producer.id };
  }

  queueUnit(defId) { return this._queueUnit(this.commandOwner || 'player', defId); }

  cancelQueuedUnit(buildingId, index = -1) {
    const owner = this.commandOwner || 'player';
    const b = this.getEntity(buildingId);
    if (!b || b.owner !== owner || !b.queue) return { ok: false, reason: 'Select a production building.' };
    if (index < 0) index = b.queue.length - 1;
    if (index >= b.queue.length || index < 0) return { ok: false, reason: 'No unit at that queue position.' };
    const [item] = b.queue.splice(index, 1);
    const refund = Math.round(UNIT_DEFS[item.defId].cost * (index === 0 ? 1 - item.progress * 0.35 : 1));
    this.credits[owner] = Math.min(this.creditCapacity[owner], this.credits[owner] + refund);
    this._event('unitCancelled', { buildingId, defId: item.defId });
    return { ok: true };
  }

  setRally(buildingId, x, y) {
    const b = this.getEntity(buildingId);
    if (!b || b.owner !== (this.commandOwner || 'player') || !['barracks', 'factory', 'helipad'].includes(b.defId))
      return { ok: false, reason: 'Choose a production building.' };
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Rally point is outside the map.' };
    b.rally = { x, y };
    this._event('rally', { buildingId, x, y });
    return { ok: true };
  }

  toggleRepair(buildingId) {
    const b = this.getEntity(buildingId);
    if (!b || b.owner !== (this.commandOwner || 'player')) return { ok: false, reason: 'Choose a friendly structure.' };
    b.repairing = !b.repairing;
    this._event('repair', { buildingId, active: b.repairing });
    return { ok: true, active: b.repairing };
  }

  useSuperweapon(x, y) {
    const owner = this.commandOwner || 'player';
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Target is outside the map.' };
    const nuke = this.hasBuilding(owner, 'warhead');
    if (!this.hasBuilding(owner, 'superweapon') && !nuke) return { ok: false, reason: 'Build a strategic weapon first.' };
    if (this.superweapon[owner] < 1) return { ok: false, reason: 'Ion strike is still charging.' };
    if (this.mode === 'multiplayer' ? !this._tileVisibleToOwner(owner, Math.floor(x), Math.floor(y)) :
      owner === 'player' ? this.fog[Math.floor(y)][Math.floor(x)] !== 2 :
        ![...this.units, ...this.buildings].some(e => e.owner === owner && dist(e.x, e.y, x, y) < (UNIT_DEFS[e.defId]?.sight || BUILDING_DEFS[e.defId]?.sight || 5)))
      return { ok: false, reason: 'Target must be visible.' };
    this.superweapon[owner] = 0;
    this._strike(owner, x, y, nuke);
    return { ok: true };
  }

  canUseCommandAbility(abilityId, x, y, owner = 'player') {
    const ability = COMMAND_ABILITIES[abilityId];
    if (this.status !== 'playing') return { ok: false, reason: 'The battle is over.' };
    if (!ability) return { ok: false, reason: 'Unknown command ability.' };
    if (owner !== 'player' && owner !== 'enemy') return { ok: false, reason: 'Invalid command owner.' };
    if (!this._validatePoint(x, y)) return { ok: false, reason: 'Target is outside the map.' };
    if (this.commandEnergy[owner] < ability.cost) return { ok: false, reason: 'Insufficient command energy.' };
    if (this.commandCooldowns[owner][abilityId] > 0) return { ok: false, reason: 'Command ability is cooling down.' };
    if (ability.package && this.research?.[owner]?.tactical !== ability.package)
      return { ok: false, reason: 'Research the matching tactical package first.' };
    if (abilityId === 'overcharge' && ![...this.units, ...this.buildings].some(e =>
      e.owner === owner && e.hp > 0 && (UNIT_DEFS[e.defId]?.weapon || e.queue?.length || BUILDING_DEFS[e.defId]?.weapon) &&
      dist(this._entityCenter(e).x, this._entityCenter(e).y, x, y) <= ability.radius))
      return { ok: false, reason: 'Target friendly combat units or production.' };
    if (abilityId === 'shield' && !this.units.some(u => u.owner === owner && u.hp > 0 &&
      dist(u.x, u.y, x, y) <= ability.radius))
      return { ok: false, reason: 'Target friendly units.' };
    if (abilityId === 'stormcall') {
      if (this.storm.phase !== 'warning' && this.storm.phase !== 'surge')
        return { ok: false, reason: 'Stormcall requires a storm warning or surge.' };
      if (!this.relays.some(relay => relay.owner === owner &&
        dist(relay.x, relay.y, x, y) <= ability.radius))
        return { ok: false, reason: 'Target within range of a controlled relay.' };
      if (!this.relays.some(relay => relay.owner === owner && !this._relayIsContested(relay) &&
        dist(relay.x, relay.y, x, y) <= ability.radius))
        return { ok: false, reason: 'Stormcall requires an uncontested relay.' };
      const visible = owner === 'player' ? this.fog[Math.floor(y)][Math.floor(x)] === 2 :
        [...this.units, ...this.buildings].some(e => {
          if (e.owner !== owner || e.hp <= 0 || e.embarkedIn || (e.w && e.progress < 1)) return false;
          const center = this._entityCenter(e);
          const sight = this._stormSight(center.x, center.y,
            UNIT_DEFS[e.defId]?.sight || BUILDING_DEFS[e.defId]?.sight || 5);
          return dist(center.x, center.y, x, y) <= sight &&
            this._hasLineOfSight(center.x, center.y, x, y);
        }) || this.relays.some(relay => relay.owner === owner &&
          dist(relay.x, relay.y, x, y) <= this._stormSight(relay.x, relay.y, 6) &&
          this._hasLineOfSight(relay.x, relay.y, x, y)) ||
        this.scans.some(scan => scan.owner === owner && scan.until > this.time &&
          dist(scan.x, scan.y, x, y) <= scan.radius);
      if (!visible) return { ok: false, reason: 'Target must be visible.' };
    }
    if (['breach', 'interdict', 'rally'].includes(abilityId) && !this._pointVisibleToOwner(owner, x, y))
      return { ok: false, reason: 'Target must be visible.' };
    if (abilityId === 'interdict' && !this.units.some(u => u.owner !== owner && u.hp > 0 && !u.embarkedIn &&
      UNIT_DEFS[u.defId]?.weapon && this.isVisible(u, owner) && dist(u.x, u.y, x, y) <= ability.radius))
      return { ok: false, reason: 'Target visible enemy mobile weapons.' };
    if (abilityId === 'rally' && !this.units.some(u => u.owner === owner && u.hp > 0 && !u.embarkedIn &&
      !UNIT_DEFS[u.defId]?.flying && UNIT_DEFS[u.defId]?.weapon && dist(u.x, u.y, x, y) <= ability.radius))
      return { ok: false, reason: 'Target nearby friendly armed ground units.' };
    return { ok: true };
  }

  _pointVisibleToOwner(owner, x, y) {
    const tileX = Math.floor(x), tileY = Math.floor(y);
    if (this.mode === 'multiplayer') return this._tileVisibleToOwner(owner, tileX, tileY);
    if (owner === 'player') return this.fog[tileY]?.[tileX] === 2;
    return this.isVisible({ x, y, owner: 'player' }, 'enemy');
  }

  _useCommandAbility(owner, abilityId, x, y) {
    const check = this.canUseCommandAbility(abilityId, x, y, owner);
    if (!check.ok) return check;
    const ability = COMMAND_ABILITIES[abilityId];
    this.commandEnergy[owner] -= ability.cost;
    this.commandCooldowns[owner][abilityId] = ability.cooldown;
    if (abilityId === 'scan') {
      this.scans.push({ owner, x, y, radius: ability.radius, until: this.time + 11 });
      for (const u of this.units) if (u.owner !== owner && dist(u.x, u.y, x, y) <= ability.radius)
        u.revealedUntil = Math.max(u.revealedUntil || 0, this.time + 11);
      if (owner === 'player') this._updateFog();
    } else if (abilityId === 'overcharge') {
      for (const e of [...this.units, ...this.buildings]) if (e.owner === owner && e.hp > 0 &&
        dist(this._entityCenter(e).x, this._entityCenter(e).y, x, y) <= ability.radius)
        e.overchargedUntil = Math.max(e.overchargedUntil || 0, this.time + 13);
    } else if (abilityId === 'shield') {
      for (const u of this.units) if (u.owner === owner && u.hp > 0 && dist(u.x, u.y, x, y) <= ability.radius) {
        u.shieldUntil = this.time + 10;
        u.shieldHp = Math.max(u.shieldHp || 0, UNIT_DEFS[u.defId].armor === 'infantry' ? 75 : 130);
      }
    } else if (abilityId === 'stormcall') {
      const relay = this.relays.filter(r => r.owner === owner && !this._relayIsContested(r) &&
        dist(r.x, r.y, x, y) <= ability.radius)
        .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id.localeCompare(b.id))[0];
      this.storm.lure = { owner, x, y, until: this.time + 35, relayId: relay.id, pulseResolved: false };
    } else if (abilityId === 'breach') {
      const until = this.time + 12;
      this.breachZones.push({ owner, x, y, radius: ability.radius, until });
      this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'breach', x, y, radius: ability.radius,
        until, ttl: 12, maxTtl: 12, owner });
    } else if (abilityId === 'interdict') {
      for (const unit of this.units) if (unit.owner !== owner && unit.hp > 0 && !unit.embarkedIn &&
        UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, owner) && dist(unit.x, unit.y, x, y) <= ability.radius)
        unit.suppressedUntil = Math.max(unit.suppressedUntil || 0, this.time + 3);
      this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'interdict', x, y, radius: ability.radius,
        ttl: 0.7, maxTtl: 0.7, owner });
    } else if (abilityId === 'rally') {
      for (const unit of this.units) if (unit.owner === owner && unit.hp > 0 && !unit.embarkedIn &&
        !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon && dist(unit.x, unit.y, x, y) <= ability.radius) {
        unit.hp = Math.min(unit.maxHp, unit.hp + 90);
        unit.suppressedUntil = Math.min(unit.suppressedUntil || 0, this.time);
        unit.order = { type: 'move', x, y, attackMove: true };
        unit.path = []; unit._pathGoal = null;
        this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'heal', x: unit.x, y: unit.y,
          radius: 0.55, ttl: 0.7, maxTtl: 0.7, owner });
      }
    }
    this._event('commandAbility', { owner, abilityId, x, y, radius: ability.radius,
      message: `${owner === 'player' ? 'Command' : 'Enemy command'}: ${ability.name}.` });
    return { ok: true };
  }

  _relayProtocolsEnabled() {
    return this.replayVersion == null || this.replayVersion >= 7;
  }

  _relayLogisticsEnabled() {
    return this.replayVersion == null || this.replayVersion >= RELAY_LOGISTICS_RULES_VERSION;
  }

  setRelayProtocol(relayId, protocol) {
    const owner = this.commandOwner || 'player';
    const relay = this.relays.find(item => item.id === relayId);
    if (!relay) return { ok: false, reason: 'Choose a resonance relay.' };
    if (relay.owner !== owner) return { ok: false, reason: 'You can only change a friendly relay.' };
    if (this._relayIsContested(relay)) return { ok: false, reason: 'The relay is contested.' };
    if (!['shelter', 'overdrive', 'logistics'].includes(protocol))
      return { ok: false, reason: 'Choose shelter, overdrive, or logistics.' };
    if (protocol === 'logistics' && !this._relayLogisticsEnabled())
      return { ok: false, reason: 'Logistics is unavailable in this replay.' };
    if (protocol === relay.protocol) return { ok: false, reason: 'The relay already uses that protocol.' };
    if ((relay.protocolCooldown || 0) > 0) return { ok: false, reason: 'Relay protocol is cooling down.' };
    if (!this._relayProtocolsEnabled()) return { ok: false, reason: 'Relay protocols are unavailable in this replay.' };
    relay.protocol = protocol;
    relay.protocolCooldown = 12;
    const message = `${owner === 'player' ? 'Your' : 'Enemy'} relay switched to ${protocol}.`;
    this._event('relayProtocol', { id: relay.id, owner, protocol, x: relay.x, y: relay.y, message });
    return { ok: true };
  }

  useCommandAbility(abilityId, x, y) { return this._useCommandAbility(this.commandOwner || 'player', abilityId, x, y); }

  canUseUnitAbility(unitId, abilityId, owner = this.commandOwner || 'player') {
    if (this.status !== 'playing') return { ok: false, reason: 'The battle is over.' };
    if (this.replayVersion != null && this.replayVersion < UNIT_ABILITY_RULES_VERSION)
      return { ok: false, reason: 'Unit abilities are unavailable in this replay.' };
    const unit = this.getEntity(unitId);
    if (!unit || !this.units.includes(unit) || unit.hp <= 0 || unit.embarkedIn)
      return { ok: false, reason: 'Choose an active ground unit.' };
    if (unit.owner !== owner) return { ok: false, reason: 'You can only command your own unit.' };
    if (unit.abilityCooldown > 0) return { ok: false, reason: 'Unit ability is cooling down.' };
    if (abilityId === 'brace') {
      if (unit.defId !== 'guardian') return { ok: false, reason: 'Brace requires a Guardian Tank.' };
      if (unit.braceUntil > this.time) return { ok: false, reason: 'Guardian is already braced.' };
      return { ok: true };
    }
    if (abilityId === 'ghostRun') {
      if (unit.defId !== 'stealthTank') return { ok: false, reason: 'Ghost Run requires a Specter Tank.' };
      if (unit.ghostRunUntil > this.time) return { ok: false, reason: 'Specter is already on a Ghost Run.' };
      if (unit.order?.type !== 'move' && unit.order?.type !== 'forceMove')
        return { ok: false, reason: 'Ghost Run requires a move order.' };
      return { ok: true };
    }
    return { ok: false, reason: 'Unknown unit ability.' };
  }

  useUnitAbility(unitId, abilityId) {
    const owner = this.commandOwner || 'player';
    const check = this.canUseUnitAbility(unitId, abilityId, owner);
    if (!check.ok) return check;
    const unit = this.getEntity(unitId);
    this._activateUnitAbility(unit, abilityId, owner);
    return { ok: true };
  }

  _activateUnitAbility(unit, abilityId, owner) {
    unit.abilityCooldown = FACTION_TANK_ABILITY_COOLDOWN;
    if (abilityId === 'brace') unit.braceUntil = this.time + GUARDIAN_BRACE_SECONDS;
    else {
      unit.ghostRunUntil = this.time + SPECTER_GHOST_RUN_SECONDS;
      unit.path = []; unit._pathGoal = null;
    }
    const abilityName = abilityId === 'brace' ? 'Guardian Brace' : 'Specter Ghost Run';
    this._event('unitAbility', { owner, unitId: unit.id, abilityId, x: unit.x, y: unit.y,
      until: abilityId === 'brace' ? unit.braceUntil : unit.ghostRunUntil,
      message: `${owner === 'player' ? 'Your' : 'Enemy'} ${abilityName} activated.` });
  }

  _strike(owner, x, y, nuke) {
    const radius = nuke ? 5.1 : 4.1;
    this.effects.push({ id: `fx${this._nextEffectId++}`, type: nuke ? 'nuke' : 'ion', x, y,
      radius, ttl: 1.5, maxTtl: 1.5, owner });
    this._damageArea(x, y, radius, nuke ? 880 : 1050, 'ion', owner, null);
    if (nuke) this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'radiation', x, y,
      radius: 3.5, ttl: 9, maxTtl: 9, owner, _damageTimer: 0 });
    this._event('superweapon', { owner, kind: nuke ? 'nuclear' : 'ion', x, y,
      message: nuke ? 'Nuclear strike launched!' : 'Ion strike launched!' });
  }

  _refreshPower() {
    for (const owner of ['player', 'enemy']) {
      let production = 0, consumption = 0, capacity = 6000;
      for (const b of this.buildings) {
        if (b.owner !== owner || b.hp <= 0 || b.progress < 1) continue;
        const p = BUILDING_DEFS[b.defId].power || 0;
        if (p > 0) production += p * clamp(b.hp / b.maxHp, 0.25, 1);
        else consumption -= p;
        if (b.defId === 'command' && b._campaignRecoveryUntil > this.time)
          production += b._campaignEmergencyPower || 0;
        if (b.defId === 'silo') capacity += 3000;
      }
      const ratio = consumption <= 0 ? 1 : clamp(production / consumption, 0.28, 1);
      this.power[owner] = { production: Math.round(production), consumption, ratio };
      this.creditCapacity[owner] = capacity;
      this.radar[owner] = this.hasBuilding(owner, 'radar') && ratio >= 0.8;
      for (const b of this.buildings) if (b.owner === owner)
        b.powered = b.progress >= 1 && (b.defId === 'command' || b.defId === 'power' || ratio >= 0.55);
    }
  }

  _revealCircle(cx, cy, radius, ignoreObstacles = false) {
    const minX = Math.max(0, Math.floor(cx - radius)); const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius)); const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (dist(x + 0.5, y + 0.5, cx, cy) <= radius &&
        (ignoreObstacles || this._hasLineOfSight(cx, cy, x + 0.5, y + 0.5))) this.fog[y][x] = 2;
    }
  }

  _hasLineOfSight(x0, y0, x1, y1) {
    const steps = Math.ceil(dist(x0, y0, x1, y1) * 1.5);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const tile = this._tile(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t));
      if (tile?.type === 'rock') return false;
    }
    return true;
  }

  _updateFog() {
    for (const row of this.fog) for (let x = 0; x < row.length; x++) if (row[x] === 2) row[x] = 1;
    for (const u of this.units) if (u.owner === 'player' && u.hp > 0 && !u.embarkedIn)
      this._revealCircle(u.x, u.y, this._stormSight(u.x, u.y, UNIT_DEFS[u.defId].sight));
    for (const b of this.buildings) if (b.owner === 'player' && b.hp > 0 && b.progress >= 1)
      this._revealCircle(b.x + b.w / 2, b.y + b.h / 2,
        this._stormSight(b.x + b.w / 2, b.y + b.h / 2, BUILDING_DEFS[b.defId].sight));
    for (const relay of this.relays) if (relay.owner === 'player')
      this._revealCircle(relay.x, relay.y, this._stormSight(relay.x, relay.y, 6));
    for (const scan of this.scans) if (scan.owner === 'player' && scan.until > this.time)
      this._revealCircle(scan.x, scan.y, scan.radius, true);
    this._refreshLastSeenHostileUnits();
  }

  _isPassable(x, y) {
    if (!this._inBounds(x, y) || !this.terrain[y][x].walkable) return false;
    for (const b of this.buildings) {
      if (b.hp > 0 && BUILDING_DEFS[b.defId]?.blocksGround !== false &&
        x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return false;
    }
    return true;
  }

  _nearestPassable(gx, gy, sx, sy) {
    if (this._isPassable(gx, gy)) return [gx, gy];
    let best = null, score = Infinity;
    for (let radius = 1; radius <= 9; radius++) {
      for (let y = gy - radius; y <= gy + radius; y++) for (let x = gx - radius; x <= gx + radius; x++) {
        if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== radius || !this._isPassable(x, y)) continue;
        const s = dist(x, y, gx, gy) * 3 + dist(x, y, sx, sy) * 0.15;
        if (s < score) { score = s; best = [x, y]; }
      }
      if (best) return best;
    }
    return null;
  }

  _findPath(x0, y0, x1, y1) {
    const sx = clamp(Math.floor(x0), 0, this.width - 1);
    const sy = clamp(Math.floor(y0), 0, this.height - 1);
    const goal = this._nearestPassable(clamp(Math.floor(x1), 0, this.width - 1),
      clamp(Math.floor(y1), 0, this.height - 1), sx, sy);
    if (!goal) return [];
    const [gx, gy] = goal;
    const start = sy * this.width + sx, end = gy * this.width + gx;
    if (start === end) return [{ x: gx + 0.5, y: gy + 0.5 }];
    const size = this.width * this.height;
    const costs = new Float32Array(size); costs.fill(Infinity);
    const came = new Int32Array(size); came.fill(-1);
    const closed = new Uint8Array(size);
    const heap = new MinHeap();
    costs[start] = 0;
    heap.push({ index: start, f: dist(sx, sy, gx, gy) });
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    let visited = 0;
    while (heap.length && visited++ < size * 4) {
      const node = heap.pop(); const i = node.index;
      if (closed[i]) continue;
      if (i === end) break;
      closed[i] = 1;
      const cx = i % this.width, cy = Math.floor(i / this.width);
      for (const [dx, dy, step] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (!this._isPassable(nx, ny)) continue;
        if (dx && dy && (!this._isPassable(cx + dx, cy) || !this._isPassable(cx, cy + dy))) continue;
        const ni = ny * this.width + nx;
        if (closed[ni]) continue;
        const nextCost = costs[i] + step + (this.terrain[ny][nx].type === 'crystal' ? 0.04 : 0);
        if (nextCost < costs[ni]) {
          costs[ni] = nextCost; came[ni] = i;
          const h = Math.hypot(gx - nx, gy - ny);
          heap.push({ index: ni, f: nextCost + h });
        }
      }
    }
    if (came[end] === -1) return [];
    const path = [];
    for (let i = end; i !== start && i !== -1; i = came[i]) {
      const x = i % this.width, y = Math.floor(i / this.width);
      path.push({ x: x + 0.5, y: y + 0.5 });
    }
    path.reverse();
    // Remove straight intermediate waypoints; movement remains grid collision-safe.
    if (path.length > 2) {
      const sparse = [path[0]];
      let prevDx = Math.sign(path[1].x - path[0].x), prevDy = Math.sign(path[1].y - path[0].y);
      for (let i = 1; i < path.length - 1; i++) {
        const dx = Math.sign(path[i + 1].x - path[i].x), dy = Math.sign(path[i + 1].y - path[i].y);
        if (dx !== prevDx || dy !== prevDy) sparse.push(path[i]);
        prevDx = dx; prevDy = dy;
      }
      sparse.push(path[path.length - 1]);
      return sparse;
    }
    return path;
  }

  _moveUnit(unit, gx, gy, dt, stopDistance = 0.2) {
    const d = UNIT_DEFS[unit.defId];
    if ((this.replayVersion == null || this.replayVersion >= UNIT_ABILITY_RULES_VERSION) &&
      unit.defId === 'guardian' && unit.braceUntil > this.time) return false;
    const ghostRun = (this.replayVersion == null || this.replayVersion >= UNIT_ABILITY_RULES_VERSION) &&
      unit.defId === 'stealthTank' && unit.ghostRunUntil > this.time;
    const speed = d.speed * this._campaignUnitMultiplier(unit.owner, 'rapid', 1.12) *
      (ghostRun ? SPECTER_GHOST_RUN_SPEED_MULTIPLIER : 1);
    if (dist(unit.x, unit.y, gx, gy) <= stopDistance) { unit.path = []; return true; }
    if (d.flying) {
      const distance = dist(unit.x, unit.y, gx, gy);
      const step = Math.min(distance, dt * speed * (unit.hp < unit.maxHp * 0.4 ? 0.82 : 1));
      const nx = unit.x + (gx - unit.x) / distance * step;
      const ny = unit.y + (gy - unit.y) / distance * step;
      unit.facing = Math.atan2(ny - unit.y, nx - unit.x);
      unit.x = nx; unit.y = ny;
      return distance - step <= stopDistance;
    }
    unit._repath = Math.max(0, unit._repath - dt);
    const changed = !unit._pathGoal || dist(unit._pathGoal.x, unit._pathGoal.y, gx, gy) > 1.2;
    if (changed || (!unit.path.length && unit._repath <= 0)) {
      unit.path = this._findPath(unit.x, unit.y, gx, gy);
      unit._pathGoal = { x: gx, y: gy };
      // A blocked destination is snapped to the nearest passable tile. When
      // that tile is not close to the requested point, remember the reachable
      // endpoint so current rules can finish there instead of retrying an
      // impossible destination forever.
      unit._pathEnd = unit.path.length ? { ...unit.path[unit.path.length - 1] } : null;
      unit._repath = 1.2 + this._rand() * 0.4;
    }
    let remaining = dt * speed * (unit.hp < unit.maxHp * 0.4 && d.armor !== 'infantry' ? 0.72 : 1);
    while (remaining > 0 && unit.path.length) {
      const next = unit.path[0];
      const distance = dist(unit.x, unit.y, next.x, next.y);
      if (distance <= 0.035) { unit.path.shift(); continue; }
      const step = Math.min(remaining, distance);
      const nx = unit.x + (next.x - unit.x) / distance * step;
      const ny = unit.y + (next.y - unit.y) / distance * step;
      if (!this._isPassable(Math.floor(nx), Math.floor(ny))) {
        unit.path = []; unit._repath = 0; break;
      }
      unit.facing = Math.atan2(ny - unit.y, nx - unit.x);
      unit.x = nx; unit.y = ny; remaining -= step;
      if (d.armor === 'heavy' && d.role !== 'mcv' && d.role !== 'transport') {
        for (const victim of this.units) {
          if (victim.hp <= 0 || victim.embarkedIn || victim.owner === unit.owner || UNIT_DEFS[victim.defId].armor !== 'infantry') continue;
          if (dist(unit.x, unit.y, victim.x, victim.y) <= 0.3) this._applyDamage(victim, 250, 'cannon', unit.owner, unit.id);
        }
      }
      if (step >= distance - 0.035) unit.path.shift();
    }
    const snappedArrival = (this.mode === 'skirmish' || this.mode === 'multiplayer') &&
      (this.replayVersion == null || this.replayVersion >= 17) &&
      !unit.path.length && unit._pathEnd &&
      dist(unit._pathEnd.x, unit._pathEnd.y, gx, gy) > 0.85 &&
      dist(unit.x, unit.y, unit._pathEnd.x, unit._pathEnd.y) < 0.15;
    return dist(unit.x, unit.y, gx, gy) <= stopDistance || snappedArrival ||
      (!unit.path.length && dist(unit.x, unit.y, gx, gy) < 0.85);
  }

  _entityCenter(e) {
    return { x: e.x + (e.w || 0) / 2, y: e.y + (e.h || 0) / 2 };
  }

  _distanceToEntity(x, y, entity) {
    if ('w' in entity) {
      const dx = Math.max(entity.x - x, 0, x - (entity.x + entity.w));
      const dy = Math.max(entity.y - y, 0, y - (entity.y + entity.h));
      return Math.hypot(dx, dy);
    }
    return dist(x, y, entity.x, entity.y);
  }

  _canDetect(observer, target) {
    const d = UNIT_DEFS[target.defId];
    if (!d?.stealth || target.revealedUntil > this.time) return true;
    return this._distanceToEntity(observer.x, observer.y, target) <= 2.5;
  }

  _weaponCanTarget(weaponDef, target) {
    if (!weaponDef || !target || target.embarkedIn) return false;
    const isAir = !!UNIT_DEFS[target.defId]?.flying;
    return weaponDef.target === 'both' || (weaponDef.target === 'air' ? isAir : !isAir);
  }

  _findEnemyNear(observer, radius, targetMode = 'both') {
    radius = this._stormSight(observer.x, observer.y, radius);
    let best = null, score = Infinity;
    for (const e of [...this.units, ...this.buildings]) {
      if (e.owner === observer.owner || e.hp <= 0 || e.embarkedIn || e.progress < 1 || !this._canDetect(observer, e)) continue;
      const air = !!UNIT_DEFS[e.defId]?.flying;
      if (targetMode === 'air' && !air || targetMode === 'ground' && air) continue;
      const distance = this._distanceToEntity(observer.x, observer.y, e);
      if (distance > radius) continue;
      if (this.mode !== 'multiplayer' && observer.owner === 'enemy' && !this.isVisible(e, 'enemy')) continue;
      const s = distance + (e.defId === 'harvester' ? 0.7 : 0) + ('w' in e ? 0.6 : 0);
      if (s < score) { best = e; score = s; }
    }
    return best;
  }

  _fire(source, target, weaponDef) {
    this._fireAt(source, this._entityCenter(target), weaponDef, target.id);
  }

  _fireAt(source, to, weaponDef, targetId = null) {
    if (source.ammo != null && source.ammo < 1) return;
    const ambushStrike = source.defId === 'stealthTank' && source.faction === 'vesper' &&
      source.revealedUntil <= this.time &&
      !this.units.some(unit => unit.hp > 0 && unit.owner !== source.owner &&
        dist(unit.x, unit.y, source.x, source.y) <= 2.5) &&
      !this.scans.some(scan => scan.owner !== source.owner && scan.until > this.time &&
        dist(scan.x, scan.y, source.x, source.y) <= scan.radius);
    const center = this._entityCenter(source);
    source.facing = Math.atan2(to.y - center.y, to.x - center.x);
    const damage = weaponDef.damage * (VETERANCY_RANKS[source.veterancy]?.damageMultiplier ?? 1) *
      ('w' in source ? 1 : this._campaignUnitMultiplier(source.owner, 'precision', 1.1));
    this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'projectile', x: center.x, y: center.y,
      launchX: center.x, launchY: center.y, sourceDefId: source.defId,
      tx: to.x, ty: to.y, targetId, forcePoint: targetId == null, owner: source.owner, sourceId: source.id,
      ambushStrike,
      speed: weaponDef.projectileSpeed, damage, damageType: weaponDef.damageType, splash: weaponDef.splash || 0,
      ttl: 5, maxTtl: 5 });
    this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'muzzle', x: center.x, y: center.y, ttl: 0.17, maxTtl: 0.17,
      owner: source.owner });
    // A secure Overdrive relay supports local ground fire. Check at each shot so
    // contesting the relay removes the benefit without storing a lasting buff.
    const relayOverdrive = (this.replayVersion == null || this.replayVersion >= 26) &&
      UNIT_DEFS[source.defId] && !UNIT_DEFS[source.defId].flying && !source.embarkedIn &&
      this.relays.some(relay => relay.owner === source.owner && relay.protocol === 'overdrive' &&
        !this._relayIsContested(relay) && dist(source.x, source.y, relay.x, relay.y) <= 2.3);
    source.cooldown = weaponDef.cooldown * (source.overchargedUntil > this.time ? 0.65 : 1) *
      (relayOverdrive ? RELAY_OVERDRIVE_RELOAD_MULTIPLIER : 1);
    if (source.ammo != null) {
      source.ammo = Math.max(0, source.ammo - 1);
      if (source.ammo <= 0) {
        if (source.order?.type === 'forceFire' && !this._nearestHelipad(source.owner, source.x, source.y)) {
          source.order = { type: 'idle' };
          source._resumeOrder = null;
        } else {
          source._resumeOrder = { ...source.order };
          source.order = { type: 'rearm' };
        }
        source.path = [];
      }
    }
    if (UNIT_DEFS[source.defId]?.stealth) source.revealedUntil = this.time + 4;
  }

  _directionalArmorMultiplier(target, attackerOwner, sourceId, sourcePosition) {
    if ((this.replayVersion ?? 12) < 12 || !attackerOwner || !sourceId ||
        !Number.isFinite(sourcePosition?.x) || !Number.isFinite(sourcePosition?.y) ||
        sourcePosition.sourceId !== sourceId || sourcePosition.owner !== attackerOwner) return 1;
    const source = this.getEntity(sourceId);
    const knownSource = source?.owner === attackerOwner || sourcePosition.projectile === true &&
      (UNIT_DEFS[sourcePosition.defId] || BUILDING_DEFS[sourcePosition.defId]);
    const def = UNIT_DEFS[target.defId];
    if (!knownSource || !def?.weapon || def.flying || !['light', 'heavy'].includes(def.armor)) return 1;
    const center = this._entityCenter(target);
    const incoming = Math.atan2(sourcePosition.y - center.y, sourcePosition.x - center.x);
    const difference = Math.abs(Math.atan2(Math.sin(incoming - target.facing), Math.cos(incoming - target.facing)));
    if (difference <= GROUND_ARMOR_ARC_RADIANS) return GROUND_ARMOR_FRONT_DAMAGE_MULTIPLIER;
    if (difference >= Math.PI - GROUND_ARMOR_ARC_RADIANS) return GROUND_ARMOR_REAR_DAMAGE_MULTIPLIER;
    return 1;
  }

  _wallCoverMultiplier(target, damageType, attackerOwner, sourceId, sourcePosition, areaDamage) {
    if ((this.replayVersion ?? 20) < 20 || areaDamage ||
        !['ballistic', 'cannon'].includes(damageType) ||
        !UNIT_DEFS[target.defId] || UNIT_DEFS[target.defId].flying ||
        !attackerOwner || attackerOwner === target.owner ||
        !sourceId || !sourcePosition?.projectile ||
        sourcePosition.sourceId !== sourceId || sourcePosition.owner !== attackerOwner ||
        !Number.isFinite(sourcePosition.x) || !Number.isFinite(sourcePosition.y)) return 1;
    for (const wall of this.buildings) {
      if (wall.defId !== 'wall' || wall.owner !== target.owner || wall.hp <= 0 || wall.progress < 1)
        continue;
      const gapX = Math.max(wall.x - target.x, 0, target.x - wall.x - wall.w);
      const gapY = Math.max(wall.y - target.y, 0, target.y - wall.y - wall.h);
      if (Math.hypot(gapX, gapY) > 1.05) continue;
      const intercept = segmentBoxEntry(sourcePosition.x, sourcePosition.y, target.x, target.y, wall);
      if (intercept !== null) {
        this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'wallCover',
          x: sourcePosition.x + (target.x - sourcePosition.x) * intercept,
          y: sourcePosition.y + (target.y - sourcePosition.y) * intercept,
          owner: target.owner, ttl: 0.28, maxTtl: 0.28 });
        return WALL_COVER_DAMAGE_MULTIPLIER;
      }
    }
    return 1;
  }

  _applyDamage(target, damage, damageType, attackerOwner, sourceId = null, sourcePosition = null, areaDamage = false) {
    if (!target || target.hp <= 0 || target.embarkedIn) return;
    // Campaign-only authored defenses can make a structure invulnerable until
    // its mission phase changes. Return before XP, salvage, or destruction logic.
    if (target.campaignShielded === true) return;
    if (target._campaignRecoveryUntil > this.time) return;
    const armor = UNIT_DEFS[target.defId]?.armor || BUILDING_DEFS[target.defId]?.armor || 'structure';
    const multiplier = (ARMOR_MULTIPLIER[damageType]?.[armor] ?? 1) *
      (BUILDING_DEFS[target.defId] && target.owner !== attackerOwner &&
        this.research?.[attackerOwner]?.doctrine === 'siege' ? 1.2 : 1) *
      (BUILDING_DEFS[target.defId] && target.owner !== attackerOwner && sourcePosition &&
        UNIT_DEFS[sourcePosition.defId] && !UNIT_DEFS[sourcePosition.defId].flying &&
        this.breachZones?.some(zone => zone.owner === attackerOwner && zone.until > this.time &&
          dist(zone.x, zone.y, this._entityCenter(target).x, this._entityCenter(target).y) <= zone.radius) ? 1.45 : 1) *
      this._directionalArmorMultiplier(target, attackerOwner, sourceId, sourcePosition) *
      this._wallCoverMultiplier(target, damageType, attackerOwner, sourceId, sourcePosition, areaDamage) *
      (target.promotion === 'bulwark' &&
        (this.replayVersion == null || this.replayVersion >= UNIT_PROMOTION_RULES_VERSION)
        ? UNIT_PROMOTION_DEFS.bulwark.damageTakenMultiplier : 1) *
      ((this.replayVersion == null || this.replayVersion >= UNIT_ABILITY_RULES_VERSION) && !areaDamage &&
        this.units.some(unit => unit.defId === 'guardian' && unit.owner === target.owner && unit.hp > 0 &&
          unit.braceUntil > this.time && dist(unit.x, unit.y, target.x, target.y) <= GUARDIAN_BRACE_RADIUS &&
          ['light', 'heavy'].includes(UNIT_DEFS[target.defId]?.armor))
        ? GUARDIAN_BRACE_DAMAGE_MULTIPLIER : 1);
    let actual = Math.max(0.01, damage * multiplier * (target.progress < 1 ? 1.3 : 1));
    if (target.shieldUntil > this.time && target.shieldHp > 0) {
      const blocked = Math.min(target.shieldHp, actual);
      target.shieldHp -= blocked;
      actual -= blocked;
    }
    // Authored capture objectives can survive bombardment so a player cannot
    // accidentally make the mission unwinnable while escorting engineers.
    const captureFloor = this.mode === 'campaign' && target.owner === 'enemy' && target.captureOnly
      ? target.maxHp * 0.15 : 0;
    const previousHp = target.hp;
    target.hp = Math.max(captureFloor, target.hp - actual);
    target._lastHit = this.time;
    this._awardVeterancyXp(sourceId, attackerOwner, target, previousHp - target.hp, target.hp <= 0);
    if (target.hp <= 0) this._destroyEntity(target, attackerOwner, sourceId);
  }

  _setBridgePassability(bridge, walkable) {
    for (let y = bridge.y; y < bridge.y + bridge.h; y++) for (let x = bridge.x; x < bridge.x + bridge.w; x++) {
      const tile = this._tile(x, y);
      if (tile?.bridgeId === bridge.id) {
        tile.type = walkable ? 'bridge' : 'water';
        tile.walkable = walkable;
        tile.buildable = false;
      }
    }
  }

  _applyAmbushSuppression(target, sourceId) {
    const source = this.getEntity(sourceId);
    const targetDef = UNIT_DEFS[target?.defId];
    if (source?.defId !== 'stealthTank' || source.faction !== 'vesper' || !targetDef?.weapon ||
      targetDef.flying || target.hp <= 0 || target.suppressedUntil > this.time) return false;
    target.suppressedUntil = this.time + VESPER_AMBUSH_SUPPRESSION_SECONDS;
    this._event('unitSuppressed', { id: target.id, until: target.suppressedUntil, sourceId });
    return true;
  }

  _awardVeterancyXp(sourceId, attackerOwner, target, healthRemoved, killed) {
    if (healthRemoved <= 0 || !sourceId || !attackerOwner || attackerOwner === target.owner ||
      (target.owner !== 'player' && target.owner !== 'enemy')) return;
    const source = this.units.find(unit => unit.id === sourceId);
    if (!source || source.hp <= 0 || source.owner !== attackerOwner || !UNIT_DEFS[source.defId]?.weapon) return;
    if (killed) source.kills = (source.kills || 0) + 1;
    // Repairs can restore HP, but each target can pay out damage XP only up to
    // its own maximum health over its lifetime.
    const eligibleDamage = Math.min(healthRemoved, Math.max(0, target.maxHp - (target._xpDamageAwarded || 0)));
    target._xpDamageAwarded = (target._xpDamageAwarded || 0) + eligibleDamage;
    source.xp = (source.xp || 0) + eligibleDamage * ('w' in target ? 0.4 : 1) +
      (killed ? ('w' in target ? 35 : 20) : 0);
    while (source.veterancy < VETERANCY_RANKS.length - 1 &&
      source.xp >= VETERANCY_RANKS[source.veterancy + 1].xp) {
      const oldMaxHp = source.maxHp;
      source.veterancy++;
      source.maxHp = UNIT_DEFS[source.defId].health * VETERANCY_RANKS[source.veterancy].healthMultiplier *
        this._campaignUnitMultiplier(source.owner, 'reinforced', 1.12);
      source.hp = this._campaignUnitMultiplier(source.owner, 'reinforced', 1.12) > 1
        ? source.hp / oldMaxHp * source.maxHp
        : Math.min(source.maxHp, source.hp + source.maxHp - oldMaxHp);
      this._event('veterancy', { id: source.id, level: source.veterancy, xp: source.xp });
      if (source.veterancy === 2 && source.owner === 'enemy' && this.mode === 'skirmish' &&
        (this.replayVersion == null || this.replayVersion >= UNIT_PROMOTION_RULES_VERSION)) {
        const role = UNIT_DEFS[source.defId].role;
        const promotionId = ['siege', 'antiarmor', 'recon'].includes(role) ? 'rangefinder' : 'bulwark';
        source.promotion = promotionId;
        this._event('unitPromoted', { id: source.id, owner: source.owner, promotion: promotionId,
          message: `Enemy ${UNIT_DEFS[source.defId].name} promoted to ${UNIT_PROMOTION_DEFS[promotionId].name}.` });
      }
    }
  }

  _damageArea(x, y, radius, damage, damageType, attackerOwner, sourceId, sourcePosition = null) {
    // Snapshot exposed targets before a carrier can release its passengers.
    const targets = [...this.units, ...this.buildings, ...this.bridges].filter(e => e.hp > 0 && !e.embarkedIn);
    for (const e of targets) {
      const distance = this._distanceToEntity(x, y, e);
      if (distance > radius) continue;
      const falloff = radius > 0.5 ? clamp(1 - distance / (radius * 1.4), 0.22, 1) : 1;
      this._applyDamage(e, damage * falloff, damageType, attackerOwner, sourceId, sourcePosition, true);
    }
    this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'explosion', x, y,
      radius: Math.max(0.55, radius), ttl: 0.6, maxTtl: 0.6 });
  }

  _destroyEntity(entity, attackerOwner, sourceId) {
    if (entity._dead) return;
    entity._dead = true;
    if (this.bridges.includes(entity)) {
      entity.destroyed = true;
      this._setBridgePassability(entity, false);
      this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'explosion',
        x: entity.x + entity.w / 2, y: entity.y + entity.h / 2,
        radius: 2.1, ttl: 1.15, maxTtl: 1.15 });
      // A span cannot leave ground units stranded on the water tiles it just
      // created. Aircraft stay above the collapse; transports resolve their
      // passengers through the existing emergency-unload rule.
      for (const unit of this.units) {
        if (unit.hp <= 0 || unit.embarkedIn || UNIT_DEFS[unit.defId]?.flying) continue;
        if (unit.x < entity.x || unit.x >= entity.x + entity.w ||
            unit.y < entity.y || unit.y >= entity.y + entity.h) continue;
        this._applyDamage(unit, unit.maxHp * 10, 'ion', attackerOwner, sourceId);
      }
      this._event('bridgeDestroyed', { id: entity.id, x: entity.x, y: entity.y,
        attackerOwner });
      return;
    }
    if (UNIT_DEFS[entity.defId]?.role === 'transport') this._unloadPassengers(entity, true);
    const isBuilding = 'w' in entity;
    const center = this._entityCenter(entity);
    const unitDef = !isBuilding ? UNIT_DEFS[entity.defId] : null;
    if ((this.replayVersion ?? 10) >= 10 && unitDef && !unitDef.flying &&
        this._tile(Math.floor(center.x), Math.floor(center.y))?.walkable &&
        unitDef.armor !== 'infantry' && unitDef.role !== 'transport') {
      if (this.wrecks.length >= MAX_BATTLEFIELD_WRECKS) this.wrecks.shift();
      const wreck = { id: `wreck${this._nextWreckId++}`, x: center.x, y: center.y,
        value: Math.min(200, Math.max(20, Math.round((unitDef.cost || 0) * 0.15))),
        faction: entity.faction || ownerFaction(this, entity.owner),
        expiresAt: this.time + WRECK_LIFETIME_SECONDS };
      this.wrecks.push(wreck);
      this._event('wreckCreated', { ...wreck });
    }
    if (isBuilding && entity.progress >= 1 && attackerOwner && attackerOwner !== entity.owner &&
      ownerFaction(this, attackerOwner) === 'vesper') {
      const source = this.units.find(unit => unit.id === sourceId);
      const cost = BUILDING_DEFS[entity.defId]?.cost || 0;
      if (source && source.hp > 0 && source.owner === attackerOwner && source.faction === 'vesper' &&
        UNIT_DEFS[source.defId]?.weapon && cost > 0) {
        const available = Math.max(0, Math.floor(this.creditCapacity[attackerOwner] - this.credits[attackerOwner]));
        const amount = Math.min(180, available, Math.round(cost * 0.12));
        if (amount > 0) {
          this.credits[attackerOwner] += amount;
          this.salvageEarned[attackerOwner] = (this.salvageEarned[attackerOwner] || 0) + amount;
          this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'salvage', owner: attackerOwner,
            amount, x: center.x, y: center.y, radius: 1.1, ttl: 0.9, maxTtl: 0.9 });
          this._event('vesperSalvage', { owner: attackerOwner, targetId: entity.id, defId: entity.defId,
            amount, x: center.x, y: center.y, message: `Vesper salvaged ${amount} credits from ${BUILDING_DEFS[entity.defId].name}.` });
        }
      }
    }
    this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'explosion', x: center.x, y: center.y,
      radius: isBuilding ? 1.7 : 0.85, ttl: isBuilding ? 1 : 0.6, maxTtl: isBuilding ? 1 : 0.6 });
    if (attackerOwner && attackerOwner !== entity.owner) {
      this.kills[attackerOwner]++;
    }
    this._event(isBuilding ? 'buildingLost' : 'unitLost', { id: entity.id, owner: entity.owner,
      defId: entity.defId, x: center.x, y: center.y });
    if (isBuilding) this._refreshPower();
  }

  _updateEffects(dt) {
    for (const fx of this.effects) {
      fx.ttl -= dt;
      if (fx.type === 'radiation') {
        fx._damageTimer = (fx._damageTimer || 0) + dt;
        if (fx._damageTimer >= 0.5) {
          fx._damageTimer -= 0.5;
          for (const u of this.units) if (u.hp > 0 && !u.embarkedIn && !UNIT_DEFS[u.defId].flying &&
            dist(u.x, u.y, fx.x, fx.y) <= fx.radius) this._applyDamage(u, 19, 'ion', fx.owner, null);
        }
      }
      if (fx.type !== 'projectile') continue;
      const target = this.getEntity(fx.targetId);
      if (target?.hp > 0) {
        const p = this._entityCenter(target); fx.tx = p.x; fx.ty = p.y;
      }
      const distance = dist(fx.x, fx.y, fx.tx, fx.ty);
      const step = fx.speed * dt;
      if (distance <= step + 0.12 || fx.ttl <= 0) {
        fx.x = fx.tx; fx.y = fx.ty; fx.ttl = 0;
        const sourcePosition = { x: fx.launchX, y: fx.launchY, sourceId: fx.sourceId,
          owner: fx.owner, defId: fx.sourceDefId, projectile: true };
        if (fx.splash > 0) {
          this._damageArea(fx.x, fx.y, fx.splash, fx.damage, fx.damageType, fx.owner, fx.sourceId, sourcePosition);
          // Splash can damage bystanders, but the ambush disruption belongs only
          // to the unit this projectile was aimed at.
          if (fx.ambushStrike && target?.hp > 0 &&
            this._distanceToEntity(fx.x, fx.y, target) <= fx.splash)
            this._applyAmbushSuppression(target, fx.sourceId);
        }
        else {
          const hit = fx.forcePoint
            ? [...this.units, ...this.buildings].filter(e => e.hp > 0 && !UNIT_DEFS[e.defId]?.flying &&
              this._distanceToEntity(fx.x, fx.y, e) <= (UNIT_DEFS[e.defId]?.radius ?? 0.28))
              .sort((a, b) => this._distanceToEntity(fx.x, fx.y, a) - this._distanceToEntity(fx.x, fx.y, b))[0]
            : target?.hp > 0 ? target : null;
          if (hit) {
            this._applyDamage(hit, fx.damage, fx.damageType, fx.owner, fx.sourceId, sourcePosition);
            if (fx.ambushStrike && hit === target) this._applyAmbushSuppression(hit, fx.sourceId);
          }
          if (hit || fx.forcePoint) this.effects.push({ id: `fx${this._nextEffectId++}`,
            type: 'impact', x: fx.x, y: fx.y, radius: 0.3, ttl: 0.25, maxTtl: 0.25 });
        }
      } else {
        fx.x += (fx.tx - fx.x) / distance * step;
        fx.y += (fx.ty - fx.y) / distance * step;
      }
    }
    this.effects = this.effects.filter(fx => fx.ttl > 0);
  }

  _nearestRefinery(owner, x, y) {
    let best = null, distance = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== owner || b.defId !== 'refinery' || b.hp <= 0 || b.progress < 1) continue;
      const d = this._distanceToEntity(x, y, b);
      if (d < distance) { distance = d; best = b; }
    }
    return best;
  }

  _nearestHelipad(owner, x, y) {
    let best = null, distance = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== owner || b.defId !== 'helipad' || b.hp <= 0 || b.progress < 1 || !b.powered) continue;
      const c = this._entityCenter(b);
      const d = dist(x, y, c.x, c.y);
      if (d < distance) { best = b; distance = d; }
    }
    return best;
  }

  _updateAirRearm(u, dt) {
    const d = UNIT_DEFS[u.defId];
    if (!d.flying || u.order?.type !== 'rearm') return false;
    if (d.ammoMax == null) {
      u.order = u._resumeOrder && u._resumeOrder.type !== 'rearm' ? u._resumeOrder : { type: 'idle' };
      u._resumeOrder = null;
      return true;
    }
    const pad = this._nearestHelipad(u.owner, u.x, u.y);
    if (!pad) return true;
    const c = this._entityCenter(pad);
    if (dist(u.x, u.y, c.x, c.y) > 0.5) this._moveUnit(u, c.x, c.y, dt, 0.5);
    else {
      u.ammo = Math.min(d.ammoMax, u.ammo + dt * d.rearmRate);
      if (u.ammo >= d.ammoMax - 0.001) {
        u.ammo = d.ammoMax;
        u.order = u._resumeOrder && u._resumeOrder.type !== 'rearm' ? u._resumeOrder : { type: 'idle' };
        u._resumeOrder = null;
        this._event('aircraftReady', { id: u.id, defId: u.defId });
      }
    }
    return true;
  }

  _findCrystal(x, y, owner = null, unitId = null) {
    let best = null, score = Infinity;
    const choose = reserve => {
      for (let yy = 0; yy < this.height; yy++) for (let xx = 0; xx < this.width; xx++) {
        const t = this.terrain[yy][xx];
        if (t.resource < 25) continue;
        const assigned = reserve && owner && this.units.some(unit => unit.id !== unitId && unit.owner === owner &&
          unit.defId === 'harvester' && unit.order?.type === 'harvest' && unit._harvestPhase !== 'return' &&
          unit._harvestTile?.x === xx && unit._harvestTile?.y === yy);
        if (assigned) continue;
        const s = dist(x, y, xx + 0.5, yy + 0.5) - Math.min(t.resource, 700) / 700 * 0.6;
        if (s < score) { score = s; best = { x: xx, y: yy }; }
      }
    };
    if (['skirmish', 'multiplayer'].includes(this.mode) &&
      (this.replayVersion == null || this.replayVersion >= 8)) choose(true);
    if (!best) choose(false);
    return best;
  }

  _findHarvesterDock(unit) {
    const assignedRefinery = unit._unloadRefineryId && this.getEntity(unit._unloadRefineryId);
    const assignedApproach = unit._unloadApproach;
    if (assignedRefinery?.hp > 0 && assignedRefinery.defId === 'refinery' && assignedRefinery.progress >= 1 &&
      assignedApproach && this._isPassable(Math.floor(assignedApproach.x), Math.floor(assignedApproach.y)) &&
      this._distanceToEntity(assignedApproach.x, assignedApproach.y, assignedRefinery) <= 0.95)
      return { refinery: assignedRefinery, approach: assignedApproach };

    const candidates = [];
    const refineries = this.buildings.filter(building => building.owner === unit.owner && building.defId === 'refinery' &&
      building.hp > 0 && building.progress >= 1);
    for (const refinery of refineries) for (let y = refinery.y - 1; y <= refinery.y + refinery.h; y++)
      for (let x = refinery.x - 1; x <= refinery.x + refinery.w; x++) {
        if (x >= refinery.x && x < refinery.x + refinery.w && y >= refinery.y && y < refinery.y + refinery.h) continue;
        const approach = { x: x + 0.5, y: y + 0.5 };
        if (!this._isPassable(x, y) || this._distanceToEntity(approach.x, approach.y, refinery) > 0.95) continue;
        const path = this._findPath(unit.x, unit.y, approach.x, approach.y);
        if (!path.length) continue;
        const reserved = this.units.some(other => other.id !== unit.id && other.owner === unit.owner &&
          other.defId === 'harvester' && other._unloadRefineryId === refinery.id && other._unloadApproach &&
          dist(other._unloadApproach.x, other._unloadApproach.y, approach.x, approach.y) < 0.7);
        const side = approach.y < refinery.y ? 'north' : approach.y >= refinery.y + refinery.h ? 'south' :
          approach.x < refinery.x ? 'west' : 'east';
        const sideLoad = this.units.filter(other => other.id !== unit.id && other.owner === unit.owner &&
          other.defId === 'harvester' && other._unloadRefineryId === refinery.id && other._unloadApproach)
          .filter(other => {
            const otherSide = other._unloadApproach.y < refinery.y ? 'north' :
              other._unloadApproach.y >= refinery.y + refinery.h ? 'south' :
                other._unloadApproach.x < refinery.x ? 'west' : 'east';
            return otherSide === side;
          }).length;
        let length = 0, px = unit.x, py = unit.y;
        for (const point of path) { length += dist(px, py, point.x, point.y); px = point.x; py = point.y; }
        const refineryDistance = this._distanceToEntity(unit.x, unit.y, refinery);
        candidates.push({ refinery, approach, pathLength: length,
          score: length + refineryDistance * 0.05 + sideLoad * 14 + (reserved ? 40 : 0) });
      }
    candidates.sort((a, b) => a.score - b.score || a.refinery.id.localeCompare(b.refinery.id) ||
      a.approach.y - b.approach.y || a.approach.x - b.approach.x);
    return candidates[0] || null;
  }

  _releaseHarvesterDock(u) {
    if (!u?._unloadRefineryId) return;
    const refinery = this.getEntity(u._unloadRefineryId);
    if (refinery?._unloadHarvesterId === u.id) refinery._unloadHarvesterId = null;
    u._unloadRefineryId = null;
    u._unloadApproach = null;
    u._unloadRemaining = 0;
    u._unloadProgress = 0;
  }

  _updateHarvester(u, dt) {
    const d = UNIT_DEFS.harvester;
    const improvedDocking = ['skirmish', 'multiplayer'].includes(this.mode) &&
      (this.replayVersion == null || this.replayVersion >= 8);
    if (u.order.type !== 'harvest') {
      this._releaseHarvesterDock(u);
      return false;
    }
    if (u.cargo >= d.capacity || u._harvestPhase === 'return') {
      let refinery, approach;
      if (improvedDocking) {
        refinery = u._unloadRefineryId && this.getEntity(u._unloadRefineryId);
        approach = u._unloadApproach;
        if (!refinery || refinery.hp <= 0 || refinery.defId !== 'refinery' || refinery.progress < 1 || !approach ||
          !this._isPassable(Math.floor(approach.x), Math.floor(approach.y)) ||
          this._distanceToEntity(approach.x, approach.y, refinery) > 0.95) {
          this._releaseHarvesterDock(u);
          const dock = this._findHarvesterDock(u);
          refinery = dock?.refinery || null;
          approach = dock?.approach || null;
          if (refinery && approach) {
            u._unloadRefineryId = refinery.id;
            u._unloadApproach = { ...approach };
          }
        }
      } else {
        refinery = this._nearestRefinery(u.owner, u.x, u.y);
        approach = refinery ? this._entityCenter(refinery) : null;
      }
      if (!refinery) { this._releaseHarvesterDock(u); u.order = { type: 'idle' }; return true; }
      u._harvestPhase = 'return';
      const center = this._entityCenter(refinery);
      if (this._distanceToEntity(u.x, u.y, refinery) <= 0.95) {
        if (u._unloadRefineryId && u._unloadRefineryId !== refinery.id) {
          this._releaseHarvesterDock(u);
        }
        const active = refinery._unloadHarvesterId && this.getEntity(refinery._unloadHarvesterId);
        if (!active || active.hp <= 0 || active._unloadRefineryId !== refinery.id) {
          refinery._unloadHarvesterId = u.id;
          u._unloadRefineryId = refinery.id;
          u._unloadRemaining = Math.max(0.05, (u.cargo / d.capacity) * 2.5);
          u._unloadProgress = 0;
        }
        if (refinery._unloadHarvesterId === u.id) {
          u._unloadRemaining = Math.max(0, u._unloadRemaining - dt);
          u._unloadProgress = clamp(1 - u._unloadRemaining / Math.max(0.05, (u.cargo / d.capacity) * 2.5), 0, 1);
          if (u._unloadRemaining <= 0) {
            const completedBloomExpedition = !!u.order?.bloomExpedition;
            const accepted = Math.min(u.cargo, Math.max(0, this.creditCapacity[u.owner] - this.credits[u.owner]));
            this.credits[u.owner] += accepted;
            let logisticsBonus = 0;
            if (accepted > 0 && this._relayLogisticsEnabled()) {
              const logisticsRelays = this.relays.filter(relay => relay.owner === u.owner &&
                relay.protocol === 'logistics' && !this._relayIsContested(relay)).length;
              logisticsBonus = Math.min(Math.max(0, this.creditCapacity[u.owner] - this.credits[u.owner]),
                accepted * logisticsRelays * RELAY_LOGISTICS_YIELD_RATE);
              this.credits[u.owner] += logisticsBonus;
            }
            const acceptedCharged = this._stormglassBloomEnabled() && u.cargo > 0
              ? accepted * clamp((u._stormglassCargo || 0) / u.cargo, 0, 1) : 0;
            const bloomBonus = Math.min(Math.max(0, this.creditCapacity[u.owner] - this.credits[u.owner]),
              acceptedCharged * STORMGLASS_BLOOM_PREMIUM_RATE);
            this.credits[u.owner] += bloomBonus;
            u.cargo = 0; u._stormglassCargo = 0; u._harvestPhase = 'field'; u._harvestTile = null; u.path = []; u._pathGoal = null;
            u._unloadRefineryId = null; u._unloadApproach = null; u._unloadRemaining = 0; u._unloadProgress = 0;
            refinery._unloadHarvesterId = null;
            if (completedBloomExpedition) for (const escort of this.units)
              if (escort.order?.bloomExpeditionEscort && escort.order.targetId === u.id)
                this._restoreBloomEscort(escort);
            this._event('credits', { owner: u.owner, amount: Math.round(accepted + logisticsBonus + bloomBonus),
              total: Math.floor(this.credits[u.owner]) });
          }
        }
      } else {
        const lowerIdReturning = improvedDocking && this.units.some(other => other.id !== u.id &&
          other.owner === u.owner && other.defId === 'harvester' && other.order.type === 'harvest' &&
          other._harvestPhase === 'return' && other.cargo > 0 && other._unloadRefineryId === refinery.id &&
          Number(other.id.slice(1)) < Number(u.id.slice(1)));
        if (!lowerIdReturning) this._moveUnit(u, approach.x, approach.y, dt, improvedDocking ? 0.2 : 0.9);
      }
      return true;
    }
    let field = u._harvestTile;
    if (u.order.x != null && u.order.y != null && this._tile(u.order.x, u.order.y)?.resource > 0)
      field = { x: u.order.x, y: u.order.y };
    if (!field || this._tile(field.x, field.y)?.resource < 1) {
      field = this._findCrystal(u.x, u.y, u.owner, u.id);
      u._harvestTile = field;
      u.order = { type: 'harvest' };
    }
    if (!field) {
      if (u.cargo > 0) u._harvestPhase = 'return';
      return true;
    }
    if (dist(u.x, u.y, field.x + 0.5, field.y + 0.5) > 0.45) {
      this._moveUnit(u, field.x + 0.5, field.y + 0.5, dt, 0.45);
    } else {
      const tile = this.terrain[field.y][field.x];
      const supported = ownerFaction(this, u.owner) === 'aegis' && this.buildings.some(b =>
        b.owner === u.owner && b.defId === 'refinery' && b.hp > 0 && b.progress >= 1 && b.powered &&
        dist(field.x + 0.5, field.y + 0.5, b.x + b.w / 2, b.y + b.h / 2) <= AEGIS_REFINERY_BONUS_RADIUS);
      const gathered = Math.min(tile.resource, d.capacity - u.cargo,
        dt * 112 * (supported ? AEGIS_REFINERY_EXTRACTION_MULTIPLIER : 1) *
        (this.research?.[u.owner]?.doctrine === 'logistics' ? 1.25 : 1));
      tile.resource -= gathered; u.cargo += gathered;
      const bloom = this._stormglassBloomEnabled() ? this.storm.bloom : null;
      if (bloom && this.time < bloom.until && dist(field.x + 0.5, field.y + 0.5, bloom.x, bloom.y) <= bloom.radius)
        u._stormglassCargo = Math.min(u.cargo, (u._stormglassCargo || 0) + gathered);
      const effectPhase = Number(u.id.slice(1)) * 0.61803398875;
      if (Math.floor(this.time * 2 + effectPhase) !== Math.floor((this.time - dt) * 2 + effectPhase))
        this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'harvest',
        x: field.x + 0.5, y: field.y + 0.5, radius: 0.55, ttl: 0.35, maxTtl: 0.35 });
      if (tile.resource <= 0.1) { tile.type = 'sand'; tile.resource = 0; tile.buildable = true; u._harvestTile = null; }
      if (u.cargo >= d.capacity - 1) u._harvestPhase = 'return';
    }
    return true;
  }

  _updateMedic(u, dt) {
    if (u.defId !== 'medic') return;
    u._healCooldown -= dt;
    if (u._healCooldown > 0) return;
    let patient = null, missing = 0;
    for (const ally of this.units) {
      if (ally.owner !== u.owner || ally.id === u.id || ally.embarkedIn || UNIT_DEFS[ally.defId].armor !== 'infantry') continue;
      if (dist(u.x, u.y, ally.x, ally.y) > 3.2) continue;
      const m = ally.maxHp - ally.hp;
      if (m > missing) { patient = ally; missing = m; }
    }
    if (patient && missing > 1) {
      patient.hp = Math.min(patient.maxHp, patient.hp + 22);
      u._healCooldown = 1.4;
      this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'heal', x: patient.x, y: patient.y,
        radius: 0.6, ttl: 0.55, maxTtl: 0.55 });
    }
  }

  _updateEngineer(u, target, dt) {
    if (u.defId !== 'engineer' || !target || !('w' in target)) return false;
    if (this.bridges.includes(target) && target.destroyed) {
      if (this._distanceToEntity(u.x, u.y, target) <= 0.9) {
        target.hp = Math.min(target.maxHp, target.hp + dt * 50);
        if (target.hp >= target.maxHp) {
          target.destroyed = false;
          target._dead = false;
          this._setBridgePassability(target, true);
          u.order = { type: 'idle' };
          this._event('bridgeRepaired', { id: target.id, by: u.id });
        }
        return true;
      }
      let approach = Number.isFinite(u.order.approachX) && Number.isFinite(u.order.approachY) &&
        this._isPassable(Math.floor(u.order.approachX), Math.floor(u.order.approachY))
        ? { x: u.order.approachX, y: u.order.approachY } : null;
      if (!approach) {
        let best = null;
        for (let y = target.y - 1; y <= target.y + target.h; y++) for (let x = target.x - 1; x <= target.x + target.w; x++) {
          if (x >= target.x && x < target.x + target.w && y >= target.y && y < target.y + target.h) continue;
          if (!this._isPassable(x, y)) continue;
          const px = x + 0.5, py = y + 0.5;
          if (this._distanceToEntity(px, py, target) > 0.9) continue;
          const path = this._findPath(u.x, u.y, px, py);
          if (!path.length) continue;
          const score = path.length * 10 + dist(u.x, u.y, px, py);
          if (!best || score < best.score) best = { x: px, y: py, score };
        }
        approach = best;
        if (approach) { u.order.approachX = approach.x; u.order.approachY = approach.y; }
      }
      if (approach) this._moveUnit(u, approach.x, approach.y, dt, 0.1);
      return true;
    }
    const c = this._entityCenter(target);
    if (this._distanceToEntity(u.x, u.y, target) > 0.7) {
      this._moveUnit(u, c.x, c.y, dt, 0.7);
      return true;
    }
    if (this.bridges.includes(target)) { u.order = { type: 'idle' }; return true; }
    if (target.owner !== u.owner && target.hp / target.maxHp <= 0.75) {
      target.owner = u.owner; target.faction = ownerFaction(this, u.owner);
      target.hp = Math.max(target.hp, target.maxHp * 0.45);
      target.queue = [];
      target.repairing = false;
      this._event('buildingCaptured', { id: target.id, owner: target.owner, by: u.id });
      this._refreshPower();
      u.hp = 0; this._destroyEntity(u, null, null);
    } else if (target.owner === u.owner) {
      target.hp = Math.min(target.maxHp, target.hp + 360);
      this._event('buildingRepaired', { id: target.id, by: u.id });
      u.hp = 0; this._destroyEntity(u, null, null);
    } else {
      u.order = { type: 'idle' };
      this._event('warning', { message: 'Enemy structure must be below 75% health to capture.' });
    }
    return true;
  }

  _unloadPassengers(carrier, emergency = false) {
    const remaining = [];
    const reserved = new Set();
    const cx = Math.floor(carrier.x), cy = Math.floor(carrier.y);
    for (const id of carrier.passengerIds || []) {
      const passenger = this.getEntity(id);
      if (!passenger || passenger.hp <= 0 || passenger.embarkedIn !== carrier.id) continue;
      let spot = null;
      const firstRadius = !emergency && UNIT_DEFS[carrier.defId]?.flying ? 0 : 1;
      for (let radius = firstRadius; radius <= 3 && !spot; radius++) {
        const candidates = [];
        for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius || !this._isPassable(x, y)) continue;
          if (reserved.has(`${x},${y}`) || this.units.some(u => u.hp > 0 && !u.embarkedIn &&
            u.id !== carrier.id && Math.hypot(u.x - x - 0.5, u.y - y - 0.5) < 0.7)) continue;
          candidates.push({ x, y, distance: Math.hypot(x + 0.5 - carrier.x, y + 0.5 - carrier.y) });
        }
        candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
        spot = candidates[0] || null;
      }
      if (!spot) {
        if (emergency) {
          passenger.embarkedIn = null;
          passenger.hp = 0;
          this._destroyEntity(passenger, null, null);
        } else remaining.push(id);
        continue;
      }
      reserved.add(`${spot.x},${spot.y}`);
      passenger.x = spot.x + 0.5; passenger.y = spot.y + 0.5;
      passenger.embarkedIn = null;
      passenger.hp = emergency ? Math.max(1, passenger.hp * 0.5) : passenger.hp;
      passenger.order = { type: 'idle' }; passenger.path = []; passenger._pathGoal = null;
      this._event('unitUnloaded', { id, carrierId: carrier.id, x: passenger.x, y: passenger.y, emergency });
    }
    carrier.passengerIds = remaining;
    return remaining.length === 0;
  }

  issueEngineer(targetId) {
    const owner = this.commandOwner || 'player';
    const target = this.getEntity(targetId);
    if (!target || !('w' in target) || this.bridges.includes(target) && !target.destroyed)
      return { ok: false, reason: 'Choose a damaged structure or destroyed bridge.' };
    if (target.owner !== owner && !this.isVisible(target, owner)) return { ok: false, reason: 'Target is outside current vision.' };
    const engineers = this._selectedCommandUnits().filter(u => u.defId === 'engineer');
    if (!engineers.length) return { ok: false, reason: 'Select an engineer.' };
    for (const u of engineers) { u.order = { type: 'engineer', targetId }; u.path = []; u._pathGoal = null; }
    this._event('order', { order: 'engineer', ids: engineers.map(u => u.id), targetId });
    return { ok: true };
  }

  issueRecoverWreck(wreckId) {
    const owner = this.commandOwner || 'player';
    if ((this.replayVersion ?? 10) < 10) return { ok: false, reason: 'Wreck recovery is unavailable in this replay.' };
    if (this.creditCapacity[owner] - this.credits[owner] < 1)
      return { ok: false, reason: 'Command storage is full.' };
    const wreck = this.wrecks.find(item => item.id === wreckId && item.expiresAt > this.time);
    if (!wreck) return { ok: false, reason: 'Choose an available wreck.' };
    const opposingOwner = owner === 'player' ? 'enemy' : 'player';
    if (!this.isVisible({ x: wreck.x, y: wreck.y, owner: opposingOwner }, owner))
      return { ok: false, reason: 'Wreck is outside current vision.' };
    const engineers = this._selectedCommandUnits().filter(unit => unit.defId === 'engineer');
    if (!engineers.length) return { ok: false, reason: 'Select an engineer.' };
    for (const unit of engineers) {
      unit.order = { type: 'recoverWreck', wreckId };
      unit._wreckRecoveryProgress = 0;
      unit._wreckCapacityWaiting = false;
      unit.path = []; unit._pathGoal = null;
    }
    this._event('order', { order: 'recoverWreck', ids: engineers.map(unit => unit.id), wreckId });
    return { ok: true };
  }

  issueServiceAtWorkshop(workshopId) {
    const owner = this.commandOwner || 'player';
    if (this.replayVersion != null && this.replayVersion < 21)
      return { ok: false, reason: 'Workshop service orders require replay version 21.' };
    const workshop = this.getEntity(workshopId);
    if (!workshop || workshop.defId !== 'serviceBay' || workshop.owner !== owner || workshop.hp <= 0 ||
      workshop.progress < 1)
      return { ok: false, reason: 'Choose a completed friendly Field Workshop.' };
    const eligible = this._selectedCommandUnits().filter(unit => {
      const def = UNIT_DEFS[unit.defId];
      return !unit.embarkedIn && unit.hp > 0 && unit.hp < unit.maxHp && !def.flying &&
        ['light', 'heavy'].includes(def.armor);
    });
    if (!eligible.length) return { ok: false, reason: 'Select a damaged ground vehicle.' };
    const serviceOrders = [];
    for (const unit of eligible) {
      const point = this._aiWorkshopApproach(unit, workshop);
      if (!point) continue;
      unit.order = { type: 'service', workshopId, resumeOrder: structuredClone(unit.order || { type: 'idle' }),
        x: point.x, y: point.y };
      unit.path = []; unit._pathGoal = null;
      unit._serviceWaiting = null;
      serviceOrders.push(unit);
    }
    if (!serviceOrders.length)
      return { ok: false, reason: 'No reachable service approach to that workshop.' };
    this._event('order', { order: 'service', ids: serviceOrders.map(unit => unit.id), workshopId });
    return serviceOrders.length < eligible.length
      ? { ok: true, reason: 'Unreachable vehicles kept their previous orders.' } : { ok: true };
  }

  _finishServiceOrder(unit, message) {
    const previous = unit.order?.resumeOrder;
    unit.order = previous && typeof previous === 'object' ? structuredClone(previous) : { type: 'idle' };
    unit.path = []; unit._pathGoal = null; unit._pathEnd = null;
    unit._serviceWaiting = null;
    if (message) this._event('serviceOrderEnded', { unitId: unit.id, message });
  }

  _updateServiceOrder(unit, dt) {
    const order = unit.order;
    const workshop = this.getEntity(order.workshopId);
    if (!workshop || workshop.defId !== 'serviceBay' || workshop.owner !== unit.owner || workshop.hp <= 0 || workshop.progress < 1) {
      this._finishServiceOrder(unit, 'Field Workshop lost; previous order restored.');
      return;
    }
    if (unit.hp >= unit.maxHp) {
      this._finishServiceOrder(unit, 'Vehicle fully repaired; previous order restored.');
      return;
    }
    const point = Number.isFinite(order.x) && Number.isFinite(order.y)
      ? { x: order.x, y: order.y } : this._aiWorkshopApproach(unit, workshop);
    if (!point) {
      this._finishServiceOrder(unit, 'No reachable service approach; previous order restored.');
      return;
    }
    order.x = point.x; order.y = point.y;
    if (this._distanceToEntity(unit.x, unit.y, workshop) > 2.5) {
      this._moveUnit(unit, point.x, point.y, dt, 0.2);
      return;
    }
    // The building update applies the established repair rate and credit cost.
    // A powered-down bay or empty treasury leaves the vehicle waiting in range.
    const waiting = !workshop.powered ? 'power' : this.credits[unit.owner] <= 0 ? 'credits' : null;
    if (waiting !== unit._serviceWaiting) {
      unit._serviceWaiting = waiting;
      if (waiting) this._event('serviceWaiting', { unitId: unit.id, workshopId: workshop.id,
        reason: waiting, message: waiting === 'power' ? 'Service paused; Field Workshop needs power.' :
          'Service paused; insufficient credits.' });
    }
    // Order completion is checked after the building repair tick next frame.
  }

  _updateWreckRecovery(unit, dt) {
    if (unit.defId !== 'engineer') { unit.order = { type: 'idle' }; return; }
    const wreck = this.wrecks.find(item => item.id === unit.order.wreckId && item.expiresAt > this.time);
    if (!wreck) { unit.order = { type: 'idle' }; unit._wreckRecoveryProgress = 0;
      unit._wreckCapacityWaiting = false; return; }
    const owner = unit.owner;
    if (dist(unit.x, unit.y, wreck.x, wreck.y) > WRECK_RECOVERY_RANGE) {
      this._moveUnit(unit, wreck.x, wreck.y, dt, WRECK_RECOVERY_RANGE);
      unit._wreckRecoveryProgress = 0;
      return;
    }
    if (this.creditCapacity[owner] - this.credits[owner] < 1) {
      if (!unit._wreckCapacityWaiting) {
        unit._wreckCapacityWaiting = true;
        this._event('wreckRecoveryWaiting', { id: wreck.id, owner, unitId: unit.id,
          message: 'Command storage is full; the Engineer is waiting to recover salvage.' });
      }
      return;
    }
    unit._wreckCapacityWaiting = false;
    unit._wreckRecoveryProgress = (unit._wreckRecoveryProgress || 0) + dt;
    if (unit._wreckRecoveryProgress < WRECK_RECOVERY_SECONDS) return;
    const amount = Math.min(wreck.value, Math.max(0, Math.floor(this.creditCapacity[owner] - this.credits[owner])));
    if (amount < 1) return;
    this.credits[owner] += amount;
    this.wrecks = this.wrecks.filter(item => item.id !== wreck.id);
    unit._wreckRecoveryProgress = 0;
    unit.order = { type: 'idle' }; unit.path = []; unit._pathGoal = null;
    this.effects.push({ id: `fx${this._nextEffectId++}`, type: 'salvage', owner,
      amount, x: wreck.x, y: wreck.y, radius: 1.1, ttl: 0.9, maxTtl: 0.9 });
    this._event('wreckRecovered', { id: wreck.id, owner, unitId: unit.id, value: amount,
      x: wreck.x, y: wreck.y });
  }

  _updateUnit(u, dt) {
    u._attackMoveHolding = false;
    if (u.hp <= 0) return;
    if (u.embarkedIn) {
      const carrier = this.getEntity(u.embarkedIn);
      if (carrier?.hp > 0) { u.x = carrier.x; u.y = carrier.y; }
      return;
    }
    u.cooldown = Math.max(0, u.cooldown - dt);
    this._updateMedic(u, dt);
    const d = UNIT_DEFS[u.defId];
    const weaponRange = unitWeaponRange(u, d.weapon, this.replayVersion);
    if (u.order?.type === 'recoverWreck') {
      if ((this.replayVersion ?? 10) < 10) { u.order = { type: 'idle' }; return; }
      this._updateWreckRecovery(u, dt);
      return;
    }
    if (d.flying && d.ammoMax != null && u.ammo < 1 && u.order?.type !== 'rearm' && u.order?.type !== 'forceMove') {
      if (u.order?.type === 'forceFire' && !this._nearestHelipad(u.owner, u.x, u.y)) {
        u.order = { type: 'idle' };
        u.path = []; u._pathGoal = null;
        return;
      }
      u._resumeOrder = { ...u.order };
      u.order = { type: 'rearm' };
      u.path = [];
    }
    if (this._updateAirRearm(u, dt)) return;
    if (this._updateHarvester(u, dt)) return;
    if (d.armor === 'infantry' && this._tile(Math.floor(u.x), Math.floor(u.y))?.type === 'crystal')
      this._applyDamage(u, dt * 2.6, 'ion', null, null);
    if (u.hp <= 0) return;
    const order = u.order || { type: 'idle' };
    const ghostRunActive = (this.replayVersion == null || this.replayVersion >= UNIT_ABILITY_RULES_VERSION) &&
      u.defId === 'stealthTank' && u.ghostRunUntil > this.time;
    if (ghostRunActive) {
      if (order.type === 'move' || order.type === 'forceMove') {
        if (this._moveUnit(u, order.x, order.y, dt, 0.28)) {
          if (!this._advanceQueuedOrder(u, order)) { u.order = { type: 'idle' }; u.path = []; }
        }
      }
      return;
    }
    if (order.type === 'service') { this._updateServiceOrder(u, dt); return; }
    if (order.type === 'board') {
      const carrier = this.getEntity(order.carrierId);
      const carrierDef = carrier && UNIT_DEFS[carrier.defId];
      if (!carrier || carrier.hp <= 0 || carrier.owner !== u.owner || carrierDef?.role !== 'transport' ||
        carrier.passengerIds.length >= carrierDef.capacity) {
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
      } else if (this._isPassable(Math.floor(u.x), Math.floor(u.y)) &&
        dist(u.x, u.y, carrier.x, carrier.y) <= (carrierDef.flying ? 1.15 : 0.8)) {
        carrier.passengerIds.push(u.id);
        u.embarkedIn = carrier.id; u.x = carrier.x; u.y = carrier.y;
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
        u.selected = false; this.selection = this.selection.filter(id => id !== u.id);
        this._event('unitBoarded', { id: u.id, carrierId: carrier.id });
      } else this._moveUnit(u, carrier.x, carrier.y, dt, 0.65);
      return;
    }
    if (order.type === 'unload') {
      if (UNIT_DEFS[u.defId]?.role !== 'transport' || !this._validatePoint(order.x, order.y) ||
        !this._isPassable(Math.floor(order.x), Math.floor(order.y))) {
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
      } else if (this._moveUnit(u, order.x, order.y, dt, 0.35)) {
        const passengers = order.aiTransport ? [...u.passengerIds] : [];
        if (this._unloadPassengers(u)) {
          if (order.aiTransport) for (const id of passengers) {
            const passenger = this.getEntity(id);
            if (!passenger || passenger.hp <= 0 || passenger.embarkedIn) continue;
            passenger._relayAssignment = order.relayId || null;
            const relay = this.relays.find(r => r.id === order.relayId);
            if (relay) passenger.order = { type: 'move', x: relay.x, y: relay.y,
              attackMove: true, relayId: relay.id };
            passenger.path = []; passenger._pathGoal = null;
          }
          u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
          if (order.aiTransport) {
            u._aiTransportComplete = true;
            for (const id of u._aiTransportSquadIds || []) {
              const squadmate = this.getEntity(id);
              if (squadmate && !squadmate.embarkedIn && squadmate.order?.type === 'board' &&
                squadmate.order.carrierId === u.id) {
                squadmate.order = { type: 'idle' }; squadmate.path = []; squadmate._pathGoal = null;
              }
            }
            delete u._aiTransportRelayId; delete u._aiTransportSquadIds;
            delete u._aiTransportStartedAt; delete u._aiTransportProgressAt;
          }
        }
      }
      return;
    }
    if (order.type === 'engineer') {
      const target = this.getEntity(order.targetId);
      if (target && (target.hp > 0 || this.bridges.includes(target) && target.destroyed)) this._updateEngineer(u, target, dt);
      else u.order = { type: 'idle' };
      return;
    }
    if (order.type === 'follow') {
      const followed = this.getEntity(order.targetId);
      if (!followed || followed.hp <= 0 || followed.owner !== u.owner || followed.id === u.id) {
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
        return;
      }
      const c = this._entityCenter(followed);
      const clearance = (d.radius || 0.3) + (UNIT_DEFS[followed.defId]?.radius || 0.35) + 0.55;
      if (this._distanceToEntity(u.x, u.y, followed) > clearance) {
        const stopDistance = 'w' in followed
          ? Math.hypot(followed.w / 2, followed.h / 2) + clearance
          : clearance;
        this._moveUnit(u, c.x, c.y, dt, stopDistance);
      } else if (u.path.length) u.path = [];
      // Following is a movement order; nearby enemies may still be engaged below.
    }
    if (order.type === 'forceFire') {
      if (!this._validatePoint(order.x, order.y) || !d.weapon || d.weapon.target === 'air') {
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
        return;
      }
      const distance = dist(u.x, u.y, order.x, order.y);
      if (distance <= weaponRange && this._hasLineOfSight(u.x, u.y, order.x, order.y)) {
        if (u.cooldown <= 0 && u.suppressedUntil <= this.time)
          this._fireAt(u, { x: order.x, y: order.y }, d.weapon);
        return;
      }
      const oldX = u.x, oldY = u.y;
      this._moveUnit(u, order.x, order.y, dt,
        distance > weaponRange ? weaponRange * 0.8 : 0.2);
      order.stalled = dist(oldX, oldY, u.x, u.y) > 0.01 ? 0 : (order.stalled || 0) + dt;
      if (order.stalled >= 4) {
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
      }
      return;
    }
    let target = null;
    if (order.type === 'attack') {
      target = this.getEntity(order.targetId);
      if (!target || target.hp <= 0 || target.owner === u.owner || !this._weaponCanTarget(d.weapon, target)) {
        if (this._advanceQueuedOrder(u, order)) return;
        u.order = { type: 'idle' }; target = null;
      } else if (u.owner === 'enemy' && order.aiIntel) {
        if (this.isVisible(target, 'enemy')) {
          const center = this._entityCenter(target);
          order.lastX = center.x; order.lastY = center.y;
        } else {
          u.order = { type: 'move', x: order.lastX, y: order.lastY, attackMove: true };
          u.path = []; u._pathGoal = null;
          target = null;
        }
      }
    }
    if (!target && d.weapon && u.stance !== 'holdFire' && order.type !== 'scatter' && order.type !== 'forceMove') {
      const radius = u.stance === 'defensive' || (order.type === 'move' && order.attackMove) ||
        order.type === 'guard' || order.type === 'patrol' ? d.sight : weaponRange + 0.25;
      target = this._findEnemyNear(u, radius, d.weapon.target);
      if (target && order.type === 'guard' &&
        this._distanceToEntity(order.x, order.y, target) > 5.5) target = null;
      if (target && u.stance === 'defensive') {
        const tracked = u._stanceChase;
        if (tracked?.targetId === target.id) {
          if (this._distanceToEntity(tracked.x, tracked.y, target) > 5.5) target = null;
        } else {
          u._stanceChase = { targetId: target.id, x: u.x, y: u.y };
        }
      }
    }
    if (u.stance === 'defensive' && u._stanceChase) {
      const tracked = this.getEntity(u._stanceChase.targetId);
      if (!tracked || tracked.hp <= 0 || tracked.owner === u.owner) u._stanceChase = null;
    }
    if (target && d.weapon) {
      const distance = this._distanceToEntity(u.x, u.y, target);
      const center = this._entityCenter(target);
      const hasLineOfSight = this._hasLineOfSight(u.x, u.y, center.x, center.y);
      if (distance <= weaponRange && hasLineOfSight) {
        if (order.attackMove) u._attackMoveHolding = true;
        if (u.cooldown <= 0 && u.suppressedUntil <= this.time) this._fire(u, target, d.weapon);
        if (order.type === 'attack' || order.attackMove || order.type === 'guard' || order.type === 'patrol') return;
      } else if (order.type === 'attack' || order.attackMove || order.type === 'guard' || order.type === 'patrol') {
        // A unit already inside its nominal range can still be unable to fire
        // through rock. Close the gap so it can move around the obstruction
        // instead of repeatedly arriving at the same out-of-sight endpoint.
        const closeForLineOfSight = !hasLineOfSight &&
          (this.replayVersion == null || this.replayVersion >= 57);
        this._moveUnit(u, center.x, center.y, dt, closeForLineOfSight ? 0.2 : weaponRange * 0.8);
        return;
      }
    }
    if (this.mode === 'skirmish' && (this.replayVersion == null || this.replayVersion >= 19) && u._jamWaypoint) {
      const waypoint = u._jamWaypoint;
      if (['move', 'forceMove'].includes(order.type) && waypoint.goalX === order.x && waypoint.goalY === order.y) {
        if (this._moveUnit(u, waypoint.x, waypoint.y, dt, 0.3)) {
          u._jamWaypoint = null;
          u.path = []; u._pathGoal = null;
        }
        return;
      }
      u._jamWaypoint = null;
      u._jamSeconds = 0;
      u.path = []; u._pathGoal = null;
    }
    if (order.type === 'move' || order.type === 'forceMove') {
      const arrived = this._moveUnit(u, order.x, order.y, dt, 0.28);
      if (arrived && !this._advanceQueuedOrder(u, order)) { u.order = { type: 'idle' }; u.path = []; }
    } else if (order.type === 'guard') {
      this._moveUnit(u, order.x, order.y, dt, 0.35);
    } else if (order.type === 'patrol') {
      const arrived = this._moveUnit(u, order.leg === 1 ? order.bx : order.ax,
        order.leg === 1 ? order.by : order.ay, dt, 0.45);
      if (arrived) { order.leg = order.leg === 1 ? 0 : 1; u.path = []; u._pathGoal = null; }
    } else if (order.type === 'scatter') {
      if (this._moveUnit(u, order.x, order.y, dt, 0.35)) {
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
      }
    } else if (order.type === 'attack' && target && !d.weapon) {
      u.order = { type: 'idle' };
    }
  }

  _resolveUnitSeparation() {
    // Grid obstacles are hard blockers; units give one another soft local clearance.
    const buckets = new Map();
    for (const u of this.units) {
      if (u.hp <= 0 || u.embarkedIn || UNIT_DEFS[u.defId].flying) continue;
      const key = `${Math.floor(u.x / 2)},${Math.floor(u.y / 2)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(u);
    }
    for (const u of this.units) {
      if (u.hp <= 0 || u.embarkedIn || UNIT_DEFS[u.defId].flying) continue;
      const bx = Math.floor(u.x / 2), by = Math.floor(u.y / 2);
      for (let yy = by - 1; yy <= by + 1; yy++) for (let xx = bx - 1; xx <= bx + 1; xx++) {
        for (const other of buckets.get(`${xx},${yy}`) || []) {
          if (other === u || Number(other.id.slice(1)) <= Number(u.id.slice(1)) || other.hp <= 0) continue;
          if (['skirmish', 'multiplayer'].includes(this.mode) &&
            (this.replayVersion == null || this.replayVersion >= 8) && u.owner === other.owner &&
            u.defId === 'harvester' && other.defId === 'harvester' &&
            u.order.type === 'harvest' && other.order.type === 'harvest') continue;
          if (['skirmish', 'multiplayer'].includes(this.mode) &&
            (this.replayVersion == null || this.replayVersion >= 16) && u.owner === other.owner &&
            ['move', 'forceMove'].includes(u.order?.type) && ['move', 'forceMove'].includes(other.order?.type) &&
            u.path?.length && other.path?.length &&
            dist(u.path[0].x, u.path[0].y, other.path[0].x, other.path[0].y) < 0.05) continue;
          const radius = (UNIT_DEFS[u.defId].radius + UNIT_DEFS[other.defId].radius) * 0.9;
          const distance = dist(u.x, u.y, other.x, other.y);
          if (distance >= radius) continue;
          const angle = distance < 0.001 ? (Number(u.id.slice(1)) * 2.399963) : Math.atan2(other.y - u.y, other.x - u.x);
          const offset = Math.min(0.2, (radius - distance) * 0.5);
          const dx = Math.cos(angle) * offset, dy = Math.sin(angle) * offset;
          if (this._isPassable(Math.floor(u.x - dx), Math.floor(u.y - dy))) { u.x -= dx; u.y -= dy; }
          if (this._isPassable(Math.floor(other.x + dx), Math.floor(other.y + dy))) { other.x += dx; other.y += dy; }
        }
      }
    }
  }

  _updateMovementJams(previousPositions, dt) {
    if (this.mode !== 'skirmish') return;
    if (this.replayVersion != null && this.replayVersion < 19) return;
    let groundComponents = null;
    for (const unit of this.units) {
      const order = unit.order;
      if (!['move', 'forceMove'].includes(order?.type) || !Number.isFinite(order.x) ||
        !Number.isFinite(order.y) || unit.embarkedIn) {
        unit._jamSeconds = 0;
        unit._jamWaypoint = null;
        continue;
      }
      if (unit._attackMoveHolding) {
        unit._jamSeconds = 0;
        continue;
      }
      const before = previousPositions.get(unit.id);
      if (unit._jamWaypoint) {
        unit._jamSeconds = before && dist(unit.x, unit.y, before.x, before.y) < 0.08
          ? (unit._jamSeconds || 0) + dt : 0;
        if (unit._jamSeconds >= 2) {
          unit._jamWaypoint = null;
          unit._jamSeconds = 0;
          unit.path = []; unit._pathGoal = null;
        }
        continue;
      }
      if (!before || dist(unit.x, unit.y, order.x, order.y) <= 1.5) {
        unit._jamSeconds = 0;
        continue;
      }
      if (dist(unit.x, unit.y, before.x, before.y) >= 0.08) {
        unit._jamSeconds = 0;
        continue;
      }
      unit._jamSeconds = (unit._jamSeconds || 0) + dt;
      if (unit._jamSeconds < 2) continue;

      // A destroyed crossing can strand a squad on the opposite bank from
      // its order. No local sidestep can reach a different ground component;
      // skip dozens of futile A* searches while retaining the order for a
      // later bridge repair. Recompute on the next jam check so topology
      // changes become available without a separate cache invalidation path.
      groundComponents ||= this._groundComponents();
      const sx = clamp(Math.floor(unit.x), 0, this.width - 1);
      const sy = clamp(Math.floor(unit.y), 0, this.height - 1);
      const goal = this._nearestPassable(clamp(Math.floor(order.x), 0, this.width - 1),
        clamp(Math.floor(order.y), 0, this.height - 1), sx, sy);
      const startComponent = groundComponents[sy * this.width + sx];
      // A unit can briefly occupy a newly blocked tile; A* can still step
      // out of it, so preserve ordinary recovery in that case.
      if (!goal || (startComponent >= 0 &&
        groundComponents[goal[1] * this.width + goal[0]] !== startComponent)) {
        continue;
      }

      // A moving squad can repeatedly soft-bump a unit against a rock or map
      // edge. Give it a short, reachable waypoint around nearby traffic; the
      // ordinary pathfinder still handles every terrain and building obstacle.
      const candidates = [];
      for (let radius = 1; radius <= 3; radius++) {
        for (let y = Math.floor(unit.y) - radius; y <= Math.floor(unit.y) + radius; y++) {
          for (let x = Math.floor(unit.x) - radius; x <= Math.floor(unit.x) + radius; x++) {
            if (Math.max(Math.abs(x - Math.floor(unit.x)), Math.abs(y - Math.floor(unit.y))) !== radius ||
              !this._isPassable(x, y)) continue;
            const point = { x: x + 0.5, y: y + 0.5 };
            if (this.units.some(other => other !== unit && other.hp > 0 && !other.embarkedIn &&
              !UNIT_DEFS[other.defId].flying && dist(point.x, point.y, other.x, other.y) <
                UNIT_DEFS[unit.defId].radius + UNIT_DEFS[other.defId].radius + 0.2)) continue;
            const path = this._findPath(unit.x, unit.y, point.x, point.y);
            if (!path.length || dist(point.x, point.y, order.x, order.y) >=
              dist(unit.x, unit.y, order.x, order.y) + 0.25) continue;
            const routeToGoal = this._findPath(point.x, point.y, order.x, order.y);
            if (!routeToGoal.length) continue;
            candidates.push({ point, score: dist(unit.x, unit.y, point.x, point.y) * 1.4 +
              dist(point.x, point.y, order.x, order.y) });
          }
        }
        if (candidates.length) break;
      }
      candidates.sort((a, b) => a.score - b.score);
      if (candidates.length) {
        unit._jamWaypoint = { ...candidates[0].point, goalX: order.x, goalY: order.y };
        unit._jamSeconds = 0;
        unit.path = [];
        unit._pathGoal = null;
      }
    }
  }

  _findSpawnTile(building) {
    const candidates = [];
    for (let radius = 0; radius <= 4; radius++) {
      for (let y = building.y - radius - 1; y <= building.y + building.h + radius; y++) {
        for (let x = building.x - radius - 1; x <= building.x + building.w + radius; x++) {
          if (!this._isPassable(x, y)) continue;
          const outside = Math.max(building.x - x, x - (building.x + building.w - 1),
            building.y - y, y - (building.y + building.h - 1));
          if (outside !== radius + 1) continue;
          if (this.units.some(u => u.hp > 0 && dist(u.x, u.y, x + 0.5, y + 0.5) < 0.75)) continue;
          candidates.push({ x: x + 0.5, y: y + 0.5,
            score: dist(x + 0.5, y + 0.5, building.rally.x, building.rally.y) + radius * 3 });
        }
      }
      if (candidates.length) break;
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0] || null;
  }

  _onBuildingComplete(b) {
    this._refreshPower();
    this._event('constructionComplete', { id: b.id, owner: b.owner, defId: b.defId, x: b.x, y: b.y });
    if (b.defId === 'refinery') {
      const spawn = this._findSpawnTile(b);
      if (spawn) this._createUnit(b.owner, 'harvester', spawn.x, spawn.y, { type: 'harvest' });
    }
  }

  _updateBuildings(dt) {
    const servicedVehicles = new Set();
    for (const b of this.buildings) {
      if (b.hp <= 0) continue;
      const def = BUILDING_DEFS[b.defId];
      if (b.progress < 1) {
        const rate = this.power[b.owner].ratio;
        b.progress = Math.min(1, b.progress + dt * rate / Math.max(1, def.buildTime));
        if (b.progress >= 1) this._onBuildingComplete(b);
        continue;
      }
      if (b.repairing && !(b.captureOnly && b.owner === 'enemy') && b.hp < b.maxHp && this.credits[b.owner] > 0) {
        const amount = Math.min(b.maxHp - b.hp, dt * 33, this.credits[b.owner] * 3.7);
        b.hp += amount; this.credits[b.owner] -= amount / 3.7;
        if (b.hp >= b.maxHp - 0.1) { b.hp = b.maxHp; b.repairing = false; }
      }
      if (b.defId === 'serviceBay' && b.powered) {
        for (const u of this.units) {
          const unitDef = UNIT_DEFS[u.defId];
          if (u.owner !== b.owner || u.hp <= 0 || u.embarkedIn || unitDef.flying ||
            !['light', 'heavy'].includes(unitDef.armor) || servicedVehicles.has(u.id) ||
            u.hp >= u.maxHp || this._distanceToEntity(u.x, u.y, b) > 2.5 || this.credits[b.owner] <= 0) continue;
          const repair = Math.min(u.maxHp - u.hp, dt * 11, this.credits[b.owner] * 2);
          if (repair <= 0) continue;
          u.hp += repair;
          this.credits[b.owner] -= repair * 0.5;
          servicedVehicles.add(u.id);
        }
      }
      b.cooldown = Math.max(0, b.cooldown - dt);
      if (def.weapon && b.powered) {
        const c = this._entityCenter(b);
        const target = this._findEnemyNear({ owner: b.owner, x: c.x, y: c.y }, def.weapon.range, def.weapon.target);
        if (target && b.cooldown <= 0 && this._hasLineOfSight(c.x, c.y, this._entityCenter(target).x, this._entityCenter(target).y))
          this._fire(b, target, def.weapon);
      }
      if (!b.queue.length) continue;
      const q = b.queue[0], ud = UNIT_DEFS[q.defId];
      q.progress = Math.min(1, q.progress + dt * this.power[b.owner].ratio *
        (b.overchargedUntil > this.time ? 1.65 : 1) / ud.buildTime);
      if (q.progress < 1) continue;
      const spawn = this._findSpawnTile(b);
      if (!spawn) continue;
      b.queue.shift();
      const u = this._createUnit(b.owner, q.defId, spawn.x, spawn.y);
      if (u.defId === 'harvester') u.order = { type: 'harvest' };
      else if (b.rally && dist(u.x, u.y, b.rally.x, b.rally.y) > 1)
        u.order = { type: 'move', x: b.rally.x, y: b.rally.y, attackMove: false };
      this._event('unitReady', { id: u.id, owner: u.owner, defId: u.defId, buildingId: b.id });
    }
  }

  sellBuilding(buildingId) {
    const owner = this.commandOwner || 'player';
    const b = this.getEntity(buildingId);
    if (!b || !('w' in b) || b.owner !== owner) return { ok: false, reason: 'Choose a friendly structure.' };
    const refund = Math.round(BUILDING_DEFS[b.defId].cost * 0.5);
    this.credits[owner] = Math.min(this.creditCapacity[owner], this.credits[owner] + refund);
    b.hp = 0; b._dead = true;
    this._event('buildingSold', { id: b.id, defId: b.defId, refund });
    this._refreshPower();
    return { ok: true, refund };
  }

  _regrowCrystals() {
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(this._rand() * this.width), y = Math.floor(this._rand() * this.height);
      const t = this._tile(x, y);
      if (!t?.walkable) continue;
      if (t.type === 'crystal') {
        t.resource = Math.min(750, t.resource + 14 + this._rand() * 22);
        continue;
      }
      if (t.type !== 'sand' || this.relays.some(r => Math.floor(r.x) === x && Math.floor(r.y) === y) ||
        this.buildings.some(b => b.hp > 0 && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) continue;
      let neighbors = 0;
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
        if (this._tile(xx, yy)?.type === 'crystal') neighbors++;
      }
      if (neighbors >= 2 && this._rand() < 0.32) {
        t.type = 'crystal'; t.resource = 140 + Math.floor(this._rand() * 120); t.buildable = false;
      }
    }
  }

  _findAiPlacement(defId, anchorId = null) {
    const d = BUILDING_DEFS[defId];
    const anchor = this.buildings.find(b => b.owner === 'enemy' && b.defId === 'command' && b.hp > 0 &&
      (!anchorId || b.id === anchorId));
    if (!anchor) return null;
    let best = null, score = Infinity;
    for (let i = 0; i < 160; i++) {
      const angle = this._rand() * Math.PI * 2;
      const radius = 3 + this._rand() * 9;
      const x = Math.floor(anchor.x + anchor.w / 2 + Math.cos(angle) * radius - d.w / 2);
      const y = Math.floor(anchor.y + anchor.h / 2 + Math.sin(angle) * radius - d.h / 2);
      if (!this.canPlaceBuilding(defId, x, y, 'enemy').ok) continue;
      const s = radius + (defId === 'turret' ? -dist(x, y, 10, 37) * 0.09 : 0) + this._rand() * 2;
      if (s < score) { best = { x, y }; score = s; }
    }
    return best;
  }

  _aiBuild(defId, anchorId = null, placement = null) {
    if (this.buildings.some(b => b.owner === 'enemy' && b.progress < 1 && b.hp > 0)) return false;
    if (!this.canBuild(defId, 'enemy').ok) return false;
    const pos = placement || this._findAiPlacement(defId, anchorId);
    if (!pos) return false;
    this.credits.enemy -= BUILDING_DEFS[defId].cost;
    this._createBuilding('enemy', defId, pos.x, pos.y, 0);
    this._event('constructionStarted', { owner: 'enemy', defId, x: pos.x, y: pos.y });
    return true;
  }

  _aiRecoverEconomy() {
    if (this.mode !== 'skirmish' ||
      (this.replayVersion != null && this.replayVersion < ECONOMY_RECOVERY_RULES_VERSION)) return;
    const refineries = this.buildings.filter(building => building.owner === 'enemy' &&
      building.defId === 'refinery' && building.hp > 0);
    const harvesters = this.units.filter(unit => unit.owner === 'enemy' &&
      unit.defId === 'harvester' && unit.hp > 0);
    if (refineries.some(refinery => refinery.progress >= 1)) {
      // A Harvester that returned to a destroyed final refinery idles with its
      // crystal still aboard. Resume docking once a replacement is operational.
      for (const unit of harvesters) if (unit.order?.type === 'idle') {
        unit.order = { type: 'harvest' };
        unit._harvestPhase = unit.cargo > 0 ? 'return' : 'field';
        unit.path = []; unit._pathGoal = null;
      }
      return;
    }
    if (refineries.length || !harvesters.length ||
      this.credits.enemy >= BUILDING_DEFS.refinery.cost ||
      this.buildings.some(building => building.owner === 'enemy' && building.hp > 0 && building.progress < 1) ||
      !this.hasBuilding('enemy', 'command') || !this.hasBuilding('enemy', 'power')) return;
    const yard = this.buildings.find(building => building.owner === 'enemy' &&
      building.defId === 'command' && building.hp > 0);
    if (!yard || this._aiExpansionThreatened(yard.x + yard.w / 2, yard.y + yard.h / 2, 10)) return;
    const defenses = this.buildings.filter(building => building.owner === 'enemy' &&
      building.hp > 0 && building.progress >= 1 &&
      ['turret', 'guardTower', 'aaTower', 'sam', 'obelisk'].includes(building.defId))
      .sort((a, b) => Number(a.defId !== 'turret') - Number(b.defId !== 'turret') ||
        a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id));
    const sales = [];
    let projectedCredits = this.credits.enemy;
    for (const defense of defenses) {
      if (projectedCredits >= BUILDING_DEFS.refinery.cost || sales.length >= 2 ||
        defenses.length - sales.length <= 1) break;
      sales.push(defense);
      projectedCredits += Math.round(BUILDING_DEFS[defense.defId].cost * 0.5);
    }
    if (projectedCredits < BUILDING_DEFS.refinery.cost) return;
    const placement = this._findAiPlacement('refinery');
    if (!placement) return;
    const previousOwner = this.commandOwner;
    this.commandOwner = 'enemy';
    try { for (const defense of sales) this.sellBuilding(defense.id); }
    finally { this.commandOwner = previousOwner; }
    this._aiBuild('refinery', null, placement);
  }

  _aiExpansionEnabled() {
    return this.mode === 'skirmish' && ['normal', 'hard'].includes(this.difficulty) &&
      (this.replayVersion == null || this.replayVersion >= 8);
  }

  _aiSiegeDirectorActive() {
    return this._aiCommanderProfileActive('siege-director') &&
      (this.replayVersion == null || this.replayVersion >= SIEGE_DIRECTOR_RULES_VERSION);
  }

  _aiSiegeExpansionActive() {
    return this._aiSiegeDirectorActive() &&
      (this.replayVersion == null || this.replayVersion >= SIEGE_EXPANSION_RULES_VERSION);
  }

  _aiExpansionThreatened(x, y, radius = 9) {
    const mobileThreat = this.units.some(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
      UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy') && dist(unit.x, unit.y, x, y) < radius);
    if (mobileThreat) return true;
    return this._aiSiegeDirectorActive() && this.buildings.some(building => {
      const weapon = BUILDING_DEFS[building.defId]?.weapon;
      if (building.owner !== 'player' || building.hp <= 0 || building.progress < 1 || !building.powered ||
          !weapon || !['ground', 'both'].includes(weapon.target || 'ground') || !this.isVisible(building, 'enemy'))
        return false;
      const center = this._entityCenter(building);
      return dist(center.x, center.y, x, y) <= Math.max(radius, weapon.range + 2);
    });
  }

  _aiExpansionFallbackSite(unit, origin) {
    const refineries = this.buildings.filter(building => building.owner === 'enemy' &&
      building.defId === 'refinery' && building.hp > 0);
    const crystals = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const tile = this.terrain[y][x];
      if (tile.type === 'crystal' && tile.resource > 0) crystals.push({ x: x + 0.5, y: y + 0.5 });
    }
    const candidates = [];
    for (let y = Math.max(2, origin.y - 4); y <= Math.min(this.height - 5, origin.y + 4); y++)
      for (let x = Math.max(2, origin.x - 4); x <= Math.min(this.width - 5, origin.x + 4); x++) {
        if (x === origin.x && y === origin.y) continue;
        let clear = true;
        for (let yy = y; yy < y + 3 && clear; yy++) for (let xx = x; xx < x + 3; xx++)
          if (!this.terrain[yy][xx].buildable || this.buildings.some(building => building.hp > 0 &&
            xx >= building.x && xx < building.x + building.w && yy >= building.y && yy < building.y + building.h) ||
            this.units.some(other => other.id !== unit.id && other.hp > 0 && other.x >= xx - 0.3 &&
              other.x <= xx + 1.3 && other.y >= yy - 0.3 && other.y <= yy + 1.3)) { clear = false; break; }
        if (!clear) continue;
        const cx = x + 1.5, cy = y + 1.5;
        if (this._aiExpansionThreatened(cx, cy, 11)) continue;
        const path = this._findPath(unit.x, unit.y, cx, cy);
        if (!path.length) continue;
        const crystalCount = crystals.filter(crystal => dist(crystal.x, crystal.y, cx, cy) <= 8 &&
          !refineries.some(refinery => dist(crystal.x, crystal.y,
            refinery.x + refinery.w / 2, refinery.y + refinery.h / 2) <= 10)).length;
        if (crystalCount < 5) continue;
        candidates.push({ x, y, distance: dist(x, y, origin.x, origin.y) });
      }
    candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    return candidates[0] || null;
  }

  _aiExpansionSite() {
    const base = this.buildings.find(building => building.owner === 'enemy' &&
      building.defId === 'command' && building.hp > 0);
    if (!base) return null;
    const refineries = this.buildings.filter(building => building.owner === 'enemy' &&
      building.defId === 'refinery' && building.hp > 0);
    const components = this._groundComponents();
    const componentAt = (x, y) => components[Math.floor(y) * this.width + Math.floor(x)];
    const baseApproach = this._nearestPassable(base.x + 1, base.y + 1,
      base.x + 1, base.y + 1);
    const baseComponent = baseApproach ? componentAt(baseApproach[0] + 0.5, baseApproach[1] + 0.5) : -1;
    if (baseComponent < 0) return null;
    const crystals = [];
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const tile = this.terrain[y][x];
      if (tile.type === 'crystal' && tile.resource > 0 && this._isPassable(x, y) &&
        componentAt(x + 0.5, y + 0.5) === baseComponent) crystals.push({ x: x + 0.5, y: y + 0.5 });
    }
    let best = null;
    for (let y = 2; y < this.height - 4; y++) for (let x = 2; x < this.width - 4; x++) {
      let clear = true;
      for (let yy = y; yy < y + 3 && clear; yy++) for (let xx = x; xx < x + 3; xx++)
        if (!this.terrain[yy][xx].buildable || this.buildings.some(building => building.hp > 0 &&
          xx >= building.x && xx < building.x + building.w && yy >= building.y && yy < building.y + building.h) ||
          this.units.some(unit => unit.hp > 0 && unit.x >= xx - 0.3 && unit.x <= xx + 1.3 &&
            unit.y >= yy - 0.3 && unit.y <= yy + 1.3)) { clear = false; break; }
      if (!clear) continue;
      const cx = x + 1.5, cy = y + 1.5;
      if (componentAt(cx, cy) !== baseComponent || dist(cx, cy, base.x + 1.5, base.y + 1.5) < 12 ||
        this._aiExpansionThreatened(cx, cy, 11)) continue;
      const patch = crystals.filter(crystal => dist(crystal.x, crystal.y, cx, cy) <= 8 &&
        !refineries.some(refinery => dist(crystal.x, crystal.y, refinery.x + refinery.w / 2,
          refinery.y + refinery.h / 2) <= 10));
      if (patch.length < 5) continue;
      // Deployment bypasses the ordinary base-perimeter check, but the follow-up
      // refinery must fit inside the new yard's normal 4.5-tile perimeter.
      let refinerySite = false;
      for (let ry = y - 5; ry <= y + 8 && !refinerySite; ry++) for (let rx = x - 5; rx <= x + 8; rx++) {
        if (rx < 1 || ry < 1 || rx + BUILDING_DEFS.refinery.w >= this.width ||
          ry + BUILDING_DEFS.refinery.h >= this.height) continue;
        if (Math.hypot(Math.max(0, x - (rx + BUILDING_DEFS.refinery.w)),
          Math.max(0, rx - (x + 3)), Math.max(0, y - (ry + BUILDING_DEFS.refinery.h)),
          Math.max(0, ry - (y + 3))) > 4.5) continue;
        let legal = true;
        for (let yy = ry; yy < ry + BUILDING_DEFS.refinery.h && legal; yy++)
          for (let xx = rx; xx < rx + BUILDING_DEFS.refinery.w; xx++)
            if (!this.terrain[yy][xx].buildable ||
              rx < x + 3 && rx + BUILDING_DEFS.refinery.w > x && ry < y + 3 && ry + BUILDING_DEFS.refinery.h > y ||
              this.buildings.some(building => building.hp > 0 && xx >= building.x && xx < building.x + building.w &&
                yy >= building.y && yy < building.y + building.h) ||
              this.units.some(unit => unit.hp > 0 && unit.x >= xx - 0.3 && unit.x <= xx + 1.3 &&
                unit.y >= yy - 0.3 && unit.y <= yy + 1.3)) { legal = false; break; }
        if (legal) { refinerySite = true; break; }
      }
      if (!refinerySite) continue;
      const baseDistance = dist(cx, cy, base.x + 1.5, base.y + 1.5);
      let score = this._aiSiegeDirectorActive()
        ? Math.min(25, patch.length) - baseDistance * 2
        : patch.length * 10 - baseDistance;
      // Advance toward an enemy structure the AI recently observed, without
      // consulting live hidden enemy state.
      if (this._aiSiegeDirectorActive()) {
        const observedFront = (this._aiIntel || []).filter(item => item.building &&
          this.time - item.seen <= 90).sort((a, b) => b.seen - a.seen || a.id.localeCompare(b.id))[0];
        if (observedFront) score -= dist(cx, cy, observedFront.x, observedFront.y) * 0.4;
      }
      if (!best || score > best.score || score === best.score && (y < best.y || y === best.y && x < best.x))
        best = { x, y, score };
    }
    return best;
  }

  _aiEscortExpansionRig(rig) {
    if (!this._aiSiegeDirectorActive() || !rig || rig.hp <= 0) return;
    for (const unit of this.units) if (unit.owner === 'enemy' && unit._aiExpansionEscort &&
      unit._aiExpansionEscort !== rig.id) {
      unit._aiExpansionEscort = null;
      if (unit.order?.aiExpansionEscort) {
        unit.order = { type: 'idle' }; unit.path = []; unit._pathGoal = null;
      }
    }
    const assigned = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      unit._aiExpansionEscort === rig.id);
    const available = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 && unit !== rig &&
      !unit.embarkedIn && ['lightTank', 'buggy', 'guardian', 'rifle', 'rocket'].includes(unit.defId) &&
      !unit._aiExpansionEscort && !unit._aiDefenseTarget && !unit._aiRaidTarget && !unit._aiRecovering)
      .sort((a, b) => dist(a.x, a.y, rig.x, rig.y) - dist(b.x, b.y, rig.x, rig.y) ||
        a.id.localeCompare(b.id));
    while (assigned.length < 2 && available.length) {
      const unit = available.shift();
      unit._relayAssignment = null;
      unit._aiExpansionEscort = rig.id;
      unit.order = { type: 'follow', targetId: rig.id, aiExpansionEscort: true };
      unit.path = []; unit._pathGoal = null;
      assigned.push(unit);
    }
  }

  _aiManageExpansion() {
    if (!this._aiExpansionEnabled()) return false;
    const siegeDirector = this._aiSiegeDirectorActive();
    if (this._aiUnderRelayDominionPressure()) {
      // A live Dominion countdown is an immediate defeat threat. Recover cash
      // and factory time from an unbuilt expansion rig for combat production.
      // Delay its retry so a brief relay contest does not restart the queue.
      let cancelled = false;
      const previousOwner = this.commandOwner;
      this.commandOwner = 'enemy';
      try {
        for (const factory of this.buildings.filter(building => building.owner === 'enemy' &&
          building.defId === 'factory' && building.hp > 0)) {
          for (let index = factory.queue.length - 1; index >= 0; index--) {
            if (factory.queue[index].defId !== 'mcv') continue;
            cancelled = this.cancelQueuedUnit(factory.id, index).ok || cancelled;
          }
        }
      } finally {
        this.commandOwner = previousOwner;
      }
      if (cancelled) this._aiExpansionTarget = {
        ...(this._aiExpansionTarget || {}), stage: 'funding', retryAt: this.time + 90,
      };
      return cancelled;
    }
    const yards = this.buildings.filter(building => building.owner === 'enemy' &&
      building.defId === 'command' && building.hp > 0);
    if (yards.length > 1) {
      const outpost = yards.find(building => building.id === this._aiExpansionTarget?.yardId) ||
        yards.sort((a, b) => dist(a.x, a.y, this.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester')?.x ?? 54,
          this.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester')?.y ?? 18) -
          dist(b.x, b.y, this.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester')?.x ?? 54,
            this.units.find(unit => unit.owner === 'enemy' && unit.defId === 'harvester')?.y ?? 18))[0];
      this._aiExpansionTarget = { ...(this._aiExpansionTarget || {}), yardId: outpost.id, stage: 'refinery' };
      const localRefinery = this.buildings.some(building => building.owner === 'enemy' && building.defId === 'refinery' &&
        building.hp > 0 && Math.hypot(Math.max(0, outpost.x - (building.x + building.w)),
          Math.max(0, building.x - (outpost.x + outpost.w)), Math.max(0, outpost.y - (building.y + building.h)),
          Math.max(0, building.y - (outpost.y + outpost.h))) <= 8);
      if (localRefinery) { this._aiExpansionTarget = null; return false; }
      if (this.credits.enemy < BUILDING_DEFS.refinery.cost + 200 || this.enemyConstruction) return false;
      return this._aiBuild('refinery', outpost.id);
    }

    this._aiExpansionTarget ??= null;
    if (this._aiExpansionTarget?.retryAt) {
      if (this.time < this._aiExpansionTarget.retryAt) return false;
      delete this._aiExpansionTarget.retryAt;
      const waitingRig = this.units.find(unit => unit.owner === 'enemy' && unit.defId === 'mcv' && unit.hp > 0);
      if (waitingRig && Number.isFinite(this._aiExpansionTarget.x) && Number.isFinite(this._aiExpansionTarget.y)) {
        const targetX = this._aiExpansionTarget.x + 1.5, targetY = this._aiExpansionTarget.y + 1.5;
        const stillReachable = this._findPath(waitingRig.x, waitingRig.y, targetX, targetY).length > 0;
        if (!stillReachable || this._aiExpansionThreatened(targetX, targetY, 11)) {
          const fallback = this._aiExpansionFallbackSite(waitingRig, this._aiExpansionTarget);
          if (fallback) {
            this._aiExpansionTarget.x = fallback.x; this._aiExpansionTarget.y = fallback.y;
            this._aiExpansionTarget.stage = 'queued';
            waitingRig.order = { type: 'move', x: fallback.x + 1.5, y: fallback.y + 1.5 };
            waitingRig.path = []; waitingRig._pathGoal = null;
          } else {
            this._aiExpansionTarget.retryAt = this.time + 90;
            return false;
          }
        }
      }
      if (!Number.isFinite(this._aiExpansionTarget.x) || !Number.isFinite(this._aiExpansionTarget.y)) {
        if (waitingRig) {
          const site = this._aiExpansionSite();
          if (!site) return false;
          Object.assign(this._aiExpansionTarget, { x: site.x, y: site.y, stage: 'queued' });
        } else this._aiExpansionTarget = null;
      }
    }
    const factory = this.buildings.find(building => building.owner === 'enemy' && building.defId === 'factory' &&
      building.hp > 0 && building.progress >= 1);
    if (!this._aiExpansionTarget) {
      const refineryCount = this.buildings.filter(building => building.owner === 'enemy' &&
        building.defId === 'refinery' && building.hp > 0).length;
      if (this.time < (siegeDirector ? 80 : 110) || !siegeDirector && refineryCount < 2 || !factory ||
        !siegeDirector && !this.hasBuilding('enemy', 'tech') || this.enemyConstruction) return false;
      const site = this._aiExpansionSite();
      if (!site) return false;
      this._aiExpansionTarget = { x: site.x, y: site.y, stage: 'funding' };
    }

    let rig = this.units.find(unit => unit.owner === 'enemy' && unit.defId === 'mcv' && unit.hp > 0);
    if (!rig) {
      const queued = this.buildings.some(building => building.owner === 'enemy' && building.queue?.some(item => item.defId === 'mcv'));
      if (queued) return false;
      if (this._aiExpansionTarget.stage === 'funding') {
        if (this.credits.enemy < UNIT_DEFS.mcv.cost + 200 || this.enemyConstruction) return false;
        if (!this._queueUnit('enemy', 'mcv').ok) return false;
        this._aiExpansionTarget.stage = 'queued';
        return true;
      }
      // A lost/cancelled rig receives a bounded retry delay.
      this._aiExpansionTarget = { retryAt: this.time + 90 };
      return false;
    }
    rig._aiExpansion = true;
    if (this._aiSiegeExpansionActive()) {
      // Relay response used to pull the expansion rig off its public site route.
      // Release any assignment made under older state before reserving this unit.
      rig._relayAssignment = null;
      rig._aiRelayResponseRelayId = null;
      rig._aiRelayUrgentRelayId = null;
      rig._aiRelayReconRelayId = null;
      rig._aiRelayResponseOrder = null;
      rig._aiRelayResponsePriorAssignment = null;
    }
    this._aiEscortExpansionRig(rig);
    const targetX = this._aiExpansionTarget.x + 1.5, targetY = this._aiExpansionTarget.y + 1.5;
    if (this._aiExpansionThreatened(targetX, targetY, 11)) {
      rig.order = { type: 'idle' }; rig.path = []; rig._pathGoal = null;
      this._aiExpansionTarget.retryAt = this.time + 90;
      return false;
    }
    if (dist(rig.x, rig.y, targetX, targetY) > 1.2) {
      const path = this._findPath(rig.x, rig.y, targetX, targetY);
      if (!path.length) {
        const fallback = this._aiExpansionFallbackSite(rig, this._aiExpansionTarget);
        if (fallback) {
          this._aiExpansionTarget.x = fallback.x; this._aiExpansionTarget.y = fallback.y;
          rig.order = { type: 'move', x: fallback.x + 1.5, y: fallback.y + 1.5 };
          rig.path = []; rig._pathGoal = null;
          return true;
        }
        rig.order = { type: 'idle' }; rig.path = []; rig._pathGoal = null;
        this._aiExpansionTarget.retryAt = this.time + 90;
        return false;
      }
      if (rig.order?.type !== 'move' || rig.order.x !== targetX || rig.order.y !== targetY) {
        rig.order = { type: 'move', x: targetX, y: targetY };
        rig.path = []; rig._pathGoal = null;
      }
      return true;
    }
    const deployCheck = this._canDeployMCV(rig);
    if (!deployCheck.ok) {
      const fallback = ['Move nearby units away first.', 'Another structure blocks deployment.',
        'Clear terrain is required to deploy.'].includes(deployCheck.reason)
        ? this._aiExpansionFallbackSite(rig, this._aiExpansionTarget) : null;
      if (fallback) {
        this._aiExpansionTarget.x = fallback.x; this._aiExpansionTarget.y = fallback.y;
        rig.order = { type: 'move', x: fallback.x + 1.5, y: fallback.y + 1.5 };
        rig.path = []; rig._pathGoal = null;
        return true;
      }
      this._aiExpansionTarget.retryAt = this.time + 90;
      return false;
    }
    const deployed = this._deployMCV(rig, 'enemy');
    if (!deployed.ok) {
      const fallback = ['Move nearby units away first.', 'Another structure blocks deployment.'].includes(deployed.reason)
        ? this._aiExpansionFallbackSite(rig, this._aiExpansionTarget) : null;
      if (fallback) {
        this._aiExpansionTarget.x = fallback.x; this._aiExpansionTarget.y = fallback.y;
        rig.order = { type: 'move', x: fallback.x + 1.5, y: fallback.y + 1.5 };
        rig.path = []; rig._pathGoal = null;
        return true;
      }
      this._aiExpansionTarget.retryAt = this.time + 90;
      return false;
    }
    this._aiExpansionTarget.yardId = deployed.id;
    this._aiExpansionTarget.stage = 'refinery';
    return true;
  }

  _aiUnderRelayDominionPressure() {
    return this.mode === 'skirmish' && this.relayDominion?.owner === 'player' &&
      (this.replayVersion == null || this.replayVersion >= RELAY_DOMINION_EXPANSION_PAUSE_RULES_VERSION);
  }

  _aiObserve() {
    // Enemy decisions use the same sight and stealth rules as ordinary units.
    this._aiIntel ??= [];
    for (const entity of [...this.units, ...this.buildings]) {
      if (entity.owner !== 'player' || entity.hp <= 0 || !this.isVisible(entity, 'enemy')) continue;
      const center = this._entityCenter(entity);
      const known = this._aiIntel.find(item => item.id === entity.id);
      const sighting = { id: entity.id, defId: entity.defId, x: center.x, y: center.y,
        building: 'w' in entity, seen: this.time };
      if (known) Object.assign(known, sighting);
      else this._aiIntel.push(sighting);
    }
    this._aiIntel = this._aiIntel.filter(item => this.time - item.seen <= (item.building ? 180 : 24));
  }

  _aiScout(combatUnits) {
    const economyRecon = this.mode === 'skirmish' && this._aiCommanderProfileActive('raider') &&
      (this.replayVersion == null || this.replayVersion >= AI_ECONOMY_RECON_RULES_VERSION);
    if (!economyRecon && this._aiIntel.some(item => this.time - item.seen < 18)) return;
    if (economyRecon) {
      const harvesterIntel = this._aiIntel.some(item => item.defId === 'harvester' &&
        this.time - item.seen < 36);
      const harvesterVisible = this.units.some(unit => unit.owner === 'player' && unit.defId === 'harvester' &&
        unit.hp > 0 && this.isVisible(unit, 'enemy'));
      const cadetOpening = this.difficulty === 'easy' && this.time < 45;
      const yielding = cadetOpening || this.time >= 210 || harvesterIntel || harvesterVisible ||
        combatUnits.some(unit => unit._aiRaidTarget || unit._aiDefenseTarget) ||
        this._aiUnderRelayDominionPressure();
      if (yielding) {
        for (const unit of combatUnits) if (unit.order?.aiScout &&
          !unit._aiDefenseTarget && !unit._aiRaidTarget && !unit._relayAssignment) {
          unit.order = { type: 'idle' };
          unit.path = []; unit._pathGoal = null;
        }
        return;
      }
    }
    const scout = economyRecon
      ? combatUnits.find(u => u.defId === 'scout' && !u._relayAssignment &&
        !u._aiDefenseTarget && u.order?.type !== 'attack') ||
        combatUnits.find(u => u.defId === 'buggy' && !u._relayAssignment &&
          !u._aiDefenseTarget && !u._aiRaidTarget && u.order?.type !== 'attack')
      : combatUnits.find(u => ['scout', 'buggy'].includes(u.defId) &&
        !u._relayAssignment && !u._aiDefenseTarget && u.order?.type !== 'attack');
    if (!scout) return;
    let route = [{ x: 32, y: 25 }, { x: 22, y: 32 }, { x: 12, y: 37 }];
    if (economyRecon) {
      // The authored starts are public map geometry. Sweep the approach from
      // midfield to the edge of the opposing start zone without consulting
      // any hidden unit or resource positions.
      const playerStart = { x: 10, y: 37 };
      const enemyStart = { x: 51, y: 12 };
      const dx = playerStart.x - enemyStart.x, dy = playerStart.y - enemyStart.y;
      const length = Math.hypot(dx, dy) || 1;
      const px = -dy / length, py = dx / length;
      const point = (fraction, offset = 0) => ({
        x: clamp(enemyStart.x + dx * fraction + px * offset, 2, this.width - 3),
        y: clamp(enemyStart.y + dy * fraction + py * offset, 2, this.height - 3),
      });
      route = [point(0.52), point(0.68), point(0.79, 3.5), point(0.87),
        point(0.93, -3), point(0.93), point(0.79, -3.5), point(0.68)];
    }
    const reachablePoint = rawPoint => {
      if (!economyRecon) return rawPoint;
      // Variant terrain may put the idealized sweep point inside a rock spine
      // or water scar. Snap it to the nearest passable tile using only static
      // terrain, and issue a tile-center goal so arrival advances the sweep.
      const nearest = this._nearestPassable(Math.floor(rawPoint.x), Math.floor(rawPoint.y),
        Math.floor(scout.x), Math.floor(scout.y));
      return nearest ? { x: nearest[0] + 0.5, y: nearest[1] + 0.5 } : rawPoint;
    };
    let step = this._aiScoutStep % route.length;
    let point = reachablePoint(route[step]);
    if (dist(scout.x, scout.y, point.x, point.y) < 2) {
      this._aiScoutStep++;
      step = this._aiScoutStep % route.length;
      point = reachablePoint(route[step]);
    }
    if (!(scout.order?.aiScout && scout.order.x === point.x && scout.order.y === point.y)) {
      scout.order = { type: 'move', x: point.x, y: point.y, attackMove: true, aiScout: true };
      scout.path = []; scout._pathGoal = null;
    }
    if (economyRecon) {
      // One available screen unit escorts the recon unit. Defenders, relay
      // assignments, and committed raids retain priority.
      const escort = combatUnits.filter(unit => unit !== scout &&
        ['buggy', 'lightTank'].includes(unit.defId) && !unit._relayAssignment &&
        !unit._aiDefenseTarget && !unit._aiRaidTarget &&
        unit.order?.type !== 'attack' && unit.order?.type !== 'rearm')
        .sort((a, b) => dist(a.x, a.y, scout.x, scout.y) - dist(b.x, b.y, scout.x, scout.y) ||
          a.id.localeCompare(b.id))[0];
      if (escort && (!escort.order?.aiScout || escort.order.x !== point.x || escort.order.y !== point.y)) {
        escort.order = { type: 'move', x: point.x, y: point.y, attackMove: true, aiScout: true,
          aiScoutEscort: scout.id };
        escort.path = []; escort._pathGoal = null;
      }
    }
  }

  _aiDefend(combatUnits) {
    const assets = [...this.units, ...this.buildings].filter(e => e.owner === 'enemy' && e.hp > 0 &&
      (e.defId === 'harvester' || ['command', 'refinery', 'factory'].includes(e.defId)));
    const threats = this.units.filter(u => u.owner === 'player' && u.hp > 0 &&
      this.isVisible(u, 'enemy') && (UNIT_DEFS[u.defId].weapon ||
        (this.mode === 'skirmish' && (this.replayVersion == null || this.replayVersion >= 23) && u.defId === 'medic' &&
          this.units.some(ally => ally.owner === 'player' && ally.hp > 0 && !ally.embarkedIn &&
            UNIT_DEFS[ally.defId]?.weapon && dist(ally.x, ally.y, u.x, u.y) <= 2.1))))
      .map(unit => ({ unit, assetDistance: Math.min(...assets.map(asset => {
        const center = this._entityCenter(asset);
        return dist(center.x, center.y, unit.x, unit.y);
      })) }))
      .filter(item => item.assetDistance < 8)
      .sort((a, b) => a.assetDistance - b.assetDistance || a.unit.id.localeCompare(b.unit.id));
    // Campaign encounters are authored around the historical single-threat
    // response; distribute the same defender cap only in freeform skirmishes.
    const responseThreats = this.mode === 'skirmish' ? threats : threats.slice(0, 1);
    const threatById = new Map(responseThreats.map(item => [item.unit.id, item.unit]));
    const emergencyRecall = this.mode === 'skirmish' &&
      (this.replayVersion == null || this.replayVersion >= 25);
    for (const u of combatUnits) if (u._aiDefenseTarget && !threatById.has(u._aiDefenseTarget)) {
      u._aiDefenseTarget = null;
      if (u.order?.aiDefense) {
        u.order = emergencyRecall && u._aiDefenseResumeOrder || { type: 'idle' };
        u.path = []; u._pathGoal = null;
      }
      if (emergencyRecall) u._aiDefenseResumeOrder = null;
    }
    if (!responseThreats.length) return;
    const maxDefenders = this.difficulty === 'hard' ? 4 : this.difficulty === 'easy' ? 2 : 3;
    const assigned = new Map(responseThreats.map(({ unit }) => [unit.id,
      combatUnits.filter(u => u._aiDefenseTarget === unit.id)]));
    // An assault can empty the base of defenders. Recall a nearby attacker only
    // when a visible enemy is already close to production or a harvester; keep
    // the normal defender cap and prefer units that are not on an assault.
    const canRespond = (unit, item) => dist(unit.x, unit.y, item.unit.x, item.unit.y) < 20 &&
      this._weaponCanTarget(UNIT_DEFS[unit.defId].weapon, item.unit) &&
      (unit.order?.type !== 'attack' || emergencyRecall && item.assetDistance < 5.5 &&
        dist(unit.x, unit.y, item.unit.x, item.unit.y) < 12);
    const available = combatUnits.filter(u => !u._aiDefenseTarget &&
      (emergencyRecall ? !u._aiRaidTarget && !u._aiRecovering &&
        (u.ammo == null || u.ammo >= 1) &&
        (u.order?.type !== 'attack' || responseThreats.some(item =>
          item.assetDistance < 5.5 && dist(u.x, u.y, item.unit.x, item.unit.y) < 12))
        : !UNIT_DEFS[u.defId].flying && u.order?.type !== 'attack'));
    let totalAssigned = [...assigned.values()].reduce((sum, group) => sum + group.length, 0);
    while (totalAssigned < maxDefenders && available.length) {
      // Spread the fixed response across active assault lanes before doubling
      // up, so one group cannot draw every nearby defender away from another.
      const candidates = responseThreats.map(item => ({ ...item, defenders: assigned.get(item.unit.id) }))
        .filter(item => available.some(u => canRespond(u, item)))
        .sort((a, b) => a.defenders.length - b.defenders.length ||
          a.assetDistance - b.assetDistance || a.unit.id.localeCompare(b.unit.id));
      if (!candidates.length) break;
      const threat = candidates[0].unit;
      const index = available.map((u, i) => ({ u, i }))
        .filter(({ u }) => canRespond(u, candidates[0]))
        .sort((a, b) => Number(a.u.order?.type === 'attack') - Number(b.u.order?.type === 'attack') ||
          dist(a.u.x, a.u.y, threat.x, threat.y) -
          dist(b.u.x, b.u.y, threat.x, threat.y) || a.u.id.localeCompare(b.u.id))[0]?.i;
      if (index == null) break;
      const u = available.splice(index, 1)[0];
      if (emergencyRecall && u.order?.type === 'attack' && !u.order.aiDefense)
        u._aiDefenseResumeOrder = structuredClone(u.order);
      u._relayAssignment = null;
      u._aiDefenseTarget = threat.id;
      assigned.get(threat.id).push(u);
      totalAssigned++;
    }
    for (const [threatId, defenders] of assigned) {
      const threat = threatById.get(threatId);
      for (const u of defenders) {
        if (u.order?.aiDefense && u.order.targetId === threat.id) continue;
        u.order = { type: 'attack', targetId: threat.id, aiDefense: true,
          aiIntel: true, lastX: threat.x, lastY: threat.y };
        u.path = []; u._pathGoal = null;
      }
    }
  }

  _aiRetreatHarvesters() {
    if (this.mode !== 'skirmish' ||
        (this.replayVersion != null && this.replayVersion < AI_HARVESTER_RETREAT_RULES_VERSION)) return;
    const harvesters = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      unit.defId === 'harvester' && unit.order?.type === 'harvest' && unit._harvestPhase !== 'return');
    if (!harvesters.length || !this.buildings.some(building => building.owner === 'enemy' &&
        building.defId === 'refinery' && building.hp > 0 && building.progress >= 1)) return;
    const threats = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
      this.isVisible(unit, 'enemy') && UNIT_DEFS[unit.defId]?.weapon &&
      ['ground', 'both'].includes(UNIT_DEFS[unit.defId].weapon.target || 'ground'));
    const defenses = this.buildings.filter(building => building.owner === 'player' && building.hp > 0 &&
      building.progress >= 1 && building.powered && this.isVisible(building, 'enemy') &&
      BUILDING_DEFS[building.defId]?.weapon &&
      ['ground', 'both'].includes(BUILDING_DEFS[building.defId].weapon.target || 'ground'));
    for (const harvester of harvesters) {
      const unitThreat = threats.some(threat => dist(harvester.x, harvester.y, threat.x, threat.y) <= 5.5);
      const defenseThreat = defenses.some(defense => {
        const center = this._entityCenter(defense);
        return dist(harvester.x, harvester.y, center.x, center.y) <=
          BUILDING_DEFS[defense.defId].weapon.range + 1;
      });
      if (unitThreat || defenseThreat) {
        // Reuse the harvest return cycle so cargo is banked and the existing
        // dock reservation/pathing rules handle the retreat deterministically.
        harvester._harvestPhase = 'return';
        harvester._harvestTile = null;
        harvester.path = []; harvester._pathGoal = null;
      }
    }
  }

  _aiSupportMedics() {
    if (this.mode !== 'skirmish' || this.enemyFaction !== 'aegis' ||
      (this.replayVersion != null && this.replayVersion < 23)) return;
    const medics = this.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'medic' &&
      unit.hp > 0 && !unit.embarkedIn);
    if (!medics.length) return;
    const infantry = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 && !unit.embarkedIn &&
      unit.defId !== 'medic' && UNIT_DEFS[unit.defId]?.weapon && UNIT_DEFS[unit.defId]?.armor === 'infantry');
    const wounded = infantry.filter(unit => unit.maxHp - unit.hp > 1);
    for (const medic of medics) {
      const followed = medic.order?.type === 'follow' ? this.getEntity(medic.order.targetId) : null;
      const followedSupportsWounded = followed && infantry.includes(followed) &&
        followed.hp >= followed.maxHp * 0.65 && wounded.some(patient =>
          this._distanceToEntity(followed.x, followed.y, patient) <= 2.1);
      if (followedSupportsWounded) continue;
      const escorts = infantry.filter(unit => unit.hp >= unit.maxHp * 0.65).map(unit => ({
        unit,
        need: wounded.filter(patient => this._distanceToEntity(unit.x, unit.y, patient) <= 2.1)
          .reduce((sum, patient) => sum + patient.maxHp - patient.hp, 0),
      })).filter(candidate => candidate.need > 0)
        .sort((a, b) => b.need - a.need || dist(medic.x, medic.y, a.unit.x, a.unit.y) -
          dist(medic.x, medic.y, b.unit.x, b.unit.y) || a.unit.id.localeCompare(b.unit.id));
      // When every surviving rifle is hurt, following the healthiest patient
      // still gets the medic into healing range. Otherwise it would
      // idle at the barracks exactly when the line needs it most.
      const escort = escorts[0]?.unit || wounded.slice().sort((a, b) =>
        b.hp / b.maxHp - a.hp / a.maxHp || dist(medic.x, medic.y, a.x, a.y) -
        dist(medic.x, medic.y, b.x, b.y) || a.id.localeCompare(b.id))[0];
      if (escort && medic.order?.type === 'follow' && medic.order.targetId === escort.id) continue;
      if (escort) medic.order = { type: 'follow', targetId: escort.id, aiMedicEscort: true };
      else if (medic.order?.aiMedicEscort) medic.order = { type: 'idle' };
      if (escort || medic.order?.type === 'idle') { medic.path = []; medic._pathGoal = null; }
    }
  }

  _aiStormglassBloom(combatUnits) {
    for (const unit of combatUnits) if (unit.order?.aiBloomEscort) {
      const target = this.getEntity(unit.order.targetId);
      if (!target || target.hp <= 0 || target._harvestPhase === 'return' ||
        !this.storm?.bloom || this.time >= this.storm.bloom.until) {
        unit.order = { type: 'idle' }; unit.path = []; unit._pathGoal = null;
      }
    }
    if (this.mode !== 'skirmish' || !this._stormglassBloomEnabled() ||
      this._aiUnderRelayDominionPressure()) return;
    const bloom = this.storm?.bloom;
    if (!bloom || this.time >= bloom.until || bloom.until - this.time < 30 ||
      this.credits.enemy >= this.creditCapacity.enemy - 200) return;
    const visibleThreat = this._aiIntel?.some(item => item.defId !== 'harvester' &&
      this.time - item.seen < 12 && dist(item.x, item.y, bloom.x, bloom.y) < 8);
    if (visibleThreat) {
      for (const harvester of this.units) if (harvester.owner === 'enemy' && harvester.order?.aiBloom) {
        harvester.order = { type: 'harvest' }; harvester._harvestTile = null;
        harvester.path = []; harvester._pathGoal = null;
      }
      return;
    }

    // The opportunity itself is public. Choose only from its visible crystal
    // patch and use no player entity data here; combat escort assignments are
    // drawn from units that the ordinary AI has left idle after defense and
    // Dominion/relay response decisions.
    const harvesters = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      unit.defId === 'harvester' && unit.order?.type === 'harvest' && unit._harvestPhase !== 'return' &&
      unit.cargo < UNIT_DEFS.harvester.capacity * 0.75);
    if (!harvesters.length) return;
    const bloomTiles = [];
    let bloomStock = 0;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      const tile = this.terrain[y][x];
      if (tile.type !== 'crystal' || tile.resource < 1 || !tile.walkable ||
        dist(x + 0.5, y + 0.5, bloom.x, bloom.y) > bloom.radius) continue;
      bloomStock += tile.resource;
      bloomTiles.push({ x, y, resource: tile.resource });
    }
    // Below this stock, the premium is too small to justify a cross-map
    // detour. The minimum corresponds to at least 87 credits before capacity.
    if (bloomStock < 250) return;

    const candidates = harvesters.map(unit => {
      const current = unit.order?.aiBloom && unit.order.x != null && unit.order.y != null
        ? bloomTiles.find(tile => tile.x === unit.order.x && tile.y === unit.order.y) : null;
      if (current) return { unit, tile: current, distance: 0, committed: true };
      const tile = bloomTiles.filter(candidate => candidate.resource >= 180).map(candidate => ({ candidate,
        distance: dist(unit.x, unit.y, candidate.x + 0.5, candidate.y + 0.5) }))
        .sort((a, b) => a.distance - b.distance || b.candidate.resource - a.candidate.resource ||
          a.candidate.y - b.candidate.y || a.candidate.x - b.candidate.x)[0];
      if (!tile || tile.distance > 14) return null;
      return { unit, tile: tile.candidate, distance: tile.distance, committed: false };
    }).filter(Boolean).sort((a, b) => Number(b.committed) - Number(a.committed) ||
      a.distance - b.distance || a.unit.id.localeCompare(b.unit.id));
    const target = candidates[0];
    if (!target) return;
    const harvester = target.unit;
    const escorts = combatUnits.filter(unit => unit.hp >= unit.maxHp * 0.65 && !unit._aiDefenseTarget &&
      !unit._aiRaidTarget && !unit._relayAssignment && !unit._aiRelayResponseRelayId &&
      !unit._aiRecovering && !unit._aiRecoverWreck && !unit._aiBridgeTarget && !unit.order?.aiScout &&
      !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon &&
      (unit.order?.type === 'idle' || !unit.order?.type));
    const assignedEscort = combatUnits.find(unit => unit.order?.aiBloomEscort &&
      unit.order.type === 'follow' && unit.order.targetId === harvester.id);
    if (!assignedEscort && !escorts.length) {
      if (harvester.order?.aiBloom) {
        harvester.order = { type: 'harvest' }; harvester._harvestTile = null;
        harvester.path = []; harvester._pathGoal = null;
      }
      return;
    }
    const route = target.committed ? null : this._findPath(harvester.x, harvester.y,
      target.tile.x + 0.5, target.tile.y + 0.5);
    if (!target.committed && (!route.length || route.length / UNIT_DEFS.harvester.speed +
      Math.min(UNIT_DEFS.harvester.capacity - harvester.cargo, bloomStock) / 112 + 4 > bloom.until - this.time)) return;
    if (!target.committed) {
      harvester._harvestTile = { x: target.tile.x, y: target.tile.y };
      harvester._harvestPhase = 'field';
      harvester.order = { type: 'harvest', x: target.tile.x, y: target.tile.y, aiBloom: true };
      harvester.path = []; harvester._pathGoal = null;
    }

    if (target.committed && harvester._harvestPhase === 'return') {
      for (const unit of combatUnits) if (unit.order?.aiBloomEscort && unit.order.targetId === harvester.id) {
        unit.order = { type: 'idle' }; unit.path = []; unit._pathGoal = null;
      }
      return;
    }
    // A single nearby, healthy, otherwise idle ground unit is enough for a
    // bounded escort. Existing AI assignments are never replaced.
    if (!assignedEscort && escorts.length) {
      escorts.sort((a, b) => dist(a.x, a.y, harvester.x, harvester.y) -
        dist(b.x, b.y, harvester.x, harvester.y) || a.id.localeCompare(b.id));
      const escort = escorts[0];
      escort.order = { type: 'follow', targetId: harvester.id, aiBloomEscort: true };
      escort.path = []; escort._pathGoal = null;
    }
  }

  _aiRaidHarvesters(combatUnits) {
    const raiderPolicy = this._aiCommanderProfileActive('raider');
    const reconStrike = raiderPolicy &&
      (this.replayVersion == null || this.replayVersion >= AI_ECONOMY_RECON_RULES_VERSION);
    for (const u of combatUnits) {
      if (!u._aiRaidTarget) continue;
      const target = this.getEntity(u._aiRaidTarget);
      if (!target || target.hp <= 0 || reconStrike && (u._aiDefenseTarget || u._relayAssignment) ||
        !this.isVisible(target, 'enemy') ||
        (u.ammo != null && u.ammo < 1)) u._aiRaidTarget = null;
    }
    if (!raiderPolicy && this.difficulty === 'easy' && this._aiWaveNumber < 2) return;
    // Keep prior recordings and campaign AI on their original first-visible
    // target rule. Skirmish ruleset 14 chooses new raids strategically below.
    if (this.mode !== 'skirmish' || (this.replayVersion ?? 14) < 14) {
      const legacyTarget = this.units.find(unit => unit.owner === 'player' &&
        unit.defId === 'harvester' && unit.hp > 0 && this.isVisible(unit, 'enemy'));
      if (!legacyTarget) return;
      const legacyLimit = this.difficulty === 'hard' ? 2 : 1;
      const legacyRaiders = combatUnits.filter(unit => unit._aiRaidTarget === legacyTarget.id);
      const legacyAvailable = combatUnits.filter(unit => !unit._aiDefenseTarget && !unit._relayAssignment &&
        !unit._aiRaidTarget && ['buggy', 'stealthTank', 'orca', 'apache'].includes(unit.defId) &&
        unit.order?.type !== 'attack' && unit.order?.type !== 'rearm' &&
        (unit.ammo == null || unit.ammo >= 1) && dist(unit.x, unit.y, legacyTarget.x, legacyTarget.y) < 22)
        .sort((a, b) => dist(a.x, a.y, legacyTarget.x, legacyTarget.y) -
          dist(b.x, b.y, legacyTarget.x, legacyTarget.y));
      while (legacyRaiders.length < legacyLimit && legacyAvailable.length) {
        const unit = legacyAvailable.shift();
        unit._aiRaidTarget = legacyTarget.id;
        legacyRaiders.push(unit);
      }
      for (const unit of legacyRaiders) {
        if (unit.order?.targetId === legacyTarget.id) continue;
        unit.order = { type: 'attack', targetId: legacyTarget.id, aiIntel: true,
          lastX: legacyTarget.x, lastY: legacyTarget.y };
        unit.path = []; unit._pathGoal = null;
      }
      return;
    }
    const limit = raiderPolicy ? (this.difficulty === 'hard' ? 3 : 2) :
      this.difficulty === 'hard' ? 2 : 1;
    const raiders = combatUnits.filter(u => u._aiRaidTarget && !u._aiDefenseTarget &&
      (u.ammo == null || u.ammo >= 1))
      .sort((a, b) => a.id.localeCompare(b.id));
    // Keep a raid committed while its target remains visible and alive. Choosing
    // again every AI tick would make escorts cause the raiders to oscillate.
    const committedTarget = raiders.map(unit => this.getEntity(unit._aiRaidTarget))
      .find(target => target?.owner === 'player' && target.defId === 'harvester' &&
        target.hp > 0 && this.isVisible(target, 'enemy'));
    const available = combatUnits.filter(u => !u._aiDefenseTarget && !u._relayAssignment &&
      !u._aiRaidTarget && (['buggy', 'stealthTank', 'orca', 'apache'].includes(u.defId) ||
        (reconStrike && u.defId === 'scout')) &&
      u.order?.type !== 'attack' && u.order?.type !== 'rearm' &&
      (u.ammo == null || u.ammo >= 1));
    const targets = committedTarget ? [committedTarget] : this.units.filter(unit =>
      unit.owner === 'player' && unit.defId === 'harvester' && unit.hp > 0 &&
      this.isVisible(unit, 'enemy'));
    const exposure = target => {
      const unitThreats = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
        !unit.embarkedIn && unit.id !== target.id && this.isVisible(unit, 'enemy') &&
        UNIT_DEFS[unit.defId]?.weapon &&
        ['ground', 'both'].includes(UNIT_DEFS[unit.defId].weapon.target || 'ground') &&
        dist(unit.x, unit.y, target.x, target.y) <= 6).length;
      const defenseThreats = this.buildings.filter(building => building.owner === 'player' &&
        building.hp > 0 && building.progress >= 1 && building.powered &&
        this.isVisible(building, 'enemy') &&
        BUILDING_DEFS[building.defId]?.weapon &&
        ['ground', 'both'].includes(BUILDING_DEFS[building.defId].weapon.target || 'ground') &&
        dist(building.x + (building.w || 1) / 2, building.y + (building.h || 1) / 2,
          target.x, target.y) <= 7).length;
      return unitThreats + defenseThreats * 2;
    };
    const target = targets.map(candidate => {
      const closestRaidDistance = available.length
        ? Math.min(...available.map(unit => dist(unit.x, unit.y, candidate.x, candidate.y)))
        : raiders.length ? Math.min(...raiders.map(unit => dist(unit.x, unit.y, candidate.x, candidate.y))) : Infinity;
      return { candidate, score: closestRaidDistance + exposure(candidate) * 8 };
    }).filter(item => Number.isFinite(item.score) &&
      (committedTarget || available.some(unit => dist(unit.x, unit.y, item.candidate.x, item.candidate.y) < 22)))
      .sort((a, b) => a.score - b.score || a.candidate.id.localeCompare(b.candidate.id))[0]?.candidate;
    if (!target) return;
    const targetRaiders = raiders.filter(unit => unit._aiRaidTarget === target.id);
    available.sort((a, b) => dist(a.x, a.y, target.x, target.y) - dist(b.x, b.y, target.x, target.y) ||
      a.id.localeCompare(b.id));
    while (targetRaiders.length < limit && available.length &&
      dist(available[0].x, available[0].y, target.x, target.y) < 22) {
      const u = available.shift();
      u._aiRaidTarget = target.id;
      targetRaiders.push(u);
    }
    for (const u of targetRaiders) {
      if (u.order?.targetId === target.id) continue;
      u.order = { type: 'attack', targetId: target.id, aiIntel: true,
        lastX: target.x, lastY: target.y };
      u.path = []; u._pathGoal = null;
    }
  }

  _aiCommanderProfileActive(profileId) {
    return this.mode === 'skirmish' && this.aiCommanderProfileId === profileId &&
      (this.replayVersion == null || this.replayVersion >= AI_COMMANDER_PROFILE_RULES_VERSION);
  }

  _aiContestRelays(combatUnits) {
    if (this.mode === 'skirmish') return this._aiStrategicRelays(combatUnits);
    const ground = combatUnits.filter(u => !UNIT_DEFS[u.defId].flying);
    const reserve = Math.min(5, Math.max(2, Math.floor(ground.length * 0.35)));
    let assigned = ground.filter(u => u._relayAssignment && this.relays.some(r => r.id === u._relayAssignment && r.owner !== 'enemy'));
    for (const u of ground) if (u._relayAssignment && !assigned.includes(u)) u._relayAssignment = null;
    const available = ground.filter(u => !u._relayAssignment && !u._aiDefenseTarget && !u.order?.aiScout &&
      u.order?.type !== 'attack' &&
      (!u.order || u.order.type === 'idle' || u.order.type === 'move'));
    const targets = this.relays.filter(r => r.owner !== 'enemy').sort((a, b) => {
      const origin = this.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
      const ox = origin?.x ?? 50, oy = origin?.y ?? 10;
      return dist(a.x, a.y, ox, oy) - dist(b.x, b.y, ox, oy);
    });
    for (const relay of targets) {
      const near = assigned.filter(u => u._relayAssignment === relay.id).length;
      const wanted = relay.owner === 'player' ? 3 : 2;
      let need = Math.min(wanted - near, reserve - assigned.length);
      while (need > 0 && available.length) {
        available.sort((a, b) => dist(a.x, a.y, relay.x, relay.y) - dist(b.x, b.y, relay.x, relay.y));
        const u = available.shift();
        u._relayAssignment = relay.id;
        u.order = { type: 'move', x: relay.x, y: relay.y, attackMove: true, relayId: relay.id };
        u.path = []; u._pathGoal = null;
        assigned.push(u); need--;
      }
    }
    for (const u of assigned) {
      const relay = this.relays.find(r => r.id === u._relayAssignment);
      if (relay && relay.owner !== 'enemy' && u.order?.type === 'idle' && dist(u.x, u.y, relay.x, relay.y) > 1.6)
        u.order = { type: 'move', x: relay.x, y: relay.y, attackMove: true, relayId: relay.id };
    }
  }

  _aiStrategicRelays(combatUnits) {
    // Current Cadet gives a new commander 45 seconds before the AI starts its
    // relay rush. Older replays preserve the previous 18-second, all-neutral
    // window (which ended immediately if the player captured a relay).
    const currentCadetOpening = this.mode === 'skirmish' && (this.replayVersion ?? 13) >= 13;
    if (this.difficulty === 'easy' && this.time < (currentCadetOpening ? 45 : 18) &&
      this.relayDominion?.owner !== 'player' &&
      (currentCadetOpening || this.relays.every(r => !r.owner))) return;
    const ground = combatUnits.filter(u => !UNIT_DEFS[u.defId].flying && u.hp > 0 &&
      !(this._aiSiegeExpansionActive() && u._aiExpansion));
    const components = this._groundComponents();
    const component = (x, y) => components[Math.floor(y) * this.width + Math.floor(x)];
    const reachable = (unit, relay) => component(unit.x, unit.y) >= 0 &&
      component(unit.x, unit.y) === component(relay.x, relay.y);
    const relayResponseRules = this.replayVersion == null || this.replayVersion >= RELAY_RESPONSE_RULES_VERSION;
    const responsePressure = relayResponseRules && this.relayDominion?.owner === 'player';
    const relayCounterattackRules = this.mode === 'skirmish' &&
      (this.replayVersion == null || this.replayVersion >= RELAY_DOMINION_COUNTERATTACK_RULES_VERSION);
    const relayPersistenceRules = relayCounterattackRules &&
      (this.replayVersion == null || this.replayVersion >= RELAY_RESPONSE_PERSISTENCE_RULES_VERSION);
    const relayVisibleToEnemy = relay => this.isVisible({ x: relay.x, y: relay.y, owner: 'player' }, 'enemy');
    const visiblePlayerRelay = this.relays.some(relay => relay.owner === 'player' && relayVisibleToEnemy(relay));
    const responseExcluded = unit => unit._aiDefenseTarget || unit._aiRaidTarget || unit._aiRecovering ||
      unit._aiRecoverWreck || unit._aiBridgeTarget || unit.order?.aiScout || unit.embarkedIn ||
      ['harvester', 'engineer', 'medic', 'apc', 'dropship'].includes(unit.defId) ||
      relayCounterattackRules && (unit._aiExpansion || unit.order?.aiTransport || unit.order?.noRelayRelease ||
        unit.order?.aiBridge || unit.order?.aiBridgeRepair ||
        ['board', 'unload', 'engineer'].includes(unit.order?.type));
    // A response assignment is temporary and self-contained so it can be
    // restored exactly after the majority ends, including after a save/load.
    const releasedThisPass = new Set();
    const targetCommitmentRules = this.replayVersion == null ||
      this.replayVersion >= RELAY_DOMINION_TARGET_COMMITMENT_RULES_VERSION;
    for (const unit of ground) if (unit._aiRelayResponseRelayId) {
      const relay = this.relays.find(candidate => candidate.id === unit._aiRelayResponseRelayId);
      const relayVisible = relay && relayVisibleToEnemy(relay);
      const recentlyObservedUrgent = relayPersistenceRules && relay && !relayVisible &&
        (targetCommitmentRules || !visiblePlayerRelay) && unit._aiRelayUrgentRelayId === relay.id &&
        unit.order?.aiRelayUrgent && unit.order.relayId === relay.id &&
        Number.isFinite(unit._aiRelayUrgentLastSeenAt) &&
        this.time - unit._aiRelayUrgentLastSeenAt <= 10;
      const stillRelevant = responsePressure && relay &&
        reachable(unit, relay) && !responseExcluded(unit) &&
        (unit._aiRelayReconRelayId === relay.id
          ? relayVisible ? relay.owner === 'player' : !visiblePlayerRelay
          : relayVisible ? relay.owner === 'player' :
            ((!relayCounterattackRules && relay.owner === 'player') || recentlyObservedUrgent));
      if (stillRelevant) {
        if (relayPersistenceRules && relayVisible && unit._aiRelayUrgentRelayId === relay.id)
          unit._aiRelayUrgentLastSeenAt = this.time;
        continue;
      }
      const canResumePriorOrder = unit._relayAssignment === unit._aiRelayResponseRelayId &&
        !responseExcluded(unit);
      if (unit._relayAssignment === unit._aiRelayResponseRelayId)
        unit._relayAssignment = unit._aiRelayResponsePriorAssignment || null;
      if (canResumePriorOrder) unit.order = unit._aiRelayResponseOrder || { type: 'idle' };
      unit._aiRelayResponseOrder = null;
      unit._aiRelayResponseRelayId = null;
      unit._aiRelayResponsePriorAssignment = null;
      unit._aiRelayUrgentRelayId = null;
      if (relayPersistenceRules) unit._aiRelayUrgentLastSeenAt = null;
      unit._aiRelayReconRelayId = null;
      releasedThisPass.add(unit.id);
      if (canResumePriorOrder) { unit.path = []; unit._pathGoal = null; }
    }
    const defending = new Set(ground.filter(u => u._aiDefenseTarget).map(u => u.id));
    const otherAway = new Set(ground.filter(u => !defending.has(u.id) && responseExcluded(u)).map(u => u.id));
    const homeGuard = this._aiCommanderProfileActive('relay-marshal') ? 1 : 2;
    const cap = (this.difficulty === 'hard' ? 5 : this.difficulty === 'easy' ? 3 : 4) +
      (this._aiCommanderProfileActive('relay-marshal') ? 1 : 0);
    let reserve = responsePressure
      ? Math.min(cap, Math.max(0, ground.length - defending.size - otherAway.size - homeGuard))
      : Math.min(cap, Math.max(0, ground.length - homeGuard), ground.length - defending.size);
    const pressure = this.relayDominion?.owner === 'player';
    const playerRelays = this.relays.filter(relay => {
      if (relayCounterattackRules && !relayVisibleToEnemy(relay)) return false;
      return relay.owner === 'player';
    });
    if (targetCommitmentRules && this._aiRelayCommittedTargetId) {
      const committed = this.relays.find(relay => relay.id === this._aiRelayCommittedTargetId);
      const visible = committed && relayVisibleToEnemy(committed);
      if (!committed || visible && committed.owner !== 'player' ||
          !visible && (!Number.isFinite(this._aiRelayCommittedTargetLastSeenAt) ||
            this.time - this._aiRelayCommittedTargetLastSeenAt > 10)) {
        this._aiRelayCommittedTargetId = null;
        this._aiRelayCommittedTargetLastSeenAt = null;
      } else if (visible) {
        this._aiRelayCommittedTargetLastSeenAt = this.time;
      }
    }
    const wasJustReleased = unit => relayCounterattackRules && releasedThisPass.has(unit.id);
    const eligible = ground.filter(u => !wasJustReleased(u) && !defending.has(u.id) && !u._aiRaidTarget &&
      !u.order?.aiScout && u.order?.type !== 'attack' &&
      !(responsePressure && responseExcluded(u)));
    const recallable = responsePressure ? ground.filter(unit => !wasJustReleased(unit) && unit.order?.type === 'attack' &&
      !responseExcluded(unit) && !unit._relayAssignment) : [];
    const canReachTarget = relay => eligible.some(unit => reachable(unit, relay)) ||
      recallable.some(unit => reachable(unit, relay));
    let target = pressure ? playerRelays.find(r => r.id === this._aiRelayTarget) : null;
    if (target && !canReachTarget(target)) target = null;
    if (targetCommitmentRules && pressure && this._aiRelayCommittedTargetId) {
      const committed = this.relays.find(relay => relay.id === this._aiRelayCommittedTargetId);
      if (committed && canReachTarget(committed)) {
        // Hold the last publicly observed target briefly through fog. This is
        // only a continuation of an existing response, never hidden intel.
        target = committed;
      } else {
        // A target that can no longer be reached yields to an available
        // observed relay (including when the force has been pulled to defend).
        this._aiRelayCommittedTargetId = null;
        this._aiRelayCommittedTargetLastSeenAt = null;
      }
    }
    if (pressure && !target) {
      const responders = [...eligible, ...recallable];
      target = playerRelays.filter(canReachTarget)
        .sort((a, b) => Math.min(...responders.filter(u => reachable(u, a)).map(u => dist(u.x, u.y, a.x, a.y))) -
          Math.min(...responders.filter(u => reachable(u, b)).map(u => dist(u.x, u.y, b.x, b.y))) ||
          a.id.localeCompare(b.id))[0] || null;
    }
    this._aiRelayTarget = target?.id || null;
    if (targetCommitmentRules && pressure && target && relayVisibleToEnemy(target) && target.owner === 'player') {
      this._aiRelayCommittedTargetId = target.id;
      this._aiRelayCommittedTargetLastSeenAt = this.time;
    }
    // The countdown is public, but unseen ownership is not. If sight of every
    // player relay is lost, scout one reachable public relay site with an
    // ordinary available squad. This reveals a live target for the urgent
    // response without issuing orders from hidden ownership.
    const relayReconRules = relayCounterattackRules &&
      (this.replayVersion == null || this.replayVersion >= RELAY_DOMINION_RECON_RULES_VERSION);
    const reconCandidates = relayReconRules && responsePressure && !target
      ? this.relays.filter(relay => !relayVisibleToEnemy(relay) &&
        eligible.some(unit => reachable(unit, relay))) : [];
    const reconTarget = reconCandidates.find(relay => relay.id === this._aiRelayReconTarget) ||
      reconCandidates.sort((a, b) => Math.min(...eligible.filter(unit => reachable(unit, a))
        .map(unit => dist(unit.x, unit.y, a.x, a.y))) -
        Math.min(...eligible.filter(unit => reachable(unit, b))
          .map(unit => dist(unit.x, unit.y, b.x, b.y))) || a.id.localeCompare(b.id))[0] || null;
    if (relayReconRules) this._aiRelayReconTarget = (target || reconTarget)?.id || null;
    if (relayCounterattackRules && responsePressure && target && relayVisibleToEnemy(target) &&
        !ground.some(unit => (relayReconRules ? unit._aiRelayUrgentRelayId :
          unit._aiRelayResponseRelayId) === target.id)) {
      const reconResponder = ground.find(unit => unit._aiRelayReconRelayId === target.id &&
        !responseExcluded(unit) && reachable(unit, target));
      const responder = reconResponder || ground.filter(unit => !wasJustReleased(unit) &&
        !responseExcluded(unit) && reachable(unit, target))
        .sort((a, b) => dist(a.x, a.y, target.x, target.y) - dist(b.x, b.y, target.x, target.y) ||
          a.id.localeCompare(b.id))[0];
      if (responder) {
        if (responder !== reconResponder) {
          responder._aiRelayResponseOrder = structuredClone(responder.order || { type: 'idle' });
          responder._aiRelayResponsePriorAssignment = responder._relayAssignment || null;
        }
        responder._aiRelayResponseRelayId = target.id;
        responder._aiRelayUrgentRelayId = target.id;
        if (relayPersistenceRules) responder._aiRelayUrgentLastSeenAt = this.time;
        responder._aiRelayReconRelayId = null;
        responder._relayAssignment = target.id;
        // Urgent relay response bypasses attack-move's stop-to-fire behavior,
        // so a nearby responder actually enters the relay's 2.3-tile radius.
        responder.order = { type: 'move', x: target.x, y: target.y,
          relayId: target.id, aiRelayResponse: true, aiRelayUrgent: true };
        responder.path = []; responder._pathGoal = null;
      }
    }
    // A nearly defeated force may have fewer than the normal two home guards.
    // Send one reachable squad to a currently observed countdown relay, keeping
    // the other at home when there is one, rather than yielding without a fight.
    if (responsePressure && target && reserve === 0 &&
        ground.length - defending.size - otherAway.size > 0 &&
        (!relayCounterattackRules || relayVisibleToEnemy(target))) reserve = 1;
    if (reconTarget && reserve === 0 &&
        ground.length - defending.size - otherAway.size > 0) reserve = 1;
    // A reachable player majority takes precedence over the last relay garrison.
    // Keep the home guard and the existing reserve cap, but leave one relay slot
    // for a contesting unit even when the field army is down to one squad.
    const garrisonLimit = target || reconTarget ? Math.max(0, reserve - 1) : reserve;
    const ownedRelays = this.relays.filter(r => r.owner === 'enemy')
      .slice(0, Math.min(2, garrisonLimit));
    const garrisons = new Set();
    for (const relay of ownedRelays) {
      const candidates = eligible.filter(u => u._relayAssignment === relay.id && reachable(u, relay))
        .sort((a, b) => dist(a.x, a.y, relay.x, relay.y) -
          dist(b.x, b.y, relay.x, relay.y) || a.id.localeCompare(b.id));
      if (candidates.length) garrisons.add(candidates[0].id);
    }

    const reconPriorOrders = reconTarget ? new Map(eligible.map(unit => [unit.id, {
      order: structuredClone(unit.order || { type: 'idle' }), assignment: unit._relayAssignment || null,
    }])) : null;
    const assigned = [];
    for (const u of ground) {
      if (!u._relayAssignment) continue;
      const relay = this.relays.find(r => r.id === u._relayAssignment);
      if (defending.has(u.id) || !relay || !reachable(u, relay) ||
        (relay.owner === 'enemy' && !garrisons.has(u.id)) ||
        (target && relay.id !== target.id && !garrisons.has(u.id))) {
        if (u.order?.relayId === u._relayAssignment) {
          u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
        }
        u._relayAssignment = null;
      } else if (u._relayAssignment) assigned.push(u);
    }
    if (assigned.length > reserve) {
      assigned.sort((a, b) => {
        const ar = this.relays.find(r => r.id === a._relayAssignment);
        const br = this.relays.find(r => r.id === b._relayAssignment);
        return (relayCounterattackRules ? Number(!!b._aiRelayUrgentRelayId) -
          Number(!!a._aiRelayUrgentRelayId) ||
          Number(!!b._aiRelayResponseRelayId) - Number(!!a._aiRelayResponseRelayId) : 0) ||
          (ar.owner === 'enemy' ? -1000 : 0) - (br.owner === 'enemy' ? -1000 : 0) ||
          dist(a.x, a.y, ar.x, ar.y) - dist(b.x, b.y, br.x, br.y) ||
          a.id.localeCompare(b.id);
      });
      while (assigned.length > reserve) {
        const u = assigned.pop();
        const relayId = u._relayAssignment;
        u._relayAssignment = null;
        if (u.order?.relayId === relayId) {
          u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
        }
      }
    }
    const missingGarrisons = ownedRelays.filter(r => !assigned.some(u => u._relayAssignment === r.id));
    while (assigned.length + missingGarrisons.length > reserve) {
      const index = assigned.findLastIndex(u => (!relayCounterattackRules ||
        !u._aiRelayUrgentRelayId && !u._aiRelayResponseRelayId) &&
        this.relays.find(r => r.id === u._relayAssignment)?.owner !== 'enemy');
      if (index < 0) break;
      const [u] = assigned.splice(index, 1);
      const relayId = u._relayAssignment;
      u._relayAssignment = null;
      if (u.order?.relayId === relayId) {
        u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
      }
    }
    const available = eligible.filter(u => !u._relayAssignment &&
      (!u.order || u.order.type === 'idle' || u.order.type === 'move'));
    const assign = (relay, count) => {
      while (count > 0 && assigned.length < reserve) {
        const candidates = available.filter(u => reachable(u, relay));
        if (!candidates.length) break;
        candidates.sort((a, b) => dist(a.x, a.y, relay.x, relay.y) -
          dist(b.x, b.y, relay.x, relay.y) || a.id.localeCompare(b.id));
        const u = candidates[0];
        available.splice(available.indexOf(u), 1);
        if (relay.id === reconTarget?.id) {
          const prior = reconPriorOrders.get(u.id);
          u._aiRelayResponseOrder = prior.order;
          u._aiRelayResponsePriorAssignment = prior.assignment;
          u._aiRelayResponseRelayId = relay.id;
          u._aiRelayReconRelayId = relay.id;
        }
        u._relayAssignment = relay.id;
        u.order = { type: 'move', x: relay.x, y: relay.y, attackMove: true, relayId: relay.id,
          ...(relay.id === reconTarget?.id ? { aiRelayRecon: true } : {}) };
        u.path = []; u._pathGoal = null;
        assigned.push(u);
        count--;
      }
    };
    for (const relay of missingGarrisons) assign(relay, 1);
    if (target) {
      // A single contesting ground unit pauses Dominion; reinforce it if the roster permits.
      const wanted = this.difficulty === 'hard' ? 4 : this.difficulty === 'easy' ? 2 : 3;
      assign(target, wanted - assigned.filter(u => u._relayAssignment === target.id).length);
      // Ordinary assault units are a last resort once the idle/move pool has
      // been used. The reserve bound above keeps two non-responding ground
      // combat units at home whenever the roster and defense assignments allow.
      // Committed assaults are recalled only to a relay the AI can currently
      // observe. The older idle-unit policy is replay-gated separately above.
      if (responsePressure && target.owner === 'player' &&
          this.isVisible({ x: target.x, y: target.y, owner: 'player' }, 'enemy')) {
        let missing = wanted - assigned.filter(u => u._relayAssignment === target.id).length;
        const responders = recallable.filter(unit => !unit._relayAssignment &&
          !unit._aiRelayResponseRelayId && reachable(unit, target))
          .sort((a, b) => dist(a.x, a.y, target.x, target.y) - dist(b.x, b.y, target.x, target.y) ||
            a.id.localeCompare(b.id));
        while (missing > 0 && assigned.length < reserve && responders.length) {
          const unit = responders.shift();
          unit._aiRelayResponseOrder = structuredClone(unit.order);
          unit._aiRelayResponseRelayId = target.id;
          unit._relayAssignment = target.id;
          unit.order = { type: 'move', x: target.x, y: target.y, attackMove: true,
            relayId: target.id, aiRelayResponse: true };
          unit.path = []; unit._pathGoal = null;
          assigned.push(unit);
          missing--;
        }
      }
    } else {
      const anchor = this.buildings.find(b => b.owner === 'enemy' && b.defId === 'command' && b.hp > 0);
      const ox = anchor?.x ?? 50, oy = anchor?.y ?? 10;
      const targets = this.relays.filter(relay => {
        if (relay.id === reconTarget?.id) return true;
        if (relay.owner === 'enemy') return false;
        if (relayCounterattackRules && !relayVisibleToEnemy(relay)) return eligible.some(u => reachable(u, relay));
        return relay.owner === 'player' || relay.owner == null
          ? eligible.some(u => reachable(u, relay)) : false;
      })
        .sort((a, b) => Number(b.id === reconTarget?.id) - Number(a.id === reconTarget?.id) ||
          dist(a.x, a.y, ox, oy) - dist(b.x, b.y, ox, oy) ||
          a.id.localeCompare(b.id));
      // Claim two relays before reinforcing one, so the AI can begin its own timer.
      for (const relay of targets) if (assigned.filter(u => u._relayAssignment === relay.id).length === 0)
        assign(relay, 1);
      for (const relay of targets) {
        const knownPlayerHeld = relayCounterattackRules
          ? relayVisibleToEnemy(relay) && relay.owner === 'player' : relay.owner === 'player';
        const wanted = knownPlayerHeld ? 3 : 2;
        assign(relay, wanted - assigned.filter(u => u._relayAssignment === relay.id).length);
      }
    }
    for (const u of assigned) {
      const relay = this.relays.find(r => r.id === u._relayAssignment);
      if (relay?.owner === 'enemy' && relay.id !== reconTarget?.id) {
        if (u.order?.type !== 'guard' || u.order.relayId !== relay.id) {
          u.order = { type: 'guard', x: relay.x, y: relay.y, relayId: relay.id };
          u.path = []; u._pathGoal = null;
        }
      } else if (relay && (u.order?.type === 'guard' ||
        u.order?.type === 'idle' && dist(u.x, u.y, relay.x, relay.y) > 1.6)) {
        u.order = { type: 'move', x: relay.x, y: relay.y, attackMove: true, relayId: relay.id };
        u.path = []; u._pathGoal = null;
      }
    }
  }

  _aiUseCommandAbilities(combatUnits) {
    const currentSkirmish = this.mode === 'skirmish' &&
      (this.replayVersion == null || this.replayVersion >= 27);
    if ((this.replayVersion == null || this.replayVersion >= 31) && this._aiUsePackageAbility(combatUnits)) return;
    if (this.storm.phase === 'surge' && this.commandEnergy.enemy >= COMMAND_ABILITIES.stormcall.cost &&
      this.commandCooldowns.enemy.stormcall <= 0 && !this.storm.lure) {
      const visibleEnemies = this.units.filter(u => u.owner === 'player' && u.hp > 0 && !u.embarkedIn &&
        this.isVisible(u, 'enemy'));
      const candidate = this.relays.filter(r => r.owner === 'enemy' && !this._relayIsContested(r) &&
        dist(this.storm.x, this.storm.y, r.x, r.y) <= 5)
        .flatMap(relay => visibleEnemies.filter(u => dist(u.x, u.y, relay.x, relay.y) <= 6)
          .map(unit => ({ relay, unit, count: visibleEnemies.filter(other =>
            dist(other.x, other.y, unit.x, unit.y) <= STORMCALL_PULSE_RADIUS).length })))
        .filter(item => item.count >= 2)
        .sort((a, b) => b.count - a.count || a.relay.id.localeCompare(b.relay.id) ||
          a.unit.id.localeCompare(b.unit.id))[0];
      if (candidate && this._useCommandAbility('enemy', 'stormcall', candidate.unit.x, candidate.unit.y).ok &&
        currentSkirmish) return;
    }
    if (currentSkirmish) {
      this._aiUseTacticalAbilities(combatUnits);
      return;
    }
    const front = combatUnits.find(u => u.hp > 0 && this.units.some(p => p.owner === 'player' && p.hp > 0 &&
      this.isVisible(p, 'enemy') && dist(u.x, u.y, p.x, p.y) < 6));
    if (front) {
      const allies = combatUnits.filter(u => dist(u.x, u.y, front.x, front.y) < 4.5);
      if (allies.length >= 2 && allies.some(u => u.hp < u.maxHp * 0.8 &&
        !(u.shieldUntil > this.time && u.shieldHp > 20)))
        this._useCommandAbility('enemy', 'shield', front.x, front.y);
      if (allies.length >= 3 && allies.some(u => !(u.overchargedUntil > this.time + 3)))
        this._useCommandAbility('enemy', 'overcharge', front.x, front.y);
    }
    if (this.commandEnergy.enemy >= COMMAND_ABILITIES.overcharge.cost &&
      this.commandCooldowns.enemy.overcharge <= 0) {
      const producer = this.buildings.filter(b => b.owner === 'enemy' && b.queue?.length && b.hp > 0)
        .sort((a, b) => b.queue.length - a.queue.length)[0];
      if (producer) {
        const center = this._entityCenter(producer);
        this._useCommandAbility('enemy', 'overcharge', center.x, center.y);
      }
    }
  }

  _aiUsePackageAbility(combatUnits) {
    const packageId = this.research?.enemy?.tactical;
    if (!packageId) return false;
    if (this.replayVersion != null && this.replayVersion <= 31)
      return this._aiUseLegacyPackageAbility(combatUnits);
    const use = (id, x, y) => this._useCommandAbility('enemy', id, x, y).ok;
    if (packageId === 'interdict') {
      const threats = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
        UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy'));
      const fronts = combatUnits.filter(unit => unit.hp > 0 && !unit.embarkedIn &&
        !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon);
      const centers = threats.map(unit => ({ unit, count: threats.filter(other =>
        dist(other.x, other.y, unit.x, unit.y) <= COMMAND_ABILITIES.interdict.radius).length,
      engaged: fronts.some(front => dist(front.x, front.y, unit.x, unit.y) <= 7) }))
        .filter(center => center.engaged)
        .sort((a, b) => b.count - a.count || a.unit.id.localeCompare(b.unit.id));
      if (centers[0]?.count) return use('interdict', centers[0].unit.x, centers[0].unit.y);
    } else if (packageId === 'rally') {
      const allies = combatUnits.filter(unit => unit.hp > 0 && !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying &&
        UNIT_DEFS[unit.defId]?.weapon &&
        (unit.hp < unit.maxHp - 40 || unit.suppressedUntil > this.time));
      const visibleThreats = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
        !unit.embarkedIn && UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy'));
      const center = allies.filter(unit => visibleThreats.some(threat =>
        dist(threat.x, threat.y, unit.x, unit.y) <= 8))
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id))[0];
      if (center) return use('rally', center.x, center.y);
    } else if (packageId === 'breach') {
      const targets = this.buildings.filter(building => building.owner === 'player' && building.hp > 0 &&
        building.progress >= 1 && this.isVisible(building, 'enemy') &&
        ['command', 'factory', 'refinery', 'radar', 'tech'].includes(building.defId))
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id));
      const target = targets.find(building => combatUnits.some(unit => unit.hp > 0 && !UNIT_DEFS[unit.defId]?.flying &&
        dist(unit.x, unit.y, building.x + (building.w || 0) / 2, building.y + (building.h || 0) / 2) <= COMMAND_ABILITIES.breach.radius));
      if (target) return use('breach', target.x + (target.w || 0) / 2, target.y + (target.h || 0) / 2);
    }
    return false;
  }

  _aiUseLegacyPackageAbility(combatUnits) {
    const packageId = this.research?.enemy?.tactical;
    if (!packageId) return false;
    const use = (id, x, y) => this._useCommandAbility('enemy', id, x, y).ok;
    if (packageId === 'interdict') {
      const threats = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
        UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy'));
      const centers = threats.map(unit => ({ unit, count: threats.filter(other =>
        dist(other.x, other.y, unit.x, unit.y) <= COMMAND_ABILITIES.interdict.radius).length }))
        .sort((a, b) => b.count - a.count || a.unit.id.localeCompare(b.unit.id));
      if (centers[0]?.count) return use('interdict', centers[0].unit.x, centers[0].unit.y);
    } else if (packageId === 'rally') {
      const allies = combatUnits.filter(unit => unit.hp > 0 && !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying &&
        UNIT_DEFS[unit.defId]?.weapon &&
        (unit.hp < unit.maxHp - 40 || unit.suppressedUntil > this.time));
      const center = allies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id))[0];
      if (center) return use('rally', center.x, center.y);
    } else if (packageId === 'breach') {
      const targets = this.buildings.filter(building => building.owner === 'player' && building.hp > 0 &&
        building.progress >= 1 && this.isVisible(building, 'enemy') &&
        ['command', 'factory', 'refinery', 'radar', 'tech'].includes(building.defId))
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.id.localeCompare(b.id));
      const target = targets.find(building => combatUnits.some(unit => unit.hp > 0 && !UNIT_DEFS[unit.defId]?.flying &&
        dist(unit.x, unit.y, building.x + (building.w || 0) / 2, building.y + (building.h || 0) / 2) <= COMMAND_ABILITIES.breach.radius));
      if (target) return use('breach', target.x + (target.w || 0) / 2, target.y + (target.h || 0) / 2);
    }
    return false;
  }

  _aiUseTacticalAbilities(combatUnits) {
    const armedUnits = combatUnits.filter(u => u.hp > 0 && UNIT_DEFS[u.defId]?.weapon);
    const visibleThreats = this.units.filter(u => u.owner === 'player' && u.hp > 0 &&
      UNIT_DEFS[u.defId]?.weapon && this.isVisible(u, 'enemy'));
    const fronts = armedUnits.map(unit => {
      const allies = armedUnits.filter(ally => dist(ally.x, ally.y, unit.x, unit.y) <= 4.5);
      const threats = visibleThreats.filter(threat => dist(threat.x, threat.y, unit.x, unit.y) < 6);
      return { unit, allies, threats };
    }).filter(front => front.threats.length)
      .sort((a, b) => b.threats.length - a.threats.length ||
        b.allies.length - a.allies.length || a.unit.id.localeCompare(b.unit.id));
    for (const front of fronts) {
      if (front.allies.length >= 2 && front.allies.some(u => u.hp < u.maxHp * 0.8 &&
        !(u.shieldUntil > this.time && u.shieldHp > 20)) &&
        this._useCommandAbility('enemy', 'shield', front.unit.x, front.unit.y).ok) return;
      if (front.allies.length >= 3 && front.allies.filter(u =>
        !(u.overchargedUntil > this.time + 3)).length >= 2 &&
        this._useCommandAbility('enemy', 'overcharge', front.unit.x, front.unit.y).ok) return;
    }

    // Reacquire a recently observed unit near a squad. The stored position is
    // the last sighting, never the target's current hidden position.
    if (this.commandEnergy.enemy >= 55 && this.commandCooldowns.enemy.scan <= 0) {
      const intel = this._aiIntel.filter(item => !item.building &&
        UNIT_DEFS[item.defId]?.weapon && this.time - item.seen >= 2 &&
        this.time - item.seen <= 12 && this._validatePoint(item.x, item.y) &&
        !this.scans.some(scan => scan.owner === 'enemy' && scan.until > this.time &&
          dist(scan.x, scan.y, item.x, item.y) <= COMMAND_ABILITIES.scan.radius) &&
        armedUnits.filter(u => dist(u.x, u.y, item.x, item.y) <= 10).length >= 2 &&
        !visibleThreats.some(u => dist(u.x, u.y, item.x, item.y) <= COMMAND_ABILITIES.scan.radius));
      intel.sort((a, b) => b.seen - a.seen || a.id.localeCompare(b.id));
      if (intel[0] && this._useCommandAbility('enemy', 'scan', intel[0].x, intel[0].y).ok) return;
    }

    // Production is useful during a lull, but preserve energy for a contact.
    if (this.commandEnergy.enemy < 85 || this.commandCooldowns.enemy.overcharge > 0) return;
    const producer = this.buildings.filter(b => b.owner === 'enemy' && b.queue?.length && b.hp > 0 &&
      !(b.overchargedUntil > this.time + 3))
      .sort((a, b) => b.queue.length - a.queue.length || a.id.localeCompare(b.id))[0];
    if (producer) {
      const center = this._entityCenter(producer);
      this._useCommandAbility('enemy', 'overcharge', center.x, center.y);
    }
  }

  _aiTransportTick() {
    if (this.mode !== 'skirmish' || !['normal', 'hard'].includes(this.difficulty)) return;
    const airlift = this.mapId === 'delta-crossing';
    const carriers = this.units.filter(u => u.owner === 'enemy' && u.hp > 0 &&
      u.defId === (airlift ? 'dropship' : 'apc'));
    const queuedCarriers = this.buildings.filter(b => b.owner === 'enemy' && b.hp > 0 && b.queue)
      .flatMap(b => b.queue).filter(item => item.defId === 'apc').length;
    const infantry = this.units.filter(u => u.owner === 'enemy' && u.hp > 0 && !u.embarkedIn &&
      UNIT_DEFS[u.defId]?.armor === 'infantry' && UNIT_DEFS[u.defId].weapon &&
      !u._aiDefenseTarget && !u._aiRaidTarget && !u.order?.aiScout && u.order?.type !== 'attack' &&
      (!u.order || ['idle', 'move'].includes(u.order.type)));
    const hasEconomy = this.buildings.some(b => b.owner === 'enemy' && b.hp > 0 && b.progress >= 1 && b.defId === 'factory') &&
      this.buildings.some(b => b.owner === 'enemy' && b.hp > 0 && b.progress >= 1 && b.defId === 'barracks');
    if (!airlift && !carriers.length && !queuedCarriers && hasEconomy && infantry.length >= 2 &&
      this.credits.enemy >= UNIT_DEFS.apc.cost) this._queueUnit('enemy', 'apc');

    const componentMap = this._groundComponents();
    const component = (x, y) => componentMap[Math.floor(y) * this.width + Math.floor(x)];
    const anchor = this.buildings.find(b => b.owner === 'enemy' && b.defId === 'command' && b.hp > 0);
    for (const carrier of carriers) {
      if (carrier._aiTransportComplete) continue;
      const relayId = carrier._aiTransportRelayId;
      let relay = this.relays.find(r => r.id === relayId && r.owner !== 'enemy');
      const reachable = r => component(r.x, r.y) >= 0 &&
        (airlift || component(carrier.x, carrier.y) === component(r.x, r.y));
      if (!relay || !reachable(relay)) {
        relay = this.relays.filter(r => r.owner !== 'enemy' && reachable(r))
          .sort((a, b) => (airlift ? Number(b.y > 24.5) - Number(a.y > 24.5) : 0) ||
            (a.owner === 'player' ? 0 : 1) - (b.owner === 'player' ? 0 : 1) ||
            dist(carrier.x, carrier.y, a.x, a.y) - dist(carrier.x, carrier.y, b.x, b.y) || a.id.localeCompare(b.id))[0];
        carrier._aiTransportRelayId = relay?.id || null;
      }
      if (!relay) {
        const squadIds = Array.isArray(carrier._aiTransportSquadIds) ? carrier._aiTransportSquadIds : [];
        const activeIds = [...new Set([...carrier.passengerIds, ...squadIds])];
        if (carrier.order?.noRelayRelease) continue;
        if (carrier.passengerIds.length && !this._unloadPassengers(carrier)) {
          const cx = Math.floor(carrier.x), cy = Math.floor(carrier.y);
          const safe = [];
          for (let radius = 1; radius <= 4; radius++) {
            for (let y = cy - radius; y <= cy + radius; y++) for (let x = cx - radius; x <= cx + radius; x++) {
              if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius || !this._isPassable(x, y) ||
                (!airlift && component(x + 0.5, y + 0.5) !== component(carrier.x, carrier.y)) ||
                this.units.some(u => u.hp > 0 && !u.embarkedIn && u.id !== carrier.id &&
                  dist(u.x, u.y, x + 0.5, y + 0.5) < 0.7)) continue;
              safe.push({ x: x + 0.5, y: y + 0.5, distance: dist(carrier.x, carrier.y, x + 0.5, y + 0.5) });
            }
            if (safe.length) break;
          }
          safe.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
          const destination = safe[0];
          if (destination) {
            carrier.order = { type: 'unload', x: destination.x, y: destination.y,
              aiTransport: true, noRelayRelease: true };
            carrier.path = []; carrier._pathGoal = null;
          }
          continue;
        }
        for (const id of activeIds) {
          const u = this.getEntity(id);
          if (!u || u.hp <= 0 || u.embarkedIn) continue;
          u._relayAssignment = null;
          u.order = { type: 'idle' }; u.path = []; u._pathGoal = null;
        }
        carrier.order = { type: 'idle' };
        carrier._aiTransportComplete = true;
        delete carrier._aiTransportRelayId; delete carrier._aiTransportSquadIds;
        delete carrier._aiTransportStartedAt; delete carrier._aiTransportProgressAt;
        continue;
      }

      if (carrier.order?.aiTransport && carrier.order.relayId !== relay.id) {
        carrier.order = { type: 'idle' }; carrier.path = []; carrier._pathGoal = null;
      }

      let squadIds = Array.isArray(carrier._aiTransportSquadIds) ? carrier._aiTransportSquadIds : null;
      let squad = squadIds?.map(id => this.getEntity(id)).filter(u => u?.hp > 0 &&
        (u.embarkedIn === carrier.id || u.order?.type === 'board' && u.order.carrierId === carrier.id));
      if (!squad || squad.length < 2) {
        squad = infantry.filter(u => !u._relayAssignment &&
          component(u.x, u.y) === component(carrier.x, carrier.y))
          .sort((a, b) => dist(a.x, a.y, carrier.x, carrier.y) - dist(b.x, b.y, carrier.x, carrier.y) ||
            a.id.localeCompare(b.id)).slice(0, 3);
        if (squad.length < 2) continue;
        carrier._aiTransportSquadIds = squad.map(u => u.id);
        for (const u of squad) {
          u._relayAssignment = null;
          u.order = { type: 'board', carrierId: carrier.id };
          u.path = []; u._pathGoal = null;
        }
        carrier._aiTransportStartedAt = this.time;
      }

      const passengers = carrier.passengerIds.map(id => this.getEntity(id)).filter(u => u?.hp > 0 && u.embarkedIn === carrier.id);
      if (passengers.length >= 2 && carrier.order?.type !== 'unload') {
        const baseX = anchor ? anchor.x + anchor.w / 2 : 50;
        const baseY = anchor ? anchor.y + anchor.h / 2 : 10;
        const dx = relay.x - baseX, dy = relay.y - baseY, length = Math.hypot(dx, dy) || 1;
        const flankTiles = [];
        for (let radius = 1; radius <= 3; radius++) {
          for (let y = Math.floor(relay.y) - radius; y <= Math.floor(relay.y) + radius; y++) {
            for (let x = Math.floor(relay.x) - radius; x <= Math.floor(relay.x) + radius; x++) {
              if (Math.max(Math.abs(x - Math.floor(relay.x)), Math.abs(y - Math.floor(relay.y))) !== radius ||
                !this._isPassable(x, y) || (!airlift &&
                component(x + 0.5, y + 0.5) !== component(carrier.x, carrier.y))) continue;
              const away = ((x + 0.5 - relay.x) * dx + (y + 0.5 - relay.y) * dy) / length;
              flankTiles.push({ x: x + 0.5, y: y + 0.5, away, d: dist(x + 0.5, y + 0.5, relay.x, relay.y) });
            }
          }
        }
        flankTiles.sort((a, b) => b.away - a.away || a.d - b.d || a.y - b.y || a.x - b.x);
        const destination = flankTiles[0] || { x: relay.x, y: relay.y };
        carrier.order = { type: 'unload', x: destination.x, y: destination.y,
          aiTransport: true, relayId: relay.id };
        carrier.path = []; carrier._pathGoal = null;
        carrier._aiTransportLastX = carrier.x; carrier._aiTransportLastY = carrier.y;
        carrier._aiTransportProgressAt = this.time;
      } else if (carrier.order?.type === 'unload') {
        if (dist(carrier.x, carrier.y, carrier._aiTransportLastX ?? carrier.x,
          carrier._aiTransportLastY ?? carrier.y) > 0.25) {
          carrier._aiTransportLastX = carrier.x; carrier._aiTransportLastY = carrier.y;
          carrier._aiTransportProgressAt = this.time;
        } else if (this.time - (carrier._aiTransportProgressAt ?? this.time) > 24) {
          const ids = [...carrier.passengerIds];
          if (this._unloadPassengers(carrier)) {
            for (const id of ids) {
              const u = this.getEntity(id);
              if (!u || u.hp <= 0 || u.embarkedIn) continue;
              u._relayAssignment = relay.id;
              u.order = { type: 'move', x: relay.x, y: relay.y, attackMove: true, relayId: relay.id };
              u.path = []; u._pathGoal = null;
            }
            carrier.order = { type: 'idle' };
            carrier._aiTransportComplete = true;
            delete carrier._aiTransportRelayId; delete carrier._aiTransportSquadIds;
          } else {
            carrier.order = { type: 'unload', x: carrier.x, y: carrier.y,
              aiTransport: true, relayId: relay.id };
            carrier.path = []; carrier._pathGoal = null;
            carrier._aiTransportProgressAt = this.time;
          }
        }
      } else if (this.time - (carrier._aiTransportStartedAt ?? this.time) > 45 && passengers.length < 2) {
        for (const u of squad) if (u && !u.embarkedIn) { u.order = { type: 'idle' }; u.path = []; u._pathGoal = null; }
        delete carrier._aiTransportRelayId; delete carrier._aiTransportSquadIds;
        delete carrier._aiTransportStartedAt;
      }
    }
  }

  _aiBridgeTick(combatUnits) {
    if (this.mode !== 'skirmish' || this.mapId !== 'delta-crossing' ||
      !['normal', 'hard'].includes(this.difficulty) || this.bridges.length !== 2) return;

    const groundComponents = this._groundComponents();
    const componentAt = (x, y) => groundComponents[Math.floor(y) * this.width + Math.floor(x)];
    const enemyCommand = this.buildings.find(building => building.owner === 'enemy' &&
      building.defId === 'command' && building.hp > 0);
    const homeComponent = enemyCommand ? componentAt(enemyCommand.x + 1.5, enemyCommand.y + 1.5) : -1;
    const onBridge = (unit, bridge) => unit.x >= bridge.x && unit.x < bridge.x + bridge.w &&
      unit.y >= bridge.y && unit.y < bridge.y + bridge.h;
    const playerThreatens = bridge => this.units.some(unit => unit.owner === 'player' && unit.hp > 0 &&
      !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon &&
      this.isVisible(unit, 'enemy') && !onBridge(unit, bridge) &&
      this._distanceToEntity(unit.x, unit.y, bridge) <= 3.5);

    // Demolish a span only after observing an armed ground unit approaching it.
    // Keep one crossing open and leave forward units, relay squads, and defenders
    // on their current orders so bridge denial cannot cancel the AI's own plan.
    const intact = this.bridges.filter(bridge => !bridge.destroyed && bridge.hp > 0);
    const preservesRelayPressure = bridge => {
      this._setBridgePassability(bridge, false);
      const after = this._groundComponents();
      this._setBridgePassability(bridge, true);
      const afterAt = (x, y) => after[Math.floor(y) * this.width + Math.floor(x)];
      for (const unit of combatUnits) {
        if (!unit._relayAssignment || UNIT_DEFS[unit.defId]?.flying) continue;
        const relay = this.relays.find(candidate => candidate.id === unit._relayAssignment);
        if (!relay || afterAt(unit.x, unit.y) < 0 ||
          afterAt(unit.x, unit.y) !== afterAt(relay.x, relay.y)) return false;
      }
      if (this._aiRelayTarget) {
        const relay = this.relays.find(candidate => candidate.id === this._aiRelayTarget);
        const reachable = relay && combatUnits.some(unit => unit.hp > 0 &&
          !UNIT_DEFS[unit.defId]?.flying && !unit._aiDefenseTarget &&
          !unit._aiRaidTarget && afterAt(unit.x, unit.y) >= 0 &&
          afterAt(unit.x, unit.y) === afterAt(relay.x, relay.y));
        if (!reachable) return false;
      }
      return true;
    };
    const demolitionTarget = intact.length === 2 ? intact.filter(bridge =>
      this.isVisible(bridge, 'enemy') && playerThreatens(bridge) &&
      !combatUnits.some(unit => unit.hp > 0 && !UNIT_DEFS[unit.defId]?.flying &&
        (onBridge(unit, bridge) || homeComponent >= 0 && componentAt(unit.x, unit.y) !== homeComponent)) &&
      preservesRelayPressure(bridge))
      .sort((a, b) => this.bridges.indexOf(a) - this.bridges.indexOf(b))[0] : null;

    for (const unit of combatUnits) {
      if (!unit._aiBridgeTarget) continue;
      const target = this.getEntity(unit._aiBridgeTarget);
      if (!target || target.destroyed || target.hp <= 0 || !this.isVisible(target, 'enemy') ||
        !playerThreatens(target)) {
        unit._aiBridgeTarget = null;
        if (unit.order?.aiBridge) { unit.order = { type: 'idle' }; unit.path = []; unit._pathGoal = null; }
      }
    }
    if (demolitionTarget) {
      const assigned = combatUnits.filter(unit => unit._aiBridgeTarget === demolitionTarget.id);
      const available = combatUnits.filter(unit => !unit._aiBridgeTarget && !unit._relayAssignment &&
        !unit._aiDefenseTarget && !unit._aiRaidTarget && !unit.order?.aiScout &&
        ['idle', 'move'].includes(unit.order?.type || 'idle') &&
        this._weaponCanTarget(UNIT_DEFS[unit.defId]?.weapon, demolitionTarget) &&
        (!unit._relayAssignment));
      const limit = this.difficulty === 'hard' ? 2 : 1;
      while (assigned.length < limit && available.length) {
        const unit = available.shift();
        unit._aiBridgeTarget = demolitionTarget.id;
        unit.order = { type: 'attack', targetId: demolitionTarget.id, aiBridge: true,
          aiIntel: true, lastX: demolitionTarget.x + demolitionTarget.w / 2,
          lastY: demolitionTarget.y + demolitionTarget.h / 2 };
        unit.path = []; unit._pathGoal = null;
        assigned.push(unit);
      }
    }

    // A single bridge still gives the ground army a route. Rebuild only when
    // both are down and a destroyed span is currently visible. Engineers use
    // the normal path and repair rules.
    const repairTarget = !intact.length
      ? this.bridges.filter(bridge => bridge.destroyed && this.isVisible(bridge, 'enemy'))
        .sort((a, b) => this.bridges.indexOf(a) - this.bridges.indexOf(b))[0]
      : null;
    if (!repairTarget) return;

    let engineers = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      unit.defId === 'engineer' && !unit.embarkedIn &&
      ((!unit.order || ['idle', 'move'].includes(unit.order.type)) ||
        unit.order?.type === 'engineer' && unit.order.targetId === repairTarget.id));
    const queuedEngineer = this.buildings.some(building => building.owner === 'enemy' && building.hp > 0 &&
      building.queue?.some(item => item.defId === 'engineer'));
    if (!engineers.length && !queuedEngineer && this.credits.enemy >= UNIT_DEFS.engineer.cost + 450)
      this._queueUnit('enemy', 'engineer');
    engineers = engineers.filter(unit => !unit.order?.aiBridgeRepair ||
      unit.order.targetId === repairTarget.id);
    const engineer = engineers.sort((a, b) => this._distanceToEntity(a.x, a.y, repairTarget) -
      this._distanceToEntity(b.x, b.y, repairTarget) || a.id.localeCompare(b.id))[0];
    if (!engineer || !this.isVisible(repairTarget, 'enemy')) return;

    const targetComponent = componentAt(engineer.x, engineer.y);
    const approachExists = Array.from({ length: repairTarget.h + 2 }, (_, i) => i - 1).some(dy =>
      Array.from({ length: repairTarget.w + 2 }, (_, i) => i - 1).some(dx => {
        const x = repairTarget.x + dx, y = repairTarget.y + dy;
        if (x >= repairTarget.x && x < repairTarget.x + repairTarget.w &&
          y >= repairTarget.y && y < repairTarget.y + repairTarget.h) return false;
        return this._isPassable(x, y) && targetComponent >= 0 && componentAt(x + 0.5, y + 0.5) === targetComponent &&
          this._distanceToEntity(x + 0.5, y + 0.5, repairTarget) <= 0.9;
      }));
    if (!approachExists || engineer.order?.type === 'engineer' &&
      engineer.order.targetId === repairTarget.id) return;
    engineer.order = { type: 'engineer', targetId: repairTarget.id, aiBridgeRepair: true };
    engineer.path = []; engineer._pathGoal = null;
  }

  _aiRelayProtocols() {
    if (this.mode !== 'skirmish' || !this._relayProtocolsEnabled()) return;
    const previousOwner = this.commandOwner;
    this.commandOwner = 'enemy';
    try {
      for (const relay of [...this.relays].sort((a, b) => a.id.localeCompare(b.id))) {
        if (relay.owner !== 'enemy' || this._relayIsContested(relay)) continue;
        const garrisoned = this.units.some(unit => unit.hp > 0 && unit.owner === 'enemy' && !unit.embarkedIn &&
          !UNIT_DEFS[unit.defId].flying && dist(unit.x, unit.y, relay.x, relay.y) <= 2.3);
        if (relay.protocol === 'overdrive' && garrisoned &&
          (this.storm.phase === 'warning' || this.storm.phase === 'surge')) {
          this.setRelayProtocol(relay.id, 'shelter');
          continue;
        }
        const combatSupport = (this.replayVersion == null || this.replayVersion >= 26) && garrisoned &&
          this.units.some(unit => unit.hp > 0 && unit.owner === 'enemy' && !unit.embarkedIn &&
            !UNIT_DEFS[unit.defId].flying && UNIT_DEFS[unit.defId].weapon &&
            dist(unit.x, unit.y, relay.x, relay.y) <= 2.3) &&
          this.units.some(unit => unit.hp > 0 && unit.owner === 'player' && !unit.embarkedIn &&
            dist(unit.x, unit.y, relay.x, relay.y) <= 6 && this.isVisible(unit, 'enemy'));
        const activeEconomy = this._relayLogisticsEnabled() && this.hasBuilding('enemy', 'refinery') &&
          this.units.some(unit => unit.owner === 'enemy' && unit.hp > 0 && unit.defId === 'harvester' &&
            unit.order?.type === 'harvest');
        const stormThreat = this.storm.phase === 'warning' || this.storm.phase === 'surge';
        if (relay.protocol === 'logistics' &&
          (!activeEconomy || this.credits.enemy >= 1900 || combatSupport || stormThreat && garrisoned)) {
          this.setRelayProtocol(relay.id, 'shelter');
          continue;
        }
        if (relay.protocol !== 'logistics' && activeEconomy && this.credits.enemy < 1400 && !combatSupport &&
          (this.storm.phase === 'calm' || this.storm.phase === 'recovery')) {
          this.setRelayProtocol(relay.id, 'logistics');
          continue;
        }
        if (relay.protocol === 'shelter' && (combatSupport || !garrisoned && this.commandEnergy.enemy < 65) &&
          (this.storm.phase === 'calm' || this.storm.phase === 'recovery'))
          this.setRelayProtocol(relay.id, 'overdrive');
      }
    } finally {
      this.commandOwner = previousOwner;
    }
  }

  _aiUseFactionUnitAbilities() {
    if (this.replayVersion != null && this.replayVersion < UNIT_ABILITY_RULES_VERSION) return;
    const enemies = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
      UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy'));
    for (const unit of this.units.filter(item => item.owner === 'enemy' && item.hp > 0 && item.abilityCooldown <= 0)) {
      if (unit.defId === 'guardian') {
        const threatenedAlly = this.units.some(ally => ally.owner === 'enemy' && ally.hp > 0 &&
          ['light', 'heavy'].includes(UNIT_DEFS[ally.defId]?.armor) &&
          dist(unit.x, unit.y, ally.x, ally.y) <= GUARDIAN_BRACE_RADIUS &&
          enemies.some(threat => dist(threat.x, threat.y, ally.x, ally.y) <= 4.5));
        if (threatenedAlly && this._activateAIUnitAbility(unit, 'brace')) return;
      } else if (unit.defId === 'stealthTank' &&
          ['move', 'forceMove'].includes(unit.order?.type) &&
          enemies.some(threat => dist(threat.x, threat.y, unit.x, unit.y) <=
            (unit.hp < unit.maxHp * 0.55 ? 8.5 : 6.5))) {
        if (this._activateAIUnitAbility(unit, 'ghostRun')) return;
      }
    }
  }

  _activateAIUnitAbility(unit, abilityId) {
    if (this.canUseUnitAbility(unit.id, abilityId, 'enemy').ok) {
      this._activateUnitAbility(unit, abilityId, 'enemy');
      return true;
    }
    return false;
  }

  _aiTick() {
    if (this.status !== 'playing') return;
    this._aiUseFactionUnitAbilities();
    if (this.skirmishOpening === 'command-rig' && !this.buildings.some(b => b.owner === 'enemy' && b.defId === 'command' && b.hp > 0)) {
      const rig = this.units.find(u => u.owner === 'enemy' && u.defId === 'mcv' && u.hp > 0);
      if (rig && this._canDeployMCV(rig).ok) this._deployMCV(rig, 'enemy');
    }
    this._aiRecoverEconomy();
    const enemyBuildings = this.buildings.filter(b => b.owner === 'enemy' && b.hp > 0 && b.progress >= 1);
    if (!this.research.enemy.doctrine && !this.research.enemy.project &&
      enemyBuildings.some(b => b.defId === 'tech' && b.powered) && this.credits.enemy >= DOCTRINE_DEFS.signal.cost) {
      const previousOwner = this.commandOwner;
      this.commandOwner = 'enemy';
      const adaptiveDoctrine=this.mode==='skirmish'&&
        (this.replayVersion==null||this.replayVersion>=28);
      this.chooseDoctrine(adaptiveDoctrine?this._aiDoctrineForSituation(enemyBuildings):
        DOCTRINE_IDS[(this.seed>>>0)%DOCTRINE_IDS.length]);
      this.commandOwner = previousOwner;
    }
    const doctrineState = this.research.enemy;
    if (this.mode === 'skirmish' && (this.replayVersion == null ||
        this.replayVersion >= DOCTRINE_REPLACEMENT_RULES_VERSION) && doctrineState.doctrine &&
        !doctrineState.project && !doctrineState.replacementUsed &&
        this.credits.enemy >= DOCTRINE_REPLACEMENT_COST + TACTICAL_PACKAGE_DEFS.breach.cost &&
        enemyBuildings.some(b => b.defId === 'tech' && b.powered)) {
      const replacement = this._aiDoctrineReplacementForSituation(enemyBuildings);
      if (replacement) {
        const previousOwner = this.commandOwner;
        this.commandOwner = 'enemy';
        this.chooseDoctrine(replacement);
        this.commandOwner = previousOwner;
      }
    }
    if ((this.replayVersion == null || this.replayVersion >= 31) && this.research.enemy.doctrine &&
      !this.research.enemy.tactical && !this.research.enemy.tacticalProject &&
      enemyBuildings.some(b => b.defId === 'tech' && b.powered) && this.credits.enemy >= TACTICAL_PACKAGE_DEFS.breach.cost) {
      const previousOwner = this.commandOwner;
      this.commandOwner = 'enemy';
      this.chooseTacticalPackage(this._aiTacticalPackageForSituation());
      this.commandOwner = previousOwner;
    }
    const count = id => enemyBuildings.filter(b => b.defId === id).length;
    this._aiManageExpansion();
    const defendingRelayDominion = this._aiUnderRelayDominionPressure();
    const expansionYards = this.buildings.filter(b => b.owner === 'enemy' && b.defId === 'command' && b.hp > 0);
    const expansionOutpost = expansionYards.find(b => b.id === this._aiExpansionTarget?.yardId) || expansionYards[1];
    const expansionRefinery = expansionOutpost && this.buildings.some(b => b.owner === 'enemy' &&
      b.defId === 'refinery' && b.hp > 0 && Math.hypot(Math.max(0, expansionOutpost.x - (b.x + b.w)),
        Math.max(0, b.x - (expansionOutpost.x + expansionOutpost.w)),
        Math.max(0, expansionOutpost.y - (b.y + b.h)), Math.max(0, b.y - (expansionOutpost.y + expansionOutpost.h))) <= 8);
    const expansionPending = this._aiExpansionEnabled() && !!this._aiExpansionTarget &&
      !this._aiExpansionTarget.retryAt && !expansionRefinery;
    const refineryInProgress = this.buildings.some(b => b.owner === 'enemy' && b.defId === 'refinery' &&
      b.hp > 0 && b.progress < 1);
    let expansionCashGoal = 0;
    if (!defendingRelayDominion && this._aiExpansionEnabled() &&
        this.time >= (this._aiSiegeDirectorActive() ? 70 : 90)) {
      if (count('refinery') < 2 && !refineryInProgress && count('factory') && count('refinery'))
        expansionCashGoal = BUILDING_DEFS.refinery.cost + 200;
      else if (count('refinery') >= 2 && !count('radar'))
        expansionCashGoal = BUILDING_DEFS.radar.cost + 200;
      else if (count('refinery') >= 2 && count('radar') && !count('tech'))
        expansionCashGoal = BUILDING_DEFS.tech.cost + 200;
      else if (this._aiExpansionTarget && !expansionRefinery)
        expansionCashGoal = this._aiExpansionTarget.stage === 'funding'
          ? UNIT_DEFS.mcv.cost + 200 : BUILDING_DEFS.refinery.cost + 200;
    }
    const protectingEconomy = expansionCashGoal > 0 && this.credits.enemy < expansionCashGoal;
    const combatUnits = this.units.filter(u => u.owner === 'enemy' && u.hp > 0 && !u.embarkedIn &&
      !(u.order?.type === 'board' && this.getEntity(u.order.carrierId)?.owner === 'enemy') &&
      !['harvester', 'engineer', 'medic', 'apc', 'dropship'].includes(u.defId));
    this._aiObserve();
    this._aiRetreatHarvesters();
    this._aiSiegeVisibleDefenses(combatUnits);
    this._aiRelayProtocols();
    this._aiDefend(combatUnits);
    this._aiSupportMedics();
    this._aiRaidHarvesters(combatUnits);
    this._aiScout(combatUnits);
    this._aiContestRelays(combatUnits);
    this._aiStormglassBloom(combatUnits);
    this._aiBridgeTick(combatUnits);
    this._aiUseCommandAbilities(combatUnits);
    this._aiTransportTick();
    this._aiRecoverArmor(combatUnits);
    this._aiRecoverWrecks();
    this._aiSalvageDrop();
    const harvesters = this.units.filter(u => u.owner === 'enemy' && u.hp > 0 && u.defId === 'harvester').length;
    const airDefense = this.enemyFaction === 'aegis' ? 'aaTower' : 'sam';
    const specialDefense = this.enemyFaction === 'vesper' ? 'obelisk' : 'guardTower';
    if (protectingEconomy &&
      count('power') && this.power.enemy.ratio >= 0.83) { /* reserve for the remote refinery */ }
    else if (!count('power') || this.power.enemy.ratio < 0.83) this._aiBuild(this.hasBuilding('enemy', 'tech') && this.credits.enemy > 1200 ? 'advancedPower' : 'power');
    else if (!count('refinery')) this._aiBuild('refinery');
    else if (!count('barracks')) this._aiBuild('barracks');
    else if (!count('factory')) this._aiBuild('factory');
    else if (this._aiExpansionEnabled() && count('refinery') < 2 && this.credits.enemy > BUILDING_DEFS.refinery.cost + 200)
      this._aiBuild('refinery');
    else if (!count('radar') && this.credits.enemy > 1350) this._aiBuild('radar');
    else if (!count('tech') && count('radar') && this.credits.enemy >
      (this._aiExpansionEnabled() ? BUILDING_DEFS.tech.cost + 200 : 2400)) this._aiBuild('tech');
    else if (!this._aiExpansionEnabled() && count('refinery') < 2 && this.credits.enemy > 3000) this._aiBuild('refinery');
    else if (count('radar') && count(airDefense) < 1 && this.credits.enemy > 1650) this._aiBuild(airDefense);
    else if (count('radar') && count('helipad') < 1 && this.credits.enemy > 2800) this._aiBuild('helipad');
    else if (count('tech') && count(specialDefense) < 1 && this.credits.enemy > 2800) this._aiBuild(specialDefense);
    else if (count('turret') < 2 + Math.min(2, this._aiWaveNumber) && this.credits.enemy > 1800) this._aiBuild('turret');
    else if (count('tech') && count(this.enemyFaction === 'aegis' ? 'superweapon' : 'warhead') < 1 && this.credits.enemy > 4850)
      this._aiBuild(this.enemyFaction === 'aegis' ? 'superweapon' : 'warhead');
    else if (count('factory') && count('serviceBay') < 1 && this.credits.enemy > 3000 &&
      this.units.some(u => u.owner === 'enemy' && u.hp > 0 && !u.embarkedIn &&
        !UNIT_DEFS[u.defId].flying && ['light', 'heavy'].includes(UNIT_DEFS[u.defId].armor) && u.hp < u.maxHp))
      this._aiBuild('serviceBay');
    const queuedHarvesters = this.buildings.filter(b => b.owner === 'enemy').reduce((sum, b) =>
      sum + b.queue.filter(q => q.defId === 'harvester').length, 0);
    const yards = this.buildings.filter(b => b.owner === 'enemy' && b.defId === 'command' && b.hp > 0);
    const outpost = yards.find(b => b.id === this._aiExpansionTarget?.yardId) || yards[1];
    const operatingOutpost = this._aiExpansionEnabled() && outpost && this.buildings.some(b =>
      b.owner === 'enemy' && b.defId === 'refinery' && b.hp > 0 && b.progress >= 1 &&
      Math.hypot(Math.max(0, outpost.x - (b.x + b.w)), Math.max(0, b.x - (outpost.x + outpost.w)),
        Math.max(0, outpost.y - (b.y + b.h)), Math.max(0, b.y - (outpost.y + outpost.h))) <= 8);
    const harvesterLimit = operatingOutpost ? 3 : Math.min(2, count('refinery') + 1);
    const protectOutpostCash = protectingEconomy || expansionPending && this.credits.enemy < expansionCashGoal;
    if (!protectOutpostCash && harvesters + queuedHarvesters < harvesterLimit &&
      this.credits.enemy >= UNIT_DEFS.harvester.cost)
      this._queueUnit('enemy', 'harvester');
    const cap = this.difficulty === 'hard' ? 27 : this.difficulty === 'easy' ? 14 : 21;
    const queued = enemyBuildings.reduce((sum, b) => sum + b.queue.length, 0);
    if (!protectOutpostCash && combatUnits.length + queued < cap) {
      const r = this._rand();
      const infantry = r < 0.38 || !count('factory');
      const recentIntel = this._aiIntel.filter(item => this.time - item.seen < 24);
      const recent = recentIntel.filter(item => !item.building);
      const air = recent.filter(item => UNIT_DEFS[item.defId]?.flying).length;
      const armor = recent.filter(item => ['heavy', 'light'].includes(UNIT_DEFS[item.defId]?.armor)).length;
      const rockets = combatUnits.filter(u => u.defId === 'rocket').length +
        enemyBuildings.reduce((sum, b) => sum + b.queue.filter(q => q.defId === 'rocket').length, 0);
      const stealthTanks = combatUnits.filter(u => u.defId === 'stealthTank').length +
        enemyBuildings.reduce((sum, b) => sum + b.queue.filter(q => q.defId === 'stealthTank').length, 0);
      const needAirRockets = air && rockets < Math.max(2, air * 2);
      const needAntiArmor = armor >= 2 && rockets < Math.min(4, Math.ceil(armor / 2));
      // Aegis fields a direct missile response to armor. Vesper's researched
      // stealth tank fills that role with a faction-specific mobile counter.
      const needVesperArmor = !needAirRockets && needAntiArmor && this.enemyFaction === 'vesper' &&
        count('tech') && stealthTanks < Math.min(3, Math.ceil(armor / 2));
      const medicCount = this.units.filter(unit => unit.owner === 'enemy' && unit.defId === 'medic' && unit.hp > 0).length +
        enemyBuildings.reduce((sum, building) => sum + building.queue.filter(item => item.defId === 'medic').length, 0);
      const needMedic = this.mode === 'skirmish' && (this.replayVersion == null || this.replayVersion >= 23) &&
        this.enemyFaction === 'aegis' && count('radar') > 0 && medicCount === 0 &&
        this.credits.enemy >= UNIT_DEFS.medic.cost && this.units.some(unit => unit.owner === 'enemy' &&
          unit.hp > 0 && !unit.embarkedIn && unit.defId !== 'medic' && UNIT_DEFS[unit.defId]?.weapon &&
          UNIT_DEFS[unit.defId]?.armor === 'infantry' && unit.maxHp - unit.hp > 1);
      const choice = this.mode === 'skirmish' && (this.replayVersion == null || this.replayVersion >= 22)
        ? this._aiChooseTeamUnit({ r, infantry, recent, recentIntel, air, armor, rockets, stealthTanks,
          needAirRockets, needAntiArmor, needVesperArmor, needMedic, combatUnits, enemyBuildings, count })
        : needAirRockets || (needAntiArmor && !needVesperArmor) ? 'rocket' : needVesperArmor ? 'stealthTank' : count('helipad') && r > 0.91 ? this.enemyFaction === 'aegis' ? 'orca' : 'apache' : infantry
          ? (r < 0.11 ? 'rocket' : r < 0.2 && this.enemyFaction === 'vesper' ? 'flamer' : 'rifle')
          : (r < 0.48 ? 'buggy' : this.hasBuilding('enemy', 'tech') && r > 0.88
            ? this.enemyFaction === 'aegis' ? 'guardian' : 'stealthTank' : r > 0.77 && count('radar') ? 'artillery' : 'lightTank');
      if (!this._queueUnit('enemy', choice).ok && choice !== 'rifle') this._queueUnit('enemy', 'rifle');
    }
    for (const b of enemyBuildings) {
      if (!b.captureOnly && b.hp < b.maxHp * 0.55 && this.credits.enemy > 300) b.repairing = true;
    }
    if (!this.buildings.some(b => b.owner === 'player' && b.hp > 0)) this._launchAiWave();
  }

  _aiDoctrineForSituation(enemyBuildings) {
    // The initial doctrine uses the current strategic picture and only counts
    // opposing defenses the AI can actually see. Seed order is
    // a deterministic tie-break, preserving reproducible matches and replays.
    const scores = this._aiDoctrineScoresForSituation(enemyBuildings);
    const highest = Math.max(...Object.values(scores));
    const tieOrder = Array.from({ length: DOCTRINE_IDS.length }, (_, offset) =>
      DOCTRINE_IDS[((this.seed >>> 0) + offset) % DOCTRINE_IDS.length]);
    return tieOrder.find(id => scores[id] === highest);
  }

  _aiDoctrineScoresForSituation(enemyBuildings) {
    const harvesters = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      unit.defId === 'harvester').length;
    const refineries = enemyBuildings.filter(building => building.defId === 'refinery').length;
    const logisticsScore = Math.max(0, harvesters - 1) + (refineries >= 2 ? 1 : 0) +
      (harvesters <= 1 && this.credits.enemy < 2200 ? 2 : 0);

    const visibleGroundDefenses = this.buildings.filter(building => {
      const weapon = BUILDING_DEFS[building.defId]?.weapon;
      return building.owner === 'player' && building.hp > 0 && building.progress >= 1 &&
        building.powered && this.isVisible(building, 'enemy') && weapon &&
        ['ground', 'both'].includes(weapon.target);
    }).length;
    const siegeScore = Math.min(3, visibleGroundDefenses);

    const secureRelays = this.relays.filter(relay => relay.owner === 'enemy' && !this._relayIsContested(relay)).length;
    const signalScore = secureRelays + (this.commandEnergy.enemy <= 55 ? 1 : 0);
    return { logistics: logisticsScore, siege: siegeScore, signal: signalScore };
  }

  _aiDoctrineReplacementForSituation(enemyBuildings) {
    const current = this.research.enemy?.doctrine;
    if (!current || !DOCTRINE_DEFS[current]) return null;
    const scores = this._aiDoctrineScoresForSituation(enemyBuildings);
    const stableOrder = Array.from({ length: DOCTRINE_IDS.length }, (_, offset) =>
      DOCTRINE_IDS[((this.seed >>> 0) + offset) % DOCTRINE_IDS.length]);
    const alternatives = DOCTRINE_IDS.filter(id => id !== current).sort((a, b) =>
      scores[b] - scores[a] || stableOrder.indexOf(a) - stableOrder.indexOf(b));
    const best = alternatives[0];
    // Require a substantial, observable advantage over the active doctrine.
    // This prevents one-point score ties and seed order from causing a costly
    // switch while still reacting to a clearly changed front or economy.
    return scores[best] >= scores[current] + 2 ? best : null;
  }

  _aiTacticalPackageForSituation() {
    if (this.replayVersion != null && this.replayVersion <= 31) {
      const visibleThreats = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
        UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy'));
      const wounded = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
        !UNIT_DEFS[unit.defId]?.flying && unit.hp < unit.maxHp * 0.72).length;
      if (wounded >= 3) return 'rally';
      if (visibleThreats.length >= 3) return 'interdict';
      return 'breach';
    }
    if (this.replayVersion == null || this.replayVersion >= 33)
      return this._aiTacticalPackageForSituationV33();
    // Version 32 recorded this weighting. Keep its choices stable for replay.
    // Base the permanent choice on what the AI can actually observe plus its
    // own force condition. Structures reward a siege window, mobile weapon
    // formations reward suppression, and damaged/suppressed troops reward
    // Rally. No opponent economy, hidden units, or random choice is consulted.
    const visibleThreats = this.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
      !unit.embarkedIn && UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy'));
    const visibleStructures = this.buildings.filter(building => building.owner === 'player' &&
      building.hp > 0 && building.progress >= 1 && this.isVisible(building, 'enemy') &&
      ['command', 'factory', 'refinery', 'radar', 'tech', 'superweapon', 'warhead',
        'turret', 'guardTower', 'obelisk'].includes(building.defId));
    // Recent sightings are the AI's actual remembered map knowledge. A stale
    // structure can guide a permanent research choice, but casts still require
    // a currently visible target in _aiUsePackageAbility.
    const knownStructures = (this._aiIntel || []).filter(item => item.building &&
      this.time - item.seen <= 180 && ['command', 'factory', 'refinery', 'radar', 'tech',
        'superweapon', 'warhead', 'turret', 'guardTower', 'obelisk'].includes(item.defId));
    const mobileGroundForce = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon);
    const wounded = mobileGroundForce.filter(unit => unit.hp < unit.maxHp * 0.78 ||
      unit.suppressedUntil > this.time);
    const siegeUnits = mobileGroundForce.filter(unit => ['rocket', 'artillery'].includes(unit.defId)).length;
    const engagedThreats = visibleThreats.filter(threat => mobileGroundForce.some(unit =>
      dist(unit.x, unit.y, threat.x, threat.y) <= 9));
    const knownMobileThreats = new Map((this._aiIntel || []).filter(item => !item.building &&
      UNIT_DEFS[item.defId]?.weapon && this.time - item.seen <= 24)
      .map(item => [item.id, item]));
    for (const threat of visibleThreats) knownMobileThreats.set(threat.id, threat);
    const observedThreats = [...knownMobileThreats.values()];
    const rallyWounds = wounded.filter(unit => observedThreats.some(threat =>
      dist(unit.x, unit.y, threat.x, threat.y) <= 20));
    const rallyScore = Math.min(3.5, rallyWounds.reduce((score, unit) => score +
      clamp((1 - unit.hp / unit.maxHp) * 2, 0.2, 1) +
      (unit.suppressedUntil > this.time ? 0.75 : 0), 0));
    const structureTargets = new Map([...knownStructures, ...visibleStructures.map(building => ({
      id: building.id, defId: building.defId,
    }))].map(building => [building.id, building]));
    const scores = {
      breach: [...structureTargets.values()].reduce((score, building) => score +
        (['command', 'factory', 'superweapon', 'warhead'].includes(building.defId) ? 3 :
          ['turret', 'guardTower', 'obelisk'].includes(building.defId) ? 2 : 1), 0) +
        Math.min(3, siegeUnits) * 1.5,
      interdict: Math.min(3.5, engagedThreats.length * 2.5 + Math.max(0, engagedThreats.length - 1) * 0.5 +
        Math.max(0, knownMobileThreats.size - engagedThreats.length) * 1.8),
      rally: rallyScore,
    };
    const order = ['breach', 'interdict', 'rally'];
    const highest = Math.max(...order.map(id => scores[id]));
    if (highest === 0) return 'rally';
    return order.find(id => scores[id] === highest) || 'rally';
  }

  _aiTacticalPackageForSituationV33() {
    // Permanent research should match a front the opponent has reached. A
    // remembered base on the far side of the map is useful intel, but it is
    // weaker Breach evidence than a structure an armed ground force can hit.
    const force = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      !unit.embarkedIn && !UNIT_DEFS[unit.defId]?.flying && UNIT_DEFS[unit.defId]?.weapon);
    const observedStructures = new Map();
    for (const item of this._aiIntel || []) {
      if (!item.building || this.time - item.seen > 120 ||
        !['command', 'factory', 'refinery', 'radar', 'tech', 'superweapon', 'warhead',
          'turret', 'guardTower', 'obelisk'].includes(item.defId)) continue;
      observedStructures.set(item.id, { ...item, visible: false });
    }
    for (const building of this.buildings) {
      if (building.owner !== 'player' || building.hp <= 0 || building.progress < 1 ||
        !this.isVisible(building, 'enemy') ||
        !['command', 'factory', 'refinery', 'radar', 'tech', 'superweapon', 'warhead',
          'turret', 'guardTower', 'obelisk'].includes(building.defId)) continue;
      observedStructures.set(building.id, { id: building.id, defId: building.defId,
        x: building.x + building.w / 2, y: building.y + building.h / 2, visible: true });
    }
    const observedMobiles = new Map();
    for (const item of this._aiIntel || []) if (!item.building &&
      this.time - item.seen <= 20 && UNIT_DEFS[item.defId]?.weapon)
      observedMobiles.set(item.id, item);
    for (const unit of this.units) if (unit.owner === 'player' && unit.hp > 0 &&
      !unit.embarkedIn && UNIT_DEFS[unit.defId]?.weapon && this.isVisible(unit, 'enemy'))
      observedMobiles.set(unit.id, unit);
    const nearForce = (x, y, radius) => force.some(unit => dist(unit.x, unit.y, x, y) <= radius);
    const siegeUnits = force.filter(unit => ['rocket', 'artillery'].includes(unit.defId)).length;
    const breach = Math.max(0, ...[...observedStructures.values()].map(target => {
      const nearest = force.length ? Math.min(...force.map(unit => dist(unit.x, unit.y, target.x, target.y))) : Infinity;
      const value = ['command', 'factory', 'superweapon', 'warhead'].includes(target.defId) ? 1.4 :
        ['turret', 'guardTower', 'obelisk'].includes(target.defId) ? 1 : 0.6;
      return value + (target.visible ? 0.8 : 0) +
        (nearest <= 7 ? 2.2 : nearest <= 13 ? 1.2 : nearest <= 20 ? 0.3 : 0) +
        (nearest <= 20 ? Math.min(2, siegeUnits) * 0.45 : 0);
    }));
    const nearbyThreats = [...observedMobiles.values()].filter(threat =>
      nearForce(threat.x, threat.y, 11));
    const engagedThreats = nearbyThreats.filter(threat => nearForce(threat.x, threat.y, 6));
    const interdict = nearbyThreats.length ? 1.1 + Math.min(3, nearbyThreats.length) * 0.9 +
      Math.min(2, engagedThreats.length) * 0.7 : 0;
    const woundedAtFront = force.filter(unit => (unit.hp < unit.maxHp * 0.85 ||
      unit.suppressedUntil > this.time) && nearbyThreats.some(threat =>
      dist(unit.x, unit.y, threat.x, threat.y) <= 12));
    const rally = woundedAtFront.length ? 1.3 + Math.min(4, woundedAtFront.reduce((score, unit) =>
      score + clamp((1 - unit.hp / unit.maxHp) * 2.2, 0.25, 1.2) +
      (unit.suppressedUntil > this.time ? 0.55 : 0), 0)) : 0;
    const scores = { breach, interdict, rally };
    const highest = Math.max(...Object.values(scores));
    if (highest < 1) return this.research.enemy.doctrine === 'siege' ? 'breach' :
      this.research.enemy.doctrine === 'signal' ? 'interdict' : 'rally';
    return ['rally', 'interdict', 'breach'].find(id => scores[id] === highest);
  }

  _aiChooseTeamUnit({ r, infantry, recent, recentIntel, air, armor, rockets, stealthTanks,
    needAirRockets, needAntiArmor, needVesperArmor, needMedic = false, combatUnits, enemyBuildings, count }) {
    const queuedCount = defId => enemyBuildings.reduce((sum, building) => sum +
      building.queue.filter(item => item.defId === defId).length, 0);
    const total = defId => combatUnits.filter(unit => unit.defId === defId).length + queuedCount(defId);
    // Keep dedicated counters in the force while retaining enough general
    // purpose armor to protect them and exploit the opening they create.
    if (needAirRockets) return 'rocket';
    if (needAntiArmor) {
      if (needVesperArmor) return 'stealthTank';
      return 'rocket';
    }
    if (needMedic) return 'medic';
    const rifleThreat = recent.filter(item => item.defId === 'rifle' || item.defId === 'flamer').length;
    const artillery = total('artillery');
    const frontline = total('lightTank') + total('buggy') + total('guardian');
    const antiInfantry = total('buggy') + total('flamer') + total('apache');
    if (this._aiSiegeDirectorActive() && count('radar') && artillery < 3)
      return 'artillery';
    // Raiders invest in a small fast screen before the first three minutes,
    // then use the larger dedicated harassment packet in _aiRaidHarvesters.
    if (this._aiCommanderProfileActive('raider') && this.time < 180 && total('buggy') < 2)
      return 'buggy';
    // Artillery is a deliberate siege investment once radar exists and the
    // opponent has exposed production or command buildings in recent intel.
    if (count('radar') && artillery < 2 && recentIntel.some(item => item.building &&
      ['command', 'factory', 'refinery'].includes(item.defId))) return 'artillery';
    if (air && rockets < Math.max(2, air * 2)) return 'rocket';
    if (armor >= 2 && this.enemyFaction === 'vesper' && count('tech') &&
      stealthTanks < Math.min(3, Math.ceil(armor / 2))) return 'stealthTank';
    if (rifleThreat >= 3 && antiInfantry < 2) return this.enemyFaction === 'vesper' ? 'flamer' : 'buggy';
    // A small screen of fast units keeps the team's slower counters from
    // arriving alone. Randomness only breaks ties after composition floors.
    if (frontline < Math.max(2, Math.ceil((combatUnits.length + 1) * 0.3)))
      return this.hasBuilding('enemy', 'tech') && r > 0.75
        ? this.enemyFaction === 'aegis' ? 'guardian' : 'stealthTank'
        : r < 0.5 ? 'buggy' : 'lightTank';
    if (count('helipad') && r > 0.9) return this.enemyFaction === 'aegis' ? 'orca' : 'apache';
    if (infantry) return r < 0.16 ? 'rocket' : r < 0.26 && this.enemyFaction === 'vesper' ? 'flamer' : 'rifle';
    return r > 0.82 && count('radar') ? 'artillery' : r < 0.5 ? 'buggy' : 'lightTank';
  }

  _aiWorkshopApproach(unit, bay) {
    const candidates = [];
    for (let y = bay.y - 3; y <= bay.y + bay.h + 2; y++) {
      for (let x = bay.x - 3; x <= bay.x + bay.w + 2; x++) {
        // Leave enough margin for _moveUnit's arrival tolerance so the vehicle
        // still ends inside the workshop's 2.5-tile repair radius.
        if (!this._isPassable(x, y) || this._distanceToEntity(x + 0.5, y + 0.5, bay) > 2.1) continue;
        candidates.push({ x: x + 0.5, y: y + 0.5, tileY: y, tileX: x,
          directDistance: dist(unit.x, unit.y, x + 0.5, y + 0.5) });
      }
    }
    candidates.sort((a, b) => a.directDistance - b.directDistance || a.tileY - b.tileY || a.tileX - b.tileX);
    // Usually the nearest workshop side is reachable, so avoid a full path
    // search for every repair-radius tile on each retreat decision.
    for (const candidate of candidates) {
      const path = this._findPath(unit.x, unit.y, candidate.x, candidate.y);
      if (!path.length) continue;
      let length = 0, px = unit.x, py = unit.y;
      for (const point of path) { length += dist(px, py, point.x, point.y); px = point.x; py = point.y; }
      return { x: candidate.x, y: candidate.y, length };
    }
    return null;
  }

  _aiRecoverArmor(combatUnits) {
    // A damaged vehicle can disengage to the Field Workshop, then return to its
    // previous assignment once the bay has restored most of its health.
    const bays = this.buildings.filter(b => b.owner === 'enemy' && b.defId === 'serviceBay' &&
      b.hp > 0 && b.progress >= 1 && b.powered);
    for (const unit of combatUnits) {
      if (!['light', 'heavy'].includes(UNIT_DEFS[unit.defId]?.armor) || UNIT_DEFS[unit.defId]?.flying) continue;
      if (unit._aiRecovering) {
        const bay = this.getEntity(unit._aiRecovering);
        if (!bay || bay.hp <= 0 || !bay.powered || unit.hp >= unit.maxHp * 0.9) {
          unit.order = unit._aiRecoveryOrder || { type: 'guard', x: unit.x, y: unit.y };
          unit._aiRecovering = null;
          unit._aiRecoveryOrder = null;
          unit._aiRecoveryPoint = null;
          unit.path = []; unit._pathGoal = null;
        } else {
          const point = unit._aiRecoveryPoint || this._aiWorkshopApproach(unit, bay);
          if (!point) continue;
          unit._aiRecoveryPoint = point;
          const { x, y } = point;
          if (unit.order?.type !== 'move' || unit.order.x !== x || unit.order.y !== y) {
            unit.order = { type: 'move', x, y };
            unit.path = []; unit._pathGoal = null;
          }
        }
        continue;
      }
      if (unit.hp > unit.maxHp * 0.55 || unit._aiDefenseTarget || unit._aiRaidTarget || unit._relayAssignment)
        continue;
      const choices = bays.map(bay => ({ bay, point: this._aiWorkshopApproach(unit, bay) }))
        .filter(choice => choice.point)
        .sort((a, b) => a.point.length - b.point.length || a.bay.id.localeCompare(b.bay.id));
      const { bay, point } = choices[0] || {};
      if (!bay) continue;
      unit._aiRecoveryOrder = structuredClone(unit.order || { type: 'guard', x: unit.x, y: unit.y });
      unit._aiRecovering = bay.id;
      unit._aiRecoveryPoint = { x: point.x, y: point.y };
      unit.order = { type: 'move', x: point.x, y: point.y };
      unit.path = []; unit._pathGoal = null;
    }
  }

  _aiSiegeVisibleDefenses(combatUnits) {
    if (!this._aiSiegeDirectorActive()) return false;
    const defenseIds = ['turret', 'guardTower', 'aaTower', 'sam', 'obelisk', 'ionSpire'];
    for (const unit of combatUnits) if (unit._aiSiegeTarget) {
      const previous = this.getEntity(unit._aiSiegeTarget);
      if (!previous || previous.hp <= 0 || !this.isVisible(previous, 'enemy')) {
        unit._aiSiegeTarget = null;
        if (unit.order?.aiSiegeDirector) {
          unit.order = { type: 'idle' }; unit.path = []; unit._pathGoal = null;
        }
      }
    }
    for (const unit of combatUnits) if (unit._aiSiegeEscort) {
      const leader = this.getEntity(unit._aiSiegeEscort);
      if (!leader || !leader._aiSiegeTarget) {
        unit._aiSiegeEscort = null;
        if (unit.order?.aiSiegeEscort) {
          unit.order = { type: 'idle' }; unit.path = []; unit._pathGoal = null;
        }
      }
    }
    const targets = this.buildings.filter(building => building.owner === 'player' && building.hp > 0 &&
      building.progress >= 1 && defenseIds.includes(building.defId) && this.isVisible(building, 'enemy'));
    if (!targets.length) return false;
    const artillery = combatUnits.filter(unit => unit.defId === 'artillery' && !unit.embarkedIn &&
      !unit._aiDefenseTarget && !unit._aiRaidTarget && !unit._aiRecovering &&
      (unit.order?.type !== 'attack' || unit._aiSiegeTarget))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!artillery.length) return false;
    const target = targets.sort((a, b) => {
      const closest = building => Math.min(...artillery.map(unit => dist(unit.x, unit.y,
        building.x + (building.w || 1) / 2, building.y + (building.h || 1) / 2)));
      return closest(a) - closest(b) || a.id.localeCompare(b.id);
    })[0];
    const assigned = artillery.slice(0, 2);
    for (const unit of assigned) {
      if (unit._aiSiegeTarget === target.id && unit.order?.targetId === target.id) continue;
      unit._relayAssignment = null;
      unit._aiSiegeTarget = target.id;
      unit.order = { type: 'attack', targetId: target.id, aiIntel: true, aiSiegeDirector: true,
        lastX: target.x + (target.w || 1) / 2, lastY: target.y + (target.h || 1) / 2 };
      unit.path = []; unit._pathGoal = null;
    }
    const leader = assigned[0];
    const escort = combatUnits.filter(unit => unit !== leader && unit.defId !== 'artillery' &&
      ['lightTank', 'buggy', 'guardian', 'rifle'].includes(unit.defId) && !unit._aiDefenseTarget &&
      !unit._aiRaidTarget && !unit._aiRecovering && !unit._aiSiegeEscort && unit.order?.type !== 'attack')
      .sort((a, b) => dist(a.x, a.y, leader.x, leader.y) - dist(b.x, b.y, leader.x, leader.y) ||
        a.id.localeCompare(b.id))[0];
    if (escort) {
      escort._relayAssignment = null;
      escort._aiSiegeEscort = leader.id;
      escort.order = { type: 'follow', targetId: leader.id, aiSiegeEscort: true };
      escort.path = []; escort._pathGoal = null;
    }
    return true;
  }

  _aiRecoverWrecks() {
    if ((this.replayVersion ?? 10) < 10 || !this.wrecks.length ||
        this.creditCapacity.enemy - this.credits.enemy < 1) return;
    const assigned = new Set(this.units.filter(unit => unit.owner === 'enemy' &&
      unit.order?.type === 'recoverWreck').map(unit => unit.order.wreckId));
    const engineers = this.units.filter(unit => unit.owner === 'enemy' && unit.hp > 0 &&
      unit.defId === 'engineer' && !unit.embarkedIn && unit.order?.type === 'idle')
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const engineer of engineers) {
      const wreck = this.wrecks.filter(item => item.expiresAt > this.time && !assigned.has(item.id) &&
        dist(engineer.x, engineer.y, item.x, item.y) <= 12 &&
        this.isVisible({ x: item.x, y: item.y, owner: 'player' }, 'enemy'))
        .sort((a, b) => dist(engineer.x, engineer.y, a.x, a.y) - dist(engineer.x, engineer.y, b.x, b.y) ||
          a.id.localeCompare(b.id))[0];
      if (!wreck) continue;
      engineer.order = { type: 'recoverWreck', wreckId: wreck.id };
      engineer._wreckRecoveryProgress = 0;
      engineer.path = []; engineer._pathGoal = null;
      assigned.add(wreck.id);
    }
  }

  _launchAiWave() {
    const teamPolicy = this.mode === 'skirmish' && (this.replayVersion == null || this.replayVersion >= 22);
    const siegeDirector = this._aiSiegeDirectorActive();
    const army = this.units.filter(u => u.owner === 'enemy' && u.hp > 0 &&
      !u.embarkedIn && !(u.order?.type === 'board' && this.getEntity(u.order.carrierId)?.owner === 'enemy') &&
      !(siegeDirector && u._aiExpansion) &&
      !['harvester', 'engineer', 'medic', 'apc', 'dropship'].includes(u.defId) && !u._relayAssignment &&
      !u._aiDefenseTarget && !u._aiRaidTarget && !u._aiRecovering &&
      !u.order?.aiScout && u.order?.type !== 'attack');
    if (army.length < 3) return false;
    this._aiObserve();
    const isVisibleDefenseIntel = item => {
      if (!siegeDirector || !['turret', 'guardTower', 'aaTower', 'sam', 'obelisk', 'ionSpire'].includes(item.defId))
        return false;
      const live = this.getEntity(item.id);
      return !!live && live.owner === 'player' && live.hp > 0 && this.isVisible(live, 'enemy');
    };
    const priority = item => isVisibleDefenseIntel(item) ? -1 :
      item.defId === 'command' ? 0 :
      item.defId === 'refinery' || item.defId === 'factory' ? 1 :
        item.defId === 'harvester' || item.defId === 'mcv' ? 2 : 3;
    const center = army.reduce((point, unit) => ({ x: point.x + unit.x / army.length,
      y: point.y + unit.y / army.length }), { x: 0, y: 0 });
    const intelTargets = [...this._aiIntel].sort((a, b) => {
      // New skirmish rules weigh observed target value against how far the
      // available force must travel. This stops every wave blindly preferring
      // the command structure when a nearby strategic objective is exposed.
      if (this.mode === 'skirmish' && (this.replayVersion == null || this.replayVersion >= 6)) {
        const score = item => priority(item) * 5 + dist(center.x, center.y, item.x, item.y);
        return score(a) - score(b) || a.id.localeCompare(b.id);
      }
      return priority(a) - priority(b) || b.seen - a.seen;
    }).filter(item => {
      const live = this.getEntity(item.id);
      if (live && live.owner !== 'player') return false;
      return !live || !this.isVisible(live, 'enemy') ||
        army.some(u => this._weaponCanTarget(UNIT_DEFS[u.defId].weapon, live));
    });
    let target = intelTargets[0];
    const leadingVisibleDefense = intelTargets[0] && isVisibleDefenseIntel(intelTargets[0]);
    if (teamPolicy && intelTargets.length > 1 && !leadingVisibleDefense) {
      // Alternate between command and economy targets when both are known.
      // Keep the established proximity/value ranking within each objective
      // class, and fall back to the best known target when a class is absent.
      const preferEconomy = this._aiWaveNumber % 2 === 0;
      const score = item => priority(item) * 5 + dist(center.x, center.y, item.x, item.y);
      const comparable = intelTargets.filter(item => score(item) <= score(intelTargets[0]) + 12);
      const preferred = comparable.find(item => preferEconomy
        ? ['refinery', 'factory', 'harvester', 'mcv'].includes(item.defId)
        : item.defId === 'command');
      if (preferred) target = preferred;
    }
    // A wave without intelligence probes the opposing deployment area.
    const destination = target || { x: 12, y: 37 };
    const size = Math.min(army.length, 5 + this._aiWaveNumber * 2);
    const visible = target && this.getEntity(target.id)?.hp > 0 &&
      this.isVisible(this.getEntity(target.id), 'enemy');
    const candidates = army.filter(u => !visible ||
      this._weaponCanTarget(UNIT_DEFS[u.defId].weapon, this.getEntity(target.id)));
    const role = unit => {
      if (['rocket', 'stealthTank'].includes(unit.defId)) return 'counter';
      if (['artillery', 'guardian'].includes(unit.defId)) return 'siege';
      if (['buggy', 'scout', 'orca', 'apache'].includes(unit.defId)) return 'screen';
      return 'line';
    };
    const rolePriority = unit => {
      if (!teamPolicy || !visible) return 0;
      const defId = this.getEntity(target.id)?.defId;
      if (siegeDirector && ['turret', 'guardTower', 'aaTower', 'sam', 'obelisk', 'ionSpire'].includes(defId))
        return ({ siege: 0, counter: 1, line: 2, screen: 3 })[role(unit)];
      if (defId === 'command' || ['factory', 'refinery', 'radar', 'tech'].includes(defId))
        return ({ siege: 0, counter: 1, line: 2, screen: 3 })[role(unit)];
      const targetDef = this.getEntity(target.id);
      if (targetDef && UNIT_DEFS[targetDef.defId]?.flying)
        return role(unit) === 'counter' ? 0 : 1;
      if (targetDef && ['light', 'heavy'].includes(UNIT_DEFS[targetDef.defId]?.armor))
        return role(unit) === 'counter' ? 0 : role(unit) === 'line' ? 1 : 2;
      return role(unit) === 'screen' ? 0 : 1;
    };
    // Assemble specialists and their screen into the same bounded assault
    // packet. Stable ID tie breaks make the team identical after replay seek.
    let attack;
    if (teamPolicy) {
      const ordered = candidates.sort((a, b) => rolePriority(a) - rolePriority(b) || a.id.localeCompare(b.id));
      attack = ordered.slice(0, size);
      const strategicBuilding = visible && this.getEntity(target.id)?.w &&
        ['command', 'factory', 'refinery', 'radar', 'tech'].includes(this.getEntity(target.id)?.defId);
      const hasEscort = unit => ['line', 'screen'].includes(role(unit));
      const escort = ordered.find(hasEscort);
      if (strategicBuilding && size >= 3 && escort && !attack.some(hasEscort)) {
        attack[attack.length - 1] = escort;
        attack.sort((a, b) => rolePriority(a) - rolePriority(b) || a.id.localeCompare(b.id));
      }
    } else attack = candidates.slice(0, size);
    if (!attack.length) return false;
    for (const u of attack) {
      u.order = visible
        ? { type: 'attack', targetId: target.id, aiIntel: true, lastX: target.x, lastY: target.y,
          ...(teamPolicy ? { aiTeam: this._aiWaveNumber, aiTeamRole: role(u) } : {}) }
        : { type: 'move', x: destination.x, y: destination.y, attackMove: true };
      u.path = []; u._pathGoal = null;
    }
    this._aiWaveNumber++;
    this._event('incomingAttack', { count: attack.length, x: destination.x, y: destination.y });
    return true;
  }

  _updateSuperweapon(dt) {
    for (const owner of ['player', 'enemy']) {
      const nuke = this.hasBuilding(owner, 'warhead');
      if (!this.hasBuilding(owner, 'superweapon') && !nuke) { this.superweapon[owner] = 0; continue; }
      if (this.power[owner].ratio >= 0.8)
        this.superweapon[owner] = Math.min(1, this.superweapon[owner] + dt / (nuke ? 180 : 160));
      if (this.mode !== 'multiplayer' && this.superweapon[owner] >= 1 && owner === 'enemy') {
        this._aiObserve();
        const target = [...this._aiIntel].filter(item => item.building)
          .sort((a, b) => (a.defId === 'factory' ? 0 : a.defId === 'command' ? 1 : 2) -
            (b.defId === 'factory' ? 0 : b.defId === 'command' ? 1 : 2) || b.seen - a.seen)[0];
        if (target) {
          const x = target.x, y = target.y;
          this.superweapon.enemy = 0;
          this._strike('enemy', x, y, nuke);
        }
      }
    }
  }

  _tick(dt) {
    this.time += dt;
    for (const unit of this.units) unit.abilityCooldown = Math.max(0, (unit.abilityCooldown || 0) - dt);
    this.breachZones = (this.breachZones || []).filter(zone => zone.until > this.time);
    this.wrecks = this.wrecks.filter(wreck => wreck.expiresAt > this.time);
    for (const owner of ['player', 'enemy']) for (const abilityId of Object.keys(COMMAND_ABILITIES))
      this.commandCooldowns[owner][abilityId] = Math.max(0, this.commandCooldowns[owner][abilityId] -
        dt * (this.research?.[owner]?.doctrine === 'signal' ? 1.2 : 1));
    this.scans = this.scans.filter(scan => scan.until > this.time);
    this._updateStorm(dt);
    this._updateBloomExpeditions();
    this._powerTimer += dt;
    if (this._powerTimer >= 0.5) { this._powerTimer = 0; this._refreshPower(); }
    for (const [owner, key] of [['player', 'construction'], ['enemy', 'enemyConstruction']]) {
      const construction = this[key];
      if (construction && !construction.ready) {
        const d = BUILDING_DEFS[construction.defId];
        construction.progress = Math.min(1, construction.progress + dt * this.power[owner].ratio / d.buildTime);
        if (construction.progress >= 1) {
          construction.ready = true;
          this._event('constructionReady', { owner, defId: construction.defId });
        }
      }
    }
    this._updateBuildings(dt);
    this._updateResearch(dt);
    const movementPositions = new Map(this.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
    for (const u of this.units) this._updateUnit(u, dt);
    for (const u of this.units) if (u.embarkedIn) {
      const carrier = this.getEntity(u.embarkedIn);
      if (carrier?.hp > 0) { u.x = carrier.x; u.y = carrier.y; }
    }
    this._resolveUnitSeparation();
    this._updateMovementJams(movementPositions, dt);
    this._updateSalvageDrop(dt);
    this._updateRelays(dt);
    this._updateEffects(dt);
    this._updateSuperweapon(dt);
    this.units = this.units.filter(u => u.hp > 0);
    this.buildings = this.buildings.filter(b => b.hp > 0);
    this.selection = this.selection.filter(id => !!this.getEntity(id));
    this._resourceTimer += dt;
    if (this._resourceTimer >= 3) { this._resourceTimer -= 3; this._regrowCrystals(); }
    this._fogTimer += dt;
    if (this._fogTimer >= 0.28) { this._fogTimer = 0; this._updateFog(); }
    this._aiTimer += dt;
    if (this.mode !== 'multiplayer') {
      if (this._aiTimer >= 2) { this._aiTimer -= 2; this._aiTick(); }
      this._aiWaveTimer -= dt;
      if (this._aiWaveTimer <= 0) {
        this._launchAiWave();
        this._aiWaveTimer = (this.difficulty === 'hard' ? 39 : this.difficulty === 'easy' ? 76 : 55) + this._rand() * 12;
      }
    }
    const elimination = ['skirmish', 'multiplayer'].includes(this.mode) && this.victoryMode === 'elimination';
    const alive = owner => this.buildings.some(b => b.owner === owner && b.hp > 0 &&
      (elimination ? ELIMINATION_ACTIVE_BUILDINGS.has(b.defId) ||
        !!(BUILDING_DEFS[b.defId]?.weapon && b.powered) : BUILDING_DEFS[b.defId]?.victoryCritical !== false)) ||
      this.units.some(u => u.owner === owner && u.hp > 0 &&
        (!elimination || UNIT_DEFS[u.defId]?.weapon || ['mcv', 'engineer'].includes(u.defId)));
    const playerAlive = alive('player');
    const enemyAlive = alive('enemy');
    if (!enemyAlive || !playerAlive) {
      // A solo Elimination sortie requires a surviving command force; a
      // simultaneous wipe cannot be ranked as a player victory.
      this.winner = elimination && !playerAlive ? 'enemy' : enemyAlive ? 'enemy' : 'player';
      this.status = this.winner === 'player' ? 'victory' : 'defeat';
      this._event(this.status, { winner: this.winner, time: this.time });
    } else this._updateRelayDominion(dt);
  }

  update(dt) {
    if (this.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return;
    let left = Math.min(dt, 10);
    while (left > 0.000001 && this.status === 'playing') {
      const step = Math.min(0.1, left);
      this._tick(step);
      left -= step;
    }
  }

  serialize() {
    const { unitDefs, buildingDefs, onEvent, ...data } = this;
    return JSON.stringify(data);
  }

  static deserialize(serialized) {
    const data = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (!data || !Array.isArray(data.terrain) || !Array.isArray(data.units) || !Array.isArray(data.buildings))
      throw new Error('Invalid Crystalline Front save data.');
    const game = Object.create(Game.prototype);
    Object.assign(game, data);
    // Manual and crash-recovery saves can predate an authored mission rewrite.
    // Retain their playable objective instead of loading midway into a stage
    // that did not exist when the battle was saved.
    if (game.mode === 'campaign' && game.replayVersion == null) {
      const state = game.campaignState || {};
      if (game.campaignMission === 3 && !state.phase) game.replayVersion = 34;
      else if (game.campaignMission === 6 && !state.phase) game.replayVersion = 32;
      else if (game.campaignMission === 9 && !state.chiefEscapePhase) game.replayVersion = 33;
    }
    // Saves created before faction field actions keep their original combat
    // and AI rules for the rest of that battle. New saves carry this marker.
    if (game.replayVersion == null && data.relayResponseRulesVersion !== RELAY_RESPONSE_RULES_VERSION) {
      game.replayVersion = data.unitAbilityRulesVersion === UNIT_ABILITY_RULES_VERSION
        ? RELAY_RESPONSE_RULES_VERSION - 1 : UNIT_ABILITY_RULES_VERSION - 1;
    }
    // Unversioned saves written before the public cache retain the prior
    // skirmish rules for the rest of that battle. Preserve older versions
    // inferred by the relay/ability migrations above.
    if (game.replayVersion == null && data.salvageDropRulesVersion !== SALVAGE_DROP_RULES_VERSION)
      game.replayVersion = SALVAGE_DROP_RULES_VERSION - 1;
    // Unversioned saves without the current relay counterattack marker retain
    // their pre-v39 orders for the rest of the battle.
    if (game.replayVersion == null &&
        data.relayDominionCounterattackRulesVersion !== RELAY_DOMINION_COUNTERATTACK_RULES_VERSION)
      game.replayVersion = RELAY_DOMINION_COUNTERATTACK_RULES_VERSION - 1;
    if (game.replayVersion == null &&
        data.relayDominionReconRulesVersion !== RELAY_DOMINION_RECON_RULES_VERSION)
      game.replayVersion = RELAY_DOMINION_RECON_RULES_VERSION - 1;
    if (game.replayVersion == null && data.economyRecoveryRulesVersion !== ECONOMY_RECOVERY_RULES_VERSION)
      game.replayVersion = ECONOMY_RECOVERY_RULES_VERSION - 1;
    if (game.replayVersion == null &&
        data.relayResponsePersistenceRulesVersion !== RELAY_RESPONSE_PERSISTENCE_RULES_VERSION)
      game.replayVersion = RELAY_RESPONSE_PERSISTENCE_RULES_VERSION - 1;
    if (game.replayVersion == null &&
        data.doctrineReplacementRulesVersion !== DOCTRINE_REPLACEMENT_RULES_VERSION)
      game.replayVersion = DOCTRINE_REPLACEMENT_RULES_VERSION - 1;
    if (game.replayVersion == null &&
        data.relayDominionTargetCommitmentRulesVersion !== RELAY_DOMINION_TARGET_COMMITMENT_RULES_VERSION)
      game.replayVersion = RELAY_DOMINION_TARGET_COMMITMENT_RULES_VERSION - 1;
    if (game.replayVersion == null &&
        data.relayDominionExpansionPauseRulesVersion !== RELAY_DOMINION_EXPANSION_PAUSE_RULES_VERSION)
      game.replayVersion = RELAY_DOMINION_EXPANSION_PAUSE_RULES_VERSION - 1;
    // Saves without the commander-profile marker predate v47 policy selection.
    // Pin them to v46 so their AI keeps the recorded commander behavior.
    if (game.mode === 'skirmish' && game.replayVersion == null &&
        data.aiCommanderProfileRulesVersion !== AI_COMMANDER_PROFILE_RULES_VERSION)
      game.replayVersion = AI_COMMANDER_PROFILE_RULES_VERSION - 1;
    // Version 47 saves had commander profiles but no economy reconnaissance.
    // Keep those battles on their recorded scouting policy after a load.
    if (game.replayVersion == null &&
        data.aiEconomyReconRulesVersion !== AI_ECONOMY_RECON_RULES_VERSION)
      game.replayVersion = AI_ECONOMY_RECON_RULES_VERSION - 1;
    if (game.replayVersion == null && data.relayLogisticsRulesVersion !== RELAY_LOGISTICS_RULES_VERSION)
      game.replayVersion = RELAY_LOGISTICS_RULES_VERSION - 1;
    if (game.replayVersion == null && data.stormglassBloomRulesVersion !== STORMGLASS_BLOOM_RULES_VERSION)
      game.replayVersion = STORMGLASS_BLOOM_RULES_VERSION - 1;
    if (game.replayVersion == null && data.bloomExpeditionRulesVersion !== BLOOM_EXPEDITION_RULES_VERSION)
      game.replayVersion = BLOOM_EXPEDITION_RULES_VERSION - 1;
    // Saves without the Siege Director marker predate the v53 profile and keep
    // the original two-profile seed mapping.
    if (game.mode === 'skirmish' && game.replayVersion == null &&
        data.siegeDirectorRulesVersion !== SIEGE_DIRECTOR_RULES_VERSION)
      game.replayVersion = SIEGE_DIRECTOR_RULES_VERSION - 1;
    // Version 53 saves retain Siege Director while keeping its original relay
    // assignments for expansion rigs.
    if (game.mode === 'skirmish' && game.replayVersion == null &&
        data.siegeExpansionRulesVersion !== SIEGE_EXPANSION_RULES_VERSION)
      game.replayVersion = SIEGE_EXPANSION_RULES_VERSION - 1;
    if (game.mode === 'skirmish' && game.replayVersion == null &&
        data.aiHarvesterRetreatRulesVersion !== AI_HARVESTER_RETREAT_RULES_VERSION)
      game.replayVersion = AI_HARVESTER_RETREAT_RULES_VERSION - 1;
    game.unitAbilityRulesVersion = UNIT_ABILITY_RULES_VERSION;
    game.aiCommanderProfileRulesVersion = AI_COMMANDER_PROFILE_RULES_VERSION;
    game.siegeDirectorRulesVersion = SIEGE_DIRECTOR_RULES_VERSION;
    game.siegeExpansionRulesVersion = SIEGE_EXPANSION_RULES_VERSION;
    game.aiHarvesterRetreatRulesVersion = AI_HARVESTER_RETREAT_RULES_VERSION;
    game.aiEconomyReconRulesVersion = AI_ECONOMY_RECON_RULES_VERSION;
    game.relayLogisticsRulesVersion = RELAY_LOGISTICS_RULES_VERSION;
    game.stormglassBloomRulesVersion = STORMGLASS_BLOOM_RULES_VERSION;
    game.bloomExpeditionRulesVersion = BLOOM_EXPEDITION_RULES_VERSION;
    game.relayResponseRulesVersion = RELAY_RESPONSE_RULES_VERSION;
    game.salvageDropRulesVersion = SALVAGE_DROP_RULES_VERSION;
    game.relayDominionCounterattackRulesVersion = RELAY_DOMINION_COUNTERATTACK_RULES_VERSION;
    game.relayDominionReconRulesVersion = RELAY_DOMINION_RECON_RULES_VERSION;
    game.economyRecoveryRulesVersion = ECONOMY_RECOVERY_RULES_VERSION;
    game.relayResponsePersistenceRulesVersion = RELAY_RESPONSE_PERSISTENCE_RULES_VERSION;
    game.doctrineReplacementRulesVersion = DOCTRINE_REPLACEMENT_RULES_VERSION;
    game.relayDominionTargetCommitmentRulesVersion = RELAY_DOMINION_TARGET_COMMITMENT_RULES_VERSION;
    game.relayDominionExpansionPauseRulesVersion = RELAY_DOMINION_EXPANSION_PAUSE_RULES_VERSION;
    const savedProfile = AI_COMMANDER_PROFILES.find(profile => profile.id === data.aiCommanderProfileId);
    const fallbackProfile = aiCommanderProfileForSeed(game.seed,
      game.replayVersion ?? SIEGE_DIRECTOR_RULES_VERSION);
    const commanderProfile = savedProfile || fallbackProfile;
    game.aiCommanderProfileId = game.mode === 'skirmish' ? commanderProfile.id : null;
    game.aiCommanderProfileName = game.mode === 'skirmish' ? commanderProfile.name : null;
    game.salvageDrop = game.salvageDrop && ['incoming', 'active', 'claimed', 'expired'].includes(game.salvageDrop.phase) &&
      Number.isFinite(game.salvageDrop.x) && Number.isFinite(game.salvageDrop.y) ? {
        phase: game.salvageDrop.phase, x: game.salvageDrop.x, y: game.salvageDrop.y,
        warningAt: Number.isFinite(game.salvageDrop.warningAt) ? game.salvageDrop.warningAt : SALVAGE_DROP_WARNING_AT,
        landsAt: Number.isFinite(game.salvageDrop.landsAt) ? game.salvageDrop.landsAt : SALVAGE_DROP_WARNING_AT + SALVAGE_DROP_FLIGHT_SECONDS,
        expiresAt: Number.isFinite(game.salvageDrop.expiresAt) ? game.salvageDrop.expiresAt : SALVAGE_DROP_WARNING_AT + SALVAGE_DROP_FLIGHT_SECONDS + SALVAGE_DROP_LIFETIME_SECONDS,
        captureOwner: ['player', 'enemy'].includes(game.salvageDrop.captureOwner) ? game.salvageDrop.captureOwner : null,
        captureProgress: Number.isFinite(game.salvageDrop.captureProgress) ? clamp(game.salvageDrop.captureProgress, 0, SALVAGE_DROP_CAPTURE_SECONDS) : 0,
        claimedBy: ['player', 'enemy'].includes(game.salvageDrop.claimedBy) ? game.salvageDrop.claimedBy : null,
        contested: !['claimed', 'expired'].includes(game.salvageDrop.phase) && game.salvageDrop.contested === true,
      } : null;
    game.storm = game.storm && typeof game.storm === 'object' ? game.storm : {};
    game.storm.bloom = game._stormglassBloomEnabled() && game.storm.bloom &&
      Number.isFinite(game.storm.bloom.x) && Number.isFinite(game.storm.bloom.y) &&
      game.storm.bloom.x >= 0 && game.storm.bloom.x < game.width &&
      game.storm.bloom.y >= 0 && game.storm.bloom.y < game.height &&
      Number.isFinite(game.storm.bloom.until) && game.storm.bloom.until > (game.time || 0) ? {
        x: game.storm.bloom.x, y: game.storm.bloom.y,
        radius: Number.isFinite(game.storm.bloom.radius)
          ? clamp(game.storm.bloom.radius, 1, 6) : STORMGLASS_BLOOM_RADIUS,
        until: game.storm.bloom.until,
      } : null;
    game.wrecks = Array.isArray(game.wrecks) ? game.wrecks.filter(wreck => wreck &&
      typeof wreck.id === 'string' && Number.isFinite(wreck.x) && Number.isFinite(wreck.y) &&
      Number.isFinite(wreck.value) && ['aegis', 'vesper'].includes(wreck.faction) &&
      Number.isFinite(wreck.expiresAt) && wreck.expiresAt > (game.time || 0)).slice(-MAX_BATTLEFIELD_WRECKS) : [];
    game._nextWreckId = Number.isSafeInteger(game._nextWreckId) && game._nextWreckId > 0
      ? game._nextWreckId : game.wrecks.reduce((next, wreck) => Math.max(next,
        Number(wreck.id.match(/^wreck([1-9][0-9]*)$/)?.[1] || 0) + 1), 1);
    game.skirmishOpening = game.mode === 'skirmish' && data.skirmishOpening === 'command-rig' ? 'command-rig' : 'established';
    game.victoryMode = ['skirmish', 'multiplayer'].includes(game.mode) && data.victoryMode === 'elimination'
      ? 'elimination' : 'dominion';
    const eligibleLastSeen = game.mode === 'skirmish' && game.victoryMode === 'elimination' &&
      Array.isArray(data.lastSeenHostileUnits) ? data.lastSeenHostileUnits : [];
    const seenIds = new Set();
    game.lastSeenHostileUnits = eligibleLastSeen.filter(contact => {
      if (!contact || typeof contact.entityId !== 'string' || contact.entityId.length > 64 ||
          seenIds.has(contact.entityId) ||
          !Number.isFinite(contact.x) || !Number.isFinite(contact.y) ||
          contact.x < 0 || contact.y < 0 || contact.x >= game.width || contact.y >= game.height ||
          !Number.isFinite(contact.lastSeenAt) || contact.lastSeenAt < 0 || contact.lastSeenAt > game.time ||
          !(UNIT_DEFS[contact.defId]?.weapon || ['mcv', 'engineer'].includes(contact.defId))) return false;
      seenIds.add(contact.entityId);
      return true;
    }).slice(-MAX_LAST_SEEN_HOSTILE_UNITS).map(contact => ({
      entityId: contact.entityId, defId: contact.defId, x: contact.x, y: contact.y, lastSeenAt: contact.lastSeenAt,
    }));
    game.campaignDoctrineId = game.mode === 'campaign' && CAMPAIGN_DOCTRINE_IDS.has(game.campaignDoctrineId)
      ? game.campaignDoctrineId : 'standard';
    game.campaignCarryoverId = game.mode === 'campaign' && ['none', 'assault', 'signal'].includes(game.campaignCarryoverId)
      ? game.campaignCarryoverId : 'none';
    game.campaignSupplyId = game.mode === 'campaign' && CAMPAIGN_SUPPLY_IDS.has(game.campaignSupplyId)
      ? game.campaignSupplyId : 'none';
    game.campaignRoutePayoffId = game.mode === 'campaign' &&
      ['none', 'ghost-channel', 'iron-current'].includes(game.campaignRoutePayoffId)
      ? game.campaignRoutePayoffId : 'none';
    game.unitDefs = UNIT_DEFS;
    game.buildingDefs = BUILDING_DEFS;
    game.onEvent = null;
    game.events = Array.isArray(game.events) ? game.events : [];
    const salvageEarned = game.salvageEarned && typeof game.salvageEarned === 'object' ? game.salvageEarned : {};
    game.salvageEarned = {
      player: Number.isFinite(salvageEarned.player) ? Math.max(0, salvageEarned.player) : 0,
      enemy: Number.isFinite(salvageEarned.enemy) ? Math.max(0, salvageEarned.enemy) : 0,
    };
    for (const unit of game.units) {
      unit.stance = ['aggressive', 'defensive', 'holdFire'].includes(unit.stance) ? unit.stance : 'aggressive';
      const oldRank = Number.isFinite(unit.veterancy) ? Math.trunc(unit.veterancy) : 0;
      unit.veterancy = clamp(oldRank, 0, VETERANCY_RANKS.length - 1);
      unit.promotion = isUnitPromotionEligible(unit) && Object.hasOwn(UNIT_PROMOTION_DEFS, unit.promotion)
        ? unit.promotion : null;
      if (!Number.isFinite(unit.xp)) {
        // Older saves used three-kill ranks and larger cumulative health bonuses.
        const damageTaken = Math.max(0, (unit.maxHp || UNIT_DEFS[unit.defId]?.health || 1) - unit.hp);
        const baseHealth = UNIT_DEFS[unit.defId]?.health;
        if (baseHealth) {
          unit.maxHp = baseHealth * VETERANCY_RANKS[unit.veterancy].healthMultiplier *
            game._campaignUnitMultiplier(unit.owner, 'reinforced', 1.12);
          unit.hp = unit.hp > 0 ? clamp(unit.maxHp - damageTaken, 1, unit.maxHp) : 0;
        }
        unit.xp = VETERANCY_RANKS[unit.veterancy].xp;
      }
      unit.kills ??= 0;
      unit.suppressedUntil ??= 0;
      unit.abilityCooldown = Number.isFinite(unit.abilityCooldown) ? clamp(unit.abilityCooldown, 0, FACTION_TANK_ABILITY_COOLDOWN) : 0;
      unit.braceUntil = Number.isFinite(unit.braceUntil) && unit.braceUntil > game.time ?
        Math.min(unit.braceUntil, game.time + GUARDIAN_BRACE_SECONDS) : 0;
      unit.ghostRunUntil = Number.isFinite(unit.ghostRunUntil) && unit.ghostRunUntil > game.time ?
        Math.min(unit.ghostRunUntil, game.time + SPECTER_GHOST_RUN_SECONDS) : 0;
      unit.embarkedIn ??= null;
      unit.passengerIds = Array.isArray(unit.passengerIds) ? unit.passengerIds : [];
      if (unit.order && Object.hasOwn(unit.order, 'queue')) {
        const raw = game.replayVersion != null && game.replayVersion < QUEUED_ORDERS_RULES_VERSION
          ? [] : Array.isArray(unit.order.queue) ? unit.order.queue.slice(0, MAX_QUEUED_ORDERS) : [];
        const queue = raw.flatMap(order => {
          if (!order || typeof order !== 'object') return [];
          if (order.type === 'attack' && typeof order.targetId === 'string' && order.targetId.length <= 64)
            return [{ type: 'attack', targetId: order.targetId }];
          if (['move', 'forceMove'].includes(order.type) && game._validatePoint(order.x, order.y))
            return [{ type: order.type, x: order.x, y: order.y,
              ...(order.type === 'move' ? { attackMove: order.attackMove === true } : {}) }];
          return [];
        });
        if (queue.length) unit.order.queue = queue;
        else delete unit.order.queue;
      }
      unit._unloadRefineryId ??= null;
      unit._unloadApproach = unit._unloadApproach && Number.isFinite(unit._unloadApproach.x) &&
        Number.isFinite(unit._unloadApproach.y) ? { x: unit._unloadApproach.x, y: unit._unloadApproach.y } : null;
      unit._unloadRemaining = Number.isFinite(unit._unloadRemaining) ? Math.max(0, unit._unloadRemaining) : 0;
      unit._unloadProgress = Number.isFinite(unit._unloadProgress) ? clamp(unit._unloadProgress, 0, 1) : 0;
      unit._stormglassCargo = game._stormglassBloomEnabled() && unit.defId === 'harvester' &&
        Number.isFinite(unit._stormglassCargo) ? clamp(unit._stormglassCargo, 0, Math.max(0, unit.cargo || 0)) : 0;
    }
    for (const building of game.buildings) if (building.defId === 'refinery') building._unloadHarvesterId ??= null;
    game.mapId = SKIRMISH_MAPS.some(map => map.id === game.mapId) ? game.mapId : 'shard-valley';
    game.mapVariant = ['twin-passes', 'canyon-ring'].includes(game.mapId) &&
      (game.mapVariant === 0 || game.mapVariant === 1) ? game.mapVariant : 0;
    if (!Array.isArray(game.bridges)) {
      game.bridges = [];
      if (['skirmish', 'multiplayer'].includes(game.mode) && game.mapId === 'delta-crossing') game._placeDeltaBridges();
    }
    game.winner ??= null;
    game.commandEnergy = { player: 30, enemy: 30, ...game.commandEnergy };
    const savedResearch = data.research && typeof data.research === 'object' ? data.research : {};
    game.research = Object.fromEntries(['player', 'enemy'].map(owner => {
      const saved = savedResearch[owner] && typeof savedResearch[owner] === 'object' ? savedResearch[owner] : {};
      const doctrine = DOCTRINE_DEFS[saved.doctrine] ? saved.doctrine : null;
      const rawProject = saved.project && DOCTRINE_DEFS[saved.project.id] ? saved.project : null;
      const tactical = TACTICAL_PACKAGE_DEFS[saved.tactical] ? saved.tactical : null;
      const rawTacticalProject = doctrine && saved.tacticalProject && TACTICAL_PACKAGE_DEFS[saved.tacticalProject.id]
        ? saved.tacticalProject : null;
      return [owner, { doctrine, project: !rawProject ? null : {
        id: rawProject.id, progress: Number.isFinite(rawProject.progress) ? clamp(rawProject.progress, 0, 1) : 0,
      }, tactical, tacticalProject: tactical || !rawTacticalProject ? null : {
        id: rawTacticalProject.id,
        progress: Number.isFinite(rawTacticalProject.progress) ? clamp(rawTacticalProject.progress, 0, 1) : 0,
      }, replacementUsed: saved.replacementUsed === true }];
    }));
    game.commandCooldowns = {
      player: { scan: 0, overcharge: 0, shield: 0, stormcall: 0, breach: 0, interdict: 0, rally: 0, ...game.commandCooldowns?.player },
      enemy: { scan: 0, overcharge: 0, shield: 0, stormcall: 0, breach: 0, interdict: 0, rally: 0, ...game.commandCooldowns?.enemy },
    };
    game.breachZones = Array.isArray(game.breachZones) ? game.breachZones.filter(zone => zone &&
      ['player', 'enemy'].includes(zone.owner) && Number.isFinite(zone.x) && Number.isFinite(zone.y) &&
      Number.isFinite(zone.until) && zone.until > (game.time || 0)).map(zone => ({
        owner: zone.owner, x: zone.x, y: zone.y, radius: Number.isFinite(zone.radius) ? clamp(zone.radius, 0.5, 8) : 5,
        until: zone.until,
      })) : [];
    game.scans = Array.isArray(game.scans) ? game.scans : [];
    game._aiIntel = Array.isArray(game._aiIntel) ? game._aiIntel : [];
    game._aiScoutStep ??= 0;
    game._aiRelayTarget ??= null;
    game._aiRelayCommittedTargetId = typeof game._aiRelayCommittedTargetId === 'string'
      ? game._aiRelayCommittedTargetId : null;
    game._aiRelayCommittedTargetLastSeenAt = Number.isFinite(game._aiRelayCommittedTargetLastSeenAt)
      ? game._aiRelayCommittedTargetLastSeenAt : null;
    game._aiRelayReconTarget = typeof game._aiRelayReconTarget === 'string'
      ? game._aiRelayReconTarget : null;
    for (const unit of game.units) if (unit._aiSalvageDropOrder != null)
      unit._aiSalvageDropOrder = unit._aiSalvageDropOrder && typeof unit._aiSalvageDropOrder === 'object'
        ? unit._aiSalvageDropOrder : null;
    for (const unit of game.units) if (unit._aiRelayResponseRelayId != null ||
      unit._aiRelayResponseOrder != null || unit._aiRelayResponsePriorAssignment != null ||
      unit._aiRelayUrgentRelayId != null || unit._aiRelayReconRelayId != null ||
      unit._aiRelayUrgentLastSeenAt != null) {
      unit._aiRelayResponseOrder = unit._aiRelayResponseOrder && typeof unit._aiRelayResponseOrder === 'object'
        ? unit._aiRelayResponseOrder : null;
      unit._aiRelayResponseRelayId = typeof unit._aiRelayResponseRelayId === 'string'
        ? unit._aiRelayResponseRelayId : null;
      unit._aiRelayResponsePriorAssignment = typeof unit._aiRelayResponsePriorAssignment === 'string'
        ? unit._aiRelayResponsePriorAssignment : null;
      unit._aiRelayUrgentRelayId = typeof unit._aiRelayUrgentRelayId === 'string'
        ? unit._aiRelayUrgentRelayId : null;
      unit._aiRelayReconRelayId = typeof unit._aiRelayReconRelayId === 'string'
        ? unit._aiRelayReconRelayId : null;
      unit._aiRelayUrgentLastSeenAt = Number.isFinite(unit._aiRelayUrgentLastSeenAt)
        ? unit._aiRelayUrgentLastSeenAt : null;
    }
    game.storm = { x: 30, y: 24, radius: 5.5, phase: 'calm', phaseTime: 0, cycle: 0,
      waypoint: 0, growthTimer: 0, damageTimer: 0, ...game.storm };
    if (game.storm.lure && (game.storm.lure.owner !== 'player' && game.storm.lure.owner !== 'enemy' ||
      !game._validatePoint(game.storm.lure.x, game.storm.lure.y) ||
      !Number.isFinite(game.storm.lure.until))) delete game.storm.lure;
    if (!Array.isArray(game.relays)) game._placeRelays();
    for (const relay of game.relays) {
      relay.protocol = relay.owner && (relay.protocol === 'overdrive' ||
        game._relayLogisticsEnabled() && relay.protocol === 'logistics') ? relay.protocol : 'shelter';
      relay.protocolCooldown = relay.owner && Number.isFinite(relay.protocolCooldown)
        ? Math.max(0, relay.protocolCooldown) : 0;
    }
    const dominion = game.relayDominion;
    const owner = ((['skirmish', 'multiplayer'].includes(game.mode) && game.victoryMode !== 'elimination')) &&
      (dominion?.owner === 'player' || dominion?.owner === 'enemy') ? dominion.owner : null;
    const required = relayDominionDuration(game.mode, game.difficulty);
    game.relayDominion = { owner,
      elapsed: owner && Number.isFinite(dominion?.elapsed)
        ? clamp(dominion.elapsed, 0, required) : 0,
      required, majority: RELAY_DOMINION_MAJORITY };
    if (['skirmish', 'multiplayer'].includes(game.mode)) game.mission = { ...game.mission,
      title: `${game.mode === 'multiplayer' ? 'Multiplayer' : 'Skirmish'} at ${SKIRMISH_MAPS.find(map => map.id === game.mapId).name}`,
      briefing: SKIRMISH_MAPS.find(map => map.id === game.mapId).description,
      objective: skirmishObjective(game.victoryMode, required) };
    return game;
  }
}
