import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, AEGIS_RELAY_RECOVERY_RATE, RELAY_OVERDRIVE_RELOAD_MULTIPLIER,
  RELAY_LOGISTICS_RULES_VERSION, RELAY_LOGISTICS_YIELD_RATE, UNIT_DEFS, BUILDING_DEFS } from '../src/game/engine.js';

function heldRelay(game, protocol = 'shelter') {
  const relay = game.relays[0];
  relay.owner = 'player';
  relay.progress = 1;
  relay.protocol = protocol;
  relay.protocolCooldown = 0;
  relay.contested = false;
  return relay;
}

test('overdrive adds command energy while shelter protects units from an ion surge', () => {
  const game = new Game({ seed: 150, mode: 'multiplayer' });
  const relay = heldRelay(game);
  game.commandEnergy.player = 0;
  game._updateRelays(1);
  assert.ok(Math.abs(game.commandEnergy.player - 0.68) < 1e-9);
  assert.deepEqual(game.setRelayProtocol(relay.id, 'overdrive'), { ok: true });
  game.commandEnergy.player = 0;
  game._updateRelays(1);
  assert.ok(Math.abs(game.commandEnergy.player - 1.13) < 1e-9);
  game.research.player.doctrine = 'signal';
  game.commandEnergy.player = 0;
  game._updateRelays(1);
  assert.ok(Math.abs(game.commandEnergy.player - 1.3) < 1e-9,
    'Signal Lattice boosts baseline recharge while Overdrive remains exactly +0.45 per second');

  const shelterGame = new Game({ seed: 151, mode: 'multiplayer' });
  const sheltered = heldRelay(shelterGame);
  const unit = shelterGame._createUnit('player', 'rifle', sheltered.x, sheltered.y);
  shelterGame.storm = { x: sheltered.x, y: sheltered.y, radius: 4, phase: 'surge', phaseTime: 0,
    cycle: 0, waypoint: 0, growthTimer: 0, damageTimer: 0.5 };
  shelterGame._updateStorm(0);
  assert.equal(unit.hp, unit.maxHp);
  sheltered.protocol = 'overdrive';
  shelterGame.storm.damageTimer = 0.5;
  shelterGame._updateStorm(0);
  assert.ok(unit.hp < unit.maxHp);
});

test('Aegis shelter relays recover nearby infantry, with save and legacy replay behavior preserved', () => {
  const game = new Game({ faction: 'aegis', seed: 159, mode: 'multiplayer' });
  const relay = heldRelay(game);
  const infantry = game._createUnit('player', 'rifle', relay.x + 1, relay.y);
  const vehicle = game._createUnit('player', 'lightTank', relay.x, relay.y + 1);
  const nearbyVesper = game._createUnit('enemy', 'rifle', relay.x - 4, relay.y);
  infantry.hp -= 20;
  vehicle.hp -= 20;
  nearbyVesper.hp -= 20;
  game._updateRelays(2);
  assert.equal(infantry.hp, infantry.maxHp - 20 + 2 * AEGIS_RELAY_RECOVERY_RATE);
  assert.equal(vehicle.hp, vehicle.maxHp - 20, 'recovery is limited to infantry');
  assert.equal(nearbyVesper.hp, nearbyVesper.maxHp - 20, 'the relay never heals enemy units');

  const saved = Game.deserialize(game.serialize());
  const savedInfantry = saved.getEntity(infantry.id);
  savedInfantry.hp -= 5;
  saved._updateRelays(1);
  assert.equal(savedInfantry.hp, infantry.hp - 5 + AEGIS_RELAY_RECOVERY_RATE,
    'recovery after loading uses the same deterministic rate');
  savedInfantry.hp = savedInfantry.maxHp - 0.5;
  saved._updateRelays(1);
  assert.equal(savedInfantry.hp, savedInfantry.maxHp, 'recovery clamps to maximum health');

  const legacy = Game.deserialize(game.serialize());
  legacy.replayVersion = 17;
  const legacyInfantry = legacy.getEntity(infantry.id);
  legacyInfantry.hp -= 10;
  legacy._updateRelays(2);
  assert.equal(legacyInfantry.hp, infantry.hp - 10, 'version 17 playback keeps historical relay rules');
});

