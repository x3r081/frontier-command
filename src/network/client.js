const TOKEN_KEY = 'frontier-command-profile-token-v1';

export class NetworkClient {
  constructor(onMessage, onConnection) {
    this.onMessage = onMessage;
    this.onConnection = onConnection;
    this.token = localStorage.getItem(TOKEN_KEY) || null;
    this.profile = null;
    this.socket = null;
    this.connected = false;
    this.reconnectDelay = 1000;
    this.reconnectTimer = null;
    this.intentionalClose = false;
    this.activeMatchCode = null;
    this.everConnected = false;
    this.commandSequence = 0;
    this.pendingCommands = new Map();
  }

  async request(path, method = 'GET', body = undefined, signal = undefined) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || data.message || `Server returned ${response.status}`);
    return data;
  }

  async init() {
    const data = await this.request('/profile', 'POST', this.token ? { token: this.token } : {});
    this.token = data.token;
    this.profile = data.profile;
    localStorage.setItem(TOKEN_KEY, this.token);
    this.connect();
    return this.profile;
  }

  async rename(name) {
    const data = await this.request('/profile', 'PATCH', { name });
    this.profile = data.profile;
    return this.profile;
  }

  friends() { return this.request('/friends'); }
  requestFriend(code) { return this.request('/friends/requests', 'POST', { code }); }
  acceptFriend(id) { return this.request(`/friends/requests/${encodeURIComponent(id)}/accept`, 'POST', {}); }
  campaignProgress() { return this.request('/campaign/progress'); }
  carryoverUnlocks(missionIndex, difficulty) {
    const query = new URLSearchParams({ missionIndex: String(missionIndex), difficulty });
    return this.request(`/campaign/carryover-unlocks?${query}`);
  }
  leaderboard({ mode = '', scenarioId = '', difficulty = '', faction = '', doctrineId = '', fieldOrderId = '', carryoverId = '', veteran = '', supplyId = '', routePayoffId = '', skirmishOpening = '', victoryMode = '', aiCommanderProfileId = '' } = {}) {
    const query = new URLSearchParams();
    if (mode) query.set('mode', mode);
    if (scenarioId) query.set('scenarioId', scenarioId);
    if (difficulty) query.set('difficulty', difficulty);
    if (faction) query.set('faction', faction);
    if (doctrineId) query.set('doctrineId', doctrineId);
    if (fieldOrderId) query.set('fieldOrderId', fieldOrderId);
    if (carryoverId) query.set('carryoverId', carryoverId);
    if (veteran) query.set('veteran', veteran);
    if (supplyId) query.set('supplyId', supplyId);
    if (routePayoffId) query.set('routePayoffId', routePayoffId);
    if (skirmishOpening) query.set('skirmishOpening', skirmishOpening);
    if (victoryMode) query.set('victoryMode', victoryMode);
    if (aiCommanderProfileId) query.set('aiCommanderProfileId', aiCommanderProfileId);
    const suffix = query.size ? `?${query}` : '';
    return this.request(`/leaderboard${suffix}`);
  }
  battleHistory() { return this.request('/records/history'); }
  rankedRating() { return this.request('/multiplayer/rating'); }
  rankedLeaderboard() { return this.request('/multiplayer/leaderboard'); }
  async startRun(details, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { return await this.request('/scores/runs', 'POST', details, controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw new Error('Leaderboard did not answer in time; this battle will be saved locally.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  finishRun(runId, details) { return this.request(`/scores/runs/${encodeURIComponent(runId)}/finish`, 'POST', details); }

  command(command, data = {}, timeoutMs = 10000) {
    if (this.pendingCommands.size >= 128) {
      return { ok: false, reason: 'Too many orders are waiting for confirmation.' };
    }
    let requestId;
    do {
      this.commandSequence = (this.commandSequence + 1) % 0x7fffffff;
      requestId = `cmd-${this.commandSequence.toString(36)}`;
    } while (this.pendingCommands.has(requestId));
    let resolve;
    const acknowledgement = new Promise(res => { resolve = res; });
    const timer = setTimeout(() => {
      if (!this.pendingCommands.has(requestId)) return;
      this.pendingCommands.delete(requestId);
      resolve({ ok: false, transportFailure: true,
        reason: 'Order confirmation timed out. Check the battlefield before retrying.' });
    }, timeoutMs);
    this.pendingCommands.set(requestId, { resolve, timer });
    if (!this.send('command', { ...data, command, requestId })) {
      clearTimeout(timer);
      this.pendingCommands.delete(requestId);
      return { ok: false, reason: 'Multiplayer connection unavailable.' };
    }
    return { ok: true, pending: true, requestId, acknowledgement };
  }

  settleCommand(message) {
    if (message?.type !== 'command_result' || typeof message.requestId !== 'string') return;
    const pending = this.pendingCommands.get(message.requestId);
    if (!pending) return;
    this.pendingCommands.delete(message.requestId);
    clearTimeout(pending.timer);
    pending.resolve(message);
  }

  failPendingCommands(reason = 'Connection lost before the order was confirmed.') {
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, transportFailure: true, reason });
    }
    this.pendingCommands.clear();
  }

  connect() {
    if (!this.token || this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.intentionalClose = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.reconnectDelay = 1000;
      this.onConnection?.(true);
      if (this.everConnected && this.activeMatchCode) {
        this.send('resume_match', { code: this.activeMatchCode });
      }
      this.everConnected = true;
    });
    socket.addEventListener('message', event => {
      if (this.socket !== socket) return;
      try {
        const message = JSON.parse(event.data);
        this.settleCommand(message);
        if (message.type === 'match_start' && typeof message.code === 'string') this.activeMatchCode = message.code;
        if (message.type === 'match_end' || message.type === 'match_session_lost') this.activeMatchCode = null;
        this.onMessage?.(message);
      }
      catch (error) { console.warn('Ignoring invalid multiplayer message.', error); }
    });
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.connected = false;
      this.socket = null;
      this.failPendingCommands();
      this.onConnection?.(false);
      if (!this.intentionalClose) {
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(10000, delay * 1.7);
        this.reconnectTimer = setTimeout(() => this.connect(), delay);
      }
    });
    socket.addEventListener('error', () => socket.close());
  }

  send(type, data = {}) {
    if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify({ type, ...data }));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.failPendingCommands('Connection closed before the order was confirmed.');
    this.socket = null;
    this.connected = false;
  }
}
