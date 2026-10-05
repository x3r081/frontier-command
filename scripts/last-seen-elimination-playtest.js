// Controlled tactical fixture for solo Elimination last-seen cleanup potential.
// Run both public-order policies from the same serialized post-base snapshot.
import { Game } from '../src/game/engine.js';

const stepSeconds = 1;
const maxSearchSeconds = 720;
const disableEnemyAI = game => {
  game._aiTick = () => {};
  game._launchAiWave = () => {};
};

function makeFixture() {
  const game = new Game({ seed: 481516, difficulty: 'normal', mapId: 'shard-valley',
    faction: 'aegis', victoryMode: 'elimination' });
  game.units = [];
  game.buildings = [];
  game.lastSeenHostileUnits = [];
  game.fog = Array.from({ length: game.height }, () => Array(game.width).fill(0));
  disableEnemyAI(game);

  // Keep only the player's command building and an isolated hostile survivor.
  game._createBuilding('player', 'command', 8, 34);
  const target = { x: 44.5, y: 20.5 };
  const scout = game._createUnit('player', 'scout', 38.5, 20.5);
  const tank = game._createUnit('player', 'lightTank', 32.5, 20.5);
  const hostile = game._createUnit('enemy', 'buggy', target.x, target.y);
  game._updateFog();
  if (!game.visibleEnemies.some(enemy => enemy.id === hostile.id))
    throw new Error('Fixture failed to establish the initial public sighting.');

  // Retreat all friendly combat units using a normal player order. The hostile
  // remains stationary, so fog refresh turns the sighting into a stale contact.
  game.select([scout.id, tank.id]);
  const retreat = game.issueMove(24.5, 20.5);
  if (!retreat.ok) throw new Error(`Fixture retreat failed: ${retreat.reason}`);
  let contact = null;
  for (let i = 0; i < 40; i++) {
    game.update(stepSeconds);
    contact = game.getLastSeenHostileUnits().find(item => item.entityId === hostile.id) || null;
    if (contact && !game.visibleEnemies.some(enemy => enemy.id === hostile.id)) break;
  }
  if (!contact || game.visibleEnemies.some(enemy => enemy.id === hostile.id))
    throw new Error('Fixture did not produce a stale public contact after retreat.');
  return game.serialize();
}

const blindGrid = (game) => {
  const points = [];
  for (let y = 4; y < game.height - 2; y += 8)
    for (let x = 4; x < game.width - 2; x += 8) points.push({ x: x + 0.5, y: y + 0.5 });
  return points;
};

function runPolicy(snapshot, policy) {
  const game = Game.deserialize(snapshot);
  disableEnemyAI(game);
  const army = game.units.filter(unit => unit.owner === 'player' && unit.hp > 0 &&
    ['scout', 'lightTank'].includes(unit.defId));
  const ids = army.map(unit => unit.id);
  const grid = blindGrid(game);
  let gridIndex = 0;
  let moveOrders = 0, attackOrders = 0;
  let nextDecision = 0;
  const issueMove = point => {
    game.select(ids);
    const result = game.issueMove(point.x, point.y, true);
    if (result.ok) moveOrders++;
  };

  while (game.status === 'playing' && game.time < maxSearchSeconds) {
    if (game.time >= nextDecision) {
      nextDecision = game.time + 2;
      const enemies = game.visibleEnemies.filter(enemy => enemy.hp > 0);
      if (enemies.length) {
        const enemy = enemies[0];
        game.select(ids);
        if (game.issueAttack(enemy.id).ok) attackOrders++;
      } else {
        let target = null;
        if (policy === 'last-seen') {
          const contact = game.getLastSeenHostileUnits()
            .sort((a, b) => a.lastSeenAt - b.lastSeenAt || a.entityId.localeCompare(b.entityId))[0];
          if (contact) target = { x: contact.x, y: contact.y };
        }
        if (!target) target = grid[Math.min(gridIndex, grid.length - 1)];
        if (target) {
          const arrived = army.some(unit => Math.hypot(unit.x - target.x, unit.y - target.y) <= 2.5);
          if (policy === 'blind-grid' && arrived) gridIndex = Math.min(gridIndex + 1, grid.length - 1);
          const waypoint = policy === 'blind-grid'
            ? grid[Math.min(gridIndex, grid.length - 1)] : target;
          const currentOrder = army[0]?.order;
          if (waypoint && (currentOrder?.type !== 'move' ||
              Math.hypot(currentOrder.x - waypoint.x, currentOrder.y - waypoint.y) > 2)) issueMove(waypoint);
        }
      }
    }
    game.update(stepSeconds);
  }
  return { policy, status: game.status, seconds: +game.time.toFixed(1),
    moveOrders, attackOrders, commands: moveOrders + attackOrders,
    finalVisibleHostiles: game.visibleEnemies.filter(enemy => enemy.hp > 0).length,
    finalPublicContacts: game.getLastSeenHostileUnits().length,
    gridIndex, gridLength: grid.length };
}

const snapshot = makeFixture();
const initial = Game.deserialize(snapshot);
const contacts = initial.getLastSeenHostileUnits();
const results = ['last-seen', 'blind-grid'].map(policy => runPolicy(snapshot, policy));
if (contacts.length !== 1 || results.some(result => result.status !== 'victory'))
  throw new Error('The controlled survivor fixture did not produce a paired victory from one stale sighting.');
console.log(JSON.stringify({ fixture: 'controlled-post-base-stale-contact',
  seed: 481516, mapId: 'shard-valley', initialTime: +initial.time.toFixed(1),
  staleContactCount: contacts.length,
  staleContacts: contacts.map(({ defId, x, y, lastSeenAt }) => ({ defId, x: +x.toFixed(1),
    y: +y.toFixed(1), lastSeenAt: +lastSeenAt.toFixed(1) })), results }));