test('Aegis recovery stops while the relay is contested or set to overdrive', () => {
  const game = new Game({ faction: 'aegis', seed: 160, mode: 'multiplayer' });
  const relay = heldRelay(game);
  const unit = game._createUnit('player', 'rifle', relay.x, relay.y);
  const enemy = game._createUnit('enemy', 'rifle', relay.x + 0.5, relay.y);
  unit.hp -= 10;
  relay.contested = true;
  game._updateRelays(1);
  assert.equal(unit.hp, unit.maxHp - 10);
  enemy.hp = 0;
  relay.contested = false;
  relay.protocol = 'overdrive';
  game._updateRelays(1);
  assert.equal(unit.hp, unit.maxHp - 10);
});

test('protocol commands validate ownership, contest, mode, and cooldown and emit an event', () => {
  const game = new Game({ seed: 152, mode: 'multiplayer' });
  const relay = heldRelay(game);
  assert.equal(game.setRelayProtocol('missing', 'overdrive').ok, false);
  relay.owner = 'enemy';
  assert.equal(game.setRelayProtocol(relay.id, 'overdrive').ok, false);
  relay.owner = 'player';
  relay.contested = true;
  assert.equal(game.setRelayProtocol(relay.id, 'overdrive').ok, false);
  relay.contested = false;
  assert.equal(game.setRelayProtocol(relay.id, 'turbo').ok, false);
  assert.equal(game.setRelayProtocol(relay.id, 'shelter').ok, false);
  assert.deepEqual(game.setRelayProtocol(relay.id, 'overdrive'), { ok: true });
  assert.equal(game.events.at(-1).type, 'relayProtocol');
  assert.deepEqual(['id', 'owner', 'protocol', 'x', 'y', 'message'].every(key => key in game.events.at(-1)), true);
  assert.equal(game.setRelayProtocol(relay.id, 'shelter').ok, false, 'the 12 second cooldown blocks another switch');
  game._updateRelays(12);
  assert.deepEqual(game.setRelayProtocol(relay.id, 'shelter'), { ok: true });
});

test('campaign commanders can switch a captured relay without enabling skirmish AI', () => {
  const game = new Game({ seed: 158, mode: 'campaign' });
  const relay = heldRelay(game);
  assert.deepEqual(game.setRelayProtocol(relay.id, 'overdrive'), { ok: true });
  assert.equal(relay.protocol, 'overdrive');
  const enemyRelay = game.relays[1];
  enemyRelay.owner = 'enemy'; enemyRelay.progress = -1;
  game.commandEnergy.enemy = 20;
  game._aiRelayProtocols();
  assert.equal(enemyRelay.protocol, 'shelter');
});

test('protocol and cooldown survive saves; legacy relay fields normalize to shelter', () => {
  const game = new Game({ seed: 153, mode: 'multiplayer' });
  const relay = heldRelay(game);
  game.setRelayProtocol(relay.id, 'overdrive');
  game._updateRelays(3);
  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.relays[0].protocol, 'overdrive');
  assert.equal(restored.relays[0].protocolCooldown, 9);
  const legacy = JSON.parse(game.serialize());
  delete legacy.relays[0].protocol;
  delete legacy.relays[0].protocolCooldown;
  const normalized = Game.deserialize(legacy);
  assert.equal(normalized.relays[0].protocol, 'shelter');
  assert.equal(normalized.relays[0].protocolCooldown, 0);
});

