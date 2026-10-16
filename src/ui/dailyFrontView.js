import { AI_COMMANDER_PROFILES, FACTIONS, Game, SKIRMISH_MAPS } from '../game/engine.js';

const byId = id => document.getElementById(id);
const mapCache = new Map();
const text = (parent, tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value == null ? '' : String(value);
  parent.append(node);
  return node;
};

function displayDate(dateId) {
  const stamp = Date.parse(`${dateId}T00:00:00.000Z`);
  if (!Number.isFinite(stamp)) return dateId || 'UTC date unavailable';
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    .format(stamp).toUpperCase();
}

function timeLeft(expiresAt, nowMs) {
  const remaining = Math.ceil((expiresAt - nowMs) / 1000);
  if (remaining <= 0) return 'FRONT ROTATED';
  const seconds = remaining;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}H ${String(minutes).padStart(2, '0')}M REMAINING`
    : `${minutes}M ${String(rest).padStart(2, '0')}S REMAINING`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function infoCard(label, value, detail = '') {
  const card = document.createElement('div');
  card.className = 'daily-front-fact';
  text(card, 'span', 'daily-front-fact-label', label);
  text(card, 'strong', 'daily-front-fact-value', value);
  if (detail) text(card, 'small', 'daily-front-fact-detail', detail);
  return card;
}

function formatRecord(record, fallback) {
  if (record == null || record === '') return fallback;
  if (typeof record === 'string' || typeof record === 'number') return String(record);
  const parts = [];
  if (record.rank != null) parts.push(`#${record.rank}${record.fieldSize ? ` / ${record.fieldSize}` : ''}`);
  if (record.score != null) parts.push(`${(Number(record.score) || 0).toLocaleString()} PTS`);
  if (record.time != null) parts.push(String(record.time));
  if (record.seconds != null) parts.push(formatDuration(record.seconds));
  if (record.kills != null) parts.push(`${record.kills} KILLS`);
  if (record.wins != null) parts.push(`${record.wins} WINS`);
  return parts.join(' · ') || fallback;
}

function paintMap(canvas, game) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = 640, height = 480;
  canvas.width = width;
  canvas.height = height;
  const colors = { sand: ['#243b33', '#2a4338', '#30483b', '#344b3e'], crystal: ['#5cbd96', '#65c69d', '#52b28e', '#73cfaa'],
    rock: ['#111c1c', '#152321', '#182725', '#1b2b28'], water: ['#102d36', '#123540', '#153943', '#183f47'] };
  const tileW = width / game.width, tileH = height / game.height;
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) {
    const tile = game.terrain[y][x];
    ctx.fillStyle = (colors[tile.type] || colors.sand)[tile.shade || 0];
    ctx.fillRect(x * tileW, y * tileH, tileW + 0.25, tileH + 0.25);
    if (tile.type === 'crystal' && tile.resource > 0) {
      ctx.fillStyle = '#abf3cd'; ctx.globalAlpha = 0.58;
      ctx.fillRect((x + 0.35) * tileW, (y + 0.34) * tileH, tileW * 0.3, tileH * 0.3);
      ctx.globalAlpha = 1;
    }
  }
  for (const bridge of game.bridges || []) {
    ctx.strokeStyle = '#9cbbaf'; ctx.lineWidth = 4;
    ctx.fillStyle = '#9cbbaf';
    ctx.fillRect(bridge.x * tileW, bridge.y * tileH, bridge.w * tileW, bridge.h * tileH);
    ctx.strokeRect(bridge.x * tileW, bridge.y * tileH, bridge.w * tileW, bridge.h * tileH);
  }
  const paintBase = (owner, color) => {
    const command = game.buildings.find(building => building.owner === owner && building.defId === 'command');
    if (!command) return;
    ctx.fillStyle = color; ctx.globalAlpha = 0.18;
    ctx.fillRect((command.x - 2) * tileW, (command.y - 2) * tileH, (command.w + 4) * tileW, (command.h + 4) * tileH);
    ctx.globalAlpha = 1; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.strokeRect((command.x - 2) * tileW, (command.y - 2) * tileH, (command.w + 4) * tileW, (command.h + 4) * tileH);
    ctx.beginPath(); ctx.arc((command.x + command.w / 2) * tileW, (command.y + command.h / 2) * tileH, 5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  };
  paintBase('player', '#83f0bf'); paintBase('enemy', '#ff977d');
  game.relays.forEach((relay, index) => {
    ctx.beginPath(); ctx.arc(relay.x * tileW, relay.y * tileH, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#b7f4d7'; ctx.fill(); ctx.strokeStyle = '#13261e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#08120f'; ctx.font = '700 8px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), relay.x * tileW, relay.y * tileH + 0.5);
  });
  ctx.strokeStyle = '#c4ebd8'; ctx.lineWidth = 1; ctx.globalAlpha = 0.4;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1); ctx.globalAlpha = 1;
}

