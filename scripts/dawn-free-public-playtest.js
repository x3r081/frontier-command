// Public-command Dawn of the Free playtest. Starts from the authored mission
// state and uses only ordinary production, repair, and visible-target orders.
import { createCampaignGame, updateCampaign } from '../src/game/campaign.js';

const difficulty = process.argv.find(arg => arg.startsWith('--difficulty='))?.split('=')[1] || 'normal';
const seed = Number(process.argv.find(arg => arg.startsWith('--seed='))?.split('=')[1] || 61010);
const maxSeconds = Number(process.argv.find(arg => arg.startsWith('--max-seconds='))?.split('=')[1] || 600);
const game = createCampaignGame(11, difficulty, seed);
const relays = game.relays;
const initialUnits = new Set(game.units.filter(unit => unit.owner === 'player').map(unit => unit.id));
const relayOneTeam = new Set(game.units.filter(unit => unit.owner === 'player' &&
  ['rifle', 'rocket', 'medic'].includes(unit.defId)).map(unit => unit.id));
const relayTwoTeam = new Set(game.units.filter(unit => unit.owner === 'player' &&
  ['guardian', 'buggy'].includes(unit.defId)).map(unit => unit.id));
const relayAssignments = new Map([
  ...[...relayOneTeam].map(id => [id, 0]),
  ...[...relayTwoTeam].map(id => [id, 1]),
]);
const events = [];
let breachAt = null;
let nextOrdersAt = 0;
let nextQueueAt = 0;
let nextRepairAt = 0;
let nextScoutAt = 0;
let scoutStage = 0;
let queuedTanks = 0;
let queuedRockets = 0;

game.onEvent = event => {
  if (['campaignIntel', 'campaignThreatWarning', 'campaignReinforcement', 'relayCaptured',
    'relayNeutralized', 'missionComplete', 'defeat', 'victory'].includes(event.type)) events.push(event);
  if (event.type === 'campaignIntel' && /relay shield collapsed/.test(event.message)) breachAt ??= game.time;
};

const ownCommand = () => game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
const aliveArmy = () => game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 && !unit.embarkedIn &&
  unit.defId !== 'harvester' && unit.defId !== 'mcv');
const selectAndMove = (units, point, attackMove = true) => {
  const live = units.filter(unit => unit?.owner === 'player' && unit.hp > 0);
  if (!live.length) return false;
  game.select(live.map(unit => unit.id));
  return game.issueMove(point.x, point.y, attackMove).ok;
};
const visibleEnemies = () => game.visibleEnemies.filter(enemy => enemy.owner === 'enemy' && enemy.hp > 0);
const near = (unit, point, radius) => Math.hypot(unit.x + (unit.w || 0) / 2 - point.x,
  unit.y + (unit.h || 0) / 2 - point.y) <= radius;

// Split the opening force across the two public relay objectives.
selectAndMove(game.units.filter(unit => relayOneTeam.has(unit.id)), relays[0]);
selectAndMove(game.units.filter(unit => relayTwoTeam.has(unit.id)), relays[1]);