test('capture resets protocol and legacy replay version keeps historical relay rules', () => {
  const game = new Game({ seed: 154, mode: 'multiplayer' });
  const relay = heldRelay(game, 'overdrive');
  relay.owner = 'enemy';
  relay.protocolCooldown = 8;
  relay.progress = -1;
  const enemy = game._createUnit('player', 'rifle', relay.x, relay.y);
  enemy.x = relay.x; enemy.y = relay.y;
  for (let i = 0; i < 70 && relay.owner !== 'player'; i++) game._updateRelays(1);
  assert.equal(relay.owner, 'player');
  assert.equal(relay.protocol, 'shelter');
  assert.equal(relay.protocolCooldown, 0);

  game.units = [];
  relay.owner = 'player'; relay.progress = 0.01; relay.protocol = 'overdrive'; relay.protocolCooldown = 7;
  game._createUnit('enemy', 'rifle', relay.x, relay.y);
  game._updateRelays(1);
  assert.equal(relay.owner, null, 'losing control neutralizes the relay');
  assert.equal(relay.protocol, 'shelter');
  assert.equal(relay.protocolCooldown, 0);

  const oldPlayback = new Game({ seed: 155, mode: 'skirmish' });
  oldPlayback.replayVersion = 6;
  const oldRelay = heldRelay(oldPlayback, 'overdrive');
  oldPlayback.commandEnergy.player = 0;
  oldPlayback._updateRelays(1);
  assert.ok(Math.abs(oldPlayback.commandEnergy.player - 0.68) < 1e-9);
  const unit = oldPlayback._createUnit('player', 'rifle', oldRelay.x, oldRelay.y);
  oldPlayback.storm = { x: oldRelay.x, y: oldRelay.y, radius: 4, phase: 'surge', phaseTime: 0,
    cycle: 0, waypoint: 0, growthTimer: 0, damageTimer: 0.5 };
  oldPlayback._updateStorm(0);
  assert.equal(unit.hp, unit.maxHp, 'v6 treats captured relays as shelters regardless of stored protocol');
  assert.equal(oldPlayback.setRelayProtocol(oldRelay.id, 'shelter').ok, false);
});

test('solo AI uses overdrive when safe, shelters a threatened garrison, and leaves v6 unchanged', () => {
  const game = new Game({ seed: 156, mode: 'skirmish' });
  const relay = game.relays[0];
  relay.owner = 'enemy'; relay.progress = -1; relay.contested = false;
  game.commandEnergy.enemy = 40;
  game.storm.phase = 'calm';
  game.commandOwner = 'player';
  game._aiRelayProtocols();
  assert.equal(relay.protocol, 'overdrive');
  assert.equal(game.commandOwner, 'player', 'AI restores the active command owner');

  game._updateRelays(12);
  const guard = game._createUnit('enemy', 'rifle', relay.x, relay.y);
  game.storm.phase = 'warning';
  game._aiRelayProtocols();
  assert.equal(relay.protocol, 'shelter');
  assert.equal(game.events.at(-1).type, 'relayProtocol');
  assert.equal(guard.owner, 'enemy');

  const legacy = new Game({ seed: 157, mode: 'skirmish' });
  const oldRelay = legacy.relays[0];
  oldRelay.owner = 'enemy'; oldRelay.progress = -1;
  legacy.commandEnergy.enemy = 40;
  legacy.replayVersion = 6;
  legacy._aiRelayProtocols();
  assert.equal(oldRelay.protocol, 'shelter');
});

test('Overdrive supports ground fire locally without stacking, and contesting removes the benefit', () => {
  const game = new Game({ seed: 161, mode: 'multiplayer' });
  const relay = heldRelay(game);
  const rifle = game._createUnit('player', 'rifle', relay.x, relay.y);
  const weapon = UNIT_DEFS.rifle.weapon;
  const fire = source => {
    game._fireAt(source, { x: source.x + 1, y: source.y }, weapon);
    return source.cooldown;
  };
  assert.equal(fire(rifle), weapon.cooldown, 'Shelter has no reload benefit');
  assert.deepEqual(game.setRelayProtocol(relay.id, 'overdrive'), { ok: true });
  assert.equal(fire(rifle), weapon.cooldown * RELAY_OVERDRIVE_RELOAD_MULTIPLIER);
  rifle.overchargedUntil = game.time + 10;
  assert.equal(fire(rifle), weapon.cooldown * 0.65 * RELAY_OVERDRIVE_RELOAD_MULTIPLIER,
    'command Overcharge and relay Overdrive multiply once each');

  const second = game.relays[1];
  second.owner = 'player'; second.progress = 1; second.protocol = 'overdrive';
  second.x = relay.x + 0.1; second.y = relay.y;
  assert.equal(fire(rifle), weapon.cooldown * 0.65 * RELAY_OVERDRIVE_RELOAD_MULTIPLIER,
    'overlapping relay fields do not stack');
  second.owner = null;
  const enemy = game._createUnit('enemy', 'rifle', relay.x + 1, relay.y);
  assert.equal(fire(rifle), weapon.cooldown * 0.65,
    'an enemy inside capture range disables the benefit before the next relay tick');
  enemy.hp = 0;
  rifle.x = relay.x + 2.31;
  assert.equal(fire(rifle), weapon.cooldown * 0.65, 'benefit ends outside capture range');
});