function drawMap(canvas, front) {
  const setup = front?.setup;
  const map = SKIRMISH_MAPS.find(item => item.id === setup?.scenarioId);
  if (!setup || !map) return;
  const key = front.id || `${front.date}-${front.rulesVersion}`;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = 640, height = 480;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const cached = mapCache.get(key);
  if (cached) {
    ctx.drawImage(cached, 0, 0, width, height);
    return;
  }
  const game = new Game({ seed: setup.seed, difficulty: setup.difficulty, faction: setup.faction,
    mode: setup.mode, mapId: setup.scenarioId, skirmishOpening: setup.skirmishOpening,
    victoryMode: setup.victoryMode, aiCommanderProfileId: setup.aiCommanderProfileId,
    replayVersion: front.rulesVersion });
  const art = document.createElement('canvas');
  paintMap(art, game);
  mapCache.set(key, art);
  while (mapCache.size > 5) mapCache.delete(mapCache.keys().next().value);
  ctx.drawImage(art, 0, 0, width, height);
}

/** Render a server-authoritative Daily Front briefing into its dialog content node. */
export function renderDailyFront(container, data = {}, { nowMs = Date.now(), loading = false, error = null } = {}) {
  if (!container || typeof container.replaceChildren !== 'function') throw new TypeError('Daily Front container is required.');
  data ||= {};
  const front = data.challenge || data.front || data;
  const setup = front?.setup;
  const dialog = byId('daily-front-dialog');
  const status = byId('daily-front-status');
  const rankedButton = document.createElement('button');
  rankedButton.id = 'daily-front-play-ranked'; rankedButton.type = 'button'; rankedButton.className = 'button-primary daily-front-ranked';
  rankedButton.textContent = 'PLAY RANKED';
  const practiceButton = document.createElement('button');
  practiceButton.id = 'daily-front-practice'; practiceButton.type = 'button'; practiceButton.className = 'button-secondary daily-front-practice';
  practiceButton.textContent = 'PRACTICE';
  const valid = !!setup && typeof setup.scenarioId === 'string' && Number.isFinite(front?.expiresAt);
  const expired = valid && front.expiresAt <= nowMs;
  rankedButton.disabled = !!loading || !valid || !!error || expired;
  practiceButton.disabled = !valid;
  if (status) {
    status.textContent = error ? String(error) : loading ? 'UPDATING COMMAND RECORDS…'
      : !valid ? 'DAILY FRONT DETAILS ARE NOT AVAILABLE.' : timeLeft(front.expiresAt, nowMs);
    status.dataset.kind = error ? 'error' : loading ? 'loading' : valid ? 'countdown' : 'unavailable';
  }
  if (dialog) dialog.setAttribute('aria-busy', String(!!loading));
  container.replaceChildren();
  container.__dailyFrontChallenge = front;
  container.__dailyFrontRankedBlocked = !!loading || !!error || !valid;

  const heading = document.createElement('header'); heading.className = 'daily-front-heading';
  text(heading, 'div', 'panel-kicker', 'GLOBAL COMMAND // 24 HOUR OPERATION');
  const title = text(heading, 'h2', '', front?.title || 'DAILY FRONT'); title.id = 'daily-front-title';
  const description = text(heading, 'p', '', 'One battlefield. One shared command challenge. Take the field before the front rotates.');
  description.id = 'daily-front-description';
  const dateLine = document.createElement('div'); dateLine.className = 'daily-front-date-line';
  text(dateLine, 'span', '', displayDate(front?.date));
  const countdown = text(dateLine, 'strong', '', valid && Number.isFinite(front.expiresAt) ? timeLeft(front.expiresAt, nowMs) : 'SYNCING UTC');
  countdown.id = 'daily-front-countdown';
  const refresh = document.createElement('button'); refresh.id = 'daily-front-refresh'; refresh.type = 'button';
  refresh.className = 'daily-front-refresh'; refresh.textContent = 'REFRESH'; refresh.disabled = !!loading;
  dateLine.append(refresh);
  heading.append(dateLine);
  container.append(heading);

  const layout = document.createElement('div'); layout.className = 'daily-front-layout';
  const mapColumn = document.createElement('div'); mapColumn.className = 'daily-front-map-column';
  const mapFrame = document.createElement('div'); mapFrame.className = 'daily-front-map-frame';
  const canvas = document.createElement('canvas'); canvas.id = 'daily-front-map'; canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', valid ? `Strategic terrain preview: ${front.setup.scenarioId}, three relays, opposing command bases.` : 'Daily Front strategic map preview.');
  mapFrame.append(canvas);
  text(mapFrame, 'span', 'daily-front-map-stamp', `FC // ${String(front?.rulesVersion ?? '--').padStart(2, '0')}`);
  mapColumn.append(mapFrame);
  const legend = document.createElement('div'); legend.className = 'daily-front-map-legend';
  for (const [label, color] of [['YOUR COMMAND', 'mint'], ['OPPOSITION', 'coral'], ['RELAY', 'relay']]) {
    const item = document.createElement('span'); item.className = `daily-front-legend-${color}`; item.textContent = label; legend.append(item);
  }
  mapColumn.append(legend);
  layout.append(mapColumn);

  const facts = document.createElement('div'); facts.className = 'daily-front-facts';
  const map = SKIRMISH_MAPS.find(item => item.id === setup?.scenarioId);
  const faction = FACTIONS[setup?.faction];
  const opponentId = setup?.aiCommanderProfileId;
  const opponentProfile = AI_COMMANDER_PROFILES.find(item => item.id === opponentId);
  const opponent = data.opponent?.name || data.opponent || opponentProfile?.name || 'Field commander';
  facts.append(infoCard('BATTLEFIELD', map?.name || 'Synchronizing', map?.description || 'Awaiting the daily battle setup.'));
  facts.append(infoCard('YOUR FACTION', faction?.name || '—', 'Faction rotation is shared by all commanders.'));
  facts.append(infoCard('OPPOSITION', opponent, 'Normal difficulty · Forward Base · Relay Dominion'));
  const records = document.createElement('div'); records.className = 'daily-front-records';
  records.append(infoCard('YOUR DAILY RANK', data.ownRank == null ? 'Unranked' : `#${data.ownRank}`, 'Ranked score from your best verified result.'));
  records.append(infoCard('PERSONAL BEST', formatRecord(data.ownBest, 'No result yet'), 'Practice results do not affect ranked standing.'));
  facts.append(records);
  layout.append(facts);
  container.append(layout);

  const roster = document.createElement('section'); roster.className = 'daily-front-roster';
  const rosterHeading = document.createElement('div'); rosterHeading.className = 'daily-front-roster-heading';
  text(rosterHeading, 'h3', '', 'TODAY’S COMMANDERS');
  text(rosterHeading, 'span', '', `${Array.isArray(data.entries) ? data.entries.length : 0} VERIFIED RESULTS`);
  roster.append(rosterHeading);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (!entries.length) {
    text(roster, 'p', 'daily-front-empty', error ? 'Leaderboard unavailable. You can still practice today’s battle.' : 'No verified results yet. Set the first mark on the board.');
  } else {
    const list = document.createElement('ol'); list.className = 'daily-front-roster-list';
    entries.slice(0, 5).forEach(entry => {
      const row = document.createElement('li');
      text(row, 'span', 'daily-front-rank', `#${entry.rank}`);
      const identity = document.createElement('span'); identity.className = 'daily-front-player';
      text(identity, 'strong', '', entry.player?.name || 'Commander');
      if (entry.player?.code) text(identity, 'small', '', entry.player.code);
      row.append(identity);
      text(row, 'span', 'daily-front-score', `${(Number(entry.score) || 0).toLocaleString()} PTS`);
      text(row, 'span', 'daily-front-result', `${entry.kills ?? 0} K · ${formatDuration(entry.seconds)}`);
      list.append(row);
    });
    roster.append(list);
  }
  container.append(roster);

  const actions = document.createElement('footer'); actions.className = 'daily-front-actions';
  const actionCopy = document.createElement('div'); actionCopy.className = 'daily-front-action-copy';
  text(actionCopy, 'strong', '', 'READY TO DEPLOY?');
  text(actionCopy, 'small', '', 'Ranked attempts are server verified. Practice uses the same setup without a leaderboard result.');
  actions.append(actionCopy);
  const buttons = document.createElement('div'); buttons.className = 'daily-front-buttons';
  buttons.append(rankedButton, practiceButton);
  actions.append(buttons);
  container.append(actions);
  if (valid) drawMap(canvas, front);

  return {
    canvas, rankedButton, practiceButton, countdown, refreshButton: refresh,
    updateCountdown(at = Date.now()) {
      if (valid && Number.isFinite(front.expiresAt)) {
        countdown.textContent = timeLeft(front.expiresAt, at);
        rankedButton.disabled = container.__dailyFrontRankedBlocked || front.expiresAt <= at;
      }
    },
  };
}

export function updateDailyFrontCountdown(container, nowMs = Date.now()) {
  const countdown = container?.querySelector?.('#daily-front-countdown');
  const challenge = container?.__dailyFrontChallenge;
  if (!countdown || !Number.isFinite(challenge?.expiresAt)) return false;
  countdown.textContent = timeLeft(challenge.expiresAt, nowMs);
  const ranked = container.querySelector('#daily-front-play-ranked');
  if (ranked) ranked.disabled = !!container.__dailyFrontRankedBlocked || challenge.expiresAt <= nowMs;
  const status = byId('daily-front-status');
  if (status?.dataset.kind === 'countdown') {
    status.textContent = timeLeft(challenge.expiresAt, nowMs);
  }
  return true;
}
