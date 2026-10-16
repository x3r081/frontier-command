import { Game } from '../src/game/engine.js';

const ARENA_SEED = 62061;
const START = { x: 26.5, y: 20.5 };
const DESTINATION = { x: 16.5, y: 20.5 };
const MAX_SECONDS = 30;

function createArena(threatMode) {
  const game = new Game({ seed: ARENA_SEED, mode: 'multiplayer', difficulty: 'normal' });
  game.replayVersion = 61;
  game.units = []; game.buildings = []; game.relays = [];
  for (const row of game.terrain) for (const tile of row) {
    tile.type = 'sand'; tile.resource = 0; tile.walkable = true; tile.buildable = true;
  }
  for (const row of game.fog) row.fill(2);

  const player = game._createUnit('player', 'lightTank', START.x, START.y);
  const enemy = game._createUnit('enemy', 'lightTank', 30.5, START.y);
  enemy.order = threatMode === 'stationary'
    ? { type: 'guard', x: enemy.x, y: enemy.y }
    : { type: 'idle' };
  let shots = { player: 0, enemy: 0 };
  let hits = { player: 0, enemy: 0 };
  const fire = game._fire.bind(game);
  game._fire = (source, target, weaponDef) => {
    if (source.id === player.id) shots.player++;
    if (source.id === enemy.id) shots.enemy++;
    return fire(source, target, weaponDef);
  };
  const applyDamage = game._applyDamage.bind(game);
  game._applyDamage = (target, damage, damageType, attackerOwner, sourceId, ...rest) => {
    if (attackerOwner === 'enemy' && sourceId === enemy.id && target.id === player.id) hits.enemy++;
    if (attackerOwner === 'player' && sourceId === player.id && target.id === enemy.id) hits.player++;
    return applyDamage(target, damage, damageType, attackerOwner, sourceId, ...rest);
  };
  if (threatMode === 'pursuing') {
    game.commandOwner = 'enemy';
    game.select(enemy.id);
    if (!game.issueAttack(player.id).ok) throw new Error('enemy pursuit order failed');
    game.commandOwner = 'player';
  }
  return { game, player, enemy, getShots: () => ({ ...shots }), getHits: () => ({ ...hits }) };
}

function run(threatMode, reverse) {
  const { game, player, enemy, getShots, getHits } = createArena(threatMode);
  game.select(player.id);
  const order = reverse
    ? game.issueReverseMove(DESTINATION.x, DESTINATION.y)
    : game.issueMove(DESTINATION.x, DESTINATION.y);
  if (!order.ok) throw new Error(`${reverse ? 'reverse' : 'ordinary'} order failed: ${order.reason}`);

  let arrivalTime = null;
  let maxDistanceOffRoute = 0;
  for (let step = 1; step <= MAX_SECONDS * 10; step++) {
    game.update(0.1);
    maxDistanceOffRoute = Math.max(maxDistanceOffRoute, Math.abs(player.y - START.y));
    if (Math.hypot(player.x - DESTINATION.x, player.y - DESTINATION.y) < 0.45 &&
        player.order.type === 'idle') {
      arrivalTime = step / 10;
      break;
    }
    if (player.hp <= 0 || game.status !== 'playing') break;
  }

  return {
    retreat: reverse ? 'reverse' : 'ordinary',
    threat: threatMode,
    arrivalSeconds: arrivalTime,
    playerHp: Math.round(player.hp),
    playerDamage: Math.round(player.maxHp - player.hp),
    enemyHp: Math.round(enemy.hp),
    enemyDamage: Math.round(enemy.maxHp - enemy.hp),
    shots: getShots(),
    hits: getHits(),
    maxOffRouteTiles: Number(maxDistanceOffRoute.toFixed(2)),
    finalOrder: player.order.type,
  };
}

for (const threat of ['stationary', 'pursuing']) {
  for (const reverse of [false, true]) console.log(JSON.stringify(run(threat, reverse)));
}