test('Overdrive reload affects either side but excludes aircraft and defenses and preserves old replays', () => {
  const game = new Game({ seed: 162, mode: 'multiplayer' });
  const relay = game.relays[0];
  relay.owner = 'enemy'; relay.progress = -1; relay.protocol = 'overdrive';
  const enemyRifle = game._createUnit('enemy', 'rifle', relay.x, relay.y);
  game._fireAt(enemyRifle, { x: relay.x + 1, y: relay.y }, UNIT_DEFS.rifle.weapon);
  assert.equal(enemyRifle.cooldown, UNIT_DEFS.rifle.weapon.cooldown * RELAY_OVERDRIVE_RELOAD_MULTIPLIER);

  const aircraft = game._createUnit('enemy', 'apache', relay.x, relay.y);
  game._fireAt(aircraft, { x: relay.x + 1, y: relay.y }, UNIT_DEFS.apache.weapon);
  assert.equal(aircraft.cooldown, UNIT_DEFS.apache.weapon.cooldown);
  const defense = game._createBuilding('enemy', 'turret', Math.floor(relay.x), Math.floor(relay.y), 1);
  game._fireAt(defense, { x: relay.x + 1, y: relay.y }, BUILDING_DEFS.turret.weapon);
  assert.equal(defense.cooldown, BUILDING_DEFS.turret.weapon.cooldown);

  const restored = Game.deserialize(game.serialize());
  const savedRifle = restored.getEntity(enemyRifle.id);
  restored._fireAt(savedRifle, { x: relay.x + 1, y: relay.y }, UNIT_DEFS.rifle.weapon);
  assert.equal(savedRifle.cooldown, UNIT_DEFS.rifle.weapon.cooldown * RELAY_OVERDRIVE_RELOAD_MULTIPLIER);
  restored.replayVersion = 25;
  restored._fireAt(savedRifle, { x: relay.x + 1, y: relay.y }, UNIT_DEFS.rifle.weapon);
  assert.equal(savedRifle.cooldown, UNIT_DEFS.rifle.weapon.cooldown,
    'archived version 25 playback retains its original fire rate');
  restored.replayVersion = 26;
  restored._fireAt(savedRifle, { x: relay.x + 1, y: relay.y }, UNIT_DEFS.rifle.weapon);
  assert.equal(savedRifle.cooldown, UNIT_DEFS.rifle.weapon.cooldown * RELAY_OVERDRIVE_RELOAD_MULTIPLIER);
});

test('solo AI uses a threatened ground garrison for Overdrive only outside a storm', () => {
  const game = new Game({ seed: 163, mode: 'skirmish' });
  const relay = game.relays[0];
  relay.owner = 'enemy'; relay.progress = -1; relay.protocol = 'shelter';
  game.commandEnergy.enemy = 100;
  game._createUnit('enemy', 'rifle', relay.x, relay.y);
  game._createUnit('player', 'rifle', relay.x + 4, relay.y);
  game.storm.phase = 'calm';
  game._aiRelayProtocols();
  assert.equal(relay.protocol, 'overdrive');
  game._updateRelays(12);
  game.storm.phase = 'warning';
  game._aiRelayProtocols();
  assert.equal(relay.protocol, 'shelter');

  const legacy = new Game({ seed: 164, mode: 'skirmish' });
  const oldRelay = legacy.relays[0];
  oldRelay.owner = 'enemy'; oldRelay.progress = -1;
  legacy.commandEnergy.enemy = 100;
  legacy._createUnit('enemy', 'rifle', oldRelay.x, oldRelay.y);
  legacy._createUnit('player', 'rifle', oldRelay.x + 4, oldRelay.y);
  legacy.replayVersion = 25;
  legacy._aiRelayProtocols();
  assert.equal(oldRelay.protocol, 'shelter');
});

function prepareLogisticsUnload({ relays = 1, replayVersion = null, credits = 1000, cargo = 100 } = {}) {
  const game = new Game({ seed: 165, mode: 'multiplayer' });
  game.replayVersion = replayVersion;
  game.credits.player = credits;
  for (let index = 0; index < relays; index++) {
    const relay = game.relays[index];
    relay.owner = 'player'; relay.progress = 1; relay.protocol = 'logistics';
    relay.protocolCooldown = 0; relay.contested = false;
  }
  const refinery = game._createBuilding('player', 'refinery', 5, 5, 1);
  const harvester = game._createUnit('player', 'harvester', refinery.x + 1.5, refinery.y + 1, { type: 'harvest' });
  harvester.cargo = cargo;
  harvester._harvestPhase = 'return';
  return { game, harvester };
}