while (game.status === 'playing' && game.time < maxSeconds) {
  const dt = 0.2;
  game.update(dt);
  updateCampaign(game, 11, dt);

  if (game.time >= nextQueueAt) {
    nextQueueAt = game.time + 12;
    if (queuedTanks < 8 && game.canQueueUnit('lightTank').ok && game.queueUnit('lightTank').ok) queuedTanks++;
    if (queuedRockets < 4 && game.canQueueUnit('rocket').ok && game.queueUnit('rocket').ok) queuedRockets++;
  }

  const command = ownCommand();
  if (command && command.hp < command.maxHp && !command.repairing && game.credits.player >= 80 &&
      game.time >= nextRepairAt) {
    game.toggleRepair(command.id);
    nextRepairAt = game.time + 4;
  }

  if (game.time >= nextOrdersAt) {
    nextOrdersAt = game.time + 5;
    const army = aliveArmy();
    const newlyProduced = army.filter(unit => !initialUnits.has(unit.id));
    const liveRelayOne = [...relayOneTeam].map(id => game.getEntity(id)).filter(unit => unit?.hp > 0);
    const liveRelayTwo = [...relayTwoTeam].map(id => game.getEntity(id)).filter(unit => unit?.hp > 0);

    for (const unit of newlyProduced) {
      if (breachAt !== null) continue;
      const count = index => [...relayAssignments].filter(([id, assigned]) => assigned === index &&
        game.getEntity(id)?.hp > 0).length;
      const countOne = count(0), countTwo = count(1);
      if (Math.min(countOne, countTwo) < 2) {
        const assignment = countOne <= countTwo ? 0 : 1;
        relayAssignments.set(unit.id, assignment);
        selectAndMove([unit], relays[assignment]);
      }
    }

    // Order local defenders against enemies actually revealed near either relay.
    for (const relay of relays.slice(0, 2)) {
      if (game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] !== 2) continue;
      const threats = visibleEnemies().filter(enemy => near(enemy, relay, 6));
      if (!threats.length) continue;
      const defenders = aliveArmy().filter(unit => near(unit, relay, 11));
      if (defenders.length) {
        game.select(defenders.map(unit => unit.id));
        game.issueAttack(threats.sort((a, b) => Math.hypot(a.x - relay.x, a.y - relay.y) -
          Math.hypot(b.x - relay.x, b.y - relay.y))[0].id);
      }
    }

    if (breachAt === null) {
      // Reissue a capture order when a relay is visibly lost. Keep both squads
      // assigned to one relay so there is a defender on each approach.
      const relayTargets = [
        { relay: relays[0], team: liveRelayOne },
        { relay: relays[1], team: liveRelayTwo },
      ];
      for (const { relay, team } of relayTargets) {
        const visible = game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] === 2;
        if (visible && relay.owner !== 'player') selectAndMove(team, relay);
      }
    } else {
      // Keep the original defenders at both relays. After the breach, send
      // newly built armor and visible-target responders onto the exposed yard.
      const assault = aliveArmy().filter(unit => !relayAssignments.has(unit.id));
      const enemyCommand = visibleEnemies().find(enemy => enemy.defId === 'command' && enemy.w);
      if (enemyCommand && assault.length) {
        game.select(assault.map(unit => unit.id));
        game.issueAttack(enemyCommand.id);
      } else if (enemyCommand === undefined && game.time >= nextScoutAt) {
        const sweep = [
          { x: relays[1].x + 7, y: relays[1].y - 5 },
          { x: relays[1].x + 13, y: relays[1].y - 8 },
          { x: relays[1].x + 18, y: relays[1].y - 11 },
        ];
        if (assault.length) {
          selectAndMove(assault, sweep[Math.min(scoutStage, sweep.length - 1)]);
          scoutStage = Math.min(scoutStage + 1, sweep.length - 1);
          nextScoutAt = game.time + 12;
        }
      }

      for (const relay of relays.slice(0, 2)) {
        if (game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] !== 2) continue;
        const threats = visibleEnemies().filter(enemy => near(enemy, relay, 5));
        if (!threats.length) continue;
        const defenders = aliveArmy().filter(unit => near(unit, relay, 12));
        if (defenders.length) {
          game.select(defenders.map(unit => unit.id));
          game.issueAttack(threats.sort((a, b) => Math.hypot(a.x - relay.x, a.y - relay.y) -
            Math.hypot(b.x - relay.x, b.y - relay.y))[0].id);
        }
      }
    }
  }
}

const target = visibleEnemies().find(enemy => enemy.defId === 'command' && enemy.w) ||
  game.buildings.find(building => building.owner === 'enemy' && building.defId === 'command');
const command = ownCommand();
console.log(JSON.stringify({
  seed, difficulty, status: game.status, seconds: +game.time.toFixed(1),
  phase: game.campaignState.phase, shieldReformCount: game.campaignState.shieldReformCount || 0,
  playerCommandHp: command?.hp ?? 0, playerCommandMaxHp: command?.maxHp ?? 0,
  enemyCommandHp: target?.hp ?? 0,
  playerArmy: aliveArmy().map(unit => ({ defId: unit.defId, hp: +unit.hp.toFixed(0),
    x: +unit.x.toFixed(1), y: +unit.y.toFixed(1), order: unit.order?.type })),
  visibleEnemies: visibleEnemies().map(enemy => ({ defId: enemy.defId, hp: +enemy.hp.toFixed(0),
    x: +enemy.x.toFixed(1), y: +enemy.y.toFixed(1) })),
  relays: relays.map(relay => ({ id: relay.id,
    owner: game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] === 2 ? relay.owner : 'unknown',
    contested: game.fog[Math.floor(relay.y)]?.[Math.floor(relay.x)] === 2 ? relay.contested : 'unknown' })),
  events: events.map(event => ({ time: +event.time?.toFixed?.(1) || +game.time.toFixed(1),
    type: event.type, message: event.message || null })),
}, null, 2));