test('Logistics earns a bounded bonus only when a harvester unloads at a refinery', () => {
  assert.equal(RELAY_LOGISTICS_YIELD_RATE, 0.1);
  const { game, harvester } = prepareLogisticsUnload({ relays: 3 });
  const startingCredits = game.credits.player;
  game._updateRelays(10);
  assert.equal(game.credits.player, startingCredits, 'a held relay alone produces no passive credits');
  game._updateHarvester(harvester, 1);
  assert.equal(game.credits.player, 1130, 'three secure Logistics relays add at most 30% of accepted cargo');
  assert.equal(game.events.filter(event => event.type === 'credits').at(-1).amount, 130,
    'the credit event includes the actual Logistics bonus');
});

test('Logistics requires an owned uncontested relay and respects credit storage capacity', () => {
  const { game, harvester } = prepareLogisticsUnload({ credits: 5950, cargo: 100 });
  const relay = game.relays[0];
  const enemy = game._createUnit('enemy', 'rifle', relay.x + 1, relay.y);
  game._updateHarvester(harvester, 1);
  assert.equal(game.credits.player, 6000, 'a contested relay supplies no bonus and storage remains capped');

  enemy.hp = 0;
  relay.contested = false;
  game.credits.player = 5900;
  harvester.cargo = 100;
  harvester._harvestPhase = 'return';
  game._updateHarvester(harvester, 1);
  assert.equal(game.credits.player, 6000, 'the bonus is clipped to available storage');
});

test('Logistics is a direct-select protocol for v49 games and preserves prior replay/save rules', () => {
  const game = new Game({ seed: 166, mode: 'campaign' });
  const relay = heldRelay(game);
  assert.equal(game._relayLogisticsEnabled(), true);
  assert.deepEqual(game.setRelayProtocol(relay.id, 'logistics'), { ok: true });
  assert.equal(relay.protocol, 'logistics');

  const oldReplay = new Game({ seed: 167, mode: 'skirmish' });
  oldReplay.replayVersion = 48;
  const oldRelay = heldRelay(oldReplay);
  assert.equal(oldReplay._relayLogisticsEnabled(), false);
  assert.equal(oldReplay.setRelayProtocol(oldRelay.id, 'logistics').ok, false);

  const restored = Game.deserialize(game.serialize());
  assert.equal(restored.relayLogisticsRulesVersion, RELAY_LOGISTICS_RULES_VERSION);
  assert.equal(restored.relays[0].protocol, 'logistics');
  const preV49Save = JSON.parse(game.serialize());
  delete preV49Save.relayLogisticsRulesVersion;
  const migrated = Game.deserialize(preV49Save);
  assert.equal(migrated.replayVersion, 48, 'marker-less saves stay on pre-Logistics rules');
  assert.equal(migrated.relays[0].protocol, 'shelter', 'pre-v49 saves normalize unsupported protocols');
});

test('solo AI chooses Logistics only for an active low-credit economy and leaves v48 unchanged', () => {
  const game = new Game({ seed: 168, mode: 'skirmish' });
  const relay = game.relays[0];
  relay.owner = 'enemy'; relay.progress = -1; relay.contested = false;
  game._createBuilding('enemy', 'refinery', 50, 12, 1);
  game._createUnit('enemy', 'harvester', 48.5, 16.5, { type: 'harvest' });
  game.credits.enemy = 1000;
  game.commandEnergy.enemy = 100;
  game.storm.phase = 'calm';
  game._aiRelayProtocols();
  assert.equal(relay.protocol, 'logistics');

  const legacy = new Game({ seed: 169, mode: 'skirmish' });
  legacy.replayVersion = 48;
  const oldRelay = legacy.relays[0];
  oldRelay.owner = 'enemy'; oldRelay.progress = -1;
  legacy._createBuilding('enemy', 'refinery', 50, 12, 1);
  legacy._createUnit('enemy', 'harvester', 48.5, 16.5, { type: 'harvest' });
  legacy.credits.enemy = 1000;
  legacy.commandEnergy.enemy = 100;
  legacy._aiRelayProtocols();
  assert.equal(oldRelay.protocol, 'shelter');
});
