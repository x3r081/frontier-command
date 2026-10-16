import { Game, TILE_SIZE, COMMAND_ABILITIES, DOCTRINE_DEFS, TACTICAL_PACKAGE_DEFS, SKIRMISH_MAPS, VETERANCY_RANKS, UNIT_DEFS, BUILDING_DEFS, ION_STORM_PHASE_SECONDS, SALVAGE_DROP_CAPTURE_SECONDS, UNIT_PROMOTION_RULES_VERSION, DOCTRINE_REPLACEMENT_RULES_VERSION, DOCTRINE_REPLACEMENT_COST, DOCTRINE_REPLACEMENT_TIME, AI_COMMANDER_PROFILES, AI_COMMANDER_PROFILE_RULES_VERSION, AIR_SERVICE_RULES_VERSION, PRODUCTION_SITE_RULES_VERSION, PRODUCTION_REPEAT_RULES_VERSION, GARRISON_RULES_VERSION, MOBILE_RALLY_RULES_VERSION, TARGET_PRIORITY_RULES_VERSION, MEDIC_ESCORT_RULES_VERSION, ENGINEER_ESCORT_RULES_VERSION, INFANTRY_DIG_IN_RULES_VERSION, INFANTRY_DIG_IN_SETUP_SECONDS, INFANTRY_DIG_IN_DURATION_SECONDS, INFANTRY_DIG_IN_DAMAGE_MULTIPLIER, INFANTRY_DIG_IN_ARC_RADIANS, WRECK_COVER_RULES_VERSION, WRECK_COVER_RADIUS, WRECK_COVER_PROXIMITY, HARVESTER_HOME_RULES_VERSION, aiCommanderProfileForSeed, isUnitPromotionEligible } from './game/engine.js';
import { CAMPAIGN_MISSIONS, CAMPAIGN_DOCTRINES, CAMPAIGN_FIELD_ORDERS, CAMPAIGN_CARRYOVERS, CAMPAIGN_SUPPLIES, CAMPAIGN_ROUTE_PAYOFFS, QUIET_KNIFE_ESCAPE, getCampaignCarryoverUnlocks, getCampaignRequisitionBalance, getCampaignFieldOrderView, getIronReclaimedView, getCounterbatteryView, createCampaignGame, updateCampaign } from './game/campaign.js';
import { deriveCampaignVeteran, validateCampaignVeteran } from './game/campaignVeteran.js';
import { campaignRecord, campaignProgressAtDifficulty, advanceCampaignLegacyCompletion, campaignFieldOrderCompleted,
  campaignChosenBranchId, campaignRequisitionSpentMissionIds,
  campaignVeteranRecordForMission, saveCampaignVeteran, saveCampaignResult } from './game/campaignProgress.js';
import { campaignDossierView } from './game/campaignDossier.js';
import { CAMPAIGN_ROUTE_ORDERED_IDS, campaignNextChoices } from './game/campaignRoute.js';
import { SoloClock, SOLO_STEP_SECONDS } from './game/soloClock.js';
import { createTacticalDamageMonitor } from './game/tacticalDamage.js';
import { recordBattleMoment, selectReplayMoments } from './game/battleMoments.js';
import { createSoloRecorder, createSoloPlayback, validateSoloReplay, SOLO_REPLAY_VERSION } from './game/replay.js';
import { loadSoloReplayArchive, addSoloReplayToArchive, deleteSoloReplayFromArchive,
  loadPendingSoloSubmission, savePendingSoloSubmission, clearPendingSoloSubmission } from './game/replayArchive.js';
import { listSaveSlots, getSaveSlot, writeSaveSlot, deleteSaveSlot } from './game/saveSlots.js';
import { clearSoloRecovery, loadSoloRecovery, saveSoloRecovery } from './game/soloRecovery.js';
import { relayIntel } from './game/relayIntel.js';
import { chooseRelayLocator } from './game/relayLocator.js';
import { SelectionRoster } from './game/selectionRoster.js';
import { drawStrategicMapPreview } from './ui/strategicMapPreview.js';
import { campaignArtworkForMission } from './ui/campaignArtwork.js';
import { AudioSystem } from './audio.js';
import { NetworkClient } from './network/client.js';
import { getFieldAbilityCohort, activateSelectedUnitAbility } from './game/fieldAbilities.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#battlefield');
const overlay = $('#overlay-canvas');
const minimap = $('#minimap');
let ctx = null;
let renderer3d = null;
let rendererReadyPromise = null;
const octx = overlay.getContext('2d');
const mctx = minimap.getContext('2d');
const AUDIO_KEY = 'frontier-command-muted';
const GRAPHICS_KEY = 'frontier-command-graphics-quality-v1';
const LAST_REPLAY_KEY = 'frontier-command-last-replay-v1';
const DOCTRINE_KEY = 'frontier-command-campaign-doctrine-v1';
const FIELD_ORDER_KEY = 'frontier-command-campaign-field-order-v1';
const CARRYOVER_KEY = 'frontier-command-campaign-carryover-v1';
const SUPPLY_KEY = 'frontier-command-campaign-supply-v1';
const audio = new AudioSystem({ muted: localStorage.getItem(AUDIO_KEY)==='true' });
const storedGraphicsQuality = localStorage.getItem(GRAPHICS_KEY);
let graphicsQuality = ['eco','balanced','ultra'].includes(storedGraphicsQuality)
  ? storedGraphicsQuality : matchMedia('(max-width: 670px)').matches ? 'balanced' : 'ultra';
const soloClock = new SoloClock();
const TEAM = { player: '#caff75', enemy: '#ff7869' };
const ASSET_PATH = '/assets/';
const portraitSource=id=>`${ASSET_PATH}portraits/${id}.png${id==='artillery-vesper'?'?rev=89':id==='medic'?'?rev=86':['mcv','mcv-vesper'].includes(id)?'?rev=85':['barracks','barracks-vesper'].includes(id)?'?rev=82':['rifle','rocket'].includes(id)?'?rev=76':['bunker','bunker-vesper'].includes(id)?'?rev=79':id==='stealthTank'||id==='guardian'?'?rev=2':['orca','engineer'].includes(id)?'?rev=1':''}`;
const portraitVariant = (faction, id) => faction === 'vesper'
  ? id === 'mcv' ? 'mcv-vesper'
    : id === 'bunker' ? 'bunker-vesper'
    : id === 'scout' ? 'scout-vesper'
    : id === 'harvester' ? 'harvester-vesper'
      : id === 'buggy' ? 'buggy-vesper'
        : id === 'artillery' ? 'artillery-vesper'
        : ['command','power','refinery','barracks','factory','radar','tech'].includes(id) ? `${id}-vesper` : id
  : id;
const assetCache = new Map();
const oreCrystal = new Image();oreCrystal.src = `${ASSET_PATH}ore-crystal.svg`;
const fallbackSymbols = { command:'⌂', power:'ϟ', refinery:'◈', barracks:'♟', factory:'▣', radar:'◎', turret:'✦', silo:'⬡', infantry:'♟', engineer:'✚', scout:'➤', tank:'▰', artillery:'✹', harvester:'◈', aircraft:'▲' };
const STRUCTURE_PRIORITY = Object.freeze({refinery:0,power:1,barracks:2,bunker:3,factory:4,wall:5,silo:6,serviceBay:7,radar:8});
const FIXED_FORCE_MISSION_IDS = new Set(['ashes-in-transit', 'after-the-dawn', 'ghost-channel', 'iron-reclaimed']);
const TARGET_PRIORITY_UI = Object.freeze({auto:'AUTO', infantry:'INFANTRY', vehicles:'VEHICLES', aircraft:'AIRCRAFT', structures:'STRUCTURES', mixed:'MIXED'});
let pendingTargetPriority = null;
const STANCE_UI = Object.freeze({
  aggressive:{short:'AGGR',name:'AGGRESSIVE',icon:'✦'},
  defensive:{short:'DEFEND',name:'DEFENSIVE',icon:'◈'},
  holdFire:{short:'HOLD',name:'HOLD FIRE',icon:'◎'},
  mixed:{short:'MIXED',name:'MIXED',icon:'◉'},
  none:{short:'STANCE',name:'NO COMBAT UNIT',icon:'◉'},
});

let game = null;
const selectionRoster = new SelectionRoster();
const selectionRosterButtons = new Map();
let currentMode = 'skirmish';
let missionIndex = 0;
let campaignDifficulty = 'normal';
let dominionDisplayKey = '';
let relayScoutIndex = 0;
let battlefieldPickerAddSquadMode = false;
let lastPublicSalvagePhase = null;
let lastPublicBloomUntil = null;
let campaignGuidanceKey = '';
let campaignGuidanceDismissedKey = '';
let quickStartGuidance = false;
let quickStartStage = 0;
let briefingMissionIndex = null;
let briefingReturnFocus = null;
let campaignReturnFocus = null;
let campaignDoctrineId = CAMPAIGN_DOCTRINES.some(item=>item.id===localStorage.getItem(DOCTRINE_KEY)) ? localStorage.getItem(DOCTRINE_KEY) : 'standard';
let campaignFieldOrderId = 'none';
let campaignCarryoverId = 'none';
let campaignSupplyId = 'none';
let campaignRoutePayoffId = 'none';
let campaignDossier = null;
let campaignDossierStatus = 'local';
let campaignDossierRequestVersion = 0;
let carryoverOnlineUnlocks = null;
let campaignVeteranOnline = undefined;
let requisitionOnlineBalance = null;
let carryoverRequestVersion = 0;
let playing = false;
let paused = false;
let deploymentIntro = null;
let armoryAutoPaused = false;
let promotionAutoPaused = false;
let powerGridAutoPaused = false;
const pendingPowerCommands = new Set();
let pendingFieldAbility = null;
let fieldAbilityContextToken = 0;
const fieldAbilityLocks = new Map();
let powerGridSignature = '';
let promotionUnitId = null;
let promotionPending = false;
let promotionToken = 0;
let lastTime = 0;
const recentFrameTimes = [];
const FRAME_RATE_WINDOW_MS = 1500;
const FRAME_RATE_MAX_SAMPLES = 48;
let lastFrameRateUiUpdate = 0;
let displayTime = 0;
let uiTimer = 0;
let minimapTimer = 0;
let faction = 'aegis';
let difficulty = 'normal';
let skirmishMap = 'shard-valley';
let skirmishOpening = 'established';
let skirmishVictoryMode = 'dominion';
let tab = 'structures';
let blueprintInspect = null;
let blueprintPointerGuardUntil = 0;
let compactBlueprintView = false;
try { compactBlueprintView = localStorage.getItem('cc-blueprint-view') === 'grid'; } catch {}
let placeId = null;
let placementToken = 0;
let attackMoveMode = false;
let routePlanMode = false;
let matchPaceMode = false;
let selectedFormation = '';
let formationSelectionKey = '';
let formationPreviewCache = { key: '', at: 0, preview: null };
let shiftHeld = false;
let routePlanSelectionKey = '';
let commandAbilityMode = null;
let commandAbilityToken = 0;
let digInMode = false;
let digInSelectionKey = '';
let digInPending = false;
let digInToken = 0;
let targetOrderPending = false;
let targetOrderToken = 0;
let commandAbilityPending = false;
let gameEnded = false;
let gameSeconds = 0;
let soloRecoveryElapsed = 0;
let musicCombat = 0;
let groups = {};
const tacticalDamageMonitor = createTacticalDamageMonitor();
let tacticalAlert = null;
let panKeys = new Set();
let camera = { x: 0, y: 0, zoom: 1 };
let pointer = { x: 0, y: 0, wx: 0, wy: 0, down: false, dragging: false, forceMove: false, sx: 0, sy: 0, pan: false, panX: 0, panY: 0, touchPan: false, touchMoved: false, touchSelecting: false, touchStartedAt: 0 };
let touchPointerId = null;
let visibleW = 1, visibleH = 1, dpr = 1;
let selectionPulse = 0;
let messageQueue = [];
let lastProductionSignature = '';
let lastProductionTab = '';
const pendingProductionRepeat = new Map();
const pendingBunkerCommands = new Map();
let activeRunId = null;
let activeRunRecorder = null;
let activeReplayEnvelope = null;
let activePlayback = null;
let replayMode = false;
let battleMoments = [];
let replayMoments = [];
let replaySpeed = 1;
let replayAccumulator = 0;
let replaySeekTarget = null;
let gameStarting = false;
let lobby = null;
let casualSearchActive = false;
let matchmakingMode = null;
let matchmakingNoticeMode = null;
let casualSearchReconnecting = false;
let casualSearchPosition = null;
let casualSearchElapsedMs = 0;
let casualSearchStartedAt = 0;
let matchmakingRating = null;
let matchmakingRatingRange = null;
let casualSearchTimer = null;
let matchRoomCode = null;
let opponentReconnecting = false;
let postMatchOpponent = null;
let postMatchFriendRequestPending = false;
let postMatchRematch = null;
let rematchOffer = null;
let rematchRequestPending = false;
let rematchResponsePending = false;
let rematchStatus = '';
let networkAvailable = false;
let networkReadyPromise = null;
let leaderboardRequestVersion = 0;
let leaderboardServerRulesVersion = null;
let soloBenchmarkRequestVersion = 0;
let battleHistoryRequestVersion = 0;
let multiplayerHistoryRequestVersion = 0;
let multiplayerHistoryLoaded = 0;
let multiplayerHistoryTotal = 0;
let multiplayerHistoryLoading = false;
let rankedRating = null;
let rankedRatingLoaded = false;
let rankedUnavailableReason = 'Ranked season support has not been confirmed.';
let rankedDataRequestVersion = 0;
let pendingJoinCode = new URLSearchParams(location.search).get('join');
const trackedDialogIds = ['#multiplayer-modal', '#leaderboard-modal', '#setup', '#manual', '#armory', '#promotion-modal', '#power-grid-modal'];
const modalBackgroundIds = new Set([...trackedDialogIds, '#campaign-select', '#save-slots-modal', '#pause-modal', '#end-modal']);
const trackedDialogOpeners = {
  '#multiplayer-modal': '#multiplayer-menu', '#leaderboard-modal': '#leaderboard-menu',
  '#setup': '#configure-game', '#manual': '#how-to-menu', '#armory': '#armory-menu',
  '#promotion-modal': '#selection-card', '#power-grid-modal': '#power-grid-trigger',
};
const dialogReturnFocus = new Map();
function handleNetworkMessage(message) {
  if(message.type==='hello'){
    network.profile=message.profile;
    updateProfileUI();
    retryPendingSoloSubmission().catch(()=>{});
    refreshFriends().catch(()=>{});
  }else if(message.type==='friends'){
    renderFriends(message);
  }else if(message.type==='friends_changed'){
    refreshFriends().catch(()=>{});
  }else if(message.type==='matchmaking'&&message.status==='queued'){
    matchmakingMode=message.ranked?'ranked':'casual';casualSearchActive=true;casualSearchReconnecting=false;
    matchmakingNoticeMode=matchmakingMode;
    casualSearchPosition=Number.isFinite(message.position)?message.position:null;
    casualSearchElapsedMs=Number.isFinite(message.elapsedMs)?message.elapsedMs:0;
    matchmakingRating=Number.isFinite(message.rating)?message.rating:null;
    matchmakingRatingRange=Number.isFinite(message.ratingRange)?message.ratingRange:null;
    casualSearchStartedAt=Date.now();
    if(casualSearchTimer)clearInterval(casualSearchTimer);
    casualSearchTimer=setInterval(()=>{if(casualSearchActive&&!casualSearchReconnecting)renderCasualMatchmaking();},1000);
    renderCasualMatchmaking();
  }else if(message.type==='matchmaking'&&message.status==='cancelled'){
    casualSearchActive=false;matchmakingMode=null;casualSearchReconnecting=false;casualSearchPosition=null;
    if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;
    renderCasualMatchmaking('Search cancelled.');
  }else if(message.type==='matchmaking'&&message.status==='timeout'){
    const wasRanked=message.ranked??matchmakingMode==='ranked';matchmakingNoticeMode=wasRanked?'ranked':'casual';casualSearchActive=false;casualSearchReconnecting=false;casualSearchPosition=null;
    if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;
    renderCasualMatchmaking('No opponent found yet. You can search again whenever you’re ready.');
    networkFeedback(`${wasRanked?'Ranked':'Casual'} search timed out. You can search again.`);
  }else if(message.type==='matchmaking'&&message.status==='match_found'){
    const wasRanked=message.ranked??matchmakingMode==='ranked';matchmakingNoticeMode=wasRanked?'ranked':'casual';casualSearchActive=false;casualSearchReconnecting=false;casualSearchPosition=null;
    if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;
    renderCasualMatchmaking(`${wasRanked?'Ranked':'Casual'} opponent found${message.opponent?.name?` — ${message.opponent.name}`:''}. Review the lobby, then mark ready when you’re ready.`);
  }else if(message.type==='matchmaking'&&message.status==='match_cancelled'){
    const wasRanked=message.ranked??matchmakingMode==='ranked';matchmakingNoticeMode=wasRanked?'ranked':'casual';casualSearchActive=false;casualSearchReconnecting=false;casualSearchPosition=null;
    if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;
    if(lobby?.matchmaking){lobby=null;renderLobby();}
    renderCasualMatchmaking(message.reason==='acceptance_timeout'
      ?'Ready check expired. Search again when you’re ready.'
      :`The ${wasRanked?'ranked':'casual'} match was cancelled. Search again when you’re ready.`);
    networkFeedback(message.reason==='acceptance_timeout'
      ?`${wasRanked?'Ranked':'Casual'} ready check expired. Search again when you choose.`
      :`${wasRanked?'Ranked':'Casual'} match cancelled before deployment. You can search again.`);
  }else if(message.type==='matchmaking'&&message.status==='idle'){
    casualSearchActive=false;matchmakingMode=null;casualSearchReconnecting=false;casualSearchPosition=null;
    if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;
    renderCasualMatchmaking('A matched opponent can see your callsign and friend code.');
  }else if(message.type==='lobby'){
    if(currentMode==='multiplayer'&&gameEnded&&message.status==='waiting')
      returnToMenu({preserveLobby:true});
    lobby=message;
    if(message.matchmaking){matchmakingMode=message.ranked?'ranked':'casual';casualSearchActive=false;casualSearchReconnecting=false;casualSearchPosition=null;if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;}
    if(currentMode==='multiplayer'&&playing){
      const status=$('#multiplayer-status-text');
      if(status&&message.status==='playing'&&message.code===matchRoomCode){
        const opponent=(message.players||[]).find(player=>player.id!==network.profile?.id);
        const reconnecting=opponent?.connected===false;
        status.textContent=`ROOM ${message.code||'LIVE'} · ${reconnecting?'OPPONENT RECONNECTING…':opponentReconnecting?'OPPONENT RECONNECTED':'MATCH CONTINUES'}`;
        if(reconnecting&&!opponentReconnecting)toast('OPPONENT DISCONNECTED · WAITING FOR RECONNECT',true);
        if(!reconnecting&&opponentReconnecting)toast('OPPONENT RECONNECTED · MATCH CONTINUES');
        opponentReconnecting=reconnecting;
      }
    }else {
      openTrackedDialog('#multiplayer-modal');renderLobby();
      if(message.status==='waiting')networkFeedback(message.matchmaking
        ?`${message.ranked?'Ranked':'Casual'} opponent found. Review the lobby and mark ready when you choose.`
        :(message.players||[]).length<2
          ?`Room ${message.code} is ready. Share the invite link or room code.`
          :'Both commanders are here. Choose settings and mark ready.');
    }
  }else if(message.type==='invite'){
    $('#join-room-code').value=message.code;
    if(currentMode==='multiplayer'&&playing){
      toast(`INVITE FROM ${message.from?.name||'COMMANDER'} · JOIN AFTER MATCH`);
      return;
    }
    openTrackedDialog('#multiplayer-modal');
    networkFeedback(`${message.from?.name||'A commander'} invited you. Join with the room code below.`);
    toast(`INVITE FROM ${message.from?.name||'COMMANDER'}`);
  }else if(message.type==='invite_sent'){
    networkFeedback('Lobby invitation sent.');
  }else if(message.type==='rematch_offer'){
    rematchOffer=message;
    rematchResponsePending=false;
    renderRematchOffer();
    if(playing&&!gameEnded){
      toast(`${message.from?.name||'A COMMANDER'} OFFERED A REMATCH · REVIEW IT AFTER THIS BATTLE`);
    }else if($('#end-modal').classList.contains('hidden')){
      openTrackedDialog('#multiplayer-modal');
      $('#multiplayer-rematch-offer').scrollIntoView({block:'center'});
      $('#multiplayer-rematch-offer [data-rematch-accept]').focus({preventScroll:true});
      networkFeedback(`${message.from?.name||'Your last opponent'} offered a rematch. Review the invitation above.`);
    }else{
      $('#end-rematch-offer').scrollIntoView({block:'center'});
      $('#end-rematch-offer [data-rematch-accept]').focus({preventScroll:true});
      toast(`${message.from?.name||'YOUR OPPONENT'} OFFERED A REMATCH`);
    }
  }else if(message.type==='rematch_pending'){
    rematchRequestPending=true;
    rematchStatus=`Rematch offered to ${message.to?.name||'your opponent'}. Waiting for their answer.`;
    renderPostMatchRematch();
  }else if(message.type==='rematch_accepted'){
    rematchRequestPending=false;rematchResponsePending=false;rematchOffer=null;
    rematchStatus='Rematch accepted. Opening the new lobby…';
    renderRematchOffer();renderPostMatchRematch();
  }else if(['rematch_declined','rematch_expired','rematch_cancelled'].includes(message.type)){
    rematchRequestPending=false;rematchResponsePending=false;
    if(!message.requestId||rematchOffer?.requestId===message.requestId)rematchOffer=null;
    rematchStatus=message.type==='rematch_declined'?'Rematch declined. You can offer again while both commanders are available.'
      :message.type==='rematch_expired'?'Rematch offer expired. You can send a new one while both commanders are available.'
      :'Rematch cancelled because a commander is no longer available.';
    renderRematchOffer();renderPostMatchRematch();
    if($('#end-modal').classList.contains('hidden'))networkFeedback(rematchStatus);
  }else if(message.type==='rematch_error'){
    rematchRequestPending=false;rematchResponsePending=false;
    rematchStatus=message.message||'Rematch unavailable. Return to Multiplayer to create a new room.';
    renderRematchOffer();renderPostMatchRematch();
    if($('#end-modal').classList.contains('hidden'))networkFeedback(rematchStatus,true);
  }else if(message.type==='match_start'){
    // The server also sends match_start when a dropped commander rejoins the
    // same live room. Keep local controls and camera while replacing its
    // authoritative snapshot; a fresh match still uses the full initializer.
    if(currentMode==='multiplayer'&&playing&&!gameEnded&&game&&
       matchRoomCode&&message.code===matchRoomCode){
      hydrateMultiplayerState(message.state);
      const status=$('#multiplayer-status-text');
      if(status)status.textContent=`ROOM ${matchRoomCode} · ${opponentReconnecting?'OPPONENT RECONNECTING…':'RECONNECTED'}`;
      toast('MATCH RECONNECTED · COMMAND ONLINE');
    }else startMultiplayerGame(message);
  }else if(message.type==='state'&&currentMode==='multiplayer'&&playing){
    hydrateMultiplayerState(message.state);
  }else if(message.type==='match_session_lost'){
    if(currentMode==='multiplayer'&&playing&&!gameEnded&&message.code===matchRoomCode)
      interruptMultiplayerMatch();
  }else if(message.type==='match_end'&&currentMode==='multiplayer'&&playing&&game){
    if(Number.isSafeInteger(message.ratingAfter)&&Number.isSafeInteger(message.ratingDelta)){
      if(rankedRating)rankedRating.rating=message.ratingAfter;
      if(rankedRatingLoaded)renderCasualMatchmaking();
      loadRankedRecords();
    }
    finishGame(message.winner==='player',{reason:message.reason,
      opponentName:message.opponentName,opponentFriendCode:message.opponentFriendCode,
      matchId:message.matchId,ranked:message.ranked,rematchEligible:message.rematchEligible});
  }else if(message.type==='command_result'&&!message.ok){
    toast(message.reason||`${message.command} unavailable`,true);
    audio.play('error');
  }else if(message.type==='error'){
    const detail=message.message||message.error||'Network request failed.';
    if(casualSearchActive){
      casualSearchActive=false;matchmakingMode=null;casualSearchReconnecting=false;casualSearchPosition=null;
      if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;
      renderCasualMatchmaking(`Search unavailable: ${detail}`);
    }
    if(detail==='This lobby was opened from another connection.'){
      const roomCode=lobby?.code||matchRoomCode||'';
      if(currentMode==='multiplayer'&&playing&&!gameEnded)interruptMultiplayerMatch(roomCode);
      else {
        lobby=null;
        renderLobby();
        if(roomCode)$('#join-room-code').value=roomCode;
        networkFeedback(`Your commander seat is active in another tab. Join room ${roomCode||'again'} here to take control.`,true);
        toast('COMMAND SEAT MOVED TO ANOTHER TAB',true);
      }
      return;
    }
    networkFeedback(detail,true);
    toast(detail,true);
  }
}
function handleNetworkConnection(connected) {
  const wasAvailable=networkAvailable;
  networkAvailable=connected;
  if(!connected){
    ++rankedDataRequestVersion;
    rankedRatingLoaded=false;
    rankedUnavailableReason='Reconnecting to verify the ranked season.';
    rematchRequestPending=false;rematchResponsePending=false;
    if(postMatchRematch)rematchStatus='Connection lost. Reconnect to offer another rematch.';
    renderPostMatchRematch();renderRematchOffer();
  }else if(!wasAvailable)loadRankedRecords();
  if(!connected&&casualSearchActive){casualSearchReconnecting=true;renderCasualMatchmaking('Connection lost. Reconnecting before search can continue.');}
  if(connected&&!wasAvailable&&casualSearchActive){
    if(lobby?.matchmaking){casualSearchActive=false;casualSearchReconnecting=false;renderCasualMatchmaking();}
    else {casualSearchReconnecting=true;renderCasualMatchmaking('Reconnected. Resuming your search…');network.send('queue_join',{ranked:matchmakingMode==='ranked'});}
  }
  const status=$('#multiplayer-status-text');
  if(status&&currentMode==='multiplayer')status.textContent=connected&&playing&&!gameEnded
    ?'RESTORING LIVE MATCH…':connected?`ROOM ${matchRoomCode||lobby?.code||'LIVE'} · CONNECTED`:'CONNECTION LOST · RECONNECTING';
  if(!connected&&currentMode==='multiplayer'&&playing)toast('CONNECTION LOST · RECONNECTING',true);
  if(connected&&pendingJoinCode&&currentMode!=='multiplayer'&&!playing){
    const code=pendingJoinCode.trim().toUpperCase();pendingJoinCode=null;
    $('#join-room-code').value=code;
    openTrackedDialog('#multiplayer-modal');network.send('join_lobby',{code,faction});
  }
  renderCasualMatchmaking();
}
const network = new NetworkClient(handleNetworkMessage, handleNetworkConnection);

function ensureRenderer() {
  if (rendererReadyPromise) return rendererReadyPromise;
  const status=$('#launch-status');
  const showLoading=status.classList.contains('hidden');
  if(showLoading){status.lastChild.textContent=' PREPARING BATTLEFIELD…';show('#launch-status');}
  // Keep Three.js and the GLTF loader out of the title screen's initial bundle.
  // The same promise is shared by solo, saved, and multiplayer starts.
  rendererReadyPromise = import('./visual/renderer3d.js')
    .then(async ({Renderer3D}) => {
      renderer3d = new Renderer3D(canvas);
      renderer3d.setGraphicsQuality(graphicsQuality);
      await renderer3d.assetsReady;
    })
    .catch(error => {
      console.warn('3D battlefield unavailable; using the 2D renderer.', error);
      ctx = canvas.getContext('2d');
    }).finally(()=>{if(showLoading)hide('#launch-status');});
  return rendererReadyPromise;
}
function renderGraphicsQuality() {
  for (const button of document.querySelectorAll('#graphics-quality-options [data-graphics-quality]')) {
    const active = button.dataset.graphicsQuality === graphicsQuality;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('#graphics-quality-status').textContent = graphicsQuality.toUpperCase();
}
function selectGraphicsQuality(quality) {
  if (!['eco','balanced','ultra'].includes(quality)) return;
  graphicsQuality = quality;
  localStorage.setItem(GRAPHICS_KEY, quality);
  renderer3d?.setGraphicsQuality(quality);
  renderGraphicsQuality();
}
function refreshFrameRateReadout(now = performance.now()) {
  const value = $('#graphics-fps-value');
  if (!value) return;
  if (document.visibilityState !== 'visible') {
    value.textContent = 'Unavailable while hidden';
    return;
  }
  if (replayMode && replaySeekTarget !== null) {
    value.textContent = 'Unavailable while seeking';
    return;
  }
  if (recentFrameTimes.length < 6) {
    value.textContent = 'Warming up…';
    return;
  }
  const first = recentFrameTimes[0], last = recentFrameTimes[recentFrameTimes.length - 1];
  const span = last - first;
  if (span <= 0) {
    value.textContent = 'Warming up…';
    return;
  }
  const fps = Math.round((recentFrameTimes.length - 1) * 1000 / span);
  const ageSeconds = Math.max(0, Math.floor((now - last) / 1000));
  value.textContent = paused || !playing || gameEnded
    ? `~${fps} FPS · ${ageSeconds ? `${ageSeconds}s ago` : 'just now'}`
    : `~${fps} FPS`;
}
function recordPresentedFrame(now) {
  if (document.visibilityState !== 'visible') return;
  if (!playing || !game || gameEnded) {
    recentFrameTimes.length = 0;
    return;
  }
  if (paused || (replayMode && replaySeekTarget !== null)) {
    if (now - lastFrameRateUiUpdate >= 1000) {
      refreshFrameRateReadout(now);
      lastFrameRateUiUpdate = now;
    }
    return;
  }
  recentFrameTimes.push(now);
  while (recentFrameTimes.length > FRAME_RATE_MAX_SAMPLES ||
    (recentFrameTimes.length > 1 && now - recentFrameTimes[0] > FRAME_RATE_WINDOW_MS)) recentFrameTimes.shift();
  if (now - lastFrameRateUiUpdate >= 1000) {
    refreshFrameRateReadout(now);
    lastFrameRateUiUpdate = now;
  }
}
function syncRendererView() {
  if (!renderer3d) return;
  renderer3d.setView(camera.x + visibleW / (2 * scale()), camera.y + visibleH / (2 * scale()), camera.zoom);
}

function finishDeploymentIntro(preserveCamera = false) {
  if (!deploymentIntro) return;
  if (!preserveCamera) {
    camera.x = deploymentIntro.target.x;
    camera.y = deploymentIntro.target.y;
    camera.zoom = deploymentIntro.target.zoom;
  }
  clampCamera();
  deploymentIntro = null;
  $('#deployment-intro').classList.add('hidden');
  paused = false;
  lastTime = performance.now();
}

function activeAiCommanderProfile() {
  if (game?.mode !== 'skirmish' || game.replayVersion != null &&
      game.replayVersion < AI_COMMANDER_PROFILE_RULES_VERSION) return null;
  return AI_COMMANDER_PROFILES.find(profile => profile.id === game.aiCommanderProfileId) || null;
}

function resetAiProfileDisclosure() {
  const badge=$('#ai-profile-badge');
  const toggle=$('#ai-profile-toggle');
  badge.classList.remove('is-expanded');
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-label','Expand enemy commander intelligence');
  toggle.lastElementChild.textContent='▾';
}

function startDeploymentIntro() {
  if (currentMode === 'multiplayer' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const title = currentMode === 'campaign'
    ? game.mission?.title || 'Campaign Operation'
    : SKIRMISH_MAPS.find(map => map.id === game.mapId)?.name || 'Skirmish';
  $('#deployment-intro-title').textContent = title;
  $('#deployment-intro-objective').textContent = objectiveLabel();
  const opponent = activeAiCommanderProfile();
  const opponentNote = $('#deployment-intro-opponent');
  opponentNote.classList.toggle('hidden', !opponent);
  opponentNote.textContent = opponent ? `ENEMY COMMANDER · ${opponent.name.toUpperCase()} — ${opponent.description}` : '';
  const target = { x: camera.x, y: camera.y, zoom: camera.zoom };
  const startZoom = Math.max(.65, target.zoom * .78);
  const centerX = target.x + visibleW / (2 * TILE_SIZE * target.zoom);
  const centerY = target.y + visibleH / (2 * TILE_SIZE * target.zoom);
  camera.zoom = startZoom;
  camera.x = centerX - visibleW / (2 * TILE_SIZE * startZoom);
  camera.y = centerY - visibleH / (2 * TILE_SIZE * startZoom);
  clampCamera();
  deploymentIntro = { startedAt: performance.now(), duration: 1950, from: { x: camera.x, y: camera.y, zoom: camera.zoom }, target };
  paused = true;
  $('#deployment-intro').classList.remove('hidden');
}

function advanceDeploymentIntro(now) {
  if (!deploymentIntro) return;
  const progress = Math.min(1, Math.max(0, (now - deploymentIntro.startedAt) / deploymentIntro.duration));
  const eased = 1 - (1 - progress) ** 3;
  camera.x = deploymentIntro.from.x + (deploymentIntro.target.x - deploymentIntro.from.x) * eased;
  camera.y = deploymentIntro.from.y + (deploymentIntro.target.y - deploymentIntro.from.y) * eased;
  camera.zoom = deploymentIntro.from.zoom + (deploymentIntro.target.zoom - deploymentIntro.from.zoom) * eased;
  if (progress >= 1) finishDeploymentIntro();
}

function assetKey(id) {
  const s = String(id).toLowerCase().replace(/[_\s]/g, '-');
  if (s === 'bunker') return 'turret';
  if (['scout','rifle','rocket','medic','flamer'].includes(s)) return 'infantry';
  if (s === 'guardian') return 'tank';
  if (s === 'mcv') return 'mcv';
  if (s === 'apc') return 'tank';
  if (s === 'dropship') return 'aircraft';
  if (s === 'helipad') return 'helipad';
  if (s === 'aatower') return 'aa-tower';
  if (s === 'sam') return 'aa-tower';
  if (s === 'guardtower') return 'guard-tower';
  if (s === 'obelisk') return 'obelisk';
  if (s === 'warhead') return 'warhead';
  if (s === 'superweapon') return 'ion-spire';
  if (s === 'servicebay') return 'war-factory';
  if (/yard|hq|headquarter|construction|command-center|mcv/.test(s)) return 'command-yard';
  if (/advanced-power|power-plant|power/.test(s)) return 'power-plant';
  if (/refinery/.test(s)) return 'refinery';
  if (/barracks|hand/.test(s)) return 'barracks';
  if (/factory|airstrip/.test(s)) return 'war-factory';
  if (/radar|comm|tech/.test(s)) return 'radar';
  if (/turret|tower|obelisk|sam|defense/.test(s)) return 'turret';
  if (/silo/.test(s)) return 'silo';
  if (/harvester/.test(s)) return 'harvester';
  if (/engineer/.test(s)) return 'engineer';
  if (/artillery|mlrs|mrls|rocket/.test(s)) return 'artillery';
  if (/aircraft|orca|apache|helicopter|heli/.test(s)) return 'aircraft';
  if (/tank|mammoth/.test(s)) return 'tank';
  if (/buggy|bike|scout|humvee|humm/.test(s)) return 'scout';
  if (/infantry|rifle|grenadier|flame|commando|soldier/.test(s)) return 'infantry';
  return null;
}
function getAsset(id) {
  const key = assetKey(id);
  if (!key) return null;
  if (!assetCache.has(key)) {
    const img = new Image();
    img.src = `${ASSET_PATH}${key}.svg`;
    assetCache.set(key, img);
  }
  const img = assetCache.get(key);
  return img.complete && img.naturalWidth ? img : null;
}
function assetHTML(id, shownFaction=faction) {
  const key = assetKey(id);
  const symbol = fallbackSymbols[key?.split('-')[0]] || '◆';
  if (UNIT_DEFS[id] || BUILDING_DEFS[id]) {
    const fallback = key ? `${ASSET_PATH}${key}.svg` : '';
    const portrait=portraitVariant(shownFaction,id);
    return `<img class="asset-icon asset-portrait" src="${portraitSource(portrait)}" alt="" decoding="async" onerror="this.onerror=null;${fallback ? `this.src='${fallback}'` : `this.replaceWith(Object.assign(document.createElement('span'),{className:'item-icon-fallback',textContent:'${symbol}'}))`}">`;
  }
  return key ? `<img class="asset-icon" src="${ASSET_PATH}${key}.svg" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'item-icon-fallback',textContent:'${symbol}'}))">` : `<span class="item-icon-fallback">${symbol}</span>`;
}
function show(id) { $(id).classList.remove('hidden'); if (modalBackgroundIds.has(id)) syncModalBackground(); }
function hide(id) { $(id).classList.add('hidden'); if (modalBackgroundIds.has(id)) syncModalBackground(); }
function syncModalBackground() {
  const trackedOpen = trackedDialogIds.some(id => !$(id).classList.contains('hidden'));
  const campaignOpen = !$('#campaign-select').classList.contains('hidden');
  const saveOpen = !$('#save-slots-modal').classList.contains('hidden');
  const pauseOpen = !$('#pause-modal').classList.contains('hidden');
  const endOpen = !$('#end-modal').classList.contains('hidden');
  $('#menu').inert = trackedOpen || campaignOpen || saveOpen;
  $('#campaign-select').inert = trackedOpen || saveOpen;
  $('#game-shell').inert = trackedOpen || saveOpen || pauseOpen || endOpen;
  $('#pause-modal').inert = trackedOpen || saveOpen || endOpen;
  $('#end-modal').inert = trackedOpen || saveOpen;
}
function containModalTab(event, layer) {
  const controls = [...layer.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.closest('.hidden') && el.getClientRects().length);
  const first = controls[0], last = controls.at(-1), active = document.activeElement;
  if (controls.length && !layer.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (controls.length && event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (controls.length && !event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}
function openTrackedDialog(id) {
  const layer = $(id);
  const opening = layer.classList.contains('hidden');
  if (!opening) return;
  for (const other of trackedDialogIds) if (other !== id && !$(other).classList.contains('hidden')) closeTrackedDialog(other, false);
  const fallback = $(trackedDialogOpeners[id]);
  const active = document.activeElement;
  const activeInsideTracked = trackedDialogIds.some(other => $(other).contains(active));
  dialogReturnFocus.set(id, active?.isConnected && !activeInsideTracked ? active : fallback);
  show(id);
  requestAnimationFrame(() => {
    if (!layer.classList.contains('hidden')) layer.querySelector('button:not(:disabled)')?.focus();
  });
}
function closeTrackedDialog(id, restoreFocus = true) {
  const layer = $(id);
  if (layer.classList.contains('hidden')) return;
  if(id==='#multiplayer-modal')leaveCasualSearch('Search cancelled because you left multiplayer.');
  hide(id);
  if(id==='#armory')clearArmoryModel();
  if (id === '#armory' && armoryAutoPaused) {
    armoryAutoPaused = false;
    if (playing && !gameEnded) {
      paused = false;
      lastTime = performance.now();
      audio.startAmbient();
      refreshFrameRateReadout();
    }
  }
  if (id === '#promotion-modal') {
    promotionToken++;
    promotionUnitId = null;
    promotionPending = false;
    if (promotionAutoPaused) {
      promotionAutoPaused = false;
      if (playing && !gameEnded) {
        paused = false;
        lastTime = performance.now();
        audio.startAmbient();
        refreshFrameRateReadout();
      }
    }
  }
  if (id === '#power-grid-modal' && powerGridAutoPaused) {
    powerGridAutoPaused = false;
    if (playing && !gameEnded) {
      paused = false;
      lastTime = performance.now();
      audio.startAmbient();
      refreshFrameRateReadout();
    }
  }
  const previous = dialogReturnFocus.get(id);
  dialogReturnFocus.delete(id);
  if (restoreFocus) {
    const fallback = $(trackedDialogOpeners[id]);
    const target = previous?.isConnected && !previous.closest('.hidden') ? previous : fallback;
    target?.focus();
  }
}
function toast(message, warning = false, duration = 3600) {
  if (!message) return;
  const el = document.createElement('div');
  el.className = `toast${warning ? ' warning' : ''}`;
  el.textContent = String(message).toUpperCase();
  $('#toast-container').append(el);
  setTimeout(() => { el.remove(); }, duration);
  if ($('#toast-container').children.length > 5) $('#toast-container').firstElementChild.remove();
}
function resetTacticalFeed() {
  tacticalDamageMonitor.reset();
  tacticalAlert = null;
  renderTacticalAlert();
}
function renderTacticalAlert() {
  const button = $('#tactical-alert');
  const active = tacticalAlert && game && game.time < tacticalAlert.until &&
    playing && !replayMode && !gameEnded;
  button.disabled = !active;
  button.classList.toggle('active', !!active);
  button.classList.toggle('lost', !!active && tacticalAlert.kind === 'lost');
  if (!active) {
    $('#tactical-alert-text').textContent = 'LIVE FEED';
    button.setAttribute('aria-label', 'No tactical alerts');
    button.title = 'Tactical alerts appear here when your forces take damage';
    return;
  }
  const def = game.unitDefs?.[tacticalAlert.defId] || game.buildingDefs?.[tacticalAlert.defId];
  const engineer = tacticalAlert.kind === 'engineer';
  const name = engineer ? 'HOSTILE ENGINEER' : (def?.name || keyName(tacticalAlert.defId)).toUpperCase();
  const sector = `${Math.floor(tacticalAlert.x)} // ${Math.floor(tacticalAlert.y)}`;
  const condition = engineer ? 'SPOTTED' : tacticalAlert.kind === 'lost' ? 'LOST' : 'DAMAGED';
  const shortName = ({ command: 'YARD', harvester: 'HARVESTER', refinery: 'REFINERY',
    factory: 'FACTORY', power: 'POWER' })[tacticalAlert.defId] || name;
  $('#tactical-alert-text').textContent = innerWidth <= 670
    ? engineer ? 'ENGINEER SPOTTED' : `${shortName} ${tacticalAlert.kind === 'lost' ? 'LOST' : 'HIT'}`
    : `${name} ${condition} · ${sector}`;
  button.setAttribute('aria-label', `${name} ${condition.toLowerCase()} at sector ${sector}. Center camera on alert.`);
  button.title = `Center on ${name.toLowerCase()} alert · sector ${sector}`;
}
function scanTacticalDamage() {
  if (!game || !playing || replayMode || gameEnded) { renderTacticalAlert(); return; }
  const next = tacticalDamageMonitor.observe(game);
  if (next && (!tacticalAlert || game.time >= tacticalAlert.until ||
      next.priority >= tacticalAlert.priority)) {
    tacticalAlert = { ...next, until: game.time + (next.kind === 'lost' ? 10 : 8) };
    if (next.priority >= 3) audio.play('alert');
  }
  renderTacticalAlert();
}
function clockText(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
function lastReplay() {
  const archived = loadSoloReplayArchive();
  if (archived.length) return archived[0].replay;
  try {
    const data = JSON.parse(localStorage.getItem(LAST_REPLAY_KEY) || 'null');
    if (!Number.isInteger(data?.version) || data.version < 1 || data.version > SOLO_REPLAY_VERSION) return null;
    validateSoloReplay(data.envelope, data.commands, data.completedTicks);
    return data;
  } catch { return null; }
}
function replayArchive() { return loadSoloReplayArchive(); }
function replayLabel(entry) {
  const envelope=entry.replay.envelope, mode=envelope.mode==='campaign'?'CAMPAIGN':'SKIRMISH';
  const scenario=envelope.mode==='campaign'
    ?CAMPAIGN_MISSIONS.find(mission=>mission.id===envelope.scenarioId)?.title?.replace(/^Mission \d+: /,'')||envelope.scenarioId
    :SKIRMISH_MAPS.find(map=>map.id===envelope.scenarioId)?.name||envelope.scenarioId;
  const date=new Date(entry.savedAt||entry.metadata?.savedAt||0);
  const opening=envelope.mode==='skirmish'&&envelope.skirmishOpening==='command-rig'?' · COMMAND RIG':'';
  const victory=envelope.mode==='skirmish'&&envelope.victoryMode==='elimination'?' · ELIMINATION':'';
  const opponent=envelope.mode==='skirmish'&&entry.replay.version>=AI_COMMANDER_PROFILE_RULES_VERSION
    ?` · VS ${aiCommanderProfileForSeed(envelope.seed,entry.replay.version).name.toUpperCase()}`:'';
  return `${mode} · ${scenario}${opening}${victory}${opponent} · ${envelope.difficulty||'NORMAL'} · ${date.toLocaleDateString()}`;
}
function renderReplayArchive() {
  const list=$('#local-replay-list'), entries=replayArchive();
  $('#local-replay-count').textContent=`${entries.length} / 10`;
  list.replaceChildren();
  if(!entries.length){const empty=document.createElement('p');empty.className='replay-archive-empty';empty.textContent='Complete a solo battle to add its replay here.';list.append(empty);return;}
  for(const entry of entries){
    const row=document.createElement('div');row.className='replay-archive-row';
    const title=document.createElement('strong');title.textContent=replayLabel(entry);
    const meta=document.createElement('small');
    const outcome=entry.metadata?.result;
    if(outcome==='victory'||outcome==='defeat'){
      const badge=document.createElement('b');badge.className=`replay-result ${outcome}`;badge.textContent=outcome.toUpperCase();
      meta.append(badge,' · ');
    }
    meta.append(`${clockText(entry.replay.completedTicks*SOLO_STEP_SECONDS)} · ${entry.replay.commands.length} orders`);
    if(entry.replay.version<SOLO_REPLAY_VERSION)meta.append(' · Legacy rules');
    if(Number.isInteger(entry.metadata?.kills)&&entry.metadata.kills>=0)meta.append(` · ${entry.metadata.kills} kills`);
    if(Number.isInteger(entry.metadata?.stars)&&entry.metadata.stars>=1&&entry.metadata.stars<=3)meta.append(` · ${entry.metadata.stars}★`);
    const momentCount=selectReplayMoments(entry.metadata?.moments,entry.replay.completedTicks).length;
    if(momentCount)meta.append(` · ${momentCount} key moments`);
    const watch=document.createElement('button');watch.type='button';watch.className='small-action';watch.textContent='WATCH';watch.setAttribute('aria-label',`Watch ${replayLabel(entry)}`);watch.dataset.watchReplay=entry.id;
    const remove=document.createElement('button');remove.type='button';remove.className='quiet-button';remove.textContent='DELETE';remove.setAttribute('aria-label',`Delete ${replayLabel(entry)}`);remove.dataset.deleteReplay=entry.id;
    const text=document.createElement('span');text.append(title,meta);row.append(text,watch,remove);list.append(row);
  }
}
function updateReplayAvailability() {
  $('#replay-menu').classList.toggle('hidden', !lastReplay());
}
function renderReplayMoments() {
  const panel = $('#replay-moments');
  const list = $('#replay-moment-list');
  list.replaceChildren();
  panel.classList.toggle('hidden', !replayMoments.length);
  for (const [index, moment] of replayMoments.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.replayMoment = String(index);
    button.setAttribute('aria-label', `Jump near ${clockText(moment.tick * SOLO_STEP_SECONDS)}: ${moment.title}`);
    button.append(createTextElement('b', '', clockText(moment.tick * SOLO_STEP_SECONDS)),
      createTextElement('span', '', moment.title));
    list.append(button);
  }
}
function updateReplayControls() {
  if (!replayMode || !activePlayback) return;
  const ratio = activePlayback.completedTicks ? activePlayback.tick / activePlayback.completedTicks : 1;
  $('#replay-time').textContent = `${clockText(activePlayback.tick * SOLO_STEP_SECONDS)} / ${clockText(activePlayback.completedTicks * SOLO_STEP_SECONDS)}`;
  const track = $('#replay-track');
  track.max = String(activePlayback.completedTicks);
  track.value = String(replaySeekTarget ?? activePlayback.tick);
  track.setAttribute('aria-valuetext', `${clockText(Number(track.value) * SOLO_STEP_SECONDS)} of ${clockText(activePlayback.completedTicks * SOLO_STEP_SECONDS)}`);
  track.style.setProperty('--replay-progress', `${Math.round(ratio * 1000) / 10}%`);
  $('#replay-toggle').textContent = activePlayback.finished ? 'COMPLETE' : paused ? 'PLAY' : 'PAUSE';
  $('#replay-toggle').disabled = activePlayback.finished;
  $('#replay-speed').textContent = `${replaySpeed}× SPEED`;
}
function requestReplaySeek() {
  if (!replayMode || !activePlayback) return;
  clearPendingFieldAbility();
  const track = $('#replay-track');
  replaySeekTarget = Math.max(0, Math.min(activePlayback.completedTicks, Number(track.value) || 0));
  refreshFrameRateReadout();
  if (!paused) paused = true;
  replayAccumulator = 0;
  track.setAttribute('aria-valuetext', `${clockText(replaySeekTarget * SOLO_STEP_SECONDS)} of ${clockText(activePlayback.completedTicks * SOLO_STEP_SECONDS)}`);
  $('#replay-seek-status').textContent = `SEEKING TO ${clockText(replaySeekTarget * SOLO_STEP_SECONDS)}`;
  updateReplayControls();
  lastTime = performance.now();
}
async function watchLastReplay() {
  if (gameStarting) return;
  const entry = replayArchive()[0];
  const record = entry?.replay || lastReplay();
  if (!record) { updateReplayAvailability(); toast('NO COMPLETE BATTLE REPLAY', true); return; }
  await watchReplayRecord(record, entry?.metadata);
}
async function watchReplayRecord(record, metadata = null) {
  resetProductionRepeatControls();
  if (gameStarting) return;
  clearPendingFieldAbility();
  gameStarting = true;
  selectionRoster.reset();
  setBattlefieldPickerOpen(false);
  try {
    const playback = createSoloPlayback(record.envelope, record.commands, record.completedTicks, record.version);
    abandonActiveRun();
    await ensureRenderer();
    activePlayback = playback;
    replayMode = true;
    syncTargetingFocus();
    replayMoments = selectReplayMoments(metadata?.moments, record.completedTicks);
    renderReplayMoments();
    replaySpeed = 1;
    replayAccumulator = 0;
    replaySeekTarget = null;
    $('#replay-seek-status').textContent = '';
    game = playback.game;
    currentMode = record.envelope.mode;
    difficulty = record.envelope.difficulty;
    faction = record.envelope.faction;
    missionIndex = currentMode === 'campaign' ? CAMPAIGN_MISSIONS.findIndex(m => m.id === record.envelope.scenarioId) : 0;
    if(currentMode==='campaign'){
      campaignDoctrineId=record.envelope.doctrineId||'standard';
      campaignFieldOrderId=record.envelope.fieldOrderId||'none';
      campaignCarryoverId=record.envelope.carryoverId||'none';
      campaignSupplyId=record.envelope.supplyId||'none';
      campaignRoutePayoffId=record.envelope.routePayoffId||'none';
    }
    if (currentMode === 'skirmish') { setSkirmishMap(game.mapId); setSkirmishOpening(game.skirmishOpening); setSkirmishVictoryMode(record.envelope.victoryMode||game.victoryMode||'dominion'); }
    gameSeconds = 0;
    musicCombat = 0;
    groups = {};
    gameEnded = false;
    paused = false;
    playing = true;
    placeId = null; placementToken++; placementPending = false;
    attackMoveMode = false;
    cancelDigInTargeting();
    setRoutePlanMode(false);
    commandAbilityMode = null; commandAbilityToken++; commandAbilityPending = false;
    lastProductionSignature = '';
    campaignGuidanceKey = '';
    $('#toast-container').replaceChildren();
    closeTrackedDialog('#leaderboard-modal', false);
    closeTrackedDialog('#setup', false);
    hide('#menu'); hide('#campaign-select'); hide('#pause-modal'); hide('#end-modal');
    setMobileRadarOpen(false);
    show('#game-shell'); show('#replay-controls');
    $('#game-shell').classList.add('replay-mode');
    $('#multiplayer-status').classList.add('hidden');
    $('#save-game').classList.add('hidden'); $('#load-game').classList.add('hidden'); $('#restart-game').classList.add('hidden');
    $('.operation-name strong').textContent = `REPLAY · ${game.mission?.title?.toUpperCase() || SKIRMISH_MAPS.find(m => m.id === game.mapId)?.name?.toUpperCase() || 'CRYSTAL FRONT'}${currentMode==='campaign'?` · ${CAMPAIGN_DOCTRINES.find(item=>item.id===campaignDoctrineId)?.name?.toUpperCase()||'STANDARD'}`:''}${record.version<SOLO_REPLAY_VERSION?' · LEGACY RULES':''}`;
    $('#objective-text').textContent = objectiveLabel();
    resetCommandDeckForOperation();
    resizeCanvases(); centerOnBase(); updateUI(true); updateReplayControls();
    toast('BATTLE REPLAY · CAMERA AND SPEED CONTROLS ACTIVE');
    audio.play('confirm'); audio.startAmbient();
    lastTime = performance.now();
  } catch (error) {
    console.warn('Battle replay could not be opened.', error);
    toast('BATTLE REPLAY UNAVAILABLE', true);
  } finally { gameStarting = false; }
}
function resultMessage(result, success = '', cue = 'order', callbacks = {}) {
  if (result?.ok === false) { toast(result.reason || 'Command unavailable', true); audio.play('error'); }
  else if(result?.pending&&result.acknowledgement){
    result.acknowledgement.then(ack=>{
      if(!ack?.ok){
        toast(ack?.transportFailure?'Order confirmation was lost. Check the battlefield before retrying.':ack?.reason||'Order was not accepted by the server.',true);
        audio.play('error');
        callbacks.onSettled?.(ack);
        return;
      }
      if(success)toast(success);
      audio.play(cue);
      if(game&&playing)updateSelectionCard();
      callbacks.onAccepted?.(ack);
      callbacks.onSettled?.(ack);
    });
  }
  else { if (success) toast(success); audio.play(cue); }
  if(!result?.pending&&game&&playing)updateSelectionCard();
  return result?.ok !== false;
}
function clearPendingFieldAbility(){
  fieldAbilityContextToken++;
  pendingFieldAbility=null;
  for(const lock of fieldAbilityLocks.values())clearTimeout(lock.timer);
  fieldAbilityLocks.clear();
}
function fieldAbilityStateIsApplied(unit,abilityId,time){
  const activeUntil=abilityId==='brace'?unit?.braceUntil:unit?.ghostRunUntil;
  return (activeUntil||0)>time||(Number(unit?.abilityCooldown)||0)>0;
}
function reconcileFieldAbilityLocks(){
  if(!game)return;
  const time=game.time||0;
  const units=new Map((game.units||[]).map(unit=>[unit.id,unit]));
  for(const [id,lock] of fieldAbilityLocks){
    const unit=units.get(id);
    if(unit&&fieldAbilityStateIsApplied(unit,lock.abilityId,time)){
      clearTimeout(lock.timer);
      fieldAbilityLocks.delete(id);
    }
  }
}
function lockFieldAbilityIds(ids,abilityId){
  reconcileFieldAbilityLocks();
  const units=new Map((game?.units||[]).map(unit=>[unit.id,unit]));
  for(const id of ids||[]){
    const unit=units.get(id);
    if(!unit||fieldAbilityStateIsApplied(unit,abilityId,game?.time||0))continue;
    const lock={abilityId,timer:null};
    lock.timer=setTimeout(()=>{
      if(fieldAbilityLocks.get(id)!==lock)return;
      fieldAbilityLocks.delete(id);
      if(game&&playing)updateSelectionCard();
    },1000);
    fieldAbilityLocks.set(id,lock);
  }
}
function definitionMap(kind) {
  const definitions=kind==='structures'?(game?.buildingDefs||{}):(game?.unitDefs||{});
  if(kind==='structures'&&definitions.bunker&&!garrisonRulesInGame()){
    const visible={...definitions};delete visible.bunker;return visible;
  }
  return definitions;
}
function selectedObjects() {
  if (!game) return [];
  const ids = new Set(game.selection || []);
  return [...game.units, ...game.buildings].filter(o => ids.has(o.id) && !o.embarkedIn);
}
function fieldRepairRulesInGame(){
  return !!game&&!replayMode&&(game.replayVersion==null||game.replayVersion>=85)&&
    typeof game.issueFieldRepair==='function'&&typeof game.issueRefillRepairKits==='function';
}
function fieldRepairPatient(target){
  const def=game?.unitDefs?.[target?.defId];
  return fieldRepairRulesInGame()&&target?.owner==='player'&&target.hp>0&&target.hp<target.maxHp&&
    !target.embarkedIn&&!('w' in target)&&!def?.flying&&['light','heavy'].includes(def?.armor);
}
function engineerEscortRulesInGame(){
  return !!game&&(game.replayVersion==null||game.replayVersion>=ENGINEER_ESCORT_RULES_VERSION);
}
function engineerEscortVehicle(target){
  const def=game?.unitDefs?.[target?.defId];
  return engineerEscortRulesInGame()&&target?.owner==='player'&&target.hp>0&&!target.embarkedIn&&
    !('w' in target)&&!def?.flying&&['light','heavy'].includes(def?.armor);
}
function engineerStructureTarget(target){
  if(!target||!('w' in target))return false;
  if(game?.bridges?.includes(target))return !!target.destroyed;
  return target.hp>0&&(target.owner==='player'?target.hp<target.maxHp:
    target.hp<=target.maxHp*0.75&&!(target.defId==='bunker'&&target.garrisonIds?.length));
}
function selectedKitEngineers(){
  return fieldRepairRulesInGame()?selectedObjects().filter(unit=>unit.defId==='engineer'&&unit.owner==='player'&&unit.hp>0):[];
}
function reverseMoveUnits(units=selectedObjects()) {
  if(!game||game.replayVersion!=null&&game.replayVersion<61)return [];
  return units.filter(unit=>{
    const def=game.unitDefs?.[unit.defId];
    return unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn&&def?.weapon&&
      !def.flying&&['light','heavy'].includes(def.armor);
  });
}
function battlefieldPickerIsOpen() { return !$('#battlefield-picker-panel').classList.contains('hidden'); }
function updateBattlefieldPickerAddSquadControl() {
  const button=$('#battlefield-picker-add-squad');
  button.closest('.battlefield-picker-squad-tools').classList.toggle('hidden',['board','bunkerAttack','rally','follow','engineer'].includes(attackMoveMode));
  button.classList.toggle('active',battlefieldPickerAddSquadMode);
  button.setAttribute('aria-pressed',String(battlefieldPickerAddSquadMode));
  button.disabled=!game||!playing||paused||replayMode;
}
function setBattlefieldPickerAddSquadMode(enabled) {
  battlefieldPickerAddSquadMode=!!enabled&&!!game&&playing&&!paused&&!replayMode&&battlefieldPickerIsOpen();
  updateBattlefieldPickerAddSquadControl();
}
function lastSeenHostileContacts() {
  return currentMode === 'skirmish' && game?.victoryMode === 'elimination'
    ? game.getLastSeenHostileUnits?.() || [] : [];
}
function updateBattlefieldPickerIntelBadge(contacts = lastSeenHostileContacts()) {
  const toggle = $('#battlefield-picker-toggle');
  const count = contacts.length;
  toggle.classList.toggle('has-stale-intel', count > 0);
  toggle.textContent = count ? `OBJECTS · ${count} LAST` : 'OBJECTS · O ⌄';
  toggle.title = count
    ? `${count} unconfirmed last-seen enemy ${count === 1 ? 'contact' : 'contacts'}. Open the object list to inspect and scout.`
    : 'Find visible objects (O)';
  toggle.setAttribute('aria-label', `${battlefieldPickerIsOpen() ? 'Close' : 'Open'} battlefield object list${count
    ? `. ${count} unconfirmed last-seen enemy ${count === 1 ? 'contact' : 'contacts'}.` : '.'}`);
}
function recommissionRulesAvailable() {
  return !replayMode && (game?.replayVersion == null || game.replayVersion >= 72) &&
    typeof game?.canRecommissionWreck === 'function' &&
    typeof game?.issueRecommissionWreck === 'function';
}
function recommissionWreckCheck(wreck) {
  if (!wreck || !game) return { ok: false, reason: 'Wreck unavailable.' };
  if (replayMode || game.replayVersion != null && game.replayVersion < 72)
    return { ok: false, reason: 'Start a new battle to recommission wrecks.' };
  if (typeof game.canRecommissionWreck !== 'function')
    return { ok: false, reason: 'Recommissioning is unavailable in this battle.' };
  return game.canRecommissionWreck(wreck.id) || { ok: false, reason: 'Recommissioning unavailable.' };
}
function battlefieldPickerObjects(contacts = lastSeenHostileContacts()) {
  if (!game) return [];
  const visible = entity => entity.owner === 'player' ||
    (fogAt(entity.x + (entity.w || 0) / 2, entity.y + (entity.h || 0) / 2) === 2 && game.isVisible(entity));
  const entries = [];
  for (const unit of game.units) if (unit.hp > 0 && !unit.embarkedIn && visible(unit)) {
    const friendly = unit.owner === 'player';
    const name = game.unitDefs?.[unit.defId]?.name || keyName(unit.defId);
    const health = `${Math.max(0, Math.round(unit.hp / Math.max(1, unit.maxHp) * 100))}% health`;
    const sector = `${Math.floor(unit.x)},${Math.floor(unit.y)}`;
    entries.push({ key: `unit:${unit.id}`, entity: unit, friendly,
      label: `${friendly ? 'Friendly' : 'Enemy'} ${name} · ${health} · ${sector}`,
      ariaLabel: `${friendly ? 'Select friendly' : 'Center camera on visible enemy'} ${name} at sector ${sector}, ${health}` });
  }
  for (const building of game.buildings) if (building.hp > 0 && visible(building)) {
    const friendly = building.owner === 'player';
    const name = game.buildingDefs?.[building.defId]?.name || keyName(building.defId);
    const health = `${Math.max(0, Math.round(building.hp / Math.max(1, building.maxHp) * 100))}% health`;
    const sector = buildingSectorLabel(building);
    const bunker=building.defId==='bunker'&&friendly&&garrisonRulesInGame();
    const bunkerCapacity=building.garrisonCapacity||game.buildingDefs?.bunker?.garrisonCapacity||3;
    const crew=bunker?` · ${bunkerOccupants(building).length}/${bunkerCapacity} GARRISONED`:'';
    entries.push({ key: `building:${building.id}`, entity: building, friendly,
      label: `${friendly ? 'Friendly' : 'Enemy'} ${name} · ${health}${crew} · ${sector}`,
      ariaLabel: `${friendly ? 'Select friendly' : 'Center camera on visible enemy'} ${name} at sector ${sector}, ${health}${crew}` });
  }
  for (const wreck of game.wrecks || []) if (wreck.expiresAt > game.time && fogAt(wreck.x, wreck.y) === 2) {
    const factionName = wreck.faction === 'vesper' ? 'Vesper' : 'Aegis';
    const sector = `${Math.floor(wreck.x)},${Math.floor(wreck.y)}`;
    const secondsLeft = Math.ceil(wreck.expiresAt - game.time);
    const recommission = recommissionWreckCheck(wreck);
    const restoreDefId = recommission.defId || wreck.restoreDefId;
    const restoreName = UNIT_DEFS[restoreDefId]?.name || (restoreDefId ? keyName(restoreDefId) : 'UNKNOWN CHASSIS');
    const legacyRules = replayMode || game.replayVersion != null && game.replayVersion < 72;
    const restoreMeta = legacyRules
      ? ' · recommission unavailable · start a new battle'
      : restoreDefId
        ? ` · ${restoreName} · ${fmt(recommission.cost)} credits · ${recommission.seconds}s · ${recommission.ok ? 'ready' : recommission.reason || 'unavailable'}`
        : ' · chassis not eligible for recommission';
    entries.push({ key: `wreck:${wreck.id}`, wreck,
      recommission,
      label: wreck.campaignFreightCache ? `Freight cache · ${wreck.value} credits · ${sector}` : `${factionName} wreck · ${wreck.value} salvage${restoreMeta} · ${secondsLeft}s left · ${sector}`,
      ariaLabel: wreck.campaignFreightCache ? `Freight cache at sector ${sector}, worth ${wreck.value} credits. Center camera or order an Engineer to recover it.` : `Visible ${factionName} wreck${restoreMeta}, at sector ${sector}, worth ${wreck.value} salvage credits, ${secondsLeft} seconds before it expires.` });
  }
  const intelEntries = [];
  for (const contact of contacts) {
    const name = game.unitDefs?.[contact.defId]?.name || keyName(contact.defId);
    const sector = `${Math.floor(contact.x)},${Math.floor(contact.y)}`;
    const age = Math.max(0, Math.floor(game.time - contact.lastSeenAt));
    intelEntries.push({ key: `last-seen:${contact.entityId}`, intel: contact,
      label: `LAST SEEN · ${name} · ${sector} · ${age}s ago`,
      ariaLabel: `Last seen ${name} at sector ${sector}, ${age} seconds ago. Unconfirmed; it may have moved or been destroyed. Center camera to scout.` });
  }
  if(attackMoveMode==='board')return entries.filter(entry=>entry.friendly&&
    (isTroopCarrier(entry.entity)||isFriendlyFieldBunker(entry.entity)&&selectedObjects().some(isBunkerEligibleInfantry))).map(entry=>({...entry,
      ariaLabel:`Board ${entry.ariaLabel.replace(/^Select friendly /,'')}`}));
  if(attackMoveMode==='bunkerAttack')return entries.filter(entry=>entry.entity?.owner==='enemy')
    .map(entry=>({...entry,ariaLabel:`Target ${entry.ariaLabel.replace(/^Center camera on visible enemy /,'')}`}));
  if(attackMoveMode==='follow')return entries.filter(entry=>isFriendlyFollowTarget(entry.entity))
    .map(entry=>({...entry,ariaLabel:`${engineerEscortVehicle(entry.entity)&&selectedObjects().some(unit=>unit.defId==='engineer')?'Escort and patch':'Escort'} ${entry.ariaLabel.replace(/^Select friendly /,'')}`}));
  if(attackMoveMode==='engineer')return entries.filter(entry=>entry.wreck||
    engineerStructureTarget(entry.entity)||fieldRepairPatient(entry.entity)).map(entry=>({...entry,
      ariaLabel:fieldRepairPatient(entry.entity)?`Patch ${entry.ariaLabel.replace(/^Select friendly /,'')}`:
        `Engineer task: ${entry.ariaLabel}`}));
  if(attackMoveMode==='rally'&&mobileRallyAvailable())return entries.filter(entry=>isFriendlyRallyUnit(entry.entity))
    .map(entry=>({...entry,ariaLabel:`Rally reinforcements to ${entry.ariaLabel.replace(/^Select friendly /,'')}`}));
  return [...intelEntries, ...entries];
}
function renderBattlefieldPicker() {
  if (!battlefieldPickerIsOpen()) return;
  updateBattlefieldPickerAddSquadControl();
  const list = $('#battlefield-picker-list');
  const contacts = lastSeenHostileContacts();
  const entries = battlefieldPickerObjects(contacts);
  const existing = new Map([...list.querySelectorAll('[data-battlefield-object]')]
    .map(button => [button.dataset.battlefieldObject, button]));
  const focused = document.activeElement?.dataset?.battlefieldObject;
  let removedFocused = false;
  for (const [key, button] of existing) if (!entries.some(entry => entry.key === key)) {
    if (key === focused) removedFocused = true;
    button.closest('li')?.remove();
    existing.delete(key);
  }
  const desired = [];
  for (const entry of entries) {
    let button = existing.get(entry.key);
    if (!button) {
      button = createTextElement('button', 'battlefield-object-option', entry.label);
      button.type = 'button';
      button.dataset.battlefieldObject = entry.key;
      const row = document.createElement('li'); row.append(button); list.append(row);
    }
    button.textContent = entry.label;
    button.setAttribute('aria-label', entry.ariaLabel);
    button.classList.toggle('is-last-seen', !!entry.intel);
    button.classList.toggle('is-recommission-target', attackMoveMode==='recommissionWreck'&&!!entry.wreck);
    const selected=!!entry.friendly&&game.selection?.includes(entry.entity?.id);
    if (selected) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
    if(entry.friendly)button.setAttribute('aria-pressed',String(selected));
    else button.removeAttribute('aria-pressed');
    desired.push(button);
  }
  desired.forEach((button, index) => {
    const current = list.children[index]?.firstElementChild;
    if (current !== button) list.insertBefore(button.closest('li'), list.children[index] || null);
  });
  const boarding=attackMoveMode==='board', bunkerAttack=attackMoveMode==='bunkerAttack';
  const rallying=attackMoveMode==='rally'&&mobileRallyAvailable(), following=attackMoveMode==='follow', engineering=attackMoveMode==='engineer';
  $('#battlefield-picker-empty').classList.toggle('hidden', entries.length > 0);
  $('#battlefield-picker-empty').textContent=boarding?'No completed friendly carriers or Field Bunkers.':
    bunkerAttack?'No enemy targets in current sight.':rallying?'No friendly rally units. Choose a fixed point on the battlefield.':following?'No other friendly units or structures to escort.':engineering?'No damaged friendly vehicles, wrecks, bridges, or structures in view.':'No friendly forces or visible objects.';
  $('#battlefield-picker-panel .battlefield-picker-heading strong').textContent = boarding?
    'CHOOSE CARRIER OR FIELD BUNKER':bunkerAttack?'CHOOSE VISIBLE ENEMY TARGET':rallying?'CHOOSE FRIENDLY RALLY UNIT':following?'CHOOSE FRIENDLY ESCORT TARGET':engineering?'CHOOSE ENGINEER TASK':contacts.length
      ? 'OBJECTS & LAST-SEEN INTEL' : 'VISIBLE OBJECTS';
  updateBattlefieldPickerIntelBadge(contacts);
  if (removedFocused) (list.querySelector('button') || $('#battlefield-picker-toggle')).focus();
}
function setBattlefieldPickerOpen(open, { focusFirst = false, restoreFocus = false } = {}) {
  const panel = $('#battlefield-picker-panel'), toggle = $('#battlefield-picker-toggle');
  if(!open)setBattlefieldPickerAddSquadMode(false);
  panel.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
  updateBattlefieldPickerIntelBadge();
  if (open) {
    $('#battlefield-picker-status').textContent = '';
    renderBattlefieldPicker();
    if (focusFirst) ($('#battlefield-picker-list').querySelector('button') || toggle).focus();
  } else if (restoreFocus) toggle.focus();
}
function activateBattlefieldObject(key, { additive = false } = {}) {
  const entry = battlefieldPickerObjects().find(item => item.key === key);
  if (!entry) { renderBattlefieldPicker(); return; }
  const x = entry.intel?.x ?? (entry.wreck ? entry.wreck.x : entry.entity.x + (entry.entity.w || 0) / 2);
  const y = entry.intel?.y ?? (entry.wreck ? entry.wreck.y : entry.entity.y + (entry.entity.h || 0) / 2);
  centerCamera(x, y);
  if (replayMode) {
    $('#battlefield-picker-status').textContent = `${entry.label}. Replay view centered.`;
    renderBattlefieldPicker();
    return;
  }
  if (attackMoveMode === 'assignRefinery') {
    issueAssignRefineryTarget(entry.entity);
    renderBattlefieldPicker();
    return;
  }
  if(['board','bunkerAttack','rally','follow','engineer'].includes(attackMoveMode)){
    issueTargetOrder(x,y,false,entry.wreck||entry.entity);
    renderBattlefieldPicker();
    return;
  }
  if (entry.friendly) {
    const additiveUnit=additive||battlefieldPickerAddSquadMode;
    if(additiveUnit&&entry.entity&&!('w' in entry.entity)){
      const selectable=(game.selection||[]).filter(id=>{
        const selected=game.getEntity(id);
        return selected?.owner==='player'&&selected.hp>0&&!selected.embarkedIn&&!('w' in selected);
      });
      const selected=new Set(selectable);
      const wasSelected=selected.has(entry.entity.id);
      if(wasSelected)selected.delete(entry.entity.id);
      else selected.add(entry.entity.id);
      game.select([...selected]);
      $('#battlefield-picker-status').textContent=`${entry.label} ${wasSelected?'removed from':'added to'} the squad selection.`;
    }else{
      game.select([entry.entity.id]);
      $('#battlefield-picker-status').textContent = `${entry.label} selected and centered.`;
    }
    updateSelectionCard();
  } else if (entry.intel) {
    $('#battlefield-picker-status').textContent = `Last sighting at sector ${Math.floor(entry.intel.x)},${Math.floor(entry.intel.y)}. Scout to confirm; the unit may have moved or been destroyed.`;
  } else if (entry.wreck) {
    if (attackMoveMode === 'recommissionWreck') {
      issueRecommissionWreckTarget(entry.wreck);
    } else if (selectedObjects().some(object => object.defId === 'engineer')) {
      const result = game.issueRecoverWreck(entry.wreck.id);
      const accepted = resultMessage(result, 'WRECK RECOVERY ORDERED');
      $('#battlefield-picker-status').textContent = accepted ? 'Engineer recovery order sent.' : result.reason;
    } else $('#battlefield-picker-status').textContent = `${entry.label}. Select an Engineer, then choose this wreck or press R and choose it.`;
  } else {
    $('#battlefield-picker-status').textContent = `${entry.label}. Centered in live view.`;
  }
  renderBattlefieldPicker();
}
function harvesterHomeRulesAvailable() {
  return !!game && !replayMode &&
    (game.replayVersion == null || game.replayVersion >= HARVESTER_HOME_RULES_VERSION) &&
    typeof game.issueAssignRefinery === 'function';
}
function isHarvesterHomeSelection(objects = selectedObjects()) {
  return objects.length > 0 && objects.every(object => !('w' in object) &&
    object.owner === 'player' && object.hp > 0 && object.defId === 'harvester') &&
    harvesterHomeRulesAvailable();
}
function isCompletedFriendlyRefinery(entity) {
  return !!entity && 'w' in entity && entity.owner === 'player' && entity.defId === 'refinery' &&
    entity.hp > 0 && entity.progress >= 1;
}
function buildingSectorLabel(building) {
  return `${Math.floor(building.x + building.w / 2)},${Math.floor(building.y + building.h / 2)}`;
}
function issueAssignRefineryTarget(refinery) {
  if (targetOrderPending) return false;
  if (!isHarvesterHomeSelection()) {
    toast('SELECT ONLY YOUR HARVESTERS', true);
    return false;
  }
  if (!isCompletedFriendlyRefinery(refinery)) {
    toast('CHOOSE A COMPLETED FRIENDLY REFINERY', true);
    if (battlefieldPickerIsOpen()) $('#battlefield-picker-status').textContent = 'Choose a completed friendly Refinery.';
    return false;
  }
  const token = targetOrderToken;
  const result = game.issueAssignRefinery(refinery.id);
  const finish = accepted => {
    if (!accepted || targetOrderToken !== token || attackMoveMode && attackMoveMode !== 'assignRefinery') return;
    if(attackMoveMode==='assignRefinery')attackMoveMode = false;
    targetOrderPending = false;
    hide('#attack-hint');
    updateAttackMoveButton();
    syncTargetingFocus();
    updateSelectionCard();
    if (battlefieldPickerIsOpen()) $('#battlefield-picker-status').textContent =
      `Home Refinery set to sector ${buildingSectorLabel(refinery)}. Loaded cargo unloads there, then harvesting continues.`;
  };
  if (result?.pending) {
    if(attackMoveMode!=='assignRefinery'){
      attackMoveMode='assignRefinery';
      updateAttackMoveButton();
      syncTargetingFocus();
    }
    targetOrderPending = true;
    $('#attack-hint').innerHTML = `HOME REFINERY · WAITING FOR SERVER CONFIRMATION${targetingCancelCopy()}`;
    show('#attack-hint');
    resultMessage(result, 'HOME REFINERY ASSIGNED', 'order', {
      onAccepted: () => finish(true),
      onSettled: ack => {
        if (targetOrderToken !== token || attackMoveMode !== 'assignRefinery') return;
        targetOrderPending = false;
        if (ack?.transportFailure) {
          attackMoveMode = false;
          hide('#attack-hint');
          updateAttackMoveButton();
          syncTargetingFocus();
        } else if (!ack?.ok) $('#attack-hint').innerHTML = `HOME REFINERY · ORDER REJECTED · SELECT REFINERY${targetingCancelCopy()}`;
      }
    });
    return true;
  }
  finish(resultMessage(result, 'HOME REFINERY ASSIGNED · LOADED CARGO UNLOADS, THEN HARVESTING CONTINUES'));
  return !!result?.ok;
}
function activateRepairCommand() {
  const selected=selectedObjects();
  if(isHarvesterHomeSelection(selected)){
    startTargetOrder('assignRefinery','HOME REFINERY','SELECT COMPLETED FRIENDLY REFINERY');
    return;
  }
  const b=selectedBuilding();
  if(b){const stopping=!!b.repairing;resultMessage(game.toggleRepair(b.id),stopping?'REPAIR STOPPED':'REPAIR ORDERED');updateUI(true);return;}
  if(selected.some(o=>o.defId==='engineer')){startTargetOrder('engineer','ENGINEER TASK',fieldRepairRulesInGame()?'SELECT DAMAGED VEHICLE, WRECK, BRIDGE, OR STRUCTURE':'SELECT WRECK, BRIDGE, OR STRUCTURE');return;}
  toast('SELECT A STRUCTURE OR ENGINEER',true);
}
function activateGuardCommand() {
  const selected=selectedObjects();
  if(isHarvesterHomeSelection(selected)&&selected.some(unit=>unit.homeRefineryId!=null)){
    resultMessage(game.issueAssignRefinery(null),'AUTO DOCK RESTORED · HOME REFINERY CLEARED');
    updateSelectionCard();
    return;
  }
  resultMessage(game?.issueGuard?.(),'GUARD POSITION SET');
}
function selectedBuilding() { return selectedObjects().find(o => 'w' in o && o.owner === 'player'); }
function medicEscortRulesInGame(){
  return !!game&&(game.replayVersion==null||game.replayVersion>=MEDIC_ESCORT_RULES_VERSION);
}
function isFriendlyFollowTarget(target){
  return !!target&&target.owner==='player'&&target.hp>0&&!target.embarkedIn&&
    !(game.selection||[]).includes(target.id);
}
function medicEscortPatient(target){
  return medicEscortRulesInGame()&&target?.owner==='player'&&target.hp>0&&!target.embarkedIn&&
    !('w' in target)&&game.unitDefs?.[target.defId]?.armor==='infantry';
}
function escortFeedback(target){
  if(engineerEscortVehicle(target)&&selectedObjects().some(unit=>unit.defId==='engineer'))
    return 'ENGINEER ESCORT SET · STOP VEHICLE TO USE CARRIED KITS';
  return medicEscortPatient(target)&&selectedObjects().some(unit=>unit.defId==='medic')
    ?'ESCORT ORDERED · MEDIC TRIAGE PRIORITY':'ESCORT ORDERED';
}
function startFollowOrder(){
  const selected=selectedObjects();
  const engineerOnly=engineerEscortRulesInGame()&&selected.length&&selected.every(unit=>unit.defId==='engineer');
  startTargetOrder('follow',engineerOnly?'ENGINEER ESCORT':'FOLLOW',engineerOnly?'SELECT FRIENDLY GROUND VEHICLE · STOP TO PATCH':'SELECT FRIENDLY TARGET');
}
function mobileRallyAvailable(){
  return !!game&&!replayMode&&(game.replayVersion==null||game.replayVersion>=MOBILE_RALLY_RULES_VERSION)&&
    typeof game.setRallyTarget==='function';
}
function isFriendlyRallyUnit(unit){
  return !!unit&&!('w' in unit)&&unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn&&
    game.unitDefs?.[unit.defId]?.speed>0;
}
function productionRallyUnit(building){
  if(!building?.rallyTargetId||game.replayVersion!=null&&game.replayVersion<MOBILE_RALLY_RULES_VERSION)return null;
  const unit=game.getEntity(building.rallyTargetId);
  return isFriendlyRallyUnit(unit)?unit:null;
}
function productionRallyOrder(building,x,y,target){
  return mobileRallyAvailable()&&isFriendlyRallyUnit(target)
    ?game.setRallyTarget(building.id,target.id):game.setRally(building.id,x,y);
}
function garrisonRulesInGame() {
  return !!game&&(game.replayVersion==null||game.replayVersion>=GARRISON_RULES_VERSION)&&!!game.buildingDefs?.bunker;
}
function garrisonRulesAvailable() {
  return garrisonRulesInGame()&&!replayMode&&
    typeof game.issueGarrison==='function'&&typeof game.issueEvacuateGarrison==='function';
}
function isFriendlyFieldBunker(building,completed=true) {
  return !!building&&'w' in building&&building.owner==='player'&&building.defId==='bunker'&&
    building.hp>0&&(!completed||building.progress>=1)&&garrisonRulesInGame();
}
function selectedFieldBunker() {
  const selected=selectedObjects();
  return selected.length===1&&isFriendlyFieldBunker(selected[0])?selected[0]:null;
}
function bunkerOccupants(building) {
  return (building?.garrisonIds||[]).map(id=>game.getEntity?.(id)||game.units.find(unit=>unit.id===id))
    .filter(unit=>unit&&unit.hp>0&&unit.owner===building.owner&&unit.embarkedIn===building.id);
}
function bunkerIncomingUnits(building) {
  return (game?.units||[]).filter(unit=>unit.owner===building.owner&&unit.hp>0&&!unit.embarkedIn&&
    unit.order?.type==='garrison'&&unit.order.bunkerId===building.id);
}
function isBunkerEligibleInfantry(unit) {
  return !!unit&&!('w' in unit)&&unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn&&
    ['scout','rifle','rocket','flamer'].includes(unit.defId)&&game.unitDefs?.[unit.defId]?.armor==='infantry';
}
function issueBunkerCommand(buildingId,action) {
  if(!game||paused||gameEnded||!garrisonRulesAvailable()||pendingBunkerCommands.has(buildingId))return;
  const building=game.getEntity?.(buildingId);
  if(!isFriendlyFieldBunker(building)){toast('FIELD BUNKER NO LONGER AVAILABLE',true);return;}
  const method=action==='evacuate'?'issueEvacuateGarrison':'issueGarrison';
  const result=game[method](buildingId);
  const success=action==='evacuate'?'EVACUATION ORDERED':'INFANTRY ENTERING FIELD BUNKER';
  if(result?.pending){
    const token=Symbol(`bunker-${action}`);
    pendingBunkerCommands.set(buildingId,token);
    updateSelectionCard();
    resultMessage(result,'','order',{
      onAccepted:()=>updateSelectionCard(),
      onSettled:()=>{
        if(pendingBunkerCommands.get(buildingId)!==token)return;
        pendingBunkerCommands.delete(buildingId);
        updateUI(true);
      },
    });
  }else if(resultMessage(result,success))updateUI(true);
}
function selectedProductionBuilding() {
  const selected=selectedObjects();
  const building=selected.length===1?selected[0]:null;
  return building?.owner==='player'&&building.hp>0&&building.progress>=1&&
    ['barracks','factory','helipad'].includes(building.defId)?building:null;
}
function selectedProductionSite() {
  return game&&(game.replayVersion==null||game.replayVersion>=PRODUCTION_SITE_RULES_VERSION)
    ?selectedProductionBuilding():null;
}
function unitProductionView(id,def=game.unitDefs[id]) {
  const site=selectedProductionSite();
  const producers=site?[site]:game.buildings.filter(building=>building.owner==='player'&&
    building.hp>0&&building.defId===def.producer);
  const producer=producers.find(building=>building.queue?.some(item=>item.defId===id));
  const queueIndex=producer?.queue.findLastIndex(item=>item.defId===id)??-1;
  const queueCount=producers.reduce((count,building)=>count+(building.queue?.filter(item=>item.defId===id).length||0),0);
  const check=game.canQueueUnit(id);
  if(check.ok&&site&&!check.producers.some(building=>building.id===site.id))
    return {site,producer,queueIndex,queueCount,ok:false,reason:'Selected production site is unavailable.'};
  if(check.ok&&(site?site.queue.length>=5:check.producers.every(building=>building.queue.length>=5)))
    return {site,producer,queueIndex,queueCount,ok:false,reason:site?'Selected site queue is full.':'Production queues are full.'};
  return {site,producer,queueIndex,queueCount,ok:check.ok,reason:check.reason};
}
function isTroopCarrier(unit) {
  const def=game?.unitDefs?.[unit?.defId];
  return def?.role==='transport'&&Number(def.capacity)>0;
}
function cycleStance() {
  if(!game||!playing||paused||replayMode)return;
  const armed=selectedObjects().filter(unit=>!('w' in unit)&&unit.owner==='player'&&game.unitDefs?.[unit.defId]?.weapon);
  if(!armed.length)return;
  const stances=new Set(armed.map(unit=>unit.stance||'aggressive'));
  const current=stances.size===1?[...stances][0]:'mixed';
  const next=current==='aggressive'?'defensive':current==='defensive'?'holdFire':'aggressive';
  resultMessage(game.issueSetStance(next),`${STANCE_UI[next].name} STANCE`);
}
function targetPriorityUnits(units=selectedObjects()) {
  return units.filter(unit=>!('w' in unit)&&unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn&&
    game?.unitDefs?.[unit.defId]?.weapon);
}
function targetPriorityAvailable() {
  return !!game&&(game.replayVersion==null||game.replayVersion>=TARGET_PRIORITY_RULES_VERSION)&&
    typeof game.issueSetTargetPriority==='function';
}
function updateTargetPriorityControl(units) {
  const armed=targetPriorityUnits(units), control=$('#cmd-priority'), select=$('#target-priority-select');
  const available=targetPriorityAvailable()&&armed.length>0;
  control.classList.toggle('hidden',!available);
  if(!available)return false;
  const key=armed.map(unit=>unit.id).sort().join('|');
  const pending=pendingTargetPriority?.game===game&&pendingTargetPriority.key===key;
  const priorities=new Set(armed.map(unit=>unit.targetPriority||'auto'));
  const priority=pending?pendingTargetPriority.priority:priorities.size===1?[...priorities][0]:'mixed';
  select.disabled=paused||replayMode||!!pending;
  if(document.activeElement!==select||pending)select.value=priority;
  control.querySelector('span').textContent=pending?'WAIT…':'TARGETS ▾';
  control.classList.toggle('is-prioritized',priority!=='auto'&&priority!=='mixed');
  control.title=`Automatic targeting: ${TARGET_PRIORITY_UI[priority]||'AUTO'}. Favor this class when visible and engageable; other enemies remain valid. Direct Attack orders keep their target. Applies to ${armed.length} armed ${armed.length===1?'unit':'units'}.`;
  return true;
}
function setTargetPriority(priority) {
  if(!game||!playing||paused||replayMode||!targetPriorityAvailable()||!Object.hasOwn(TARGET_PRIORITY_UI,priority)||priority==='mixed')return;
  const armed=targetPriorityUnits();
  if(!armed.length)return;
  const result=game.issueSetTargetPriority(priority);
  if(result?.pending){
    const intent={game,key:armed.map(unit=>unit.id).sort().join('|'),priority};
    pendingTargetPriority=intent;
    updateSelectionCard();
    resultMessage(result,`TARGET PRIORITY · ${TARGET_PRIORITY_UI[priority]}`,'order',{onSettled:()=>{
      if(pendingTargetPriority===intent)pendingTargetPriority=null;
      updateSelectionCard();
    }});
  }else resultMessage(result,`TARGET PRIORITY · ${TARGET_PRIORITY_UI[priority]}`);
}
function cycleUnits() {
  if (!game) return;
  const units = game.units.filter(u => u.owner === 'player' && u.hp > 0 && !u.embarkedIn)
    .map((unit, index) => ({ unit, index }));
  const rank = unit => {
    const armed = !!game.unitDefs?.[unit.defId]?.weapon;
    const idle = !unit.order || unit.order.type === 'idle';
    return armed ? idle ? 0 : 1 : idle ? 2 : 3;
  };
  units.sort((a, b) => rank(a.unit) - rank(b.unit) || a.index - b.index);
  if (!units.length) return;
  const current = units.findIndex(({ unit }) => game.selection?.includes(unit.id));
  const next = units[(current + 1) % units.length].unit;
  game.select(next.id);
  centerCamera(next.x, next.y);
  updateSelectionCard();
  audio.play('select');
}
function keyName(id) { return String(id).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function teamColor(owner) { return TEAM[owner] || '#eeeecc'; }
function fmt(n) { return Math.floor(n || 0).toLocaleString(); }
function hash(x, y, n = 0) { let v = ((x * 374761393) ^ (y * 668265263) ^ (n * 1442695041)) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967295; }
function getCell(x, y) { return game?.terrain?.[Math.floor(y)]?.[Math.floor(x)]; }
function fogAt(x, y) { return game?.fog?.[Math.floor(y)]?.[Math.floor(x)] ?? 0; }

function setFaction(next) {
  faction = next;
  document.querySelectorAll('.faction-card').forEach(el => {
    const active = el.dataset.faction === next;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}
function setDifficulty(next) {
  difficulty = next;
  document.querySelectorAll('#difficulty-options button').forEach(el => {
    const active = el.dataset.difficulty === next;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}
const strategicMapImages = new Map();
function ensureStrategicMapPreviews() {
  if (strategicMapImages.size) return;
  for (const map of SKIRMISH_MAPS) {
    const source = document.createElement('canvas');
    source.width = 512; source.height = 384;
    drawStrategicMapPreview(source, new Game({ seed: 481516, mapId: map.id }));
    strategicMapImages.set(map.id, source);
    const thumbnail = document.querySelector(`#map-options [data-map="${map.id}"] canvas`);
    const context = thumbnail?.getContext('2d');
    if (context) {
      context.imageSmoothingEnabled = true;
      context.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
    }
  }
}
function setSkirmishMap(next) {
  if (!SKIRMISH_MAPS.some(map => map.id === next)) return;
  skirmishMap = next;
  updateSetupTacticNotes();
  document.querySelectorAll('#map-options button').forEach(el => {
    const active = el.dataset.map === next;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  $('#map-tactic-note')?.scrollIntoView({ block: 'nearest' });
}
function updateSetupTacticNotes() {
  ensureStrategicMapPreviews();
  const map = SKIRMISH_MAPS.find(item => item.id === skirmishMap);
  const mapNote = $('#map-tactic-note');
  const mapHeading = mapNote?.querySelector('strong');
  const mapCopy = mapNote?.querySelector('p');
  const mapDetail = mapNote?.querySelector('small');
  const mapMark = mapNote?.querySelector('.map-tactic-mark');
  const mapOptions = $('#map-options');
  if (mapNote && mapOptions && mapNote.parentElement === mapOptions.parentElement && mapOptions.nextElementSibling !== mapNote)
    mapOptions.after(mapNote);
  const deltaAirlift = skirmishMap === 'delta-crossing' && skirmishOpening === 'established';
  if (map) {
    const atlas = $('#map-atlas-preview');
    const image = strategicMapImages.get(map.id);
    if (atlas && image) {
      atlas.getContext('2d')?.drawImage(image, 0, 0, atlas.width, atlas.height);
      atlas.setAttribute('aria-label', `${map.name} sample route schematic showing starting positions, crystal fields, bridges, and three relays. Seeded routes and deposits may vary.`);
    }
    const intel = {
      'shard-valley': ['◈', 'CONTEST THE CENTRAL CRYSTAL', 'Open diagonal lanes leave room to flank, while the central crystal rewards an early, protected expansion.', 'FIELD READ · Secure a route to the center, then use scattered rock and water to screen your harvesters.'],
      'twin-passes': ['⫸', 'TWO PASSES · TWO FRONTS', 'A tall rock divide splits the crystal lanes and funnels ground forces through two crossings.', 'FIELD READ · Scout both approaches early. A reserve force can punish an opponent who commits everything to one pass.'],
      'delta-crossing': deltaAirlift
        ? ['✈', 'DELTA CROSSING · AIR INSERTION', 'Both forces start with an Airlift Dropship and nearby infantry. The flooded middle funnels ground armies through two bridges that can be demolished and rebuilt by engineers.', 'BRIDGE ORDERS · Select an armed unit and right-click a bridge to attack it. Select an engineer and right-click a destroyed bridge to rebuild from the bank. On touch, use Attack or Repair to target the bridge. Board the Dropship with L and unload with U. Ground forces on a collapsing span are lost.']
        : ['⟐', 'DELTA CROSSING · BRIDGE CONTROL', 'With a Command Rig opening, both forces must establish production before reaching the flooded middle. Its two bridges can be demolished and rebuilt by engineers.', 'FIELD READ · Deploy your rig, then contest both bridge approaches. Select an armed unit and right-click a bridge to attack it; an engineer can rebuild a destroyed span from the bank. Ground forces on a collapsing span are lost.'],
      'canyon-ring': ['⌁', 'CANYON RING · HOLD THE PASSES', 'A broken canyon spine circles the central basin, with northern and southern passages linking the bases.', 'FIELD READ · Watch both passages and avoid leaving your harvesters exposed while your main force rotates around the basin.'],
      'storm-basin': ['ϟ', 'STORM BASIN · CONTROL THE CAUSEWAYS', 'A broad storm scar divides the basin. Two crystal-rich causeways provide the main routes between bases.', 'FIELD READ · Contest the approaches and protect the crystal lanes that feed your expansion.'],
    }[map.id];
    if (mapMark) mapMark.textContent = intel[0];
    if (mapHeading) mapHeading.textContent = intel[1];
    if (mapCopy) mapCopy.textContent = intel[2];
    if (mapDetail) mapDetail.textContent = intel[3];
  }
  mapNote?.classList.toggle('hidden', !map);
  $('#opening-tactic-note')?.classList.toggle('hidden',skirmishOpening!=='command-rig');
  const rigNote=$('#opening-tactic-note p');
  if(rigNote)rigNote.textContent=skirmishVictoryMode==='elimination'
    ?'Press E to deploy. Build power, a Refinery, then production; keep the escort close while your economy opens.'
    :'Press E to deploy. Build power, a Refinery, then production; send the escort toward a relay early.';
}
function setSkirmishOpening(next) {
  skirmishOpening=next==='command-rig'?'command-rig':'established';
  document.querySelectorAll('#opening-options button').forEach(button=>{
    const active=button.dataset.opening===skirmishOpening;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  const deltaSummary=$('#map-options [data-map="delta-crossing"] small');
  if(deltaSummary)deltaSummary.textContent=skirmishOpening==='command-rig'
    ?'Flooded middle · breakable bridges':'Flooded middle · breakable bridges · airlift opening';
  updateSetupTacticNotes();
}
function setSkirmishVictoryMode(next) {
  skirmishVictoryMode=next==='elimination'?'elimination':'dominion';
  document.querySelectorAll('.victory-mode-option').forEach(button=>{
    const active=button.dataset.victoryMode===skirmishVictoryMode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  updateSetupTacticNotes();
}
function openSetup() { updateSetupTacticNotes(); openTrackedDialog('#setup'); }
function closeSetup() { closeTrackedDialog('#setup'); }
function openManual() { openTrackedDialog('#manual'); }
function closeManual() { closeTrackedDialog('#manual'); }
function openPowerGrid() {
  if (!game || replayMode) return;
  if (playing && !gameEnded && currentMode !== 'multiplayer' && !paused) {
    paused = true;
    powerGridAutoPaused = true;
    audio.stopAmbient();
    refreshFrameRateReadout();
  }
  powerGridSignature = '';
  renderPowerGrid();
  openTrackedDialog('#power-grid-modal');
}
function closePowerGrid() { closeTrackedDialog('#power-grid-modal'); }
function powerGridBuildings() {
  if (!game) return [];
  return game.buildings.filter(building => building.owner === 'player' && building.hp > 0 &&
    building.progress >= 1 && Number(game.buildingDefs?.[building.defId]?.power) < 0)
    .sort((a,b) => {
      const an=game.buildingDefs?.[a.defId]?.name||keyName(a.defId);
      const bn=game.buildingDefs?.[b.defId]?.name||keyName(b.defId);
      return an.localeCompare(bn)||a.y-b.y||a.x-b.x||String(a.id).localeCompare(String(b.id));
    });
}
function powerGridTile(building) {
  const x=Math.floor(building.x+(building.w||0)/2);
  const y=Math.floor(building.y+(building.h||0)/2);
  return `${String(x).padStart(2,'0')} // ${String(y).padStart(2,'0')}`;
}
function renderPowerGrid(force=false) {
  const modal=$('#power-grid-modal');
  if(!modal||!game)return;
  const power=game.power?.player||{},production=power.production||0,consumption=power.consumption||0;
  const buildings=powerGridBuildings();
  const researchCenterOnline=game.buildings.some(center=>center.owner==='player'&&center.defId==='tech'&&center.hp>0&&center.progress>=1&&center.powered===true);
  const signature=JSON.stringify([production,consumption,researchCenterOnline,buildings.map(building=>{
    const first=building.queue?.[0];
    const research=building.defId==='tech'?(game.research?.player?.project||game.research?.player?.tacticalProject):null;
    const unload=building.defId==='refinery'?game.units.find(unit=>unit._unloadRefineryId===building.id):null;
    const can=game.canSetBuildingPower?.(building.id,!building.powerStandby);
    return [building.id,building.powerStandby===true,building.powered===true,first?.defId,Math.floor((first?.progress||0)*100),building.queue?.length||0,research?.id,Math.floor((research?.progress||0)*100),unload?.id,Math.floor((unload?._unloadProgress||0)*100),can?.ok,can?.reason,pendingPowerCommands.has(building.id)];
  })]);
  if(!force&&signature===powerGridSignature)return;
  powerGridSignature=signature;
  $('#power-grid-production').textContent=`${fmt(production)} POWER`;
  $('#power-grid-draw').textContent=`${fmt(consumption)} DRAW`;
  const headroom=production-consumption;
  $('#power-grid-headroom').textContent=`${headroom>=0?'+':''}${fmt(headroom)} POWER`;
  $('#power-grid-headroom').classList.toggle('is-negative',headroom<0);
  const list=$('#power-grid-list');
  if(!buildings.length){
    list.innerHTML='<p class="power-grid-empty">No completed power consumers available to manage.</p>';
    return;
  }
  list.innerHTML=buildings.map(building=>{
    const def=game.buildingDefs[building.defId],name=def?.name||keyName(building.defId);
    const standby=building.powerStandby===true,draw=Math.abs(Number(def?.power)||0);
    const check=game.canSetBuildingPower?.(building.id,!standby);
    const pending=pendingPowerCommands.has(building.id);
    const usable=!!check?.ok&&!replayMode&&!pending;
    const archivedUnavailable=/power routing is unavailable in this archived battle/i.test(check?.reason||'');
    const q=building.queue?.[0],qName=q&&(game.unitDefs?.[q.defId]?.name||keyName(q.defId));
    const research=building.defId==='tech'?(game.research?.player?.project||game.research?.player?.tacticalProject):null;
    const researchActiveElsewhere=building.defId==='tech'&&building.powered!==true&&game.buildings.some(center=>center.id!==building.id&&center.owner==='player'&&center.defId==='tech'&&center.hp>0&&center.progress>=1&&center.powered===true);
    const unload=building.defId==='refinery'?game.units.find(unit=>unit._unloadRefineryId===building.id):null;
    const queueText=q?`${standby?'QUEUE PAUSED':'TRAINING'} · ${qName} · ${Math.floor((q.progress||0)*100)}%${(building.queue?.length||0)>1?` · +${building.queue.length-1} QUEUED`:''}`:
      research?`${researchActiveElsewhere?'RESEARCH ACTIVE ELSEWHERE':standby||!researchCenterOnline?'RESEARCH PAUSED':'RESEARCHING'} · ${research.name||keyName(research.id)} · ${Math.floor((research.progress||0)*100)}%`:
      unload?`${standby?'UNLOAD PAUSED':'UNLOADING CARGO'} · ${Math.floor((unload._unloadProgress||0)*100)}%`:standby?'JOBS PAUSED':'NO ACTIVE JOB';
    const state=standby?'STANDBY':building.powered?'ONLINE':'OFFLINE';
    const action=standby?'Restore':'Stand by';
    const jobLine=archivedUnavailable?'START A NEW BATTLE TO ENABLE POWER CONTROL':queueText;
    const tile=powerGridTile(building);
    const label=archivedUnavailable?`${name} power controls unavailable in this archived battle. Start a new battle to enable them.`:`${action} ${name}`;
    return `<article class="power-grid-row${standby?' is-standby':''}"><button type="button" class="power-grid-identity" data-locate-power-building="${String(building.id).replaceAll('"','&quot;')}" aria-label="Locate ${name} at ${tile}" title="Locate ${name} · ${tile}">${assetHTML(building.defId)}<span><strong><span class="power-grid-building-name">${name}</span><span class="power-grid-locate-cue" aria-hidden="true">⌖ LOCATE</span></strong><small>${tile} · ${draw} POWER DRAW</small></span></button><div class="power-grid-state"><span class="power-grid-status">${state}</span><span class="power-grid-job">${jobLine}</span></div><button type="button" class="power-grid-toggle" data-power-building="${String(building.id).replaceAll('"','&quot;')}" data-standby="${!standby}" aria-label="${label}" title="${label}" ${usable?'':'disabled'}>${pending?'WAIT…':action.toUpperCase()}</button></article>`;
  }).join('');
}
function setBuildingStandby(buildingId,standby) {
  if(!game||typeof standby!=='boolean')return;
  const building=game.buildings.find(item=>String(item.id)===String(buildingId));
  if(!building){toast('BUILDING NO LONGER AVAILABLE',true);return;}
  const check=game.canSetBuildingPower?.(building.id,standby);
  if(!check||typeof game.setBuildingPower!=='function'){toast('POWER CONTROL IS UNAVAILABLE',true);return;}
  if(!check.ok){toast(check.reason||'POWER CONTROL IS UNAVAILABLE',true);return;}
  if(pendingPowerCommands.has(building.id))return;
  const result=game.setBuildingPower?.(building.id,standby);
  if(result?.pending){
    pendingPowerCommands.add(building.id);
    powerGridSignature='';
    renderPowerGrid(true);
    updateSelectionCard();
    resultMessage(result,'','order',{onAccepted:()=>{updateUI(true);},onSettled:()=>{
      pendingPowerCommands.delete(building.id);
      powerGridSignature='';
      updateUI(true);
    }});
    return;
  }
  if(resultMessage(result,'')){
    powerGridSignature='';
    updateUI(true);
  }
}
let armoryFaction = 'aegis', armoryKind = 'units', armorySelected = '';
let armoryModelCleanup=null, armoryModelToken=0, armoryModelModulePromise=null;
function clearArmoryModel(){
  armoryModelToken++;
  armoryModelCleanup?.();
  armoryModelCleanup=null;
}
function previewArmoryUnit(visual,portrait,detail,name){
  const token=armoryModelToken;
  const defId=armorySelected, faction=armoryFaction;
  const host=document.createElement('div');host.className='armory-model-host';host.hidden=true;
  visual.append(host);
  armoryModelModulePromise??=import('./ui/armoryModelViewer.js');
  armoryModelModulePromise.then(({mountArmoryModelViewer})=>{
    if(token!==armoryModelToken||!visual.isConnected)return;
    armoryModelCleanup=mountArmoryModelViewer(host,{defId,faction,name,
      onReady:()=>{
        if(token!==armoryModelToken)return;
        host.hidden=false;portrait.hidden=true;
        visual.classList.add('has-model-preview');detail.classList.add('has-model-preview');
      },
      onFallback:()=>{
        if(token!==armoryModelToken)return;
        host.hidden=false;portrait.hidden=false;
        visual.classList.remove('has-model-preview');detail.classList.remove('has-model-preview');
      }});
  }).catch(()=>{if(token===armoryModelToken)host.remove();armoryModelModulePromise=null;});
}
const factionPerks = {
  aegis: 'Aegis harvesters extract crystal 20% faster near a powered Refinery. Secure Aegis Shelter relays restore nearby friendly infantry at 1 HP per second. Aegis also fields the Guardian, Field Medic, Kestrel, Watchtower, Skyshield Battery, and Ion Spire.',
  vesper: 'Vesper combat units recover salvage credits when they destroy completed enemy structures. Vesper fields Pyro Troopers, Specter Tanks, Wraith Gunships, SAM Sites, Obelisks, and Warhead Temples.',
};
const armoryProducerNames = { barracks:'Barracks', factory:'War Factory', helipad:'Helipad' };
function openArmory() {
  if (playing && !gameEnded && currentMode !== 'multiplayer' && !paused) {
    paused = true;
    armoryAutoPaused = true;
    audio.stopAmbient();
    refreshFrameRateReadout();
  }
  $('#armory-description').textContent = playing && !gameEnded
    ? currentMode === 'multiplayer'
      ? 'Live multiplayer match continues while you read. Review the current combat roster.'
      : 'Solo match paused while you read. Review the current combat roster.'
    : 'Review known forces and structures. Entries describe the current combat roster.';
  renderArmory();
  openTrackedDialog('#armory');
}
function promotionEligible(unit) {
  return !!unit && !replayMode && unit.owner === 'player' && unit.hp > 0 &&
    !unit.embarkedIn && !unit.promotion && isUnitPromotionEligible(unit) &&
    (game.replayVersion == null || game.replayVersion >= UNIT_PROMOTION_RULES_VERSION);
}
function openPromotion(unit) {
  if (!playing || gameEnded || !promotionEligible(unit)) return;
  promotionToken++;
  promotionUnitId = unit.id;
  promotionPending = false;
  $('#promotion-unit-name').textContent = game.unitDefs[unit.defId].name.toUpperCase();
  $('#promotion-live-note').textContent = currentMode === 'multiplayer'
    ? 'The live match continues while you choose.'
    : 'Your solo battle is paused while you choose.';
  for (const option of document.querySelectorAll('#promotion-modal [data-promotion]')) option.disabled = false;
  if (currentMode !== 'multiplayer' && !paused) {
    paused = true;
    promotionAutoPaused = true;
    audio.stopAmbient();
    refreshFrameRateReadout();
  }
  openTrackedDialog('#promotion-modal');
}
function renderArmory() {
  clearArmoryModel();
  const defs = armoryKind === 'units' ? UNIT_DEFS : BUILDING_DEFS;
  const entries = Object.entries(defs).filter(([,d]) => !d.faction || d.faction === 'all' || d.faction === armoryFaction);
  if (!entries.some(([id]) => id === armorySelected)) armorySelected = entries[0]?.[0] || '';
  document.querySelectorAll('[data-armory-faction]').forEach(b => { const on=b.dataset.armoryFaction===armoryFaction;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on)); });
  document.querySelectorAll('[data-armory-kind]').forEach(b => { const on=b.dataset.armoryKind===armoryKind;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on)); });
  const list=$('#armory-list'); list.replaceChildren();
  for (const [id,d] of entries) {
    const button=document.createElement('button'); button.type='button'; button.className=`armory-entry-card${id===armorySelected?' active':''}`; button.dataset.armoryItem=id; button.setAttribute('aria-pressed',String(id===armorySelected));
    const img=document.createElement('img'); img.className='armory-thumb'; img.alt=''; img.loading='lazy';
    const variant=portraitVariant(armoryFaction,id); img.src=portraitSource(variant); img.onerror=()=>{img.onerror=null;img.src=portraitSource(id);};
    const copy=document.createElement('span');copy.className='armory-entry-copy'; const name=document.createElement('strong');name.textContent=d.name;const meta=document.createElement('small');meta.textContent=armoryKind==='units'?(d.role||'unit').toUpperCase():(d.power?`${d.power>0?'+':''}${d.power} POWER`:'STRUCTURE');copy.append(name,meta);button.append(img,copy);list.append(button);
  }
  const detail=$('#armory-detail'); detail.classList.remove('has-model-preview');detail.replaceChildren(); const d=defs[armorySelected]; if(!d)return;
  const title=document.createElement('h3');title.textContent=d.name;
  const faction=document.createElement('div');faction.className=`armory-faction-tag ${armoryFaction}`;faction.textContent=armoryFaction==='aegis'?'AEGIS DEFENSE NETWORK':'VESPER STRIKE COMMAND';
  const visual=document.createElement('div');visual.className='armory-portrait';const portrait=document.createElement('img');portrait.alt=`${d.name} field portrait`;const detailPortrait=portraitVariant(armoryFaction,armorySelected);portrait.src=portraitSource(detailPortrait);portrait.onerror=()=>{portrait.onerror=null;portrait.src=portraitSource(armorySelected);};visual.append(portrait);
  const desc=document.createElement('p');desc.className='armory-description';desc.textContent=factionDescription(armoryFaction,armorySelected,d);
  const stats=document.createElement('dl');stats.className='armory-stats';
  const rows=[['COST',d.cost===0?'FREE':`${Number(d.cost).toLocaleString()} CR`],['BUILD TIME',`${d.buildTime||0}s`],['HEALTH',Number(d.health).toLocaleString()],['ARMOR',String(d.armor||'—').toUpperCase()],armoryKind==='units'?['SPEED',d.flying?`${d.speed} · AIR`:`${d.speed} TILES/S`]:['POWER',`${d.power>0?'+':''}${d.power||0}`]];
  if (armoryKind === 'units' && d.producer) rows.push(['PRODUCED AT',armoryProducerNames[d.producer]||BUILDING_DEFS[d.producer]?.name||d.producer]);
  for(const [label,value] of rows){const dt=document.createElement('dt');dt.textContent=label;const dd=document.createElement('dd');dd.textContent=value;stats.append(dt,dd);}
  const role=document.createElement('p');role.className='armory-role';role.textContent=armoryKind==='units'?`FIELD ROLE · ${(d.role||'unit').toUpperCase()}`:`FIELD ROLE · ${d.weapon?'ARMED DEFENSE':'BASE INFRASTRUCTURE'}`;
  const req=(d.requires||[]).map(x=>x==='tech'?'Research Center':(BUILDING_DEFS[x]?.name||x));
  const prereq=document.createElement('p');prereq.className='armory-prereq';prereq.textContent=`PREREQUISITES · ${req.length?req.join(' + '):'None'}`;
  const perk=document.createElement('aside');perk.className='armory-perk';const perkTitle=document.createElement('strong');perkTitle.textContent=`${armoryFaction.toUpperCase()} FACTION DOCTRINE`;const perkCopy=document.createElement('span');perkCopy.textContent=factionPerks[armoryFaction];perk.append(perkTitle,perkCopy);
  detail.append(faction,visual,title,role,desc,stats,prereq,perk);
  if(armoryKind==='units')previewArmoryUnit(visual,portrait,detail,d.name);
}
const campaignIndexById = id => CAMPAIGN_MISSIONS.findIndex(mission => mission.id === id);
const campaignBranchCode = id => id === 'ghost-channel' ? '04A' : id === 'iron-current' ? '04B' : null;
const isBonusCampaignMission = id => ['after-the-dawn','iron-reclaimed','counterbattery'].includes(id);
const campaignMissionCode = (mission, index) => isBonusCampaignMission(mission.id)
  ?'BONUS':campaignBranchCode(mission.id)||String(index+1).padStart(2,'0');
const campaignUsesRoutePayoff = index => index === 4 || index === 5;
const campaignRouteBoard = scenarioId => scenarioId === 'red-ledger' || scenarioId === 'ashes-in-transit';
const currentCampaignDossierView = (selectedDifficulty = campaignDifficulty) =>
  campaignDossierView(localStorage, campaignDossier, network.profile?.id, selectedDifficulty);
const campaignChosenBranchForUI = selectedDifficulty => currentCampaignDossierView(selectedDifficulty).chosenBranchId;
const campaignRouteLead = (selectedDifficulty, branchOverride = null) => {
  const branch=branchOverride??campaignChosenBranchForUI(selectedDifficulty);
  if(branch==='ghost-channel')return 'Aegis breached the Ghost Channel vault; Vesper’s western cell must move before its command net is traced.';
  if(branch==='iron-current')return 'Aegis held the Iron Current freight line; Vesper’s western cell must fund its counterstrike from basin crystal.';
  return '';
};
const campaignBriefingCopy = (mission,selectedDifficulty=campaignDifficulty) => {
  const lead=mission.id==='red-ledger'?campaignRouteLead(selectedDifficulty,campaignRoutePayoffId):'';
  const payoff=mission.id==='red-ledger'
    ?CAMPAIGN_ROUTE_PAYOFFS.find(item=>item.id===campaignRoutePayoffId)?.description:'';
  if(mission.id==='ashes-in-transit'&&campaignRoutePayoffId==='ghost-channel')
    return 'The Ghost Channel breach exposed the analyst’s codes. Take the northern uplink for a rapid burst, then hold the marked signal-shadow site with an armed escort to delay the Aegis response. Destroy the incoming interceptor and extract the analyst alive.';
  if(mission.id==='ashes-in-transit'&&campaignRoutePayoffId==='iron-current')
    return 'The Iron Current freight line left a recoverable supply cache on the southern route. Transmit from the low-power uplink, recover the marked cache with an Engineer, then extract the analyst alive.';
  return `${lead?`${lead} `:''}${mission.briefing}${payoff?` Route payoff: ${payoff}`:''}`;
};
const campaignBriefingObjective = (mission, routeId=campaignRoutePayoffId) => {
  if (mission.id === 'ashes-in-transit') {
    if (routeId === 'ghost-channel') return 'Transmit at the northern uplink for 5 seconds, deploy a signal shadow with an armed unit, destroy the Aegis interceptor, and extract the analyst alive.';
    if (routeId === 'iron-current') return 'Transmit at the southern uplink for 8 seconds, recover the marked supply cache with an Engineer, and extract the analyst alive.';
  }
  if (mission.id !== 'red-ledger') return mission.objective;
  if (routeId === 'ghost-channel') return 'Issue an Attack order against the Aegis payroll courier and destroy it, build a second powered Refinery, and bank 4,800 credits within six minutes.';
  if (routeId === 'iron-current') return 'Recover the eastern freight cache with an Engineer, build a second powered Refinery, and bank 4,800 credits within six minutes.';
  return mission.objective;
};
const campaignCardBriefing = mission => mission.id === 'ghost-channel'
  ? 'Covert route · hack the signal vault with a fixed squad, then extract the same engineer before the deadline.'
  : mission.id === 'iron-current'
    ? 'Industrial route · fund the freight reserve and hold its relay through three assault waves.'
    : mission.id === 'iron-reclaimed'
      ? 'Bonus recovery · restore the marked Guardian with your Engineer, then escort both to extraction.'
    : mission.id === 'counterbattery'
      ? 'Bonus assault · flank the siege batteries, protect your Command Yard, and silence both before the barrage deadline.'
    : mission.id === 'red-ledger'&&campaignRouteLead(campaignDifficulty)
      ? `${campaignRouteLead(campaignDifficulty)} ${campaignBriefingObjective(mission,campaignChosenBranchForUI(campaignDifficulty))}`
    : mission.id === 'ashes-in-transit'&&campaignChosenBranchForUI(campaignDifficulty)
      ? campaignBriefingObjective(mission,campaignChosenBranchForUI(campaignDifficulty))
    : mission.briefing;
function renderCampaignList() {
  const focusedMission=$('#campaign-list').contains(document.activeElement)
    ? document.activeElement.closest('[data-mission]')?.dataset.mission : null;
  const dossierView=currentCampaignDossierView();
  const orderTotal=dossierView.fieldOrderTotal;
  const orderCapacity=CAMPAIGN_FIELD_ORDERS.reduce((sum,orders)=>sum+orders.length,0);
  const chosenBranch=dossierView.chosenBranchId;
  const syncLabel=dossierView.source==='profile'
    ? campaignDossierStatus==='cached'?'COMMANDER RECORD · LAST SYNC':'COMMANDER RECORD SYNCED'
    : campaignDossierStatus==='loading'?'CHECKING COMMANDER RECORD':'LOCAL PRACTICE RECORD';
  $('#campaign-order-summary').textContent=`FIELD ORDERS · ${orderTotal} / ${orderCapacity} EARNED · ${campaignDifficulty.toUpperCase()} · ${syncLabel}`;
  const campaignActs={
    0:['01','THE VALLEY IGNITES','Aegis secures the basin; Vesper’s command net becomes the target.'],
    4:['02','LINES IN THE DUST','Choose a route through the western front, then fund the counterstrike.'],
    9:['03','THE LAST SIGNALS','Both factions race to decide who controls the valley’s future.'],
    14:['04','AFTER THE DAWN','A rescue record points to one final recovery beyond the campaign’s end.'],
    15:['BONUS','IRON RECLAIMED','Restore one abandoned Guardian and bring its Engineer home.'],
    16:['BONUS','COUNTERBATTERY','Break two siege batteries before their barrage closes the passes.'],
  };
  const orderedMissions=CAMPAIGN_ROUTE_ORDERED_IDS.map(id=>({id,index:campaignIndexById(id)})).filter(item=>item.index>=0);
  const missionCleared=({index})=>dossierView.mission(index)?.completed;
  const clearedCount=orderedMissions.filter(missionCleared).length;
  // Once a route has been chosen, its alternate remains replayable but should
  // not hold the campaign's active chapter and progress cue at the fork.
  const nextRoutePosition=orderedMissions.findIndex(({id,index})=>
    (!chosenBranch||!campaignBranchCode(id)||id===chosenBranch)&&
    dossierView.mission(index)?.unlocked&&!missionCleared({index})
  );
  const leadRoutePosition=nextRoutePosition<0?orderedMissions.length-1:nextRoutePosition;
  const chapterStart=[...Object.keys(campaignActs).map(Number)].filter(start=>start<=leadRoutePosition).pop()??0;
  const chapter=campaignActs[chapterStart]||campaignActs[0];
  const routeTrajectory=`<section class="campaign-trajectory" aria-label="${clearedCount} of ${orderedMissions.length} operations cleared. Current chapter: ${chapter[1]}.">
    <div class="campaign-trajectory-top"><span>OPERATIONS CLEARED</span><strong>${String(clearedCount).padStart(2,'0')} <i>/</i> ${String(orderedMissions.length).padStart(2,'0')}</strong></div>
    <div class="campaign-trajectory-track" aria-hidden="true">${orderedMissions.map(({index})=>{
      const mission=CAMPAIGN_MISSIONS[index],done=missionCleared({index});
      const ready=dossierView.mission(index)?.unlocked&&
        (!chosenBranch||!campaignBranchCode(mission.id)||mission.id===chosenBranch);
      return `<span class="${done?'is-cleared':ready?'is-current':''}${campaignBranchCode(mission.id)?' is-branch':''}" title="${campaignMissionCode(mission,index)} · ${mission.title.replace(/"/g,'&quot;')}"></span>`;
    }).join('')}</div>
    <div class="campaign-trajectory-bottom"><span>ACTIVE CHAPTER <b>${chapter[0]} · ${chapter[1]}</b></span><span>AEGIS <i>→</i> VESPER <i>→</i> SHARD VALLEY</span></div>
  </section>`;
  $('#campaign-list').innerHTML=routeTrajectory+orderedMissions.map(({id, index:i},routePosition)=>{
    const m=CAMPAIGN_MISSIONS[i];
    if(!m)return '';
    const record=dossierView.mission(i);
    const unlocked=record.unlocked;
    const stars=record.stars;
    const orderProgress=CAMPAIGN_FIELD_ORDERS[i].filter(order=>dossierView.fieldOrder(i,order.id).earned).length;
    const branch=campaignBranchCode(m.id);
    const routeSource=dossierView.verifiedBranchId?'VERIFIED ':dossierView.localBranchId?'LOCAL PRACTICE ':'';
    const routeState=branch?(chosenBranch===m.id?`${routeSource}CHOSEN ROUTE · `:chosenBranch?'ALTERNATE ROUTE · ':'ROUTE CHOICE · '):'';
    const state=(isBonusCampaignMission(m.id)?'BONUS · ':routeState)+(unlocked
      ? record.verifiedCompleted?'VERIFIED COMPLETE':record.localCompleted?'LOCAL COMPLETE'
        :record.verifiedUnlocked?'RANKED READY':'LOCAL PRACTICE READY'
      :'LOCKED');
    const medalSource=record.verifiedStars&&record.localStars&&record.verifiedStars!==record.localStars
      ?`${record.verifiedStars} VERIFIED / ${record.localStars} LOCAL`
      :record.verifiedStars?'VERIFIED':record.localStars?'LOCAL':campaignDifficulty.toUpperCase();
    const forkHeading=m.id==='ghost-channel'?'<div class="campaign-fork-heading"><span>THE FRONTIER DIVIDES</span><strong>Choose your approach</strong><small>Complete either route to continue the story. The other remains available to replay.</small></div>':'';
    const act=campaignActs[routePosition];
    const actHeading=act?`<div class="campaign-act-heading"><span>${act[0]} / CAMPAIGN CHAPTER</span><strong>${act[1]}</strong><small>${act[2]}</small></div>`:'';
    return `${actHeading}${forkHeading}<button class="campaign-mission${branch?' campaign-mission-branch':''}${isBonusCampaignMission(m.id)?' campaign-mission-bonus':''}${chosenBranch===m.id?' campaign-mission-chosen':''}" data-mission="${i}" ${unlocked?'':'disabled'}><span class="campaign-index">${campaignMissionCode(m,i)}</span><span class="campaign-info"><strong>${m.title}</strong><small>${campaignCardBriefing(m)}</small><span class="campaign-state">${state}</span><span class="campaign-order-progress">FIELD ORDERS · ${orderProgress}/${CAMPAIGN_FIELD_ORDERS[i]?.length||0}</span></span><span class="campaign-record" aria-label="${stars} of 3 ${campaignDifficulty} stars. ${medalSource}."><span>${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</span><small>${medalSource}</small></span><span class="campaign-arrow">${unlocked?'↗':'⌁'}</span></button>`;
  }).join('');
  if(focusedMission!=null)$('#campaign-list').querySelector(`[data-mission="${focusedMission}"]`)?.focus({preventScroll:true});
}
async function refreshCampaignDossier() {
  const requestVersion=++campaignDossierRequestVersion;
  const hasCachedRecord=()=>Boolean(network.profile?.id&&campaignDossier?.profileId===network.profile.id);
  campaignDossierStatus=hasCachedRecord()?'cached':'loading';
  if(!$('#campaign-select').classList.contains('hidden')&&briefingMissionIndex===null)renderCampaignList();
  try {
    await ensureNetworkReady();
    const profileId=network.profile?.id;
    const response=await network.campaignProgress();
    if(requestVersion!==campaignDossierRequestVersion||network.profile?.id!==profileId||response.profileId!==profileId)return;
    campaignDossier=response;
    campaignDossierStatus='profile';
  }catch(error){
    if(requestVersion!==campaignDossierRequestVersion)return;
    campaignDossierStatus=hasCachedRecord()?'cached':'local';
  }
  if(!$('#campaign-select').classList.contains('hidden')&&briefingMissionIndex===null)renderCampaignList();
  else if(briefingMissionIndex!==null){
    renderCampaignFieldOrders(briefingMissionIndex);
    renderCampaignBriefingRecord(briefingMissionIndex);
  }
}
function openCampaign() {
  campaignReturnFocus = document.activeElement;
  $('#campaign-select .panel-kicker').textContent='FRONTIER CAMPAIGN // 16 OPERATIONS';
  $('#campaign-select > .campaign-panel > p').textContent='Command both rival factions through the Shard Valley war. Choose a covert or industrial route after Black Shard; either path leads back to the main campaign.';
  document.querySelectorAll('#campaign-difficulty button').forEach(button=>{
    button.classList.toggle('active',button.dataset.difficulty===campaignDifficulty);
    button.setAttribute('aria-pressed',String(button.dataset.difficulty===campaignDifficulty));
  });
  renderCampaignList();
  show('#campaign-select');
  requestAnimationFrame(()=>$('#campaign-list').querySelector('button:not(:disabled)')?.focus());
  refreshCampaignDossier();
}
function missionMechanic(mission) {
  if (mission.mechanic) return mission.mechanic;
  if (mission.id === 'first-harvest') return 'DEFENDED ECONOMY';
  const text = mission.objective.toLowerCase();
  if (/capture and hold|hold at least|resonance relays/.test(text)) return 'TERRITORY CONTROL';
  if (/capture/.test(text)) return 'INFILTRATION & CAPTURE';
  if (/escort|analyst|extraction beacon/.test(text)) return 'ESCORT & EXTRACTION';
  if (/keep .*standing|protect|storm cycle/.test(text)) return 'SURVIVAL DEFENSE';
  if (/refinery|credits|bank|outproduce/.test(text)) return 'ECONOMIC RACE';
  return 'TARGET ELIMINATION';
}
function fieldOrdersForMission(index) { return CAMPAIGN_FIELD_ORDERS?.[index] || []; }
function validFieldOrderId(index, id) { return id === 'none' || fieldOrdersForMission(index).some(order => order.id === id); }
function validCarryoverId(index, id) {
  return CAMPAIGN_CARRYOVERS.some(item => item.id === id) && (index > 0 || id === 'none');
}
function campaignCarryoverSourceIndexes(index) {
  if(index===13||index===14)return [3];
  if(index===4){
    const completed=[13,14].filter(i=>campaignRecord(localStorage,campaignDifficulty,CAMPAIGN_MISSIONS[i]?.id)>0);
    return completed.length?completed:[3]; // Existing linear saves retain Black Shard Intel.
  }
  return index>0?[index-1]:[];
}
function localCampaignCarryoverUnlocks(index) {
  if (index < 1) return ['none'];
  const earned = campaignCarryoverSourceIndexes(index).flatMap(sourceIndex=>
    fieldOrdersForMission(sourceIndex)
      .filter(order=>campaignFieldOrderCompleted(localStorage,campaignDifficulty,CAMPAIGN_MISSIONS[sourceIndex].id,order.id))
      .map(order=>order.id));
  return getCampaignCarryoverUnlocks(index, earned);
}
function availableCampaignCarryovers(index) {
  return new Set([...localCampaignCarryoverUnlocks(index), ...(carryoverOnlineUnlocks || [])]);
}
function localCampaignRequisitionBalance(index) {
  const earned = CAMPAIGN_MISSIONS.flatMap((mission, missionIndex) =>
    fieldOrdersForMission(missionIndex).filter(order =>
      campaignFieldOrderCompleted(localStorage, campaignDifficulty, mission.id, order.id)).map(order => order.id));
  return getCampaignRequisitionBalance(index, earned,
    campaignRequisitionSpentMissionIds(localStorage, campaignDifficulty));
}
function availableCampaignSupplies(index) {
  const available = new Set(['none']);
  if (index > 0 && Math.max(localCampaignRequisitionBalance(index), requisitionOnlineBalance ?? 0) > 0)
    for (const supply of CAMPAIGN_SUPPLIES) available.add(supply.id);
  return available;
}
function renderCampaignRequisition(index) {
  const section = $('#requisition-section');
  section.classList.toggle('hidden', index < 1);
  if (index < 1) return;
  const localBalance = localCampaignRequisitionBalance(index);
  const onlineBalance = requisitionOnlineBalance;
  $('#requisition-balance').textContent = onlineBalance === null
    ? `${localBalance} / 3 LOCAL AVAILABLE`
    : `${onlineBalance} / 3 VERIFIED${localBalance > onlineBalance ? ` · ${localBalance} LOCAL` : ''}`;
  const options = $('#requisition-options');
  const focusedId = options.contains(document.activeElement) ? document.activeElement.dataset.supply : null;
  const available = availableCampaignSupplies(index);
  options.replaceChildren(...CAMPAIGN_SUPPLIES.map(supply => {
    const unlocked = available.has(supply.id);
    const status = supply.id === 'none' ? 'SAVE REQUISITION'
      : !unlocked ? 'EARN FIELD ORDERS TO UNLOCK'
        : (onlineBalance ?? 0) > 0 ? 'RANKED READY · COST 1'
          : 'LOCAL ONLY · COST 1';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `requisition-card${supply.id === campaignSupplyId ? ' active' : ''}`;
    button.dataset.supply = supply.id;
    button.disabled = !unlocked;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(supply.id === campaignSupplyId));
    button.setAttribute('aria-label', `${supply.name}. ${supply.description} ${status}.`);
    button.tabIndex = supply.id === campaignSupplyId ? 0 : -1;
    const name = document.createElement('strong'); name.textContent = supply.name;
    const description = document.createElement('small'); description.textContent = supply.description;
    const badge = document.createElement('span'); badge.textContent = status;
    button.append(name, description, badge);
    return button;
  }));
  if (focusedId) options.querySelector(`[data-supply="${focusedId}"]`)?.focus();
}
function selectCampaignSupply(id) {
  if (briefingMissionIndex === null || !availableCampaignSupplies(briefingMissionIndex).has(id)) return;
  campaignSupplyId = id;
  localStorage.setItem(SUPPLY_KEY, id);
  renderCampaignRequisition(briefingMissionIndex);
}
function renderCampaignCarryovers(index) {
  const section = $('#carryover-section');
  section.classList.toggle('hidden', index < 1);
  if (index < 1) return;
  const options = $('#carryover-options');
  const focusedId = options.contains(document.activeElement) ? document.activeElement.dataset.carryover : null;
  const local = new Set(localCampaignCarryoverUnlocks(index));
  const available = availableCampaignCarryovers(index);
  const sourceIndexes=campaignCarryoverSourceIndexes(index);
  const previousMissionNames=sourceIndexes.map(sourceIndex=>CAMPAIGN_MISSIONS[sourceIndex]?.title).filter(Boolean).join(' or ');
  options.replaceChildren(...CAMPAIGN_CARRYOVERS.map((carryover, optionIndex) => {
    const unlocked = available.has(carryover.id);
    const priorOrder = fieldOrdersForMission(sourceIndexes[0])[optionIndex - 1];
    const status = carryover.id === 'none' ? 'STANDARD ISSUE'
      : carryoverOnlineUnlocks?.includes(carryover.id) ? 'RANKED READY'
      : local.has(carryover.id) ? 'EARNED ON THIS DEVICE'
      : `LOCKED · ${priorOrder?.title || 'FIELD ORDER'}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `carryover-card${carryover.id === campaignCarryoverId ? ' active' : ''}`;
    button.dataset.carryover = carryover.id;
    button.disabled = !unlocked;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(carryover.id === campaignCarryoverId));
    button.setAttribute('aria-label', `${carryover.name}. ${carryover.description} ${unlocked ? status : `Locked. Complete ${priorOrder?.title || 'the relevant Field Order'} in ${previousMissionNames || 'the previous operation'}.`}`);
    button.tabIndex = carryover.id === campaignCarryoverId ? 0 : -1;
    const heading = document.createElement('strong'); heading.textContent = carryover.name;
    const description = document.createElement('small'); description.textContent = carryover.description;
    const badge = document.createElement('span'); badge.textContent = status;
    button.append(heading, description, badge);
    return button;
  }));
  if(focusedId)options.querySelector(`[data-carryover="${focusedId}"]`)?.focus();
}
function selectCampaignCarryover(id) {
  if (briefingMissionIndex === null || !availableCampaignCarryovers(briefingMissionIndex).has(id)) return;
  campaignCarryoverId = id;
  localStorage.setItem(CARRYOVER_KEY, id);
  renderCampaignCarryovers(briefingMissionIndex);
}
function campaignVeteranName(veteran) {
  return UNIT_DEFS[veteran.defId]?.name || 'Surviving unit';
}
function campaignVeteranRank(veteran) {
  return veteran.veterancy === 2 ? 'ELITE' : 'VETERAN';
}
function createVeteranPortrait(veteran) {
  const image = document.createElement('img');
  image.src = portraitSource(portraitVariant(veteran.faction, veteran.defId));
  image.alt = `${campaignVeteranName(veteran)} portrait`;
  return image;
}
function renderCampaignVeteran(index) {
  const section = $('#veteran-section');
  section.classList.toggle('hidden', index < 1);
  if (index < 1) return;
  const local = campaignVeteranRecordForMission(localStorage, campaignDifficulty, index);
  const verifiedKnown = campaignVeteranOnline !== undefined;
  const veteran = verifiedKnown ? campaignVeteranOnline : local?.veteran ?? null;
  const status = $('#veteran-status');
  const content = $('#veteran-briefing');
  content.replaceChildren();
  if (!veteran) {
    status.textContent = verifiedKnown ? 'NO VERIFIED SURVIVOR' : local ? 'NO LOCAL SURVIVOR' : 'NO SURVIVOR ON RECORD';
    const message = document.createElement('p');
    message.textContent = verifiedKnown && local?.veteran
      ? 'A local survivor is on this device, but ranked deployment requires a verified prior victory on this profile.'
      : 'Keep an armed unit alive through a victory to bring one experienced attachment into the next operation.';
    content.append(message);
    return;
  }
  status.textContent = verifiedKnown ? 'VERIFIED ATTACHMENT' : 'LOCAL ATTACHMENT';
  const copy = document.createElement('div');
  const rank = document.createElement('small'); rank.textContent = `${campaignVeteranRank(veteran)} · ${veteran.faction.toUpperCase()} EQUIPMENT`;
  const name = document.createElement('strong'); name.textContent = campaignVeteranName(veteran);
  const detail = document.createElement('p');
  detail.textContent = `Deploys beside your starting force with earned experience${veteran.promotion ? ` and ${veteran.promotion === 'bulwark' ? 'Bulwark' : 'Rangefinder'} field modification` : ''}. ${verifiedKnown ? 'Locked by your verified prior victory.' : 'Ranked use requires a verified prior victory.'}`;
  copy.append(rank, name, detail);
  content.append(createVeteranPortrait(veteran), copy);
}
async function refreshCampaignCarryoverUnlocks(index, selectedDifficulty) {
  const requestVersion = ++carryoverRequestVersion;
  try {
    await ensureNetworkReady();
    const result = await network.carryoverUnlocks(index, selectedDifficulty);
    if (requestVersion !== carryoverRequestVersion || briefingMissionIndex !== index || campaignDifficulty !== selectedDifficulty) return;
    carryoverOnlineUnlocks = Array.isArray(result.carryoverIds) ? result.carryoverIds : ['none'];
    campaignVeteranOnline = Object.hasOwn(result, 'campaignVeteran') && validateCampaignVeteran(result.campaignVeteran)
      ? result.campaignVeteran : undefined;
    requisitionOnlineBalance = Number.isInteger(result.requisitionBalance)
      ? Math.max(0, Math.min(3, result.requisitionBalance)) : null;
    if (campaignUsesRoutePayoff(index) && CAMPAIGN_ROUTE_PAYOFFS.some(item => item.id === result.routePayoffId) &&
        (result.routePayoffId !== 'none' || result.rankedAvailable === true || campaignRoutePayoffId === 'none')) {
      campaignRoutePayoffId = result.routePayoffId;
      $('#briefing-copy').textContent = campaignBriefingCopy(CAMPAIGN_MISSIONS[index], selectedDifficulty);
      $('#briefing-objective').textContent = campaignBriefingObjective(CAMPAIGN_MISSIONS[index]);
    }
    renderCampaignCarryovers(index);
    renderCampaignRequisition(index);
    renderCampaignVeteran(index);
  } catch (error) {
    if (requestVersion === carryoverRequestVersion && briefingMissionIndex === index) {
      carryoverOnlineUnlocks = null;
      campaignVeteranOnline = undefined;
      requisitionOnlineBalance = null;
      renderCampaignCarryovers(index);
      renderCampaignRequisition(index);
      renderCampaignVeteran(index);
    }
  }
}
function renderCampaignBriefingRecord(index) {
  const record=currentCampaignDossierView().mission(index);
  if(!record)return;
  const medalSource=record.verifiedStars&&record.localStars&&
    record.verifiedStars!==record.localStars
      ?`${record.verifiedStars} VERIFIED · ${record.localStars} LOCAL`
      :record.verifiedStars?'VERIFIED COMMANDER RECORD'
        :record.localStars?'LOCAL PRACTICE RECORD':'NO MEDAL';
  $('#briefing-record').textContent=record.stars
    ?`BEST MEDAL · ${'★'.repeat(record.stars)}${'☆'.repeat(3-record.stars)} · ${medalSource}`
    :`NO MEDAL · ${campaignDifficulty.toUpperCase()}`;
}
function openMissionBriefing(index, trigger) {
  const mission = CAMPAIGN_MISSIONS[index];
  const dossierView=currentCampaignDossierView();
  const campaignRecordView=dossierView.mission(index);
  if (!mission || !campaignRecordView?.unlocked) return;
  briefingMissionIndex = index;
  briefingReturnFocus = trigger;
  const preferredFieldOrder = localStorage.getItem(FIELD_ORDER_KEY) || 'none';
  campaignFieldOrderId = validFieldOrderId(index, preferredFieldOrder) ? preferredFieldOrder : 'none';
  carryoverOnlineUnlocks = null;
  campaignVeteranOnline = undefined;
  requisitionOnlineBalance = null;
  const preferredCarryover = localStorage.getItem(CARRYOVER_KEY) || 'none';
  campaignCarryoverId = localCampaignCarryoverUnlocks(index).includes(preferredCarryover) ? preferredCarryover : 'none';
  const preferredSupply = localStorage.getItem(SUPPLY_KEY) || 'none';
  campaignSupplyId = availableCampaignSupplies(index).has(preferredSupply) ? preferredSupply : 'none';
  campaignRoutePayoffId = campaignUsesRoutePayoff(index) ? dossierView.chosenBranchId || 'none' : 'none';
  const factionName = mission.faction === 'vesper' ? 'VESPER COLLECTIVE' : 'AEGIS DIRECTORATE';
  $('#briefing-number').textContent = `${mission.id==='after-the-dawn'?'BONUS OPERATION · AIRLIFT':mission.id==='iron-reclaimed'?'BONUS OPERATION · RECOVERY':mission.id==='counterbattery'?'BONUS OPERATION · SIEGE':campaignBranchCode(mission.id)?`BRANCH OPERATION ${campaignBranchCode(mission.id)}`:`OPERATION ${String(index + 1).padStart(2, '0')}`} // ${factionName}`;
  $('#briefing-title').textContent = mission.title;
  $('#briefing-copy').textContent = campaignBriefingCopy(mission,campaignDifficulty);
  $('#briefing-objective').textContent = campaignBriefingObjective(mission);
  $('#briefing-mechanic').textContent = `MISSION PROFILE · ${missionMechanic(mission)}`;
  renderCampaignBriefingRecord(index);
  const artwork=campaignArtworkForMission(mission.id);
  const artPanel=$('#briefing-faction'), artImage=$('#briefing-faction-art');
  artPanel.dataset.faction=mission.faction;
  artPanel.dataset.artwork=artwork?'mission':'fallback';
  artPanel.style.setProperty('--briefing-art-position',artwork?.position||'43% center');
  artPanel.style.setProperty('--briefing-art-mobile-position',artwork?.mobilePosition||'center 34%');
  artImage.loading='eager';
  artImage.decoding='async';
  artImage.onerror=()=>{
    artImage.onerror=null;
    artPanel.dataset.artwork='fallback';
    artImage.src=`/assets/faction-${mission.faction}.jpg`;
    artImage.alt=`${factionName} faction artwork`;
  };
  artImage.src=artwork?.src||`/assets/faction-${mission.faction}.jpg`;
  artImage.alt=artwork?.alt||`${factionName} faction artwork`;
  const artCaption=$('#briefing-faction-name');
  const artEyebrow=document.createElement('small');artEyebrow.textContent=artwork?.label||'FIELD INTELLIGENCE';
  const artFaction=document.createElement('strong');artFaction.textContent=factionName;
  artCaption.replaceChildren(artEyebrow,artFaction);
  renderCampaignFieldOrders(index);
  renderCampaignDoctrines();
  renderCampaignCarryovers(index);
  renderCampaignRequisition(index);
  renderCampaignVeteran(index);
  if (index > 0) refreshCampaignCarryoverUnlocks(index, campaignDifficulty);
  $('#campaign-panel').classList.add('briefing-open');
  show('#mission-briefing');
  requestAnimationFrame(()=>{
    $('#campaign-panel').scrollTop=0;
    $('#briefing-title').focus({preventScroll:true});
  });
}
function renderCampaignFieldOrders(index) {
  const options = $('#field-order-options');
  if (!options) return;
  const focusedOrder=options.contains(document.activeElement)
    ? document.activeElement.closest('[data-field-order]')?.dataset.fieldOrder : null;
  const orders = fieldOrdersForMission(index);
  const specs = [{ id: 'none', title: 'Primary objective only', objective: 'No additional contract. Focus your force on the mission orders.', rewardText: 'No bonus reward' }, ...orders];
  options.replaceChildren(...specs.map((order, orderIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `field-order-card${order.id === campaignFieldOrderId ? ' active' : ''}${order.id === 'none' ? ' field-order-none' : ''}`;
    const orderRecord=order.id==='none'?null:currentCampaignDossierView().fieldOrder(index,order.id);
    const earned=!!orderRecord?.earned;
    if (earned) button.classList.add('field-order-earned');
    button.dataset.fieldOrder = order.id;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(order.id === campaignFieldOrderId));
    button.tabIndex = order.id === campaignFieldOrderId ? 0 : -1;
    button.setAttribute('aria-label', `${order.title}. ${earned ? 'Previously earned. ' : ''}${order.objective} Reward: ${order.rewardText}`);
    const top = document.createElement('span'); top.className = 'field-order-top';
    const indexMark = document.createElement('small'); indexMark.textContent = order.id === 'none' ? 'OPTIONAL CONTRACT' : `FIELD ORDER 0${orderIndex}`;
    const mark = document.createElement('i'); mark.setAttribute('aria-hidden', 'true'); mark.textContent = earned ? '★' : order.id === campaignFieldOrderId ? '✓' : '＋';
    top.append(indexMark, mark);
    const title = document.createElement('strong'); title.textContent = order.title;
    const objective = document.createElement('span'); objective.className = 'field-order-objective'; objective.textContent = order.objective;
    const reward = document.createElement('span'); reward.className = 'field-order-reward'; reward.textContent = order.rewardText;
    button.append(top, title, objective, reward);
    if (earned) { const badge = document.createElement('span'); badge.className = 'field-order-earned-label'; badge.textContent = orderRecord.verified ? 'VERIFIED ORDER EARNED' : 'LOCAL ORDER EARNED'; button.append(badge); }
    return button;
  }));
  if(focusedOrder!==null)options.querySelector(`[data-field-order="${focusedOrder}"]`)?.focus({preventScroll:true});
}
function selectCampaignFieldOrder(id) {
  if (briefingMissionIndex === null || !validFieldOrderId(briefingMissionIndex, id)) return;
  campaignFieldOrderId = id;
  localStorage.setItem(FIELD_ORDER_KEY, id);
  $('#field-order-options').querySelectorAll('[data-field-order]').forEach(button => {
    const active = button.dataset.fieldOrder === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
    button.tabIndex = active ? 0 : -1;
    const mark = button.querySelector('.field-order-top i');
    if (mark) mark.textContent = button.classList.contains('field-order-earned') ? '★' : active ? '✓' : '＋';
  });
}
function renderCampaignDoctrines() {
  const options = $('#doctrine-options');
  options.replaceChildren(...CAMPAIGN_DOCTRINES.map(doctrine => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `doctrine-card${doctrine.id===campaignDoctrineId?' active':''}`;
    button.dataset.doctrine = doctrine.id;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(doctrine.id === campaignDoctrineId));
    button.tabIndex = doctrine.id === campaignDoctrineId ? 0 : -1;
    button.setAttribute('aria-label', `${doctrine.name}: ${doctrine.description}`);
    const name = document.createElement('strong'); name.textContent = doctrine.name;
    const description = document.createElement('small'); description.textContent = doctrine.description;
    button.append(name, description);
    return button;
  }));
}
function selectCampaignDoctrine(id) {
  if (!CAMPAIGN_DOCTRINES.some(doctrine => doctrine.id === id)) return;
  campaignDoctrineId = id;
  localStorage.setItem(DOCTRINE_KEY, id);
  $('#doctrine-options').querySelectorAll('[data-doctrine]').forEach(button => {
    const active = button.dataset.doctrine === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
    button.tabIndex = active ? 0 : -1;
  });
}
function closeMissionBriefing() {
  if ($('#mission-briefing').classList.contains('hidden')) return;
  carryoverRequestVersion++;
  hide('#mission-briefing');
  $('#campaign-panel').classList.remove('briefing-open');
  const returningMissionIndex=briefingMissionIndex;
  renderCampaignList();
  const focusTarget=briefingReturnFocus?.isConnected?briefingReturnFocus
    :$('#campaign-list').querySelector(`[data-mission="${returningMissionIndex}"]`);
  focusTarget?.focus();
  briefingMissionIndex = null;
}
function objectiveLabel() {
  const relaySeconds=game?.relayDominion?.required??(difficulty==='easy'?120:90);
  if(currentMode==='skirmish'||game?.mode==='skirmish')return (game?.victoryMode||skirmishVictoryMode)==='elimination'
    ?'DESTROY ENEMY COMMAND, FORCES, DEFENSES & INDUSTRY':`HOLD 2 RELAYS ${relaySeconds}S OR DESTROY ENEMY FORCES`;
  if(currentMode==='multiplayer'||game?.mode==='multiplayer')return game?.victoryMode==='elimination'
    ?'DESTROY RIVAL COMMAND, FORCES, DEFENSES & INDUSTRY':`HOLD 2 RELAYS ${relaySeconds}S OR DESTROY RIVAL FORCES`;
  if(game?.campaignMission===4 && (game.replayVersion==null
    ?game.campaignState?.routeObjectiveRulesVersion===46:game.replayVersion>=46))
    return campaignBriefingObjective(CAMPAIGN_MISSIONS[4],game.campaignRoutePayoffId).toUpperCase();
  if(game?.campaignMission===5 && (game.replayVersion==null
    ?game.campaignState?.ashesRouteRulesVersion===51:game.replayVersion>=51))
    return campaignBriefingObjective(CAMPAIGN_MISSIONS[5],game.campaignRoutePayoffId).toUpperCase();
  return game?.mission?.objective?.toUpperCase()||'ELIMINATE ENEMY FORCES';
}
function isFixedForceOperation() {
  return currentMode === 'campaign' && FIXED_FORCE_MISSION_IDS.has(
    game?.mission?.id || CAMPAIGN_MISSIONS[missionIndex]?.id);
}
function resetCommandDeckForOperation() {
  closeBlueprintDetails();
  const fixedForce = isFixedForceOperation();
  $('#game-shell').classList.toggle('fixed-force-operation', fixedForce);
  tab = fixedForce ? 'support' : 'structures';
  const supportTab = document.querySelector('.tab[data-tab="support"]');
  supportTab.textContent = fixedForce ? 'FIELD SUPPORT' : 'SUPPORT';
  document.querySelectorAll('.tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  lastProductionSignature = '';
}
async function beginGame(options = {}) {
  if(gameStarting)return;
  clearPendingFieldAbility();
  selectionRoster.reset();
  relayScoutIndex=0;
  matchPaceMode=false;
  selectedFormation='';formationSelectionKey='';formationPreviewCache={key:'',at:0,preview:null};
  battlefieldPickerAddSquadMode=false;
  setBattlefieldPickerOpen(false);
  resetAiProfileDisclosure();
  finishDeploymentIntro();
  gameStarting=true;
  $('#launch-status').lastChild.textContent=' CONNECTING TO COMMAND RECORDS…';
  show('#launch-status');
  abandonActiveRun();
  placementToken++; placementPending = false;
  commandAbilityToken++; commandAbilityPending = false;
  activePlayback=null;replayMode=false;replayAccumulator=0;replaySeekTarget=null;
  battleMoments=[];replayMoments=[];
  $('#game-shell').classList.remove('replay-mode');hide('#replay-controls');
  currentMode=options.mode||'skirmish';missionIndex=options.missionIndex??0;
  difficulty=options.difficulty||difficulty;
  let seed=Math.floor(Math.random()*1e9);
  let rankedScenarioId=null;
  let rankedStartError=null;
  const requestedOpening=currentMode==='skirmish'
    ? (options.skirmishOpening|| (options.guided?'established':skirmishOpening))
    : 'established';
  const requestedVictoryMode=currentMode==='skirmish'?(options.victoryMode||skirmishVictoryMode)==='elimination'?'elimination':'dominion':'dominion';
  let lockedOpening=requestedOpening;
  let lockedVictoryMode=requestedVictoryMode;
  let lockedDoctrineId=options.doctrineId||campaignDoctrineId;
  let lockedFieldOrderId = currentMode === 'campaign'
    ? (options.fieldOrderId ?? (options.keepFieldOrder ? game?.campaignFieldOrderId : campaignFieldOrderId) ?? 'none')
    : 'none';
  if (currentMode === 'campaign' && !validFieldOrderId(missionIndex, lockedFieldOrderId)) lockedFieldOrderId = 'none';
  let lockedCarryoverId = currentMode === 'campaign' ? (options.carryoverId ?? campaignCarryoverId) : 'none';
  if (currentMode === 'campaign' && !validCarryoverId(missionIndex, lockedCarryoverId)) lockedCarryoverId = 'none';
  let lockedCampaignVeteran = currentMode === 'campaign'
    ? (Object.hasOwn(options, 'campaignVeteran') ? options.campaignVeteran
      : campaignVeteranRecordForMission(localStorage, difficulty, missionIndex)?.veteran ?? null)
    : null;
  if (!validateCampaignVeteran(lockedCampaignVeteran)) lockedCampaignVeteran = null;
  let lockedSupplyId = currentMode === 'campaign' ? (options.supplyId ?? campaignSupplyId) : 'none';
  if (currentMode === 'campaign' && (!CAMPAIGN_SUPPLIES.some(supply => supply.id === lockedSupplyId) || missionIndex === 0)) lockedSupplyId = 'none';
  let lockedRoutePayoffId = currentMode === 'campaign' && campaignUsesRoutePayoff(missionIndex)
    ? (options.routePayoffId ?? campaignRoutePayoffId ?? 'none') : 'none';
  if (!CAMPAIGN_ROUTE_PAYOFFS.some(payoff => payoff.id === lockedRoutePayoffId) || !campaignUsesRoutePayoff(missionIndex))
    lockedRoutePayoffId = 'none';
  const runFaction=currentMode==='campaign'?CAMPAIGN_MISSIONS[missionIndex]?.faction:options.faction||faction;
  try {
    // A WebSocket reconnect does not make the HTTP leaderboard unavailable.
    // Obtain the profile and ticket before creating a seed-locked simulation.
    await networkProfileWithin(6000);
    // Settle a previous ticket before asking the server for another one.
    if(loadPendingSoloSubmission()?.terminalReason) {
      toast(`PRIOR RESULT COULD NOT BE SUBMITTED · ${loadPendingSoloSubmission().terminalReason}`,true);
      clearPendingSoloSubmission();
    } else if(loadPendingSoloSubmission()) {
      const submitted=await retryPendingSoloSubmission();
      if(!submitted) throw new Error('A previous solo result is still waiting to submit. This sortie will be saved locally.');
    }
  const scenarioId=currentMode==='campaign'?CAMPAIGN_MISSIONS[missionIndex]?.id:options.mapId||skirmishMap;
    const run=await network.startRun({mode:currentMode,difficulty,faction:runFaction,scenarioId,
      ...(currentMode==='campaign'?{doctrineId:lockedDoctrineId,fieldOrderId:lockedFieldOrderId,carryoverId:lockedCarryoverId,supplyId:lockedSupplyId}:{skirmishOpening:requestedOpening,victoryMode:requestedVictoryMode})});
    if(run.rulesVersion!==SOLO_REPLAY_VERSION){
      network.finishRun(run.runId,{abandon:true}).catch(()=>{});
      const error=new Error(`Records server rules differ from this game (version ${SOLO_REPLAY_VERSION}). Restart or update the server before submitting ranked results.`);
      error.code='RULES_MISMATCH';
      throw error;
    }
    if(currentMode==='campaign'&&campaignUsesRoutePayoff(missionIndex)&&!Object.hasOwn(run,'routePayoffId')){
      network.finishRun(run.runId,{abandon:true}).catch(()=>{});
      throw new Error('The records server does not support campaign route payoffs.');
    }
    if(currentMode==='skirmish'&&requestedOpening==='command-rig'&&run.skirmishOpening!=='command-rig'){
      network.finishRun(run.runId,{abandon:true}).catch(()=>{});
      throw new Error('The records server does not support Command Rig openings.');
    }
    if(currentMode==='skirmish'&&(run.victoryMode||'dominion')!==requestedVictoryMode){
      network.finishRun(run.runId,{abandon:true}).catch(()=>{});
      throw new Error('The records server does not support the selected victory rules.');
    }
    activeRunId=run.runId;seed=run.seed??seed;rankedScenarioId=run.scenarioId||null;
    if(currentMode==='skirmish')lockedOpening=run.skirmishOpening||'established';
    if(currentMode==='skirmish')lockedVictoryMode=run.victoryMode||'dominion';
    if(currentMode==='campaign'&&run.doctrineId)lockedDoctrineId=run.doctrineId;
    if(currentMode==='campaign'&&run.fieldOrderId)lockedFieldOrderId=run.fieldOrderId;
    if(currentMode==='campaign'&&run.carryoverId)lockedCarryoverId=run.carryoverId;
    if(currentMode==='campaign'&&run.supplyId)lockedSupplyId=run.supplyId;
    if(currentMode==='campaign')lockedRoutePayoffId=run.routePayoffId||'none';
    if(currentMode==='campaign')lockedCampaignVeteran=validateCampaignVeteran(run.campaignVeteran)
      ? run.campaignVeteran : null;
  } catch(error) {rankedStartError=error;console.warn('Leaderboard run could not start.',error);}
  const mapId = rankedScenarioId || (options.mapId === 'random' ? SKIRMISH_MAPS[seed % SKIRMISH_MAPS.length].id : options.mapId || skirmishMap);
  resetProductionRepeatControls();
  try { game = currentMode==='campaign'
    ? createCampaignGame(missionIndex, options.difficulty||difficulty, activeRunId ? seed : undefined, lockedDoctrineId, lockedFieldOrderId, lockedCarryoverId, lockedSupplyId, lockedRoutePayoffId, lockedCampaignVeteran)
    : new Game({ seed, difficulty: options.difficulty || difficulty, faction: options.faction || faction, mode: 'skirmish', mapId, skirmishOpening:lockedOpening, victoryMode:lockedVictoryMode }); }
  catch (err) { console.error(err); alert(`Unable to start game: ${err.message}`); hide('#launch-status');gameStarting=false;return; }
  clearSoloRecovery();
  updateSoloRecoveryButton();
  if(currentMode==='campaign'){
    campaignDoctrineId=game.campaignDoctrineId||lockedDoctrineId;
    campaignFieldOrderId=game.campaignFieldOrderId||lockedFieldOrderId;
    campaignCarryoverId=game.campaignCarryoverId||lockedCarryoverId;
    campaignSupplyId=game.campaignSupplyId||lockedSupplyId;
    campaignRoutePayoffId=game.campaignRoutePayoffId||lockedRoutePayoffId;
  }
  if(game.skirmishOpening==='command-rig'){
    const rig=game.units.find(unit=>unit.owner==='player'&&unit.defId==='mcv'&&unit.hp>0);
    if(rig)game.select([rig.id]);
  }
  $('#launch-status').lastChild.textContent=' PREPARING BATTLEFIELD…';
  await ensureRenderer();
  faction=game.faction;
  if (currentMode === 'skirmish') { setSkirmishMap(game.mapId); setSkirmishOpening(game.skirmishOpening); setSkirmishVictoryMode(game.victoryMode||lockedVictoryMode); }
  gameEnded = false;
  lastPublicSalvagePhase = null;
  lastPublicBloomUntil = null;
  lastProductionSignature='';
  campaignGuidanceKey='';campaignGuidanceDismissedKey='';
  quickStartGuidance=currentMode==='skirmish'&&(options.guided===true||requestedVictoryMode==='elimination');
  quickStartStage=0;
  gameSeconds = 0;
  soloClock.reset();
  soloRecoveryElapsed = 0;
  activeReplayEnvelope={mode:currentMode,difficulty:options.difficulty||difficulty,faction:game.faction,
    seed:game.seed,scenarioId:currentMode==='campaign'?CAMPAIGN_MISSIONS[missionIndex].id:game.mapId,
    ...(currentMode==='campaign'?{doctrineId:campaignDoctrineId,fieldOrderId:campaignFieldOrderId,carryoverId:campaignCarryoverId,supplyId:campaignSupplyId,routePayoffId:game.campaignRoutePayoffId||'none',campaignVeteran:game.campaignVeteran||null}:{skirmishOpening:game.skirmishOpening,victoryMode:game.victoryMode||lockedVictoryMode})};
  activeRunRecorder=createSoloRecorder(game,soloClock);
  musicCombat = 0;
  groups = {};
  resetTacticalFeed();
  placeId = null; placementToken++; placementPending = false;
  attackMoveMode = false;
  cancelDigInTargeting();
  setRoutePlanMode(false);
  commandAbilityMode = null; commandAbilityToken++; commandAbilityPending = false;
  paused = false;
  playing = true;
  checkpointSoloRecovery();
  $('#toast-container').replaceChildren();
  resetCommandDeckForOperation();
  closeMissionBriefing();
  setMobileRadarOpen(false);
  setMobileDeckExpanded(true);
  closeTrackedDialog('#setup', false);
  hide('#menu'); hide('#campaign-select'); hide('#pause-modal'); hide('#end-modal'); show('#game-shell');
  hide('#launch-status');
  $('#multiplayer-status').classList.add('hidden');
  $('#save-game').classList.remove('hidden');$('#load-game').classList.remove('hidden');$('#restart-game').classList.remove('hidden');
  $('.operation-name strong').textContent = currentMode==='campaign' ? `${game.mission?.title?.toUpperCase()||'OPERATION'} · ${CAMPAIGN_DOCTRINES.find(item=>item.id===campaignDoctrineId)?.name?.toUpperCase()||'STANDARD'}` : 'CRYSTAL FRONT';
  $('#objective-text').textContent = objectiveLabel();
  camera.zoom = 1;
  deploymentIntro = null;
  $('#deployment-intro').classList.add('hidden');
  $('#zoom-value').textContent = '100%';
  resizeCanvases();
  centerOnBase();
  frameOpeningForces();
  updateUI(true);
  toast(currentMode==='campaign'?`OPERATION ${missionIndex+1} · ${game.mission?.title}`:
    game.skirmishOpening==='command-rig'?'COMMAND RIG READY · E TO DEPLOY · SEND ESCORT TO A RELAY':'COMMAND ONLINE · SECURE THE CRYSTAL FIELDS');
  if (currentMode === 'campaign' && campaignCarryoverId !== 'none')
    toast(`${CAMPAIGN_CARRYOVERS.find(item=>item.id===campaignCarryoverId)?.name||'Carryover Intel'} ACTIVE`);
  if (currentMode === 'campaign' && campaignSupplyId !== 'none')
    toast(`${CAMPAIGN_SUPPLIES.find(item=>item.id===campaignSupplyId)?.name||'Route requisition'} DEPLOYED`);
  if (currentMode === 'campaign' && game.campaignVeteran)
    toast(`${campaignVeteranRank(game.campaignVeteran)} ${campaignVeteranName(game.campaignVeteran).toUpperCase()} ATTACHED`);
  if (rankedStartError) toast(rankedStartError.code==='RULES_MISMATCH'
    ? 'UNRANKED SORTIE · RECORDS SERVER NEEDS AN UPDATE · SAVED LOCALLY'
    : 'UNRANKED SORTIE · COMMAND RECORDS UNAVAILABLE · SAVED LOCALLY', true);
  audio.play('confirm');audio.startAmbient();
  lastTime = performance.now();
  if(currentMode==='multiplayer'||matchMedia('(prefers-reduced-motion: reduce)').matches) $('#menu-toggle').focus();
  else canvas.focus();
  startDeploymentIntro();
  gameStarting=false;
}
function saveGame() {
  if (!game) return;
  if(currentMode==='multiplayer'){toast('LIVE MATCHES SAVE ON THE SERVER',true);return;}
  openSaveSlots('save');
}
function slotMetadata(slot) {
  const data=slot?.data;
  if(!data)return null;
  const mode=data.mode||data.game?.mode||'skirmish';
  const gameData=data.game||data;
  const scenario=mode==='campaign'
    ? CAMPAIGN_MISSIONS[data.missionIndex??0]?.title||gameData.mission?.title||'CAMPAIGN OPERATION'
    : SKIRMISH_MAPS.find(map=>map.id===gameData.mapId)?.name||gameData.mapId||'SKIRMISH';
  const seconds=Number.isFinite(data.gameSeconds)?data.gameSeconds:gameData.time||0;
  const date=new Date(slot.savedAt);
  return { scenario, difficulty:(data.difficulty||'normal').toUpperCase(), time:`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`, date:Number.isNaN(date.getTime())?'Unknown date':date.toLocaleString() };
}
let saveSlotMode='load';
let saveSlotConfirmation=null;
let saveSlotReturnFocus=null;
function openSaveSlots(mode) {
  saveSlotMode=mode;saveSlotConfirmation=null;
  saveSlotReturnFocus=document.activeElement;
  $('#save-slots-title').textContent=mode==='save'?'SAVE GAME':'LOAD GAME';
  $('#save-slots-description').textContent=mode==='save'?'Choose a slot. Saving over an occupied slot requires confirmation.':'Choose a saved operation to continue.';
  renderSaveSlots();show('#save-slots-modal');
  $('#save-slots-close').focus();
}
function closeSaveSlots(restoreFocus=true) {
  hide('#save-slots-modal');
  if(restoreFocus&&saveSlotReturnFocus?.isConnected&&!saveSlotReturnFocus.closest('.hidden'))saveSlotReturnFocus.focus();
  saveSlotReturnFocus=null;
}
function renderSaveSlots() {
  const list=$('#save-slot-list');list.replaceChildren();
  $('#save-slot-confirmation').textContent='';
  const slots=listSaveSlots();
  for(let index=1;index<=3;index++){
    const slot=slots[String(index)],meta=slotMetadata(slot);
    const card=document.createElement('div');card.className='save-slot';card.setAttribute('role','listitem');
    const heading=document.createElement('h3');heading.textContent=`SAVE SLOT ${index}`;card.append(heading);
    const summary=document.createElement('p');summary.textContent=meta?`${meta.scenario} · ${meta.difficulty} · ${meta.time} · Saved ${meta.date}`:'EMPTY SLOT';card.append(summary);
    const primary=document.createElement('button');primary.type='button';primary.className='button-secondary';
    primary.textContent=saveSlotMode==='save'?(slot?'OVERWRITE SLOT':'SAVE HERE'):(slot?'LOAD OPERATION':'EMPTY');
    primary.disabled=saveSlotMode==='load'&&!slot;
    primary.addEventListener('click',()=>activateSaveSlot(index,Boolean(slot)));card.append(primary);
    if(slot){const remove=document.createElement('button');remove.type='button';remove.className='button-secondary';remove.textContent='DELETE';remove.addEventListener('click',()=>confirmSaveSlotAction('delete',index));card.append(remove);}
    list.append(card);
  }
}
function confirmSaveSlotAction(action,index) {
  saveSlotConfirmation={action,index};
  const slotLabel=`SAVE SLOT ${index}`;
  const message=action==='delete'?`Delete ${slotLabel}? This cannot be undone.`:`Overwrite ${slotLabel} with the current operation?`;
  const region=$('#save-slot-confirmation');region.replaceChildren();
  const text=document.createElement('span');text.textContent=message;region.append(text);
  const yes=document.createElement('button');yes.type='button';yes.className='button-primary';yes.textContent=action==='delete'?'CONFIRM DELETE':'CONFIRM OVERWRITE';
  yes.addEventListener('click',()=>{
    if(action==='delete'){deleteSaveSlot(index);toast(`${slotLabel} DELETED`);renderSaveSlots();$('#save-slots-close').focus();}
    else persistSaveSlot(index);
  });region.append(yes);
  const no=document.createElement('button');no.type='button';no.className='button-secondary';no.textContent='CANCEL';no.addEventListener('click',()=>{saveSlotConfirmation=null;renderSaveSlots();$('#save-slots-close').focus();});region.append(no);yes.focus();
}
function activateSaveSlot(index,occupied) {
  if(saveSlotMode==='save'){if(occupied)confirmSaveSlotAction('overwrite',index);else persistSaveSlot(index);return;}
  const slot=getSaveSlot(index);if(slot?.data){closeSaveSlots(false);void loadSaved(slot.data);}
}
function persistSaveSlot(index) {
  try {
    writeSaveSlot(index,{ game: game.serialize(), gameSeconds, simulationTick:soloClock.completedTicks, faction, difficulty, groups, mode:currentMode, missionIndex, doctrineId:game.campaignDoctrineId||campaignDoctrineId, fieldOrderId:game.campaignFieldOrderId||campaignFieldOrderId, carryoverId:game.campaignCarryoverId||campaignCarryoverId, supplyId:game.campaignSupplyId||campaignSupplyId, routePayoffId:game.campaignRoutePayoffId||'none' },{scenario:currentMode==='campaign'?CAMPAIGN_MISSIONS[missionIndex]?.title:SKIRMISH_MAPS.find(map=>map.id===game.mapId)?.name});
    closeSaveSlots();toast(`OPERATION SAVED TO SLOT ${index}`);
  } catch (err) { console.error(err);toast('SAVE FAILED',true); }
}
function checkpointSoloRecovery() {
  if (!playing || gameEnded || replayMode || !game || !['campaign', 'skirmish'].includes(currentMode) ||
      game.status !== 'playing') return false;
  return saveSoloRecovery({ game: game.serialize(), gameSeconds, simulationTick: soloClock.completedTicks,
    faction, difficulty, groups, mode: currentMode, missionIndex,
    doctrineId: game.campaignDoctrineId || campaignDoctrineId,
    fieldOrderId: game.campaignFieldOrderId || campaignFieldOrderId,
    carryoverId: game.campaignCarryoverId || campaignCarryoverId,
    supplyId: game.campaignSupplyId || campaignSupplyId,
    routePayoffId: game.campaignRoutePayoffId || 'none' });
}
function updateSoloRecoveryButton() {
  const button = $('#recover-game');
  if (!button) return;
  const recovery = loadSoloRecovery();
  button.classList.toggle('hidden', !recovery);
  if (recovery) {
    const title = recovery.data.mode === 'campaign'
      ? CAMPAIGN_MISSIONS[recovery.data.missionIndex]?.title
      : SKIRMISH_MAPS.find(map => map.id === (() => { try { return JSON.parse(recovery.data.game).mapId; } catch { return ''; } })())?.name;
    button.textContent = `RECOVER ${title || 'INTERRUPTED BATTLE'} · UNRANKED`;
  }
}
async function loadSaved(data, fromRecovery = false) {
  if (!data) { toast('NO SAVED OPERATION FOUND',true); return; }
  clearPendingFieldAbility();
  try {
    selectionRoster.reset();
    resetProductionRepeatControls();
    abandonActiveRun();
    activePlayback=null;replayMode=false;replayAccumulator=0;replaySeekTarget=null;
    $('#game-shell').classList.remove('replay-mode');hide('#replay-controls');
    game = Game.deserialize(data.game || data);
    if (game.mode === 'multiplayer' || game.status !== 'playing') throw new Error('Recovery is not an active solo battle.');
    await ensureRenderer();
    gameSeconds = Number.isFinite(data.gameSeconds) ? data.gameSeconds : game.time || 0;
    soloClock.restore(Number.isSafeInteger(data.simulationTick) && data.simulationTick >= 0
      ? data.simulationTick : Math.max(0, Math.round((game.time || gameSeconds) / SOLO_STEP_SECONDS)));
    soloRecoveryElapsed = 0;
    musicCombat = 0;
    faction = data.faction || faction;
    difficulty = data.difficulty || difficulty;
    currentMode=data.mode||game.mode||'skirmish';missionIndex=data.missionIndex??0;
    if (!['campaign', 'skirmish'].includes(currentMode) || currentMode !== game.mode)
      throw new Error('Saved operation mode does not match its battlefield.');
    resetCommandDeckForOperation();
    if(currentMode==='campaign'){
      campaignDoctrineId=game.campaignDoctrineId||data.doctrineId||'standard';
      campaignFieldOrderId=game.campaignFieldOrderId||data.fieldOrderId||'none';
      campaignCarryoverId=game.campaignCarryoverId||data.carryoverId||'none';
      campaignSupplyId=game.campaignSupplyId||data.supplyId||'none';
      campaignRoutePayoffId=game.campaignRoutePayoffId||data.routePayoffId||'none';
      if(CAMPAIGN_DOCTRINES.some(item=>item.id===campaignDoctrineId))localStorage.setItem(DOCTRINE_KEY,campaignDoctrineId);
      if(validFieldOrderId(missionIndex,campaignFieldOrderId))localStorage.setItem(FIELD_ORDER_KEY,campaignFieldOrderId);
      if(validCarryoverId(missionIndex,campaignCarryoverId))localStorage.setItem(CARRYOVER_KEY,campaignCarryoverId);
      if(CAMPAIGN_SUPPLIES.some(supply=>supply.id===campaignSupplyId))localStorage.setItem(SUPPLY_KEY,campaignSupplyId);
    }
    if (currentMode === 'skirmish') { setSkirmishMap(game.mapId); setSkirmishOpening(game.skirmishOpening); setSkirmishVictoryMode(game.victoryMode||data.victoryMode||'dominion'); }
    groups = data.groups || {};
    resetTacticalFeed();
    gameEnded = false; paused = false; playing = true; placeId = null; placementToken++; placementPending = false;
    attackMoveMode = false; cancelDigInTargeting(); commandAbilityMode = null; commandAbilityToken++; commandAbilityPending = false;
    syncTargetingFocus();
    setRoutePlanMode(false);
    campaignGuidanceKey='';campaignGuidanceDismissedKey='';
    quickStartGuidance=false;
    quickStartStage=0;
    lastProductionSignature='';
    $('#toast-container').replaceChildren();
    setMobileRadarOpen(false);
    closeTrackedDialog('#setup', false);
    hide('#menu'); hide('#campaign-select'); hide('#pause-modal'); hide('#end-modal'); show('#game-shell');
    $('#multiplayer-status').classList.add('hidden');
    $('#save-game').classList.remove('hidden');$('#load-game').classList.remove('hidden');$('#restart-game').classList.remove('hidden');
    $('.operation-name strong').textContent = currentMode==='campaign' ? `${game.mission?.title?.toUpperCase()||'OPERATION'} · ${CAMPAIGN_DOCTRINES.find(item=>item.id===campaignDoctrineId)?.name?.toUpperCase()||'STANDARD'}` : 'CRYSTAL FRONT';
    $('#objective-text').textContent = objectiveLabel();
    clearSoloRecovery();updateSoloRecoveryButton();
    resizeCanvases(); centerOnBase();
    if(currentMode==='campaign'&&missionIndex===15&&game.campaignState?.phase==='recommission-wreck')
      frameOpeningForces();
    updateUI(true); toast(fromRecovery?'INTERRUPTED BATTLE RECOVERED · UNRANKED':'OPERATION RESTORED · UNRANKED'); audio.play('confirm');audio.startAmbient();lastTime = performance.now();$('#menu-toggle').focus();
    return true;
  } catch (err) { console.error(err); toast('THE SAVED GAME COULD NOT BE LOADED',true); return false; }
}
function abandonActiveRun() {
  activeRunRecorder?.dispose();
  activeRunRecorder=null;
  activeReplayEnvelope=null;
  if(!activeRunId)return;
  const runId=activeRunId;
  activeRunId=null;
  network.finishRun(runId,{abandon:true}).catch(()=>{});
}
function returnToMenu({preserveLobby=false}={}) {
  resetProductionRepeatControls();
  clearPendingFieldAbility();
  selectionRoster.reset();
  battlefieldPickerAddSquadMode=false;
  setBattlefieldPickerOpen(false);
  resetAiProfileDisclosure();
  setRoutePlanMode(false);
  closeBlueprintDetails();
  finishDeploymentIntro();
  clearSoloRecovery();updateSoloRecoveryButton();
  abandonActiveRun();
  if(!preserveLobby&&currentMode==='multiplayer'&&(lobby||matchRoomCode))network.send('leave_lobby');
  setMobileRadarOpen(false);
  paused = false; playing = false; game = null; activePlayback=null;replayMode=false;replayAccumulator=0;replaySeekTarget=null;
  syncTargetingFocus();
  selectedFormation='';formationSelectionKey='';formationPreviewCache={key:'',at:0,preview:null};
  lobby=null;matchRoomCode=null;opponentReconnecting=false;postMatchOpponent=null;postMatchFriendRequestPending=false;audio.stopAmbient();hide('#game-shell'); hide('#pause-modal'); hide('#end-modal');hide('#multiplayer-status');hide('#replay-controls');$('#game-shell').classList.remove('replay-mode');show('#menu');updateReplayAvailability();
  renderLobby();renderCasualMatchmaking();
  $(currentMode==='campaign'?'#campaign-menu':'#quick-start').focus();
}
function togglePause(force) {
  if (!playing || gameEnded) return;
  if(replayMode){if(replaySeekTarget!==null){replaySeekTarget=null;$('#replay-seek-status').textContent='SEEK CANCELLED';}paused=typeof force==='boolean'?force:!paused;syncTargetingFocus();replayAccumulator=0;updateReplayControls();lastTime=performance.now();refreshFrameRateReadout();return;}
  paused = typeof force === 'boolean' ? force : !paused;
  syncTargetingFocus();
  if (paused) {
    $('.pause-panel .panel-kicker').textContent=currentMode==='multiplayer'?'LIVE MATCH CONTINUES':'COMMAND PAUSED';
    $('#restart-game').innerHTML=`${currentMode==='campaign'?'RESTART OPERATION':'RESTART SKIRMISH'} <span>›</span>`;
    $('#quit-game').innerHTML=currentMode==='multiplayer'?'FORFEIT MATCH <span>›</span>':'RETURN TO TITLE <span>›</span>';
    show('#pause-modal');$('#resume-game').focus();audio.stopAmbient();
  } else { hide('#pause-modal');$('#menu-toggle').focus();audio.startAmbient();lastTime = performance.now(); }
  refreshFrameRateReadout();
}
function centerOnBase() {
  if (!game) return;
  const yard = game.buildings.find(b => b.owner === 'player' && /yard|command|hq/.test(b.defId)) || game.buildings.find(b => b.owner === 'player');
  if (yard) centerCamera(yard.x + yard.w / 2, yard.y + yard.h / 2);
  else if(game.units.some(u=>u.owner==='player'&&u.defId==='mcv'&&u.hp>0)){
    const rig=game.units.find(u=>u.owner==='player'&&u.defId==='mcv'&&u.hp>0);
    centerCamera(rig.x,rig.y);
  }
  else centerCamera(game.width * .25, game.height * .5);
}
function frameOpeningForces() {
  if (!game) return;
  // On a phone the tactical HUD leaves a short, narrow view of the field.
  // Open on the controllable squad so its selection targets stay clear of the
  // bottom squad dock; the base remains available through the object list.
  if (visibleW < 600) {
    const squad = game.units.filter(u => u.owner === 'player' && u.hp > 0 &&
      !u.embarkedIn && u.defId !== 'harvester');
    if (squad.length) {
      camera.zoom = .85;
      centerOnBase();
      let points = squad.map(u => toScreen(u.x, u.y));
      const spanX = Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
      if (spanX > visibleW - 52) {
        camera.zoom = Math.max(.65, camera.zoom * (visibleW - 52) / spanX);
        centerOnBase();
        points = squad.map(u => toScreen(u.x, u.y));
      }
      const middleX = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2;
      const middleY = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2;
      panCameraByScreen(visibleW * .48 - middleX, visibleH * .55 - middleY);
      $('#zoom-value').textContent = `${Math.round(camera.zoom * 100)}%`;
      return;
    }
  }
  const yard = game.buildings.find(b => b.owner === 'player' && /yard|command|hq/.test(b.defId)) ||
    game.buildings.find(b => b.owner === 'player');
  const startingUnits = game.units.filter(u => u.owner === 'player' && u.hp > 0 && !u.embarkedIn);
  const landmarks = startingUnits
    .map(u => ({ x: u.x, y: u.y }));
  if (yard) landmarks.push({ x: yard.x + yard.w / 2, y: yard.y + yard.h / 2 });
  if (landmarks.length < 2) return;

  // Relay locations are public strategic markers even while the terrain and
  // units around them remain under fog. Include the closest one in the opening
  // composition so the player's first objective has a visible direction.
  const groundForce = startingUnits.filter(unit => !unit.flying && unit.defId !== 'harvester');
  const relayOrigin = groundForce.length ? groundForce : startingUnits;
  const origin = relayOrigin.length ? relayOrigin.reduce((center, unit) => ({
    x: center.x + unit.x / relayOrigin.length,
    y: center.y + unit.y / relayOrigin.length,
  }), { x: 0, y: 0 }) : yard
    ? { x: yard.x + yard.w / 2, y: yard.y + yard.h / 2 }
    : { x: game.width * 0.25, y: game.height * 0.5 };
  const relay = [...(game.relays || [])]
    .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))[0];
  if (relay) landmarks.push({ x: relay.x, y: relay.y });

  const marginX = Math.max(28, Math.min(56, visibleW * .08));
  const marginY = Math.max(28, Math.min(54, visibleH * .08));
  const bounds = () => {
    const points = landmarks.map(point => toScreen(point.x, point.y));
    return {
      minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
      minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)),
    };
  };
  let box = bounds();
  const fit = Math.min((visibleW - marginX * 2) / Math.max(1, box.maxX - box.minX),
    (visibleH - marginY * 2) / Math.max(1, box.maxY - box.minY));
  // A small desktop pullback gives the relay axis room without making the
  // starting units too small to pick. Lower bound protects unusually spread
  // openings from an unreadable strategic-scale shot.
  camera.zoom = Math.max(.72, Math.min(.92, fit));
  centerOnBase();
  box = bounds();
  const focusX = (box.minX + box.maxX) / 2;
  const focusY = (box.minY + box.maxY) / 2;
  const relayScreen = relay ? toScreen(relay.x, relay.y) : null;
  const originScreen = toScreen(origin.x, origin.y);
  const dx = visibleW / 2 - focusX + (relayScreen ? (relayScreen.x - originScreen.x) * .08 : 0);
  const dy = visibleH / 2 - focusY + (relayScreen ? (relayScreen.y - originScreen.y) * .08 : 0);
  if (dx || dy) panCameraByScreen(dx, dy);
  $('#zoom-value').textContent = `${Math.round(camera.zoom * 100)}%`;
}
function centerCamera(x, y) { camera.x = x - visibleW / (2 * TILE_SIZE * camera.zoom); camera.y = y - visibleH / (2 * TILE_SIZE * camera.zoom); clampCamera(); }
function clampCamera() {
  if (!game) return;
  const tilesW = visibleW / (TILE_SIZE * camera.zoom), tilesH = visibleH / (TILE_SIZE * camera.zoom);
  if(renderer3d){
    // The isometric view can look beyond the map's diorama rim. Bound its
    // center so edge bases and units can actually be centered at every zoom.
    camera.x=Math.max(0,Math.min(game.width,camera.x+tilesW/2))-tilesW/2;
    camera.y=Math.max(0,Math.min(game.height,camera.y+tilesH/2))-tilesH/2;
    return;
  }
  camera.x = Math.max(-1, Math.min(game.width - tilesW + 1, camera.x));
  camera.y = Math.max(-1, Math.min(game.height - tilesH + 1, camera.y));
}
function resizeCanvases() {
  const focus=renderer3d&&game&&playing
    ?{x:camera.x+visibleW/(2*scale()),y:camera.y+visibleH/(2*scale())}:null;
  const rect = canvas.parentElement.getBoundingClientRect();
  dpr = Math.min(devicePixelRatio || 1, 2);
  visibleW = rect.width; visibleH = rect.height;
  canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
  overlay.width = Math.round(rect.width * dpr); overlay.height = Math.round(rect.height * dpr);
  overlay.style.width = `${rect.width}px`; overlay.style.height = `${rect.height}px`;
  if(renderer3d)renderer3d.resize(rect.width,rect.height,dpr);
  else {canvas.width = Math.round(rect.width * dpr);canvas.height = Math.round(rect.height * dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if(focus){camera.x=focus.x-visibleW/(2*scale());camera.y=focus.y-visibleH/(2*scale());}
  clampCamera();
  syncRendererView();
}
function scale() { return TILE_SIZE * camera.zoom; }
function toScreen(x, y) { if(renderer3d){syncRendererView();return renderer3d.worldToScreen(x,y);}return { x: (x - camera.x) * scale(), y: (y - camera.y) * scale() }; }
function toWorld(sx, sy) { if(renderer3d){syncRendererView();return renderer3d.screenToWorld(sx,sy);}return { x: sx / scale() + camera.x, y: sy / scale() + camera.y }; }
function eventPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function setPointer(e) {
  const p=eventPoint(e);pointer.x=p.x;pointer.y=p.y;
  pointer.inside=true;
  refreshPointerLabel();
}
function refreshPointerLabel() {
  if(!game||!pointer.inside)return;
  const w=toWorld(pointer.x,pointer.y);pointer.wx=w.x;pointer.wy=w.y;
  const bridge=bridgeAt(w.x,w.y);
  const wreck=bridge?null:wreckAt(w.x,w.y);
  const tileX=Math.floor(w.x),tileY=Math.floor(w.y);
  const sector=`SECTOR ${String(tileX).padStart(2,'0')} // ${String(tileY).padStart(2,'0')}`;
  const vantage=game.terrain[tileY]?.[tileX]?.elevation===1&&fogAt(tileX,tileY)===2;
  const label=bridge?`${sector} · ${bridge.destroyed?'BRIDGE DOWN':`BRIDGE ${Math.round(bridge.hp/bridge.maxHp*100)}%`}`:
    wreck?`${sector} · ${wreck.campaignFreightCache?'FREIGHT CACHE':'WRECK SALVAGE'} ${fmt(wreck.value)} · ${Math.max(1,Math.ceil(wreck.expiresAt-game.time))}S LEFT`:
      vantage?`${sector} · HIGH GROUND (+1 SIGHT · +0.5 REACH)`:sector;
  if($('#coord-label').textContent!==label)$('#coord-label').textContent=label;
}
function panCameraByScreen(dx,dy) {
  if(renderer3d){syncRendererView();const delta=renderer3d.screenDeltaToWorld(-dx,-dy);camera.x+=delta.x;camera.y+=delta.y;}
  else{camera.x-=dx/scale();camera.y-=dy/scale();}
  clampCamera();syncRendererView();
}
function changeZoom(delta, sx = visibleW / 2, sy = visibleH / 2) {
  const before = toWorld(sx, sy);
  camera.zoom = Math.max(.65, Math.min(1.8, camera.zoom * (delta > 0 ? 1.15 : 1 / 1.15)));
  if(renderer3d){syncRendererView();const after=toWorld(sx,sy);camera.x+=before.x-after.x;camera.y+=before.y-after.y;}
  else {camera.x = before.x - sx / scale(); camera.y = before.y - sy / scale();}
  clampCamera();syncRendererView();
  $('#zoom-value').textContent = `${Math.round(camera.zoom * 100)}%`;
}

function bridgeAt(wx,wy){
  return (game?.bridges||[]).find(bridge=>wx>=bridge.x&&wy>=bridge.y&&
    wx<bridge.x+bridge.w&&wy<bridge.y+bridge.h&&fogAt(wx,wy)===2)||null;
}
function wreckAt(wx,wy){
  if(fogAt(wx,wy)!==2)return null;
  return (game?.wrecks||[]).findLast(wreck=>
    Math.hypot(wx-wreck.x,wy-wreck.y)<=.7)||null;
}
function projectedUnitPick(unit) {
  if (!renderer3d) return null;
  const def = game.unitDefs?.[unit.defId];
  if (!def) return null;
  const center = renderer3d.worldToScreen(unit.x, unit.y,
    def.flying ? 1.1 : def.armor === 'infantry' ? 0.55 : 0.48,{absoluteHeight:!!def.flying});
  return {
    x: center.x, y: center.y,
    rx: def.flying ? Math.max(22, 28 * camera.zoom)
      : def.armor === 'infantry' ? Math.max(10, 13 * camera.zoom) : Math.max(17, 25 * camera.zoom),
    ry: def.flying ? Math.max(16, 21 * camera.zoom)
      : def.armor === 'infantry' ? Math.max(12, 17 * camera.zoom) : Math.max(14, 20 * camera.zoom),
  };
}
function objectAt(wx, wy) {
  if (!game) return null;
  if (renderer3d) {
    // The ground-plane ray falls below a model's visible hull in the isometric
    // camera. Pick the rendered unit first so clicking a tank's roof or an
    // infantry silhouette selects what is visibly under the pointer.
    let best = null, bestDistance = 1;
    for (const unit of game.units) {
      if (unit.hp <= 0 || unit.embarkedIn || unit.owner === 'enemy' && !game.isVisible(unit)) continue;
      const pick = projectedUnitPick(unit);
      if (!pick) continue;
      const distance = ((pointer.x - pick.x) / pick.rx) ** 2 + ((pointer.y - pick.y) / pick.ry) ** 2;
      if (distance < bestDistance) { best = unit; bestDistance = distance; }
    }
    if (best) return best;
  }
  for (let i = game.units.length - 1; i >= 0; i--) {
    const u = game.units[i];
    if (u.hp <= 0 || u.embarkedIn || u.owner === 'enemy' && !game.isVisible(u)) continue;
    if (Math.hypot(wx - u.x, wy - u.y) <= .55) return u;
  }
  for (let i = game.buildings.length - 1; i >= 0; i--) {
    const b = game.buildings[i];
    if (b.owner === 'enemy' && !game.isVisible(b)) continue;
    if (wx >= b.x && wy >= b.y && wx <= b.x + b.w && wy <= b.y + b.h) return b;
  }
  return bridgeAt(wx,wy)||wreckAt(wx,wy);
}
function selectAt(wx, wy, additive = false) {
  const hit = objectAt(wx, wy);
  if (hit && hit.owner === 'player') {
    const prior = additive ? (game.selection || []) : [];
    game.select([...new Set([...prior, hit.id])]);
    audio.play('select');
  } else if (!additive) game.select([]);
  updateSelectionCard();
}
function selectBox(x1, y1, x2, y2, additive) {
  const left=Math.min(x1,x2),right=Math.max(x1,x2),top=Math.min(y1,y2),bottom=Math.max(y1,y2);
  const ids = game.units.filter(u => {
    if(u.owner!=='player'||u.hp<=0||u.embarkedIn)return false;
    const p=projectedUnitPick(u);
    if(p)return p.x+p.rx>=left&&p.x-p.rx<=right&&p.y+p.ry>=top&&p.y-p.ry<=bottom;
    const ground=toScreen(u.x,u.y);
    return ground.x>=left&&ground.x<=right&&ground.y>=top&&ground.y<=bottom;
  }).map(u => u.id);
  const selected = additive ? [...new Set([...(game.selection || []), ...ids])] : ids;
  game.select(selected); updateSelectionCard();
  if(selected.length)audio.play('select');
}
function issueContext(wx, wy, queue = false) {
  if (!game) return;
  queue ||= routePlanMode;
  if (placeId) { cancelPlacement(); return; }
  if(digInMode){cancelDigInTargeting();return;}
  if(commandAbilityMode){cancelCommandAbility();return;}
  if(attackMoveMode){issueTargetOrder(wx,wy,queue);return;}
  const hit = objectAt(wx, wy);
  const own = selectedObjects();
  if (!own.length) return;
  if (!queue && isHarvesterHomeSelection(own) && isCompletedFriendlyRefinery(hit)) {
    issueAssignRefineryTarget(hit);
    return;
  }
  if(queue){
    const result=hit?.owner==='enemy'?game.issueAttack(hit.id,true):issueMoveCommand(wx,wy,false,true);
    resultMessage(result,hit?.owner==='enemy'?'ATTACK QUEUED':'WAYPOINT QUEUED','order',{
      onSettled:ack=>{if(ack?.transportFailure)setRoutePlanMode(false);}
    });
    updateSelectionCard();
    return;
  }
  if(hit?.defId==='serviceBay'&&hit.owner==='player'&&own.some(o=>!('w' in o)&&o.hp<o.maxHp&&
    ['light','heavy'].includes(game.unitDefs?.[o.defId]?.armor))) {
    const result=game.issueServiceAtWorkshop(hit.id);
    resultMessage(result,'SERVICE ORDERED');
    if(result.ok&&result.reason)toast(result.reason,true);
    return;
  }
  if(hit&&game.wrecks?.includes(hit)){
    if(own.some(o=>o.defId==='engineer'))resultMessage(game.issueRecoverWreck(hit.id),'WRECK RECOVERY ORDERED');
    else resultMessage(issueMoveCommand(wx,wy));
    return;
  }
  if (hit && game.bridges?.includes(hit)) {
    const engineers = own.filter(o => o.defId === 'engineer');
    const armed = own.filter(o => game.unitDefs?.[o.defId]?.weapon);
    if (engineers.length && armed.length) {
      if (hit.destroyed) resultMessage(game.issueEngineer(hit.id),'BRIDGE REPAIR ORDERED');
      else resultMessage(game.issueAttack(hit.id),'BRIDGE DEMOLITION ORDERED · ENGINEERS NEED A DESTROYED SPAN');
    }
    else if (engineers.length) resultMessage(game.issueEngineer(hit.id),'BRIDGE REPAIR ORDERED');
    else if (own.some(o => game.unitDefs?.[o.defId]?.weapon)) resultMessage(game.issueAttack(hit.id),'BRIDGE DEMOLITION ORDERED');
    else resultMessage(issueMoveCommand(wx, wy));
    return;
  }
  if(hit?.owner==='player'&&isTroopCarrier(hit)&&own.some(o=>game.unitDefs?.[o.defId]?.armor==='infantry'))
    resultMessage(game.issueBoard(hit.id),'BOARDING CARRIER');
  else if(isFriendlyFieldBunker(hit)&&own.some(isBunkerEligibleInfantry))
    issueBunkerCommand(hit.id,'garrison');
  else if(medicEscortPatient(hit)&&isFriendlyFollowTarget(hit)&&own.length&&own.every(unit=>unit.defId==='medic'))
    resultMessage(game.issueFollow(hit.id),escortFeedback(hit));
  else if(fieldRepairPatient(hit)&&own.length&&own.every(unit=>unit.defId==='engineer'))
    resultMessage(game.issueFieldRepair(hit.id),'FIELD REPAIR ORDERED · HOLD THE VEHICLE STILL');
  else if (hit && 'w' in hit && own.some(o=>o.defId==='engineer')) {
    const armed=own.some(o=>game.unitDefs?.[o.defId]?.weapon);
    if(armed&&hit.owner==='enemy'){
      resultMessage(game.issueAttack(hit.id),hit.hp/hit.maxHp<=0.75?'ATTACK ORDERED':'ATTACK ORDERED · SEND ENGINEERS BELOW 75%');
      if(hit.hp/hit.maxHp<=0.75)resultMessage(game.issueEngineer(hit.id),'ENGINEER CAPTURE ORDERED');
    }else resultMessage(game.issueEngineer(hit.id));
  }
  else if (hit && hit.owner === 'enemy') resultMessage(game.issueAttack(hit.id));
  else if (getCell(wx, wy)?.resource > 0 && own.some(o => /harvester/.test(o.defId))) resultMessage(issueMoveCommand(wx, wy));
  else if (own.some(o => 'w' in o) && !own.some(o => !('w' in o))) {
    const b = own.find(o=>['barracks','factory','helipad'].includes(o.defId));
    if(b&&game.setRally)resultMessage(productionRallyOrder(b,wx,wy,hit),
      mobileRallyAvailable()&&isFriendlyRallyUnit(hit)?'MOBILE REINFORCEMENT RALLY SET':'FIXED RALLY POINT SET');
  } else resultMessage(issueMoveCommand(wx, wy));
}
function attemptPlacement(wx, wy) {
  if(placementPending)return;
  const x = Math.floor(wx), y = Math.floor(wy);
  const result = game.issueBuild(placeId, x, y);
  if(result?.pending){
    const requestedPlaceId=placeId;
    const token=placementToken;
    placementPending=true;
    resultMessage(result, `${game.buildingDefs?.[requestedPlaceId]?.name||keyName(requestedPlaceId)} deployed`, 'order', {
      onAccepted:()=>{if(placementToken===token&&placeId===requestedPlaceId)cancelPlacement(false);},
      onSettled:ack=>{if(placementToken===token){placementPending=false;if(ack?.transportFailure&&placeId===requestedPlaceId)cancelPlacement(false);}}
    });
  } else if (resultMessage(result, `${game.buildingDefs?.[placeId]?.name||keyName(placeId)} deployed`)) cancelPlacement(false);
  updateUI(true);
}
let placementPending = false;
let targetingFocusActive = null;
function syncTargetingFocus() {
  const active = !!(playing && !paused && !gameEnded && !replayMode && (attackMoveMode || commandAbilityMode || digInMode || placeId));
  if (active === targetingFocusActive) return;
  targetingFocusActive = active;
  const battlefield=$('#battlefield-wrap');
  battlefield.classList.toggle('tactical-targeting', active);
  if(active&&!$('#targeting-cancel')){
    const button=document.createElement('button');
    button.id='targeting-cancel';button.type='button';button.className='targeting-cancel';
    button.textContent='CANCEL TARGETING';button.setAttribute('aria-label','Cancel current targeting action');
    button.addEventListener('click',cancelActiveTargeting);
    battlefield.append(button);
  }
}
function targetingCancelCopy(){return innerWidth<=670||matchMedia('(pointer: coarse)').matches?'':' <span>·</span> ESC TO CANCEL';}
function setPlacementHint(){
  $('#placement-hint').innerHTML=innerWidth<=670||matchMedia('(pointer: coarse)').matches?'TAP BUILD SITE':'LEFT CLICK TO PLACE <span>·</span> ESC TO CANCEL';
}
function cancelActiveTargeting(){
  if(placeId){cancelPlacement();return true;}
  if(digInMode){cancelDigInTargeting();return true;}
  if(commandAbilityMode){cancelCommandAbility();return true;}
  if(attackMoveMode||routePlanMode){attackMoveMode=false;targetOrderPending=false;targetOrderToken++;hide('#attack-hint');setRoutePlanMode(false);updateAttackMoveButton();return true;}
  return false;
}
function cancelPlacement(cancelEngine = false) { placementToken++; if (cancelEngine && game?.cancelConstruction && placeId) resultMessage(game.cancelConstruction(),'CONSTRUCTION CANCELED'); placeId = null; placementPending=false; hide('#placement-hint'); syncTargetingFocus(); }
function cancelCommandAbility(){commandAbilityToken++;commandAbilityMode=null;commandAbilityPending=false;$('#attack-hint').removeAttribute('title');hide('#attack-hint');syncTargetingFocus();}
function updateSelectionRoster(state){
  const container=$('#selection-roster');
  const toggle=$('#selection-roster-toggle');
  if(!state?.visible)toggle.setAttribute('aria-expanded','false');
  container.classList.toggle('hidden',!state?.visible);
  toggle.classList.toggle('hidden',!state?.visible);
  toggle.setAttribute('aria-label',toggle.getAttribute('aria-expanded')==='true'?'Hide unit type roster':'Show unit type roster');
  if(!state?.visible)return;
  const rows=[{key:'all',name:'ALL',count:state.allIds.length,selectedCount:state.selectedIds.length},...state.groups];
  const liveKeys=new Set(rows.map(row=>String(row.key)));
  for(const [key,button] of selectionRosterButtons){
    if(!liveKeys.has(key)){button.remove();selectionRosterButtons.delete(key);}
  }
  for(const row of rows){
    const key=String(row.key);
    let button=selectionRosterButtons.get(key);
    if(!button){
      button=document.createElement('button');
      button.type='button';
      button.className='selection-roster-button';
      button.dataset.selectionRoster=key;
      selectionRosterButtons.set(key,button);
    }
    const label=key==='all'?'ALL':row.name||key;
    const count=key==='all'?state.allIds.length:row.count;
    const selected=key==='all'?state.isAll:row.selectedCount>0;
    button.textContent=`${label} · ${count}`;
    button.setAttribute('aria-label',`${label}, ${count} ${count===1?'unit':'units'}${key==='all'?'':`, ${row.selectedCount} selected`}`);
    button.title=key==='all'?'Select all surviving units from the original mixed selection':`Select all ${label} units from the original mixed selection`;
    button.setAttribute('aria-pressed',String(selected));
    button.disabled=!!replayMode;
    if(button.parentNode!==container)container.append(button);
  }
}
function routeSelectionKey(units=selectedObjects().filter(o=>!('w' in o)&&o.owner==='player')){
  return units.map(unit=>unit.id).sort().join('|');
}
function updateRoutePlanControl(units){
  const button=$('#route-plan-toggle');
  const key=routeSelectionKey(units);
  if(routePlanMode&&(!key||key!==routePlanSelectionKey))setRoutePlanMode(false);
  button.disabled=!key||!playing||paused||replayMode;
  button.classList.toggle('active',routePlanMode);
  button.setAttribute('aria-pressed',String(routePlanMode));
  button.setAttribute('aria-label',routePlanMode?'Disable route planning for selected units':'Enable route planning for selected units');
  button.title=routePlanMode?'Tap successive waypoints or visible enemies; tap ROUTE again to finish':'Plan a route with successive battlefield taps';
  syncTargetingFocus();
}
function setRoutePlanMode(enabled){
  if(enabled){
    const key=routeSelectionKey();
    if(!key)return;
    routePlanSelectionKey=key;
    routePlanMode=true;
    toast('ROUTE PLANNING · TAP WAYPOINTS OR ENEMIES');
  }else{
    const wasActive=routePlanMode;
    routePlanMode=false;
    routePlanSelectionKey='';
    if(wasActive&&['attack','forceMove','reverseMove'].includes(attackMoveMode)){
      attackMoveMode=false;targetOrderPending=false;targetOrderToken++;hide('#attack-hint');
      updateAttackMoveButton();
    }
  }
  const button=$('#route-plan-toggle');
  button.classList.toggle('active',routePlanMode);
  button.setAttribute('aria-pressed',String(routePlanMode));
  button.setAttribute('aria-label',routePlanMode?'Disable route planning for selected units':'Enable route planning for selected units');
  button.title=routePlanMode?'Tap successive waypoints or visible enemies; tap ROUTE again to finish':'Plan a route with successive battlefield taps';
}
function targetOrderHint(mode,label,prompt){
  const routing=['attack','forceMove','reverseMove'].includes(mode);
  const touchGuide=matchMedia('(pointer: coarse)').matches||innerWidth<=670;
  const formationNote=selectedFormation&&['attack','forceMove'].includes(mode)?` · ${selectedFormation.toUpperCase()} LAYOUT`:'';
  return `${label} · ${touchGuide?prompt.replace(/^SELECT /,'TAP '):prompt}${routing?(routePlanMode?' · TAP NEXT POINT':touchGuide?' · TAP ROUTE TO QUEUE':' · SHIFT+CLICK TO QUEUE'):''}${formationNote}${targetingCancelCopy()}`;
}
function startTargetOrder(mode, label, prompt='SELECT DESTINATION'){
  if(!game)return;
  cancelDigInTargeting();
  if(mode==='assignRefinery'&&!isHarvesterHomeSelection()){
    toast('SELECT ONLY YOUR HARVESTERS TO SET A HOME REFINERY',true);
    return;
  }
  if(mode==='rally'&&!selectedProductionBuilding()){toast('SELECT A COMPLETED PRODUCTION BUILDING',true);return;}
  if(mode==='rally'&&mobileRallyAvailable())prompt='SELECT GROUND OR FRIENDLY UNIT';
  if(!['attack','forceMove','reverseMove'].includes(mode))setRoutePlanMode(false);
  if(placeId)cancelPlacement();
  commandAbilityToken++;commandAbilityMode=null;commandAbilityPending=false;
  targetOrderPending=false;
  targetOrderToken++;
  attackMoveMode=mode;
  updateAttackMoveButton();
  $('#attack-hint').innerHTML=targetOrderHint(mode,label,prompt);
  $('#attack-hint').title=selectedFormation&&['attack','forceMove'].includes(mode)?'Approximate positions; terrain can adjust slots.':'';
  show('#attack-hint');
  syncTargetingFocus();
  if(mode==='recommissionWreck'&&battlefieldPickerIsOpen())
    $('#battlefield-picker-status').textContent='Targeting active · choose a compatible visible vehicle wreck to recover its chassis.';
  renderBattlefieldPicker();
  toast(`${label} TARGETING ACTIVE`);
}
function startRecommissionTarget() {
  const selected = selectedObjects();
  if (!selected.length || selected.length !== 1 || selected[0].owner !== 'player' || selected[0].defId !== 'engineer') {
    toast('SELECT ONE ENGINEER TO RECOMMISSION A WRECK', true);
    return;
  }
  if (!recommissionRulesAvailable()) {
    toast('START A NEW BATTLE TO RECOMMISSION WRECKS', true);
    return;
  }
  startTargetOrder('recommissionWreck', 'RECOMMISSION WRECK', 'SELECT A VISIBLE COMPATIBLE WRECK');
}
function issueRecommissionWreckTarget(wreck) {
  if (!game || attackMoveMode !== 'recommissionWreck' || targetOrderPending) return false;
  if (!wreck || !(game.wrecks || []).includes(wreck)) {
    toast('SELECT A VISIBLE WRECK', true);
    return false;
  }
  const check = recommissionWreckCheck(wreck);
  if (!check.ok) {
    toast(check.reason || 'WRECK CANNOT BE RECOMMISSIONED', true);
    if (battlefieldPickerIsOpen()) $('#battlefield-picker-status').textContent = check.reason || 'Wreck cannot be recommissioned.';
    renderBattlefieldPicker();
    return false;
  }
  const token = targetOrderToken;
  const result = game.issueRecommissionWreck(wreck.id);
  if (result?.pending) {
    targetOrderPending = true;
    $('#attack-hint').innerHTML = `RECOMMISSION WRECK · WAITING FOR SERVER CONFIRMATION${targetingCancelCopy()}`;
    resultMessage(result, 'RECOMMISSION ORDERED · 12S', 'order', {
      onAccepted: () => {
        if (targetOrderToken !== token || attackMoveMode !== 'recommissionWreck') return;
        targetOrderPending = false; attackMoveMode = false; hide('#attack-hint'); updateAttackMoveButton();
        if (battlefieldPickerIsOpen()) $('#battlefield-picker-status').textContent = 'Recommission order accepted. Keep the Engineer alive through the 12 second repair.';
        renderBattlefieldPicker();
      },
      onSettled: ack => {
        if (targetOrderToken !== token || attackMoveMode !== 'recommissionWreck') return;
        targetOrderPending = false;
        if (!ack?.ok) $('#attack-hint').innerHTML = `RECOMMISSION WRECK · ORDER REJECTED · SELECT WRECK${targetingCancelCopy()}`;
      }
    });
    return true;
  }
  const accepted = resultMessage(result, 'RECOMMISSION ORDERED · 12S');
  if (accepted && targetOrderToken === token && attackMoveMode === 'recommissionWreck') {
    attackMoveMode = false; hide('#attack-hint'); updateAttackMoveButton();
    if (battlefieldPickerIsOpen()) $('#battlefield-picker-status').textContent = 'Recommission order issued. Keep the Engineer alive through the 12 second repair.';
  }
  renderBattlefieldPicker();
  return accepted;
}
function issueTargetOrder(wx,wy,queue=false,targetOverride=null){
  if(!game||!attackMoveMode||targetOrderPending)return;
  const mode=attackMoveMode, token=targetOrderToken;
  const label=mode==='attack'?'ATTACK MOVE':mode==='bunkerAttack'?'BUNKER ATTACK':keyName(mode).toUpperCase();
  const routed=['attack','forceMove','reverseMove'].includes(mode)&&routePlanMode;
  queue ||= routed;
  let result, success='', cue='order';
  if(mode==='recommissionWreck'){
    const target=objectAt(wx,wy);
    issueRecommissionWreckTarget(target&&game.wrecks?.includes(target)?target:null);
    return;
  }
  if(mode==='assignRefinery'){
    const target=objectAt(wx,wy);
    issueAssignRefineryTarget(target);
    return;
  }
  if(mode==='super'){result=game.useSuperweapon(wx,wy);success='STRATEGIC STRIKE ORDERED';}
  else if(mode==='engineer'){
    const target=targetOverride||objectAt(wx,wy);
    const wreck=target&&game.wrecks?.includes(target);
    const patient=fieldRepairPatient(target);
    result=wreck?game.issueRecoverWreck(target.id):patient?game.issueFieldRepair(target.id):engineerStructureTarget(target)?game.issueEngineer(target.id):
      {ok:false,reason:fieldRepairRulesInGame()?'Choose a damaged friendly ground vehicle or structure, a wreck, a destroyed bridge, or an empty enemy structure at 75% health or less.':'Choose a wreck, destroyed bridge, damaged friendly structure, or empty enemy structure at 75% health or less.'};
    success=wreck?'WRECK RECOVERY ORDERED':patient?'FIELD REPAIR ORDERED · HOLD THE VEHICLE STILL':'ENGINEER ORDERED';
  }
  else if(mode==='patrol'){result=game.issuePatrol(wx,wy);success='PATROL ROUTE SET';}
  else if(mode==='rally'){
    const building=selectedProductionBuilding();
    const target=targetOverride||objectAt(wx,wy);
    result=building?productionRallyOrder(building,wx,wy,target):{ok:false,reason:'Select a completed production building.'};
    success=mobileRallyAvailable()&&isFriendlyRallyUnit(target)?'MOBILE REINFORCEMENT RALLY SET':'FIXED RALLY POINT SET';
  }
  else if(mode==='follow'){
    const target=targetOverride||objectAt(wx,wy);
    result=target?game.issueFollow(target.id):{ok:false,reason:'Select a friendly unit or structure to follow.'};success=escortFeedback(target);
  }
  else if(mode==='board'){
    const target=targetOverride||objectAt(wx,wy);
    if(target&&isTroopCarrier(target)){result=game.issueBoard(target.id);success='BOARDING CARRIER';}
    else if(isFriendlyFieldBunker(target)&&selectedObjects().some(isBunkerEligibleInfantry)){
      result=game.issueGarrison(target.id);success='GARRISONING FIELD BUNKER';
    }else result={ok:false,reason:'Choose a completed friendly troop carrier or Field Bunker.'};
  }
  else if(mode==='bunkerAttack'){
    const target=targetOverride||objectAt(wx,wy);
    result=target&&target.owner==='enemy'?game.issueAttack(target.id,queue):{ok:false,reason:'Choose a visible enemy target for the Field Bunker.'};
    success='FIELD BUNKER TARGET SET';
  }
  else if(mode==='service'){
    const target=objectAt(wx,wy);
    result=target?.defId==='serviceBay'?game.issueServiceAtWorkshop(target.id):
      {ok:false,reason:'Select a friendly Field Workshop.'};
    success='SERVICE ORDERED';
  }
  else if(mode==='unload'){result=game.issueUnload(wx,wy);success='CARRIER MOVING TO UNLOAD';}
  else if(mode==='force'){result=game.issueForceFire(wx,wy);success='FORCE FIRE ORDERED';}
  else if(mode==='forceMove'){result=issueForceMoveCommand(wx,wy,queue);success=queue?'FORCE MOVE QUEUED':'FORCE MOVE ORDERED';}
  else if(mode==='reverseMove'){result=issueReverseMoveCommand(wx,wy,queue);success=queue?'REVERSE MOVE QUEUED':'ARMOR REVERSING · 65% SPEED';}
  else if(mode==='attack'&&game.bridges?.includes(objectAt(wx,wy))) {
    const bridge=objectAt(wx,wy);
    result=game.issueAttack(bridge.id,queue);success=queue?'BRIDGE DEMOLITION QUEUED':'BRIDGE DEMOLITION ORDERED';
  }
  else {result=issueMoveCommand(wx,wy,true,queue);success=queue?'ATTACK MOVE QUEUED':'ATTACK MOVE ORDERED';}
  const finishTargeting=()=>{
    attackMoveMode=false;hide('#attack-hint');updateAttackMoveButton();
    if(innerWidth<=670&&battlefieldPickerIsOpen())setBattlefieldPickerOpen(false,{restoreFocus:true});
  };
  if(result?.pending){
    targetOrderPending=true;
    $('#attack-hint').innerHTML=`${label} · WAITING FOR SERVER CONFIRMATION${targetingCancelCopy()}`;
    resultMessage(result,success,cue,{
      onAccepted:()=>{if(targetOrderToken===token&&attackMoveMode===mode){targetOrderPending=false;if(routed&&routePlanMode)$('#attack-hint').innerHTML=targetOrderHint(mode,label,'SELECT NEXT DESTINATION');else finishTargeting();}},
      onSettled:ack=>{if(targetOrderToken===token&&attackMoveMode===mode){targetOrderPending=false;if(!ack?.ok){if(ack?.transportFailure){setRoutePlanMode(false);attackMoveMode=false;hide('#attack-hint');updateAttackMoveButton();}else $('#attack-hint').innerHTML=`${label} · ORDER REJECTED · SELECT TARGET${targetingCancelCopy()}`;}}}
    });
  } else if(resultMessage(result,success,cue)&&targetOrderToken===token&&attackMoveMode===mode){
    if(routed&&routePlanMode)$('#attack-hint').innerHTML=targetOrderHint(mode,label,'SELECT NEXT DESTINATION');
    else finishTargeting();
  }
}
function startCommandAbility(id){
  const ability=COMMAND_ABILITIES[id];
  if(!ability||!game)return;
  cancelDigInTargeting();
  setRoutePlanMode(false);
  if(game.commandEnergy.player<ability.cost){toast('INSUFFICIENT COMMAND ENERGY',true);audio.play('error');return;}
  if(game.commandCooldowns.player[id]>0){toast('ABILITY COOLING DOWN',true);audio.play('error');return;}
  if(ability.package&&game.research?.player?.tactical!==ability.package){toast('RESEARCH THIS TACTICAL PACKAGE FIRST',true);audio.play('error');return;}
  if(id==='stormcall'){
    if(!['warning','surge'].includes(game.storm?.phase)){toast('STORMCALL REQUIRES AN ACTIVE ION FRONT',true);audio.play('error');return;}
    if(!game.relays.some(relay=>relay.owner==='player')){toast('CAPTURE A RELAY TO CALL THE STORM',true);audio.play('error');return;}
    if(!game.relays.some(relay=>relay.owner==='player'&&!game._relayIsContested(relay))){toast('SECURE AN UNCONTESTED RELAY TO CALL THE STORM',true);audio.play('error');return;}
  }
  if(placeId)cancelPlacement();else placementToken++;
  attackMoveMode=false;targetOrderPending=false;targetOrderToken++;
  updateAttackMoveButton();
  commandAbilityToken++;commandAbilityPending=false;
  commandAbilityMode=id;
  const abilityPrompt=id==='stormcall'?'SELECT GROUND NEAR A SECURE RELAY':'SELECT TARGET';
  $('#attack-hint').innerHTML=`${ability.name.toUpperCase()} · ${innerWidth<=670||matchMedia('(pointer: coarse)').matches?abilityPrompt.replace(/^SELECT /,'TAP '):abilityPrompt}${targetingCancelCopy()}`;
  $('#attack-hint').removeAttribute('title');
  show('#attack-hint');
  syncTargetingFocus();
  toast(`${ability.name} targeting active`);
}

const FALLBACK_TERRAIN_PALETTES = Object.freeze({
  'shard-valley': { sand:['#52604a','#57664d','#4c5a47','#61704f','#4b604c','#5c6651'], rock:['#364740','#3e4a43','#404a40','#3b463b'], water:['#1b4140','#1b3d3b'], minimap:'#62725b' },
  'twin-passes': { sand:['#576473','#637284','#536375','#6d7c88','#596b7e','#697688'], rock:['#354551','#455767','#3b4c5d','#4a5968'], water:['#1e4355','#1b3e50'], minimap:'#657482' },
  'delta-crossing': { sand:['#50695a','#5a7461','#536d5c','#647b65','#4c685a','#5d7764'], rock:['#3d5a53','#47665c','#40594f','#52695b'], water:['#1b595c','#175154'], minimap:'#5c7965' },
  'canyon-ring': { sand:['#87634d','#966c53','#805b49','#a07555','#8a624b','#996e52'], rock:['#64483f','#745245','#6b4b40','#79574a'], water:['#42555b','#3d4f57'], minimap:'#926b50' },
  'storm-basin': { sand:['#5e5870','#6c647a','#5c566e','#766b82','#655d73','#70677c'], rock:['#49465a','#565267','#4c4a60','#5e596d'], water:['#313b60','#2c3758'], minimap:'#6a6277' },
});
function drawTerrainTile(x, y, cell, t) {
  const s = scale(), p = toScreen(x,y);
  if (p.x + s < 0 || p.y + s < 0 || p.x > visibleW || p.y > visibleH) return;
  const r = hash(x,y);
  // Bridge damage is current intelligence only. An explored tile outside sight
  // must not reveal a remote demolition through the fallback terrain.
  const type = cell?.bridgeId && fogAt(x,y)!==2 ? 'sand' : cell?.type || 'sand';
  const palette=FALLBACK_TERRAIN_PALETTES[game?.mapId]||FALLBACK_TERRAIN_PALETTES['shard-valley'];
  if (type === 'water') {
    ctx.fillStyle = palette.water[r>.5?0:1]; ctx.fillRect(p.x,p.y,s+1,s+1);
    ctx.strokeStyle = '#73c9b331'; ctx.lineWidth = Math.max(1,s*.025);
    ctx.beginPath(); ctx.moveTo(p.x+s*.14,p.y+s*(.35+Math.sin(t*2+x)*.04)); ctx.quadraticCurveTo(p.x+s*.5,p.y+s*.2,p.x+s*.82,p.y+s*.38); ctx.stroke();
  } else {
    const region=hash(Math.floor(x/6),Math.floor(y/6),70);
    ctx.fillStyle = type === 'rock' ? palette.rock[Math.floor(r*palette.rock.length)] : palette.sand[Math.floor((r*.66+region*.34)*palette.sand.length)%palette.sand.length]; ctx.fillRect(p.x,p.y,s+1,s+1);
    if (type === 'rock') {
      ctx.fillStyle = '#28372e90'; ctx.beginPath(); ctx.moveTo(p.x+s*.08,p.y+s*.77); ctx.lineTo(p.x+s*.36,p.y+s*.16); ctx.lineTo(p.x+s*.85,p.y+s*.36); ctx.lineTo(p.x+s*.89,p.y+s*.81); ctx.fill();
      ctx.strokeStyle = '#80917c80'; ctx.beginPath(); ctx.moveTo(p.x+s*.2,p.y+s*.6); ctx.lineTo(p.x+s*.38,p.y+s*.19); ctx.lineTo(p.x+s*.78,p.y+s*.35); ctx.stroke();
    } else {
      for (let i=0;i<3;i++) { const rx=hash(x,y,10+i), ry=hash(x,y,21+i); ctx.fillStyle=i===0?'#9eb48a45':'#1a302735'; ctx.fillRect(p.x+rx*s,p.y+ry*s,Math.max(1,s*.07),Math.max(1,s*.035)); }
      if (r > .77) { ctx.strokeStyle='#82926a55'; ctx.lineWidth=Math.max(1,s*.026); ctx.beginPath(); ctx.moveTo(p.x+s*.25,p.y+s*.75); ctx.lineTo(p.x+s*.33,p.y+s*.56); ctx.moveTo(p.x+s*.33,p.y+s*.56); ctx.lineTo(p.x+s*.37,p.y+s*.78); ctx.stroke(); }
      if(hash(x,y,81)>.88){ctx.fillStyle='#1b2b2460';ctx.beginPath();ctx.ellipse(p.x+s*.58,p.y+s*.67,s*.22,s*.09,-.3,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b8c19850';ctx.beginPath();ctx.moveTo(p.x+s*.33,p.y+s*.66);ctx.lineTo(p.x+s*.51,p.y+s*.55);ctx.lineTo(p.x+s*.72,p.y+s*.58);ctx.stroke();}
      if(hash(x,y,82)>.89){ctx.strokeStyle='#c1cda170';ctx.lineWidth=Math.max(1,s*.022);for(let i=0;i<3;i++){const bx=p.x+s*(.2+i*.12),by=p.y+s*(.2+i*.07);ctx.beginPath();ctx.moveTo(bx,by+s*.12);ctx.lineTo(bx+s*.04,by-s*.05);ctx.stroke();}}
    }
  }
  if(cell?.elevation===1){
    ctx.fillStyle='#e6c47824';ctx.fillRect(p.x,p.y,s+1,s+1);
    ctx.strokeStyle='#efdba887';ctx.lineWidth=Math.max(1,s*.055);
    ctx.beginPath();
    if(game.terrain[y-1]?.[x]?.elevation!==1){ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+s,p.y);}
    if(game.terrain[y+1]?.[x]?.elevation!==1){ctx.moveTo(p.x,p.y+s);ctx.lineTo(p.x+s,p.y+s);}
    if(game.terrain[y]?.[x-1]?.elevation!==1){ctx.moveTo(p.x,p.y);ctx.lineTo(p.x,p.y+s);}
    if(game.terrain[y]?.[x+1]?.elevation!==1){ctx.moveTo(p.x+s,p.y);ctx.lineTo(p.x+s,p.y+s);}
    ctx.stroke();
  }
  ctx.strokeStyle = '#091c1320'; ctx.lineWidth=1; ctx.strokeRect(p.x+.5,p.y+.5,s,s);
  if (cell?.resource > 0) drawCrystal(x,y,cell.resource,t);
}
function drawBridgeFallback(bridge) {
  if(fogAt(bridge.x+bridge.w/2,bridge.y+bridge.h/2)!==2)return;
  const s=scale(),p=toScreen(bridge.x,bridge.y),w=bridge.w*s,h=bridge.h*s;
  if(p.x+w<0||p.y+h<0||p.x>visibleW||p.y>visibleH)return;
  ctx.save();
  const deckX=p.x+w*.08,deckW=w*.84;
  ctx.fillStyle='#17282b';ctx.fillRect(deckX,p.y,deckW,h);
  if(bridge.destroyed){
    ctx.fillStyle='#798985';ctx.fillRect(deckX,p.y,deckW,h*.21);ctx.fillRect(deckX,p.y+h*.79,deckW,h*.21);
    ctx.fillStyle='#293d42';ctx.fillRect(deckX+w*.10,p.y+h*.18,deckW-w*.20,h*.09);
    ctx.fillRect(deckX+w*.10,p.y+h*.73,deckW-w*.20,h*.09);
    ctx.strokeStyle='#f6a36f';ctx.lineWidth=Math.max(2,s*.07);
    for(const end of [p.y+h*.21,p.y+h*.79]){ctx.beginPath();ctx.moveTo(deckX,end);ctx.lineTo(deckX+deckW,end);ctx.stroke();}
  }else{
    ctx.fillStyle='#738784';ctx.fillRect(deckX,p.y,deckW,h);
    ctx.fillStyle='#536964';ctx.fillRect(deckX+w*.10,p.y,deckW-w*.20,h);
    ctx.strokeStyle='#e0bd72';ctx.lineWidth=Math.max(2,s*.08);
    for(const edge of [deckX,deckX+deckW]){ctx.beginPath();ctx.moveTo(edge,p.y);ctx.lineTo(edge,p.y+h);ctx.stroke();}
    ctx.strokeStyle='#a9b9ae80';ctx.lineWidth=Math.max(1,s*.025);
    for(let i=1;i<bridge.h;i++){ctx.beginPath();ctx.moveTo(deckX,p.y+i*s);ctx.lineTo(deckX+deckW,p.y+i*s);ctx.stroke();}
  }
  if(fogAt(bridge.x+bridge.w/2,bridge.y+bridge.h/2)===2&&bridge.hp<bridge.maxHp){
    ctx.fillStyle='#172424';ctx.fillRect(deckX,p.y-8,deckW,4);
    ctx.fillStyle=bridge.destroyed?'#fa8a62':'#e5ca73';ctx.fillRect(deckX,p.y-8,deckW*Math.max(0,bridge.hp/bridge.maxHp),4);
  }
  ctx.restore();
}
function drawWreckFallback(wreck,t){
  if(fogAt(wreck.x,wreck.y)!==2)return;
  const p=toScreen(wreck.x,wreck.y),s=scale(),age=Math.max(0,Math.min(1,(wreck.expiresAt-game.time)/120));
  if(p.x<-s||p.y<-s||p.x>visibleW+s||p.y>visibleH+s)return;
  ctx.save();
  ctx.globalAlpha=Math.max(.28,Math.min(1,age*3));
  ctx.translate(p.x,p.y);
  ctx.fillStyle='#101916a8';ctx.beginPath();ctx.ellipse(0,s*.18,s*.52,s*.24,-.18,0,Math.PI*2);ctx.fill();
  ctx.rotate(-.24);
  ctx.fillStyle=wreck.campaignFreightCache?'#a98236':wreck.faction==='vesper'?'#59413b':'#4c5746';ctx.strokeStyle=wreck.campaignFreightCache?'#ffe08a':'#b4a07c';ctx.lineWidth=Math.max(1,s*.035);
  ctx.beginPath();ctx.moveTo(-s*.36,-s*.14);ctx.lineTo(s*.24,-s*.22);ctx.lineTo(s*.4,s*.05);ctx.lineTo(s*.12,s*.21);ctx.lineTo(-s*.38,s*.14);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle='#1a2621';ctx.fillRect(-s*.16,-s*.21,s*.35,s*.3);
  ctx.strokeStyle='#e9bd71';ctx.lineWidth=Math.max(1,s*.025);ctx.beginPath();ctx.moveTo(-s*.26,s*.07);ctx.lineTo(-s*.04,-s*.08);ctx.lineTo(s*.18,s*.12);ctx.stroke();
  ctx.restore();
  if(wreck.expiresAt-game.time<30&&Math.sin(t*6)>0){
    ctx.strokeStyle=wreck.campaignFreightCache?'#ffe08ab0':'#e9bd71b0';ctx.lineWidth=Math.max(1,s*.03);ctx.beginPath();ctx.arc(p.x,p.y,s*.48,0,Math.PI*2);ctx.stroke();
  }
}
function drawBridgeHealthOverlay(){
  if(!renderer3d)return;
  for(const bridge of game.bridges||[]){
    if(bridge.destroyed||bridge.hp>=bridge.maxHp||fogAt(bridge.x+bridge.w/2,bridge.y+bridge.h/2)!==2)continue;
    const p=renderer3d.worldToScreen(bridge.x+bridge.w/2,bridge.y+bridge.h/2,0.72);
    const width=Math.max(35,52*camera.zoom),left=p.x-width/2,top=p.y-14;
    octx.fillStyle='#071516dd';octx.fillRect(left-2,top-2,width+4,8);
    octx.fillStyle='#e7ae68';octx.fillRect(left,top,width*Math.max(0,bridge.hp/bridge.maxHp),4);
  }
}
function drawCrystal(x,y,resource,t) {
  const s=scale(), p=toScreen(x,y), count=Math.min(5,Math.max(2,Math.ceil(resource/250)));
  const glow=ctx.createRadialGradient(p.x+s*.5,p.y+s*.5,0,p.x+s*.5,p.y+s*.5,s*.65);
  glow.addColorStop(0,'#5af0d169');glow.addColorStop(1,'#5af0d100');ctx.fillStyle=glow;ctx.fillRect(p.x-s*.15,p.y-s*.15,s*1.3,s*1.3);
  if(oreCrystal.complete&&oreCrystal.naturalWidth){const dim=s*(.72+Math.min(1,resource/700)*.4);ctx.save();ctx.translate(p.x+s*.5,p.y+s*.52);ctx.rotate((hash(x,y,93)-.5)*.3);ctx.shadowColor='#66f5df';ctx.shadowBlur=s*.22;ctx.drawImage(oreCrystal,-dim/2,-dim*.58,dim,dim);ctx.restore();return;}
  ctx.save(); ctx.shadowColor='#58f8df'; ctx.shadowBlur=8*camera.zoom;
  for(let i=0;i<count;i++){
    const cx=p.x+s*(.17+hash(x,y,31+i)*.65), cy=p.y+s*(.2+hash(x,y,47+i)*.6);
    const h=s*(.16+hash(x,y,63+i)*.18)*(1+.05*Math.sin(t*3+i));
    ctx.fillStyle=i%2?'#57d7c9':'#a8fce4'; ctx.beginPath(); ctx.moveTo(cx,cy-h); ctx.lineTo(cx+h*.27,cy-h*.2); ctx.lineTo(cx+h*.22,cy+h*.15); ctx.lineTo(cx-h*.2,cy+h*.18); ctx.lineTo(cx-h*.27,cy-h*.18); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='#dcfff4a0';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx,cy-h);ctx.lineTo(cx,cy+h*.1);ctx.stroke();
  }
  ctx.restore();
}
function drawBuilding(b,t) {
  const s=scale(), p=toScreen(b.x,b.y), w=b.w*s,h=b.h*s;
  if (p.x+w<0||p.y+h<0||p.x>visibleW||p.y>visibleH) return;
  const visibility=fogAt(b.x+b.w/2,b.y+b.h/2);
  if(b.owner==='enemy'&&!game.isVisible(b))return;
  const color=teamColor(b.owner), selected=(game.selection||[]).includes(b.id);
  ctx.save();
  ctx.fillStyle='#0008';ctx.beginPath();ctx.ellipse(p.x+w*.53,p.y+h*.86,w*.46,h*.2,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#172a20';ctx.fillRect(p.x+s*.08,p.y+s*.18,w-s*.16,h-s*.23);
  ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,s*.08);ctx.strokeRect(p.x+s*.12,p.y+s*.2,w-s*.24,h-s*.3);
  const image=getAsset(b.defId);
  if(image){ ctx.drawImage(image,p.x-s*.04,p.y-s*.23,w+s*.08,h+s*.23); }
  else {
    const grad=ctx.createLinearGradient(p.x,p.y,p.x+w,p.y+h);grad.addColorStop(0,b.owner==='player'?'#c4d3a9':'#c68170');grad.addColorStop(.44,'#54665b');grad.addColorStop(1,'#26382d');
    ctx.fillStyle=grad;ctx.fillRect(p.x+s*.18,p.y+s*.1,w-s*.36,h-s*.27);
    ctx.fillStyle='#122923';ctx.fillRect(p.x+s*.29,p.y+s*.24,w-s*.58,h-s*.5);
    ctx.fillStyle=color;ctx.fillRect(p.x+s*.25,p.y+s*.16,w-s*.5,Math.max(2,s*.08));
  }
  ctx.fillStyle=color;ctx.fillRect(p.x+s*.11,p.y+h-s*.22,Math.min(w-s*.22,s*.55),Math.max(2,s*.08));
  if((b.hp||0)<(b.maxHp||1)*.4){const drift=Math.sin(t*1.5+b.id)*s*.15;ctx.fillStyle='#232d29a0';ctx.beginPath();ctx.arc(p.x+w*.65+drift,p.y-s*.05,s*.16,0,Math.PI*2);ctx.fill();}
  if(b.progress>0&&b.progress<1){ctx.fillStyle='#08120bc9';ctx.fillRect(p.x,p.y+h-8,w,6);ctx.fillStyle=color;ctx.fillRect(p.x,p.y+h-8,w*b.progress,6);}
  if(selected){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash([s*.14,s*.08]);ctx.strokeRect(p.x-s*.08,p.y-s*.15,w+s*.16,h+s*.19);ctx.setLineDash([]);}
  if(selected||b.hp<b.maxHp){drawHealth(p.x,p.y-s*.25,w,b.hp,b.maxHp);}
  ctx.restore();
}
function drawHealth(x,y,w,hp,maxHp){ctx.fillStyle='#07130beb';ctx.fillRect(x,y,w,5);const pct=Math.max(0,(hp||0)/(maxHp||1));ctx.fillStyle=pct>.55?'#aaf26c':pct>.25?'#f1cc72':'#f57865';ctx.fillRect(x+1,y+1,(w-2)*pct,3);}
function drawUnit(u,t) {
  const s=scale(),p=toScreen(u.x,u.y);
  if(p.x<-s||p.y<-s||p.x>visibleW+s||p.y>visibleH+s)return;
  if(u.owner==='enemy'&&!game.isVisible(u))return;
  const selected=(game.selection||[]).includes(u.id), color=teamColor(u.owner);
  const image=getAsset(u.defId), unitDef=game.unitDefs?.[u.defId], infantry=unitDef?.armor==='infantry',flying=unitDef?.flying;
  const dim=infantry?s*.93:flying?s*1.75:s*1.38;
  const altitude=flying?s*(.24+.04*Math.sin(t*3+u.id)):0;
  ctx.save();
  ctx.fillStyle=flying?'#0005':'#0009';ctx.beginPath();ctx.ellipse(p.x+s*(flying ? .21 : 0),p.y+s*.24,dim*.46,dim*.18,0,0,Math.PI*2);ctx.fill();
  if(selected){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.shadowColor=color;ctx.shadowBlur=8+Math.sin(t*5)*3;ctx.beginPath();ctx.ellipse(p.x,p.y+s*.17,dim*.55,dim*.27,0,0,Math.PI*2);ctx.stroke();ctx.shadowBlur=0;}
  ctx.translate(p.x,p.y-altitude);
  let angle=typeof u.facing==='number'?u.facing:0;
  if(Math.abs(angle)>Math.PI*2+.1)angle=angle*Math.PI/180;
  ctx.rotate(angle+Math.PI/2);
  if(image){ctx.drawImage(image,-dim*.5,-dim*.57,dim,dim);}
  else if(infantry){ctx.fillStyle='#1c3028';ctx.beginPath();ctx.arc(0,0,s*.21,0,Math.PI*2);ctx.fill();ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,-s*.1,s*.14,0,Math.PI*2);ctx.fill();ctx.fillStyle='#d8dac1';ctx.fillRect(-s*.045,-s*.31,s*.09,s*.21);}
  else{ctx.fillStyle=u.owner==='player'?'#77916c':'#996458';ctx.fillRect(-dim*.4,-dim*.28,dim*.8,dim*.58);ctx.fillStyle='#25352a';ctx.fillRect(-dim*.3,-dim*.4,dim*.6,dim*.55);ctx.fillStyle=color;ctx.fillRect(-dim*.22,-dim*.36,dim*.44,dim*.1);ctx.fillStyle='#b4bbaa';ctx.fillRect(-dim*.05,-dim*.62,dim*.1,dim*.42);}
  ctx.restore();
  if(selected||u.hp<u.maxHp)drawHealth(p.x-dim*.42,p.y-dim*.73-altitude,dim*.84,u.hp,u.maxHp);
}
function drawEffects(t) {
  for(const e of game.effects||[]) {
    if(e.owner==='enemy'&&fogAt(e.x||0,e.y||0)!==2)continue;
    const p=toScreen(e.x||0,e.y||0),s=scale();
    const life=(e.ttl??.5)/(e.maxTtl||.5),r=(e.radius||.3)*s;
    ctx.save();
    ctx.globalAlpha=Math.min(1,Math.max(0,life));
    if(e.type==='breach'){
      ctx.strokeStyle=e.owner==='player'?'#ffc979':'#ff8779';ctx.fillStyle=e.owner==='player'?'#ffcb7613':'#ff756713';
      ctx.lineWidth=2;ctx.setLineDash([7,6]);ctx.beginPath();ctx.ellipse(p.x,p.y,r,r*.55,0,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(p.x-r*.17,p.y);ctx.lineTo(p.x+r*.17,p.y);ctx.moveTo(p.x,p.y-r*.17);ctx.lineTo(p.x,p.y+r*.17);ctx.stroke();
    }else if(e.type==='interdict'){
      const pulse=1.15-life*.3;ctx.strokeStyle=e.owner==='player'?'#73f0e5':'#ff9d91';
      ctx.fillStyle=e.owner==='player'?'#73f0e51a':'#ff9d911a';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(p.x,p.y,r*pulse,r*pulse*.55,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    }else if(/explosion|blast|nuke|ion/.test(e.type||'')) {
      const ion=e.type==='ion';
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r*2);
      g.addColorStop(0,ion?'#f5ffff':'#fffbc4');
      g.addColorStop(.25,ion?'#75f5f0':'#ffc36b');
      g.addColorStop(.65,ion?'#3bdad088':'#ef693f88');
      g.addColorStop(1,'#ef693f00');
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.x,p.y,r*2,0,Math.PI*2);ctx.fill();
      if(ion){
        ctx.strokeStyle='#d5fff7';ctx.lineWidth=5*camera.zoom;ctx.shadowColor='#9dfff1';ctx.shadowBlur=22;
        ctx.beginPath();ctx.moveTo(p.x,p.y-r*5);ctx.lineTo(p.x,p.y+r*.2);ctx.stroke();
      }
    }else if(e.type==='heal'||e.type==='harvest') {
      ctx.strokeStyle=e.type==='heal'?'#aaff9e':'#66fff0';
      ctx.lineWidth=2;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=8;
      ctx.beginPath();ctx.arc(p.x,p.y,r*(1.6-life*.7),0,Math.PI*2);ctx.stroke();
    }else if(e.type==='salvage') {
      ctx.strokeStyle='#ffbd56';ctx.lineWidth=2.5;ctx.shadowColor='#ffc96c';ctx.shadowBlur=12;
      ctx.beginPath();ctx.ellipse(p.x,p.y,r*(1.15-life*.45),r*(.48-life*.18),0,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#ffe3a0';
      for(let i=0;i<5;i++){
        const a=i*Math.PI*2/5+t*1.5;
        ctx.fillRect(p.x+Math.cos(a)*r*.42-2,p.y+Math.sin(a)*r*.22-r*.18*(1-life)-2,4,4);
      }
    }else if(e.type==='wallCover') {
      ctx.strokeStyle='#b6ffdf';ctx.lineWidth=2;ctx.shadowColor='#88ffcb';ctx.shadowBlur=8;
      for(let i=0;i<3;i++){
        const a=i*Math.PI*2/3+.35,inner=r*.25,outer=r*(1.2-life*.25);
        ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*inner,p.y+Math.sin(a)*inner);
        ctx.lineTo(p.x+Math.cos(a)*outer,p.y+Math.sin(a)*outer);ctx.stroke();
      }
    }else if(e.type==='wreckCover') {
      ctx.strokeStyle='#ffc36b';ctx.fillStyle='#ffe3a0';ctx.lineWidth=2;ctx.shadowColor='#ffad43';ctx.shadowBlur=10;
      const spark=r*(.42+life*.18);
      for(let i=0;i<4;i++){
        const a=i*Math.PI/2+t*2.2,inner=spark*.25,outer=spark*(.8+life*.25);
        ctx.beginPath();ctx.moveTo(p.x+Math.cos(a)*inner,p.y+Math.sin(a)*inner);
        ctx.lineTo(p.x+Math.cos(a)*outer,p.y+Math.sin(a)*outer);ctx.stroke();
      }
      ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,spark*.22),0,Math.PI*2);ctx.fill();
    }else{
      ctx.fillStyle=e.type==='projectile'?'#ffcf76':'#fff0a5';ctx.shadowColor='#ffab56';ctx.shadowBlur=10;
      ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,r*.45),0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
}
function drawFog(){const s=scale(),x0=Math.max(0,Math.floor(camera.x)),y0=Math.max(0,Math.floor(camera.y)),x1=Math.min(game.width,Math.ceil(camera.x+visibleW/s)),y1=Math.min(game.height,Math.ceil(camera.y+visibleH/s));for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const f=fogAt(x,y);if(f===2)continue;const p=toScreen(x,y);ctx.fillStyle=f===1?'#05120d9c':'#020907ed';ctx.fillRect(p.x,p.y,s+1,s+1);if(f===0&&hash(x,y,99)>.94){ctx.fillStyle='#59746322';ctx.fillRect(p.x+s*.22,p.y+s*.3,s*.55,1);}}}
function drawSelectionBox(){if(!pointer.down||!pointer.dragging||pointer.pan)return;const x=Math.min(pointer.sx,pointer.x),y=Math.min(pointer.sy,pointer.y),w=Math.abs(pointer.x-pointer.sx),h=Math.abs(pointer.y-pointer.sy);octx.fillStyle='#baff7930';octx.fillRect(x,y,w,h);octx.strokeStyle='#caff75';octx.lineWidth=1;octx.strokeRect(x+.5,y+.5,w,h);}
function drawQueuedRoute(){
  const selected=new Set(game?.selection||[]);
  const lead=game?.units?.find(unit=>unit.owner==='player'&&selected.has(unit.id)&&
    Array.isArray(unit.order?.queue)&&unit.order.queue.length);
  if(!lead)return;
  const targetPoint=order=>{
    if(Number.isFinite(order?.x)&&Number.isFinite(order?.y))return {x:order.x,y:order.y};
    if(order?.type!=='attack')return null;
    const target=game.getEntity?.(order.targetId);
    if(!target||target.hp<=0||target.owner==='enemy'&&fogAt(target.x,target.y)!==2)return null;
    return {x:target.x+(target.w||0)/2,y:target.y+(target.h||0)/2};
  };
  let previous=targetPoint(lead.order)||{x:lead.x,y:lead.y};
  octx.save();
  octx.lineWidth=2;octx.setLineDash([6,5]);
  for(const [index,order] of lead.order.queue.entries()){
    const destination=targetPoint(order);
    if(!destination)break;
    const from=toScreen(previous.x,previous.y),to=toScreen(destination.x,destination.y);
    const attack=order.type==='attack'||order.attackMove;
    const routeColor=attack?'#ffad84':order.reverse?'#f2ca82':'#9deee2';
    octx.strokeStyle=`${routeColor}d9`;
    octx.beginPath();octx.moveTo(from.x,from.y);octx.lineTo(to.x,to.y);octx.stroke();
    octx.setLineDash([]);
    octx.fillStyle='#081917dd';octx.strokeStyle=routeColor;
    octx.beginPath();octx.arc(to.x,to.y,9,0,Math.PI*2);octx.fill();octx.stroke();
    octx.fillStyle='#f4fff7';octx.font='700 10px Barlow Condensed, sans-serif';
    octx.textAlign='center';octx.textBaseline='middle';octx.fillText(String(index+1),to.x,to.y+.5);
    octx.setLineDash([6,5]);
    previous=destination;
  }
  octx.restore();
}
function drawPlacement(){if(!placeId||!game)return;const def=game.buildingDefs?.[placeId];if(!def)return;const x=Math.floor(pointer.wx),y=Math.floor(pointer.wy),w=def.w||def.width||2,h=def.h||def.height||2,p=toScreen(x,y),s=scale();const allowed=game.canPlaceBuilding?game.canPlaceBuilding(placeId,x,y).ok:false;octx.fillStyle=allowed?'#b6f46a66':'#fa746866';octx.fillRect(p.x,p.y,w*s,h*s);octx.strokeStyle=allowed?'#caff75':'#ff7869';octx.lineWidth=2;octx.strokeRect(p.x,p.y,w*s,h*s);const img=getAsset(placeId);if(img){octx.globalAlpha=.8;octx.drawImage(img,p.x,p.y,w*s,h*s);octx.globalAlpha=1;}}
function drawAttackMarker(t){if(!attackMoveMode)return;const r=12+Math.sin(t*5)*3;octx.strokeStyle=attackMoveMode==='follow'?'#88eddd':attackMoveMode==='force'?'#ff7668':'#ffb47d';octx.lineWidth=2;octx.beginPath();octx.arc(pointer.x,pointer.y,r,0,Math.PI*2);octx.moveTo(pointer.x-r-7,pointer.y);octx.lineTo(pointer.x-r+2,pointer.y);octx.moveTo(pointer.x+r-2,pointer.y);octx.lineTo(pointer.x+r+7,pointer.y);octx.stroke();}
function formationPreviewAvailable(units=selectedObjects()) {
  return !!game&&!replayMode&&(game.replayVersion==null||game.replayVersion>=76)&&
    typeof game.getFormationPreview==='function'&&typeof game.issueFormationMove==='function'&&
    formationGroundUnits(units).length>=2;
}
function formationGroundUnits(units=selectedObjects()) {
  return units.filter(unit=>unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn&&
    !game.unitDefs?.[unit.defId]?.flying&&(game.unitDefs?.[unit.defId]?.speed||0)>0);
}
function updateFormationControl(units) {
  const previousFormation=selectedFormation;
  const available=!!game&&formationPreviewAvailable(units);
  const key=units.map(unit=>unit.id).sort().join('|');
  if(key!==formationSelectionKey){selectedFormation='';formationSelectionKey=key;formationPreviewCache={key:'',at:0,preview:null};}
  if(!available)selectedFormation='';
  const control=$('#formation-control'),select=$('#formation-select');
  control.classList.toggle('hidden',!available);
  select.disabled=!available;
  if(select.value!==selectedFormation)select.value=selectedFormation;
  select.title='SCREEN puts armored units in front and rockets and support at the rear. Obstacles and combat can split the formation.';
  if(previousFormation!==selectedFormation)refreshFormationTargetHint();
}
function refreshFormationTargetHint(){
  if(!['attack','forceMove'].includes(attackMoveMode)||targetOrderPending)return;
  const label=attackMoveMode==='attack'?'ATTACK MOVE':'FORCE MOVE';
  $('#attack-hint').innerHTML=targetOrderHint(attackMoveMode,label,'SELECT DESTINATION');
  $('#attack-hint').title=selectedFormation?'Approximate positions; terrain can adjust slots.':'';
}
function issueFormationCommand(x,y,movement,queue=false) {
  if(!selectedFormation||!formationPreviewAvailable())return null;
  return game.issueFormationMove(x,y,selectedFormation,movement,queue,!!matchPaceMode&&matchPaceAvailable());
}
function drawFormationPreview() {
  if(!selectedFormation||!['attack','forceMove'].includes(attackMoveMode)||!formationPreviewAvailable())return;
  const x=pointer.wx,y=pointer.wy,queue=!!routePlanMode||shiftHeld;
  const selectedKey=formationGroundUnits().map(unit=>unit.id).sort().join('|');
  const key=`${selectedFormation}:${selectedKey}:${x.toFixed(1)}:${y.toFixed(1)}:${queue}`;
  const now=performance.now();
  const keyChanged=key!==formationPreviewCache.key;
  if((keyChanged&&now-formationPreviewCache.at>=55)||(!keyChanged&&now-formationPreviewCache.at>=120)){
    formationPreviewCache={key,at:now,preview:game.getFormationPreview(x,y,selectedFormation,queue)};
  }else if(keyChanged&&formationPreviewCache.at===0){
    formationPreviewCache={key,at:now,preview:game.getFormationPreview(x,y,selectedFormation,queue)};
  }
  const preview=formationPreviewCache.preview;
  if(!preview?.slots?.length)return;
  octx.save();octx.setLineDash([4,4]);octx.lineWidth=1.5;octx.strokeStyle='#bfffa9bb';octx.fillStyle='#17302299';
  for(const slot of preview.slots.slice(0,32)){
    const p=toScreen(slot.x,slot.y);
    if(p.x<-10||p.y<-10||p.x>visibleW+10||p.y>visibleH+10)continue;
    const r=Math.max(4,Math.min(8,scale()*.22));
    octx.beginPath();octx.arc(p.x,p.y,r,0,Math.PI*2);octx.fill();octx.stroke();
  }
  const center=toScreen(x,y),facing=Number(preview.facing);
  if(Number.isFinite(facing)){
    const worldFacing=toScreen(x+Math.cos(facing),y+Math.sin(facing));
    const dx=worldFacing.x-center.x,dy=worldFacing.y-center.y,length=Math.hypot(dx,dy)||1;
    const ex=center.x+dx/length*20,ey=center.y+dy/length*20,screenFacing=Math.atan2(dy,dx);
    octx.setLineDash([]);octx.strokeStyle='#d8ffb8';octx.lineWidth=2;octx.beginPath();octx.moveTo(center.x,center.y);octx.lineTo(ex,ey);octx.stroke();
    octx.beginPath();octx.moveTo(ex,ey);octx.lineTo(ex-Math.cos(screenFacing-.55)*7,ey-Math.sin(screenFacing-.55)*7);octx.moveTo(ex,ey);octx.lineTo(ex-Math.cos(screenFacing+.55)*7,ey-Math.sin(screenFacing+.55)*7);octx.stroke();
  }
  octx.setLineDash([]);octx.font='700 9px Barlow Condensed, sans-serif';octx.textAlign='left';octx.textBaseline='middle';
  if(visibleW>670){
    const legend='NOMINAL POSITIONS',lx=Math.max(4,Math.min(visibleW-110,center.x+13)),ly=Math.max(10,Math.min(visibleH-8,center.y+27));
    octx.fillStyle='#07140fd9';octx.fillRect(lx-4,ly-7,104,14);octx.fillStyle='#c9e6c1';octx.fillText(legend,lx,ly);
  }
  octx.restore();
}
function drawStormLureFallback(t){
  const lure=game.storm?.lure;
  if(!lure||lure.until<=game.time||!['warning','surge'].includes(game.storm.phase))return;
  const fog=fogAt(lure.x,lure.y);
  if(lure.owner==='player'?fog===0:fog!==2)return;
  const p=toScreen(lure.x,lure.y),pulse=1+Math.sin(t*5)*.12,r=scale()*.58*pulse;
  octx.save();octx.strokeStyle=lure.owner==='player'?'#bbfff2':'#ffabdb';octx.fillStyle='#79f4ed20';octx.lineWidth=2;
  octx.beginPath();octx.ellipse(p.x,p.y,r,r*.55,0,0,Math.PI*2);octx.fill();octx.stroke();
  octx.beginPath();octx.moveTo(p.x,p.y-14);octx.lineTo(p.x+8,p.y);octx.lineTo(p.x,p.y+14);octx.lineTo(p.x-8,p.y);octx.closePath();octx.fill();octx.stroke();octx.restore();
}
function drawAshesUplinkMarkers(t) {
  if (currentMode !== 'campaign' || missionIndex !== 5 || !game?.campaignState ||
      game.replayVersion != null && game.replayVersion < 43) return;
  const state = game.campaignState;
  const routeContinuation=game.replayVersion==null?state.ashesRouteRulesVersion===51:game.replayVersion>=51;
  const markers=state.phase==='transmit-codes'
    ?(state.transmissionUplinks||[]).filter(item=>!state.transmissionUplinkId||item.id===state.transmissionUplinkId)
      .map(item=>({...item,label:`${item.id.toUpperCase()} UPLINK`,color:'#ffe3a0',fill:'#ebbd6326'}))
    :routeContinuation&&state.phase==='deploy-signal-shadow'&&state.ghostShadowPoint
      ?[{...state.ghostShadowPoint,label:'SIGNAL SHADOW',color:'#9feaff',fill:'#49bde933'}]
      :routeContinuation&&state.phase==='recover-supply-cache'
        ?(game.wrecks||[]).filter(item=>item.id===state.routeCacheId)
          .map(item=>({...item,label:'IRON CACHE',color:'#ffd68a',fill:'#e6a94233'}))
        :[];
  for (const marker of markers) {
    const p = toScreen(marker.x, marker.y);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const pulse = 1 + Math.sin(t * 3.4) * 0.08;
    const radius = Math.max(15, 22 * camera.zoom) * pulse * (marker.label==='SIGNAL SHADOW'?1.25:1);
    const label = marker.label;
    octx.save();
    const onScreen = p.x >= 0 && p.x <= visibleW && p.y >= 0 && p.y <= visibleH;
    let labelX, labelY;
    if (onScreen) {
      octx.strokeStyle = marker.color;
      octx.fillStyle = marker.fill;
      octx.lineWidth = 2;
      octx.beginPath();octx.ellipse(p.x, p.y, radius, radius * 0.55, 0, 0, Math.PI * 2);
      octx.fill();octx.stroke();
      labelX = Math.max(68, Math.min(visibleW - 68, p.x));
      labelY = Math.max(18, Math.min(visibleH - 12, p.y - radius * 0.65 - 7));
    } else {
      // Keep both public route choices discoverable when the camera frames
      // only the starting column. The arrow is clipped to the battlefield.
      const cx = visibleW / 2, cy = visibleH / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const step = Math.min((cx - 32) / Math.max(1, Math.abs(dx)),
        (cy - 32) / Math.max(1, Math.abs(dy)));
      const x = cx + dx * step, y = cy + dy * step;
      octx.save();
      octx.translate(x, y);
      octx.rotate(Math.atan2(dy, dx));
      octx.fillStyle = marker.color;
      octx.strokeStyle = '#17221a';
      octx.lineWidth = 2;
      octx.beginPath();octx.moveTo(14, 0);octx.lineTo(-7, -7);octx.lineTo(-7, 7);octx.closePath();
      octx.fill();octx.stroke();
      octx.restore();
      labelX = Math.max(68, Math.min(visibleW - 68, x));
      labelY = Math.max(20, Math.min(visibleH - 12, y - 18));
    }
    octx.fillStyle = marker.color;
    octx.font = '700 11px Barlow Condensed, sans-serif';
    octx.textAlign = 'center';
    const labelWidth = octx.measureText(label).width;
    octx.fillStyle = '#0b1a18dc';
    octx.fillRect(labelX - labelWidth / 2 - 7, labelY - 12, labelWidth + 14, 18);
    octx.fillStyle = marker.color;
    octx.fillText(label, labelX, labelY);
    octx.restore();
  }
}
function drawIronReclaimedMarkers(t) {
  if (currentMode !== 'campaign' || missionIndex !== 15 || !game?.campaignState) return;
  const view=getIronReclaimedView(game);
  if(!view)return;
  const targets=view.phase==='recommission-wreck'
    ?[{...view.markers.wreck,label:'MARKED GUARDIAN WRECK',color:'#ffd17b'}]
    :view.phase==='escort-to-relay'
      ?[...(!view.routeChoice?[{...view.markers.northPass,label:'NORTH PASS',color:'#a8e2e2'},{...view.markers.southPass,label:'SOUTH PASS',color:'#a8e2e2'}]:[]),
        {...view.markers.rendezvous,label:'EAST RECOVERY MARKER',color:'#b8f0b2'}]
      :[{...view.markers.extraction,label:'FIELD WORKSHOP · EXTRACTION',color:'#b8f0b2'}];
  drawCampaignPointMarkers(targets,t);
}
function drawCounterbatteryMarkers(t){
  if(currentMode!=='campaign'||missionIndex!==16||targetingFocusActive&&innerWidth<=670)return;
  const view=getCounterbatteryView(game);
  const targets=(view?.targets||[]).filter(target=>target.alive).map(target=>({...target,
    label:`${target.label}${target.visible?'':' · INTEL'}`,color:target.visible?'#ffab8b':'#e6cd88'}));
  drawCampaignPointMarkers(targets,t);
}
function drawCampaignPointMarkers(targets,t){
  for(const target of targets){
    if(!target||!Number.isFinite(target.x)||!Number.isFinite(target.y))continue;
    const p=toScreen(target.x,target.y),pulse=1+Math.sin(t*3.4)*.08,radius=Math.max(17,24*camera.zoom)*pulse;
    octx.save();
    const onScreen=p.x>=0&&p.x<=visibleW&&p.y>=0&&p.y<=visibleH;
    let labelX,labelY;
    if(onScreen){
      octx.strokeStyle=target.color;octx.fillStyle='#d0c47b24';octx.lineWidth=2;
      octx.beginPath();octx.ellipse(p.x,p.y,radius,radius*.58,0,0,Math.PI*2);octx.fill();octx.stroke();
      labelX=Math.max(96,Math.min(visibleW-96,p.x));labelY=Math.max(18,Math.min(visibleH-12,p.y-radius*.7-7));
    }else{
      const cx=visibleW/2,cy=visibleH/2,dx=p.x-cx,dy=p.y-cy;
      const step=Math.min((cx-32)/Math.max(1,Math.abs(dx)),(cy-32)/Math.max(1,Math.abs(dy)));
      const x=cx+dx*step,y=cy+dy*step;
      octx.save();octx.translate(x,y);octx.rotate(Math.atan2(dy,dx));
      octx.fillStyle=target.color;octx.strokeStyle='#17221a';octx.lineWidth=2;
      octx.beginPath();octx.moveTo(14,0);octx.lineTo(-7,-7);octx.lineTo(-7,7);octx.closePath();octx.fill();octx.stroke();octx.restore();
      labelX=Math.max(96,Math.min(visibleW-96,x));labelY=Math.max(20,Math.min(visibleH-12,y-18));
    }
    octx.font='700 11px Barlow Condensed, sans-serif';octx.textAlign='center';
    const width=octx.measureText(target.label).width;
    octx.fillStyle='#0b1a18e8';octx.fillRect(labelX-width/2-7,labelY-12,width+14,18);
    octx.fillStyle=target.color;octx.fillText(target.label,labelX,labelY);octx.restore();
  }
}
const recentCombatBars=new Map();
let healthOverlayTime=-Infinity;
function layoutHealthOverlayBars(items){
  const offsets=[0,-8,8,-16,16,-24,24,-32,32];
  const columns=new Map();
  const placed=[];
  const cellSizeX=24,cellSizeY=8,gap=2;
  const ordered=items.slice().sort((a,b)=>b.priority-a.priority||(String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0));
  for(const item of ordered){
    const left=Math.floor((item.x-gap)/cellSizeX),right=Math.floor((item.x+item.w+gap)/cellSizeX);
    const minY=item.minY??-Infinity,maxY=item.maxY??Infinity;
    const baseY=Math.max(minY,Math.min(maxY,item.y));
    let chosen=null;
    for(const offset of offsets){
      const y=baseY+offset;
      if(y<minY||y>maxY)continue;
      const top=Math.floor((y-gap)/cellSizeY),bottom=Math.floor((y+6+gap)/cellSizeY);
      let collision=false;
      for(let column=left;column<=right&&!collision;column++){
        const rows=columns.get(column);
        if(!rows)continue;
        for(let row=top;row<=bottom&&!collision;row++){
          for(const other of rows.get(row)||[]){
            if(item.x-gap<other.x+other.w&&item.x+item.w+gap>other.x&&
              y-gap<other.y+6&&y+6+gap>other.y){collision=true;break;}
          }
        }
      }
      if(!collision){chosen={...item,y,offset:y-item.y};break;}
    }
    if(!chosen)chosen={...item,y:baseY,offset:baseY-item.y};
    placed.push(chosen);
    const top=Math.floor((chosen.y-gap)/cellSizeY),bottom=Math.floor((chosen.y+6+gap)/cellSizeY);
    for(let column=left;column<=right;column++){
      let rows=columns.get(column);
      if(!rows)columns.set(column,rows=new Map());
      for(let row=top;row<=bottom;row++){
        let bucket=rows.get(row);
        if(!bucket)rows.set(row,bucket=[]);
        bucket.push(chosen);
      }
    }
  }
  return placed;
}
function draw3dHealthOverlay(){
  // Keep integrity readable in screen pixels. World-space bars could disappear
  // into the tank hull and the transparent fog pass at strategic zoom.
  if(game.time<healthOverlayTime-0.001) recentCombatBars.clear();
  healthOverlayTime=game.time;
  for(const fx of game.effects||[]) if(fx.type==='projectile'){
    // Show both sides of an exchange while shots are in flight. The live
    // visibility gate below prevents targeting data from drawing through fog.
    if(fx.sourceId)recentCombatBars.set(fx.sourceId,game.time+2.4);
    if(fx.targetId)recentCombatBars.set(fx.targetId,game.time+2.4);
  }
  for(const [id,until] of recentCombatBars) if(until<=game.time) recentCombatBars.delete(id);
  const selected=new Set(game.selection||[]);
  const candidates=[];
  for(const entity of [...game.buildings,...game.units]){
    if(entity.hp<=0||entity.embarkedIn||(entity.owner==='enemy'&&!game.isVisible(entity)))continue;
    const building='w' in entity;
    const hp=Math.max(0,Math.min(1,entity.hp/(entity.maxHp||1)));
    const isSelected=selected.has(entity.id)||entity.selected;
    const recentlyHit=recentCombatBars.has(entity.id);
    if(!isSelected&&hp>=0.99&&(building||!recentlyHit))continue;
    const def=game.unitDefs?.[entity.defId];
    const worldX=building?entity.x+entity.w/2:entity.x;
    const worldY=building?entity.y+entity.h/2:entity.y;
    const height=building?1.85:def?.flying?1.9:def?.armor==='infantry'?1.27:1.55;
    const p=renderer3d.worldToScreen(worldX,worldY,height,{absoluteHeight:!!def?.flying});
    if(p.x<-60||p.y<-12||p.x>visibleW+60||p.y>visibleH+12)continue;
    const w=Math.max(30,Math.min(68,(building?52:36)*camera.zoom));
    const x=Math.round(p.x-w/2),y=Math.round(p.y);
    const priority=isSelected?3:hp<=0.25?2:recentlyHit?1:0;
    candidates.push({id:entity.id,x,y,w,hp,faction:entity.faction,priority,minY:0,maxY:Math.max(0,visibleH-6)});
  }
  for(const bar of layoutHealthOverlayBars(candidates)){
    const {x,y,w,hp,faction,offset}=bar,h=6;
    if(offset){
      const center=x+w/2,anchorY=y-offset;
      octx.beginPath();octx.moveTo(center,anchorY);octx.lineTo(center,y);
      octx.strokeStyle='#06100fee';octx.lineWidth=3;octx.stroke();
      octx.beginPath();octx.moveTo(center,anchorY);octx.lineTo(center,y);
      octx.strokeStyle=hp>0.55?'#8ff0c099':hp>0.25?'#ffd17b99':'#ff766eaa';octx.lineWidth=1;octx.stroke();
    }
    octx.fillStyle=faction==='vesper'?'#3d2525ed':'#12383ded';
    octx.fillRect(x,y,w,h);
    octx.fillStyle=hp>0.55?'#8ff0c0':hp>0.25?'#ffd17b':'#ff766e';
    octx.fillRect(x+1,y+1,Math.max(1,(w-2)*hp),h-2);
    octx.fillStyle='#e6f9e466';
    octx.fillRect(x+1,y+1,w-2,1);
  }
}
function render(t) {
  if(!game||!playing)return;
  octx.clearRect(0,0,visibleW,visibleH);
  if(renderer3d){
    syncRendererView();
    renderer3d.render(game,{centerX:renderer3d.centerX,centerY:renderer3d.centerY,zoom:camera.zoom,time:t,placeId,pointerWorld:{x:pointer.wx,y:pointer.wy}});
    draw3dHealthOverlay();
    drawBridgeHealthOverlay();
    if(!digInMode){drawAshesUplinkMarkers(t);drawIronReclaimedMarkers(t);drawCounterbatteryMarkers(t);}
    drawQueuedRoute();drawSelectionBox();drawFormationPreview();drawAttackMarker(t);drawCommandAbilityMarker(t);drawDigInMarker();drawFieldRepairChannels();
    return;
  }
  ctx.clearRect(0,0,visibleW,visibleH);
  const s=scale(),x0=Math.max(0,Math.floor(camera.x)-1),y0=Math.max(0,Math.floor(camera.y)-1),x1=Math.min(game.width,Math.ceil(camera.x+visibleW/s)+1),y1=Math.min(game.height,Math.ceil(camera.y+visibleH/s)+1);
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)drawTerrainTile(x,y,game.terrain[y]?.[x],t);
  for(const bridge of game.bridges||[])drawBridgeFallback(bridge);
  for(const wreck of game.wrecks||[])drawWreckFallback(wreck,t);
  const entities=[...game.buildings.map(o=>({o,k:0,y:o.y+o.h})),...game.units.filter(o=>!o.embarkedIn).map(o=>({o,k:1,y:o.y}))].sort((a,b)=>a.y-b.y);
  for(const e of entities){if(e.k===0)drawBuilding(e.o,t);else drawUnit(e.o,t);}
  drawEffects(t);drawFog();drawStormLureFallback(t);drawSalvageDropFallback(t);if(!digInMode){drawAshesUplinkMarkers(t);drawIronReclaimedMarkers(t);drawCounterbatteryMarkers(t);}drawQueuedRoute();drawSelectionBox();drawPlacement();drawFormationPreview();drawAttackMarker(t);drawCommandAbilityMarker(t);drawDigInMarker();drawFieldRepairChannels();
}
function drawSalvageDropFallback(t){
  const drop=game?.salvageDrop;
  if(!drop||!['incoming','active'].includes(drop.phase))return;
  const p=toScreen(drop.x,drop.y),s=scale(),incoming=drop.phase==='incoming';
  if(p.x<-s*4||p.y<-s*4||p.x>visibleW+s*4||p.y>visibleH+s*4)return;
  const radius=Math.max(11,s*(incoming?1.25:.88));
  const pulse=1+.11*Math.sin(t*7);
  const color=drop.contested?'#ffe19b':drop.captureOwner==='enemy'?'#ff9a73':drop.captureOwner==='player'?'#77edee':'#f9d289';
  ctx.save();ctx.translate(p.x,p.y);
  ctx.fillStyle=incoming?'#f4c97815':'#75eff327';
  ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,s*.07);
  ctx.setLineDash(incoming?[6,6]:[]);
  ctx.beginPath();ctx.ellipse(0,0,radius*pulse,radius*.57*pulse,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.setLineDash([]);
  if(incoming){
    ctx.beginPath();ctx.moveTo(0,-radius*1.7);ctx.lineTo(0,-radius*.45);ctx.moveTo(-radius*.45,0);ctx.lineTo(radius*.45,0);ctx.stroke();
  }else{
    const box=Math.max(7,s*.42);
    ctx.fillStyle='#172c2c';ctx.strokeStyle='#e4fbec';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(0,-box);ctx.lineTo(box,0);ctx.lineTo(0,box);ctx.lineTo(-box,0);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.fillRect(-box*.54,-2,box*1.08,4);
    const progress=Math.max(0,Math.min(1,(drop.captureProgress||0)/SALVAGE_DROP_CAPTURE_SECONDS));
    if(progress>0){ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,0,radius*1.2,radius*.69,0,-Math.PI/2,-Math.PI/2+Math.PI*2*progress);ctx.stroke();}
  }
  ctx.restore();
}
function drawCommandAbilityMarker(t){
  if(!commandAbilityMode)return;
  const ability=COMMAND_ABILITIES[commandAbilityMode];
  const stormcall=commandAbilityMode==='stormcall';
  const radius=stormcall?18:(ability?.radius||4)*scale()*.55;
  const pulse=Math.sin(t*5)*4;
  octx.save();
  if(stormcall){
    for(const relay of game.relays){
      if(relay.owner!=='player')continue;
      const center=toScreen(relay.x,relay.y),range=(ability.radius||6)*scale();
      octx.strokeStyle='#bcf997a8';octx.fillStyle='#b9ed9020';octx.lineWidth=1.5;octx.setLineDash([6,6]);
      octx.beginPath();octx.ellipse(center.x,center.y,range,range*.55,0,0,Math.PI*2);octx.fill();octx.stroke();
    }
  }
  const valid=game.canUseCommandAbility(commandAbilityMode,pointer.wx,pointer.wy).ok;
  octx.strokeStyle=valid?'#c6ff83':'#ff866f';octx.fillStyle=valid?'#c6ff8319':'#ff866f18';octx.lineWidth=2;octx.setLineDash([9,7]);
  octx.beginPath();octx.ellipse(pointer.x,pointer.y,radius+pulse,(radius+pulse)*.55,0,0,Math.PI*2);octx.fill();octx.stroke();
  octx.setLineDash([]);octx.beginPath();octx.moveTo(pointer.x-10,pointer.y);octx.lineTo(pointer.x+10,pointer.y);octx.moveTo(pointer.x,pointer.y-10);octx.lineTo(pointer.x,pointer.y+10);octx.stroke();octx.restore();
}
function drawFieldRepairChannels(){
  if(!game||game.replayVersion!=null&&game.replayVersion<85)return;
  const selected=new Set(game.selection||[]);
  for(const engineer of game.units){
    if(engineer.owner!=='player'||engineer.defId!=='engineer'||engineer.hp<=0||engineer.embarkedIn)continue;
    const patching=engineer.order?.type==='fieldRepair'||engineer.order?.type==='follow'&&
      engineerEscortVehicle(game.getEntity(engineer.order.targetId))&&engineer._fieldRepairProgress>0;
    const refilling=engineer.order?.type==='refillRepairKits';
    const progress=patching?engineer._fieldRepairProgress:refilling?engineer._fieldRepairRefillProgress:0;
    const target=patching?game.getEntity(engineer.order.targetId):engineer;
    if(!target||target.hp<=0||target.owner!=='player'||target.embarkedIn||!(progress>0))continue;
    const p=toScreen(target.x,target.y),e=toScreen(engineer.x,engineer.y);
    if(p.x<0||p.x>visibleW||p.y<0||p.y>visibleH)continue;
    const radius=Math.max(14,20*camera.zoom),fraction=Math.max(0,Math.min(1,progress/(patching?5:8)));
    octx.save();
    if(patching){
      octx.strokeStyle='#8fe7d8aa';octx.lineWidth=2;
      octx.beginPath();octx.moveTo(e.x,e.y-10);octx.lineTo(p.x,p.y-12);octx.stroke();
    }
    octx.translate(p.x,p.y+3);octx.scale(1,.6);
    octx.lineWidth=3;octx.strokeStyle='#0c2728c9';octx.beginPath();octx.arc(0,0,radius,0,Math.PI*2);octx.stroke();
    octx.strokeStyle='#9ff4df';octx.beginPath();octx.arc(0,0,radius,-Math.PI/2,-Math.PI/2+Math.PI*2*fraction);octx.stroke();
    octx.restore();
    if(selected.has(engineer.id)||selected.has(target.id)){
      const label=patching?`FIELD KIT · ${Math.floor(progress)}/5S`:`REFILL KIT · ${Math.floor(progress)}/8S`;
      octx.save();octx.font='700 10px Barlow Condensed, sans-serif';octx.textAlign='center';
      const width=octx.measureText(label).width;
      const x=Math.max(width/2+8,Math.min(visibleW-width/2-8,p.x)),y=Math.max(18,p.y-radius-17);
      octx.fillStyle='#071d1be8';octx.fillRect(x-width/2-6,y-11,width+12,17);
      octx.fillStyle='#bdffe9';octx.fillText(label,x,y);octx.restore();
    }
  }
}
function drawDigInMarker(){
  if(!digInMode||!game||!pointer.inside)return;
  const units=selectedObjects().filter(unit=>!('w' in unit)&&unit.owner==='player'&&unit.hp>0&&
    ['rifle','rocket'].includes(unit.defId));
  if(!units.length)return;
  const origin={x:units.reduce((sum,unit)=>sum+unit.x,0)/units.length,
    y:units.reduce((sum,unit)=>sum+unit.y,0)/units.length};
  const center=toScreen(origin.x,origin.y);
  const direction=Math.atan2(pointer.wy-origin.y,pointer.wx-origin.x);
  const radius=2.6,halfArc=INFANTRY_DIG_IN_ARC_RADIANS;
  const readiness=game.canDigIn?.(pointer.wx,pointer.wy);
  const valid=readiness?.ok??units.some(unit=>(unit.abilityCooldown||0)<=0);
  const color=valid?'#c9ff66':'#ff9c75';
  octx.save();
  octx.beginPath();octx.moveTo(center.x,center.y);
  for(let step=0;step<=20;step++){
    const angle=direction-halfArc+(step/20)*halfArc*2;
    const edge=toScreen(origin.x+Math.cos(angle)*radius,origin.y+Math.sin(angle)*radius);
    octx.lineTo(edge.x,edge.y);
  }
  octx.closePath();octx.fillStyle=valid?'#c9ff6623':'#ff9c751c';octx.fill();
  octx.strokeStyle=color;octx.lineWidth=2;octx.setLineDash([6,5]);octx.stroke();
  octx.setLineDash([]);octx.beginPath();octx.moveTo(center.x,center.y);
  const facingPoint=toScreen(origin.x+Math.cos(direction),origin.y+Math.sin(direction));
  octx.lineTo(facingPoint.x,facingPoint.y);
  octx.strokeStyle='#efffd1';octx.lineWidth=2;octx.stroke();octx.restore();
}
function missionUplinkTargets(){
  if(currentMode!=='campaign'||!game?.campaignState)return [];
  const state=game.campaignState;
  if(missionIndex===0&&(game.replayVersion==null
      ?state.firstHarvestRaidRulesVersion>=54:game.replayVersion>=54)&&
      state.firstHarvestRaidWarned&&!state.firstHarvestRaidRepelled)
    return [state.firstHarvestRaidPoint].filter(Boolean);
  if(missionIndex===3&&(game.replayVersion==null||game.replayVersion>=35)){
    if(state.phase==='secure-relay')return [game.relays.find(relay=>relay.id===state.relayId)].filter(Boolean);
    const array=game.getEntity(state.targetId);
    return array?[{x:array.x+(array.w||0)/2,y:array.y+(array.h||0)/2}]:[];
  }
  if(missionIndex===5){
    if((game.replayVersion==null||game.replayVersion>=43)&&state.phase==='transmit-codes'&&
        Array.isArray(state.transmissionUplinks))
      return state.transmissionUplinks.filter(item=>!state.transmissionUplinkId||item.id===state.transmissionUplinkId);
    const routeContinuation=game.replayVersion==null?state.ashesRouteRulesVersion===51:game.replayVersion>=51;
    if(routeContinuation&&state.phase==='deploy-signal-shadow')return [state.ghostShadowPoint].filter(Boolean);
    if(routeContinuation&&state.phase==='recover-supply-cache'){
      const cache=game.wrecks?.find(wreck=>wreck.id===state.routeCacheId);
      return cache?[cache]:[];
    }
    return [state.extraction||{x:48,y:17}];
  }
  if(missionIndex===9&&(game.replayVersion==null||game.replayVersion>=34)&&
      ['alerted','escaping'].includes(state.chiefEscapePhase))return [QUIET_KNIFE_ESCAPE];
  if(missionIndex===13){
    if(state.phase==='extract-engineer')return [state.extraction].filter(Boolean);
    const vault=game.getEntity(state.targetId);
    return vault?[{x:vault.x+(vault.w||0)/2,y:vault.y+(vault.h||0)/2}]:[];
  }
  if(missionIndex===14)return [game.relays.find(relay=>relay.id===state.relayId)].filter(Boolean);
  if(missionIndex===15){
    const view=getIronReclaimedView(game);
    if(view?.phase==='escort-to-relay'&&!view.routeChoice)
      return [{...view.markers.northPass,label:'NORTH PASS'},
        {...view.markers.southPass,label:'SOUTH PASS'},
        {...view.markers.rendezvous,label:'EAST RECOVERY'}].filter(Boolean);
    return [view?.markers?.wreck,view?.markers?.rendezvous,view?.markers?.extraction].filter(Boolean);
  }
  if(missionIndex===16)return (getCounterbatteryView(game)?.targets||[])
    .filter(target=>target.alive).map(target=>({x:target.x,y:target.y,
      label:`${target.label}${target.visible?'':' · INTEL'}`}));
  if(missionIndex===12){
    if(state.phase==='extract-engineer')return [state.extraction].filter(Boolean);
    return [game.relays.find(relay=>relay.id===state.relayId)].filter(Boolean);
  }
  return [];
}
function selectedOrderMinimapCues(selectedIds,cw,ch){
  const cues=[];
  for(const building of game.buildings){
    if(!selectedIds.has(building.id)||building.owner!=='player'||building.hp<=0||building.progress<1||
      !['barracks','factory','helipad'].includes(building.defId)||
      !Number.isFinite(building.rally?.x)||!Number.isFinite(building.rally?.y))continue;
    const rallyUnit=productionRallyUnit(building);
    cues.push({fromX:(building.x+building.w/2)*cw,fromY:(building.y+building.h/2)*ch,
      toX:(rallyUnit?.x??building.rally.x)*cw,toY:(rallyUnit?.y??building.rally.y)*ch,color:rallyUnit?'#79e8df':'#ffd28d'});
    if(cues.length>=24)break;
  }
  let inspected=0;
  for(const unit of game.units){
    if(!selectedIds.has(unit.id))continue;
    if(inspected++>=48||cues.length>=24)break;
    if(unit.owner!=='player'||unit.hp<=0||unit.embarkedIn)continue;
    const order=unit.order||{};
    let target=null,color='#79e8df';
    if((order.type==='move'||order.type==='forceMove'||order.type==='unload')&&
       Number.isFinite(order.x)&&Number.isFinite(order.y)){
      target={x:order.x,y:order.y};
      if(order.reverse||order.attackMove)color='#ffd17b';
    }else if(order.type==='patrol'){
      const leg=order.leg===1;
      const x=leg?order.bx:order.ax,y=leg?order.by:order.ay;
      if(Number.isFinite(x)&&Number.isFinite(y))target={x,y};
    }else if(order.type==='attack'){
      const entity=game.getEntity?.(order.targetId);
      if(entity&&entity.hp>0&&entity.owner==='enemy'&&game.isVisible(entity)){
        target={x:entity.x+(entity.w||0)/2,y:entity.y+(entity.h||0)/2};
        color='#ffd17b';
      }
    }else if(order.type==='follow'||order.type==='board'){
      const entity=game.getEntity?.(order.type==='board'?order.carrierId:order.targetId);
      if(entity&&entity.hp>0&&entity.owner==='player'&&!entity.embarkedIn)
        target={x:entity.x+(entity.w||0)/2,y:entity.y+(entity.h||0)/2};
    }else if(order.type==='harvest'&&Number.isFinite(order.x)&&Number.isFinite(order.y)){
      target={x:order.x+.5,y:order.y+.5};
    }else if(order.type==='rearm'){
      const pad=game._nearestHelipad?.('player',unit.x,unit.y);
      if(pad)target={x:pad.x+pad.w/2,y:pad.y+pad.h/2};
    }
    if(!target||target.x<0||target.y<0||target.x>game.width||target.y>game.height)continue;
    cues.push({fromX:unit.x*cw,fromY:unit.y*ch,toX:target.x*cw,toY:target.y*ch,color});
  }
  return cues;
}
function drawMinimap() {
  if(!game)return;
  const w=minimap.width,h=minimap.height,cw=w/game.width,ch=h/game.height;
  const missionTargets=missionUplinkTargets();
  const lastSeenContacts=lastSeenHostileContacts();
  const selectedIds=new Set(game.selection||[]);
  const selectedHomeHarvester=game.units.some(unit=>selectedIds.has(unit.id)&&unit.owner==='player'&&unit.defId==='harvester'&&unit.homeRefineryId!=null);
  const orderCues=game.radar?.player||missionTargets.length
    ?selectedOrderMinimapCues(selectedIds,cw,ch):[];
  const orderCueDescription=orderCues.length
    ?' Cyan or gold dashed lines connect selected units to their current order destinations; enemy targets appear only while visible.'
    :'';
  const homeCueDescription=selectedHomeHarvester?' Gold tethers mark selected Harvesters’ preferred friendly Refinery.':'';
  updateBattlefieldPickerIntelBadge(lastSeenContacts);
  minimap.setAttribute('aria-label', lastSeenContacts.length
    ? `Minimap. Friendly forces are squares, visible enemies are diamonds, visible high ground has a muted gold tint, and unconfirmed last-seen hostile contacts are amber question marks.${orderCueDescription}${homeCueDescription}`
    : `Minimap. Friendly forces are squares, visible enemies are diamonds, visible high ground has a muted gold tint, and unknown relays are circles.${orderCueDescription}${homeCueDescription}`);
  mctx.clearRect(0,0,w,h);
  if(!game.radar?.player&&!missionTargets.length){
    minimap.style.cursor='default';
    mctx.fillStyle='#081611';mctx.fillRect(0,0,w,h);
    // The instruction sits in an HTML card above the dead instrument. Keep
    // this canvas quiet so no sweep or static can run through the lettering.
    mctx.strokeStyle='#6d9f8150';mctx.lineWidth=1;
    mctx.beginPath();mctx.moveTo(0,h/2);mctx.lineTo(w,h/2);mctx.moveTo(w/2,0);mctx.lineTo(w/2,h);mctx.stroke();
    drawSalvageDropMinimapMarker(cw,ch);
    $('#enemy-count').textContent='NO SIGNAL';
    return;
  }
  minimap.style.cursor='crosshair';
  const terrainPalette=FALLBACK_TERRAIN_PALETTES[game?.mapId]||FALLBACK_TERRAIN_PALETTES['shard-valley'];
  for(let y=0;y<game.height;y++)for(let x=0;x<game.width;x++){const c=game.terrain[y]?.[x],f=fogAt(x,y);mctx.fillStyle=f===0?'#05100c':f===1?'#26392e':c?.resource>0?'#65d6c8':c?.type==='water'?terrainPalette.water[0]:c?.type==='rock'?terrainPalette.rock[0]:terrainPalette.minimap;mctx.fillRect(x*cw,y*ch,Math.ceil(cw),Math.ceil(ch));if(f===2&&c?.elevation===1){mctx.fillStyle='#e4c47b30';mctx.fillRect(x*cw,y*ch,Math.ceil(cw),Math.ceil(ch));}}
  for(const bridge of game.bridges||[]){
    if(fogAt(bridge.x+bridge.w/2,bridge.y+bridge.h/2)!==2)continue;
    mctx.fillStyle=bridge.destroyed?'#e28864':'#e5c47b';
    if(bridge.destroyed){mctx.fillRect(bridge.x*cw,bridge.y*ch,Math.max(2,bridge.w*cw),Math.max(2,ch));mctx.fillRect(bridge.x*cw,(bridge.y+bridge.h-1)*ch,Math.max(2,bridge.w*cw),Math.max(2,ch));}
    else mctx.fillRect(bridge.x*cw,bridge.y*ch,Math.max(2,bridge.w*cw),Math.max(2,bridge.h*ch));
  }
  for(const b of game.buildings){if(b.owner==='enemy'&&!game.isVisible(b))continue;mctx.fillStyle=teamColor(b.owner);mctx.fillRect(b.x*cw,b.y*ch,Math.max(2,b.w*cw),Math.max(2,b.h*ch));}
  const homeLinks=game.units.filter(unit=>selectedIds.has(unit.id)&&unit.owner==='player'&&unit.defId==='harvester'&&unit.homeRefineryId!=null).slice(0,8);
  if(homeLinks.length){
    mctx.save();mctx.setLineDash([2,2]);mctx.lineWidth=1.2;mctx.strokeStyle='#f2d58b';mctx.fillStyle='#071713';
    for(const unit of homeLinks){
      const refinery=game.buildings.find(building=>building.id===unit.homeRefineryId&&building.owner==='player'&&building.defId==='refinery');
      if(!refinery)continue;
      const ux=unit.x*cw,uy=unit.y*ch,rx=(refinery.x+refinery.w/2)*cw,ry=(refinery.y+refinery.h/2)*ch;
      mctx.beginPath();mctx.moveTo(ux,uy);mctx.lineTo(rx,ry);mctx.stroke();
      mctx.setLineDash([]);mctx.beginPath();mctx.arc(rx,ry,4.4,0,Math.PI*2);mctx.fill();mctx.stroke();mctx.setLineDash([2,2]);
    }
    mctx.restore();
  }
  if(orderCues.length){
    mctx.save();mctx.globalAlpha=.58;mctx.lineWidth=1.2;mctx.setLineDash([2,3]);
    for(const cue of orderCues){
      mctx.strokeStyle=cue.color;
      mctx.beginPath();mctx.moveTo(cue.fromX,cue.fromY);mctx.lineTo(cue.toX,cue.toY);mctx.stroke();
    }
    mctx.setLineDash([]);mctx.globalAlpha=.9;
    const endpoints=[];
    for(const cue of orderCues){
      if(endpoints.some(point=>Math.hypot(point.x-cue.toX,point.y-cue.toY)<5))continue;
      endpoints.push({x:cue.toX,y:cue.toY});
      mctx.fillStyle='#071713';mctx.strokeStyle=cue.color;mctx.lineWidth=1.5;
      mctx.beginPath();mctx.arc(cue.toX,cue.toY,3.6,0,Math.PI*2);mctx.fill();mctx.stroke();
      mctx.fillStyle=cue.color;mctx.fillRect(cue.toX-1,cue.toY-1,2,2);
    }
    mctx.restore();
  }
  for(const u of game.units){
    if(u.embarkedIn||u.owner==='enemy'&&!game.isVisible(u))continue;
    const px=u.x*cw,py=u.y*ch;
    if(selectedIds.has(u.id)){
      mctx.strokeStyle='#f2ffdc';mctx.lineWidth=1;
      mctx.strokeRect(px-3,py-3,6,6);
    }
    mctx.fillStyle=teamColor(u.owner);
    if(u.owner==='enemy'){
      mctx.beginPath();mctx.moveTo(px,py-2.8);mctx.lineTo(px+2.8,py);
      mctx.lineTo(px,py+2.8);mctx.lineTo(px-2.8,py);mctx.closePath();mctx.fill();
    }else mctx.fillRect(px-1.5,py-1.5,3,3);
  }
  for(const relay of game.relays||[]){
    const sight=fogAt(relay.x,relay.y),intel=relayIntel(relay,sight);
    if(sight===0&&!intel.known)continue;
    const color=!intel.known?'#9baea5':intel.owner==='player'?'#79ecff':intel.owner==='enemy'?'#ff816c':'#f5de9b';
    const px=relay.x*cw,py=relay.y*ch;
    mctx.strokeStyle=color;mctx.fillStyle='#07171a';mctx.lineWidth=2;mctx.beginPath();
    if(intel.owner==='player')mctx.rect(px-4.5,py-4.5,9,9);
    else if(intel.owner==='enemy'){
      mctx.moveTo(px,py-5);mctx.lineTo(px+5,py);
      mctx.lineTo(px,py+5);mctx.lineTo(px-5,py);mctx.closePath();
    }else mctx.arc(px,py,4.5,0,Math.PI*2);
    mctx.fill();mctx.stroke();
  }
  drawSalvageDropMinimapMarker(cw,ch);
  const bloom=game.storm?.bloom;
  if(bloom&&bloom.until>game.time){
    const px=bloom.x*cw,py=bloom.y*ch;
    const ring=Math.max(5,Math.min(12,bloom.radius*(cw+ch)*.5));
    mctx.save();
    mctx.setLineDash([3,2]);mctx.strokeStyle='#9deaff';mctx.lineWidth=2;
    mctx.beginPath();mctx.arc(px,py,ring,0,Math.PI*2);mctx.stroke();
    mctx.setLineDash([]);mctx.fillStyle='#d8faff';
    mctx.beginPath();mctx.moveTo(px,py-4);mctx.lineTo(px+4,py);
    mctx.lineTo(px,py+4);mctx.lineTo(px-4,py);mctx.closePath();mctx.fill();
    mctx.restore();
  }
  if(tacticalAlert&&game.time<tacticalAlert.until&&!replayMode){
    const px=tacticalAlert.x*cw,py=tacticalAlert.y*ch;
    const radius=5+2.5*(1+Math.sin(displayTime*7));
    mctx.strokeStyle=tacticalAlert.kind==='lost'?'#ff7869':'#ffd17b';
    mctx.lineWidth=2;mctx.beginPath();mctx.arc(px,py,radius,0,Math.PI*2);mctx.stroke();
    mctx.fillStyle=tacticalAlert.kind==='lost'?'#ff7869':'#ffd17b';
    mctx.fillRect(px-1.5,py-1.5,3,3);
  }
  for(const missionTarget of missionTargets){
    const px=missionTarget.x*cw,py=missionTarget.y*ch,pulse=5.5+Math.sin(displayTime*4)*1.2;
    const missionMark=missionTarget.label||(missionIndex===3
      ?game.campaignState.phase==='secure-relay'?'CENTRAL RELAY':'FORWARD ARRAY'
      :missionIndex===15
        ?game.campaignState.phase==='recommission-wreck'?'GUARDIAN WRECK'
          :game.campaignState.phase==='escort-to-relay'?'EAST RECOVERY'
            :'WORKSHOP EXTRACTION'
      :missionIndex===5&&game.campaignState.phase==='transmit-codes'
        ?`${missionTarget.id?.toUpperCase()||'SIGNAL'} UPLINK`
        :missionIndex===5&&game.campaignState.phase==='deploy-signal-shadow'
          ?'SIGNAL SHADOW'
          :missionIndex===5&&game.campaignState.phase==='recover-supply-cache'
            ?'IRON CACHE'
        :missionIndex===5||missionIndex===9?'EXTRACTION':'OBJECTIVE');
    const hostileMark=missionIndex===16||missionIndex===9||missionIndex===3&&game.campaignState.phase!=='secure-relay';
    const markerColor=hostileMark?'#ff9b78':missionMark==='SIGNAL SHADOW'?'#9feaff':missionIndex===15?'#b8f0b2':'#f4dc8c';
    mctx.strokeStyle=markerColor;mctx.fillStyle=hostileMark?'#402420':'#243422';mctx.lineWidth=2;
    mctx.beginPath();mctx.arc(px,py,pulse,0,Math.PI*2);mctx.fill();mctx.stroke();
    mctx.beginPath();mctx.moveTo(px,py-3);mctx.lineTo(px+3,py);mctx.lineTo(px,py+3);mctx.lineTo(px-3,py);mctx.closePath();mctx.fillStyle=markerColor;mctx.fill();
    mctx.font='bold 9px Barlow Condensed, sans-serif';
    mctx.textAlign=missionIndex===9?'right':'center';
    mctx.fillText(missionMark,missionIndex===9?Math.min(w-4,px+12):px,py-11);
  }
  if(game.storm&&game.storm.phase!=='calm'){
    mctx.strokeStyle=game.storm.phase==='surge'?'#eb81ff':'#ffc079';mctx.fillStyle=game.storm.phase==='surge'?'#d779e62b':'#f3ba5e19';mctx.lineWidth=1.5;
    mctx.beginPath();mctx.ellipse(game.storm.x*cw,game.storm.y*ch,game.storm.radius*cw,game.storm.radius*ch,0,0,Math.PI*2);mctx.fill();mctx.stroke();
    const lure=game.storm.lure;
    if(lure&&lure.until>game.time&&(lure.owner==='player'?fogAt(lure.x,lure.y)>0:fogAt(lure.x,lure.y)===2)){
      const lx=lure.x*cw,ly=lure.y*ch;
      mctx.strokeStyle=lure.owner==='player'?'#bfffe9':'#ffaddc';mctx.lineWidth=2;
      mctx.beginPath();mctx.moveTo(lx,ly-5);mctx.lineTo(lx+5,ly);mctx.lineTo(lx,ly+5);mctx.lineTo(lx-5,ly);mctx.closePath();mctx.stroke();
    }
  }
  for(const contact of lastSeenContacts.slice(0, 12)){
    const px=contact.x*cw,py=contact.y*ch,radius=6.2+Math.sin(displayTime*3)*.5;
    mctx.save();
    mctx.fillStyle='#2e2115';mctx.beginPath();mctx.arc(px,py,radius,0,Math.PI*2);mctx.fill();
    mctx.setLineDash([3,2]);mctx.strokeStyle='#ffe1a4';mctx.lineWidth=2;
    mctx.beginPath();mctx.arc(px,py,radius,0,Math.PI*2);mctx.stroke();
    mctx.setLineDash([]);mctx.fillStyle='#ffe8bd';mctx.font='bold 12px Barlow Condensed, sans-serif';
    mctx.textAlign='center';mctx.textBaseline='middle';mctx.fillText('?',px,py+.5);mctx.restore();
  }
  mctx.strokeStyle='#e8fcba';mctx.lineWidth=1;
  if(renderer3d){const corners=[[0,0],[visibleW,0],[visibleW,visibleH],[0,visibleH]].map(([sx,sy])=>toWorld(sx,sy));mctx.beginPath();corners.forEach((p,i)=>i?mctx.lineTo(p.x*cw,p.y*ch):mctx.moveTo(p.x*cw,p.y*ch));mctx.closePath();mctx.stroke();}
  else mctx.strokeRect(camera.x*cw,camera.y*ch,visibleW/scale()*cw,visibleH/scale()*ch);
  const liveEnemies=game.units.filter(u=>u.owner==='enemy'&&!u.embarkedIn&&game.isVisible(u)).length;
  $('#enemy-count').textContent=lastSeenContacts.length
    ? `${liveEnemies} LIVE · ${lastSeenContacts.length} LAST SEEN` : `${liveEnemies} CONTACTS`;
}
function drawSalvageDropMinimapMarker(cw,ch){
  const drop=game?.salvageDrop;
  if(!drop||!['incoming','active'].includes(drop.phase))return;
  const px=drop.x*cw,py=drop.y*ch,pulse=6+Math.sin(displayTime*6)*1.5;
  const color=drop.contested?'#ffe19b':drop.captureOwner==='enemy'?'#ff9a73':drop.captureOwner==='player'?'#77edee':'#f9d289';
  mctx.save();mctx.strokeStyle=color;mctx.fillStyle='#091a18';mctx.lineWidth=2;
  mctx.beginPath();mctx.arc(px,py,pulse,0,Math.PI*2);mctx.fill();mctx.stroke();
  mctx.fillStyle=color;mctx.beginPath();mctx.moveTo(px,py-3.5);mctx.lineTo(px+3.5,py);mctx.lineTo(px,py+3.5);mctx.lineTo(px-3.5,py);mctx.closePath();mctx.fill();
  mctx.restore();
}

function hasPrerequisites(def) { const req=def.prerequisites||def.requires||[]; const list=Array.isArray(req)?req:[req]; return list.every(id=>game.buildings.some(b=>b.owner==='player'&&b.defId===id)); }
function availableForFaction(def) { if(!def.faction&&!def.factions)return true; const f=def.faction||def.factions; return Array.isArray(f)?f.includes(faction):f===faction||f==='all'; }
function factionDescription(viewFaction,id,def) {
  if(id==='bunker')return viewFaction==='vesper'
    ?'A reinforced Vesper firing post. Garrison up to three armed infantry for protection and +1 weapon range. Flame penetrates the bunker and damages its crew.'
    :'An Aegis Field Bunker protects up to three armed infantry and adds +1 weapon range. Flame penetrates the bunker and damages its crew.';
  if(viewFaction==='vesper'&&id==='refinery')return 'Converts harvested crystal into credits. Protect harvesters and keep storage available.';
  if(viewFaction==='vesper'&&id==='harvester')return 'Collects crystal and delivers it to a refinery for credits.';
  return def.description||keyName(id);
}
function productionDescription(id,def) { return factionDescription(faction,id,def); }
function closeBlueprintDetails(restoreFocus=false) {
  const previous=blueprintInspect;
  blueprintInspect=null;
  $('#blueprint-details').hidden=true;
  $('#production-list').querySelectorAll('[data-blueprint-info]').forEach(button=>button.setAttribute('aria-expanded','false'));
  if(restoreFocus&&previous)$('#production-list').querySelector(`[data-blueprint-info="${previous.id}"][data-kind="${previous.kind}"]`)?.focus();
}
function updateBlueprintDetails() {
  if(!game||!blueprintInspect)return;
  const {id,kind}=blueprintInspect;
  const def=(kind==='structures'?game.buildingDefs:game.unitDefs)?.[id];
  if(!def||tab!==kind){closeBlueprintDetails();return;}
  const site=kind==='units'?selectedProductionSite():null;
  if(site&&def.producer!==site.defId){closeBlueprintDetails();return;}
  const check=kind==='structures'?game.canBuild(id):unitProductionView(id,def);
  const required=def.prerequisites||def.requires||[];
  const prerequisites=(Array.isArray(required)?required:[required]).filter(Boolean)
    .map(requirement=>game.buildingDefs?.[requirement]?.name||keyName(requirement));
  let availability=check?.ok?site?`Queues at the selected ${game.buildingDefs[site.defId].name}.`:'Available. Choose the main card to order.':check?.reason||'Unavailable.';
  if(kind==='structures'&&game.construction?.defId===id)
    availability=game.construction.ready?'Ready to place. Choose the main card, then a build site.':
      `Constructing · ${Math.round((game.construction.progress||0)*100)}%.`;
  else if(kind==='structures'&&game.construction)
    availability='Construction bay busy. Finish or cancel the current structure first.';
  const prerequisiteNote=prerequisites.length?`Requires ${prerequisites.join(' + ')}. `:'';
  const availabilityNote=prerequisiteNote&&/^Requires\b/i.test(availability)?'':availability;
  const details={
    '#blueprint-details-name':def.name||keyName(id),
    '#blueprint-details-cost':`${kind==='structures'?'STRUCTURE':'UNIT'} · ◈ ${fmt(def.cost||0)}`,
    '#blueprint-details-description':productionDescription(id,def),
    '#blueprint-details-status':`${prerequisiteNote}${availabilityNote}`.trim(),
  };
  for(const [selector,value] of Object.entries(details))if($(selector).textContent!==value)$(selector).textContent=value;
}
function showBlueprintDetails(id,kind) {
  if(!game)return;
  blueprintInspect={id,kind};
  $('#blueprint-details').hidden=false;
  updateBlueprintDetails();
  $('#production-list').querySelectorAll('[data-blueprint-info]').forEach(button=>
    button.setAttribute('aria-expanded',String(button.dataset.blueprintInfo===id&&button.dataset.kind===kind)));
}
function productionCard(id,def,kind) {
  const cost=def.cost||0, check=kind==='structures'?game.canBuild(id):unitProductionView(id,def);
  const producer=check.producer;
  const queueIndex=check.queueIndex??-1;
  const queueCount=check.queueCount||0;
  const queue=kind==='units'?queueIndex>=0:game.construction?.defId===id;
  const enabled=(check?.ok && (kind!=='structures'||!game.construction))||(kind==='structures'&&queue);
  const reason=kind==='structures'&&queue&&!game.construction?.ready?'IN PRODUCTION':enabled?'':check?.reason||'BUILDING IN PROGRESS';
  const progress=kind==='structures'&&queue?game.construction?.progress:undefined;
  const progressPct=progress==null?0:progress<=1?progress*100:progress;
  const description=productionDescription(id,def);
  const card=`<button class="production-item ${queue?'queued':''}" data-build="${id}" data-kind="${kind}" ${enabled?'':'disabled'} title="${description}${reason?` · ${reason}`:''}">${assetHTML(id)}<span class="item-text"><strong>${def.name||keyName(id)}</strong><small>◈ ${fmt(cost)}</small><em>${reason||def.role||description}</em></span>${queue&&kind==='structures'?'<span class="queue-badge">'+(game.construction?.ready?'READY':'BUILDING')+'</span>':''}${queue&&kind==='units'?`<span class="queue-badge" aria-hidden="true">×${queueCount}</span>`:''}${queue&&kind==='structures'?`<span class="queue-progress" style="width:${progressPct}%"></span>`:''}</button>`;
  const info=`<button class="blueprint-info-button" type="button" data-blueprint-info="${id}" data-kind="${kind}" aria-label="Inspect ${def.name||keyName(id)} blueprint" aria-controls="blueprint-details" aria-expanded="${blueprintInspect?.id===id&&blueprintInspect?.kind===kind}" title="Inspect blueprint without ordering">i</button>`;
  const cancelSite=producer?`${game.buildingDefs[producer.defId].name}, sector ${Math.floor(producer.x+producer.w/2)}, ${Math.floor(producer.y+producer.h/2)}`:'';
  const cancel=queue&&kind==='units'?`<button class="queue-cancel-button" type="button" data-cancel-queue="${producer.id}" data-queue-index="${queueIndex}" aria-label="Cancel most recent ${def.name||keyName(id)} order at ${cancelSite}" title="Cancel most recent order at ${cancelSite}">×</button>`:'';
  return `<div class="production-card-group${queue&&kind==='units'?' unit-queue-card':''}">${card}${info}${cancel}</div>`;
}
function updateProductionSite() {
  const site=tab==='units'?selectedProductionSite():null;
  const panel=$('#production-site');
  panel.classList.toggle('hidden',!site);
  if(!site)return;
  const name=game.buildingDefs[site.defId].name.toUpperCase();
  const sector=`${Math.floor(site.x+site.w/2)}//${Math.floor(site.y+site.h/2)}`;
  $('#production-site-name').textContent=`${name} · ${sector}`;
  const active=site.queue?.[0];
  const task=site.powerStandby===true?`PAUSED · STANDBY${active?` · ${Math.floor(active.progress*100)}%`:''}`:active?`${game.unitDefs[active.defId].name.toUpperCase()} ${Math.floor(active.progress*100)}%`:'READY';
  $('#production-site-status').textContent=`${task} · ${site.queue.length}/5 QUEUED`;
  const rallyUnit=productionRallyUnit(site);
  const rallyName=rallyUnit?game.unitDefs[rallyUnit.defId].name:null;
  $('#production-site-rally').textContent=rallyUnit?`REINFORCE ${rallyName.toUpperCase()}`:
    `FIXED RALLY ${Math.floor(site.rally.x)}//${Math.floor(site.rally.y)}`;
  panel.title=rallyUnit?`Armed reinforcements rendezvous with ${rallyName}, then follow. Choose ground with RALLY (M) to restore a fixed point. Unarmed units keep their ordinary orders.`:
    `New unit orders use this ${name.toLowerCase()}. Rally: ${Math.floor(site.rally.x)}, ${Math.floor(site.rally.y)}. Use RALLY (M) to choose ground or a friendly moving unit.`;
  updateProductionRepeatControls(site);
}
function resetProductionRepeatControls() {
  pendingProductionRepeat.clear();
  pendingBunkerCommands.clear();
  const select=$('#production-repeat-unit'),wrap=$('#production-repeat-controls');
  delete select.dataset.authorityKey;
  delete wrap.dataset.siteId;
  wrap.classList.remove('mobile-expanded');
  $('#production-repeat-toggle').setAttribute('aria-expanded','false');
}
function updateProductionRepeatControls(site) {
  const wrap=$('#production-repeat-controls'),select=$('#production-repeat-unit'),button=$('#production-repeat-apply'),toggle=$('#production-repeat-toggle');
  const rulesAvailable=!replayMode&&(game.replayVersion==null||game.replayVersion>=PRODUCTION_REPEAT_RULES_VERSION)&&
    typeof game.getProductionRepeatStatus==='function'&&typeof game.setProductionRepeat==='function';
  wrap.hidden=!rulesAvailable;
  toggle.hidden=!rulesAvailable;
  if(!rulesAvailable)return;
  if(wrap.dataset.siteId!==String(site.id)){
    wrap.classList.remove('mobile-expanded');
    toggle.setAttribute('aria-expanded','false');
    wrap.dataset.siteId=String(site.id);
  }
  const definitions=Object.entries(game.unitDefs||{}).filter(([,def])=>def.producer===site.defId&&availableForFaction(def))
    .sort((a,b)=>(a[1].sort??a[1].cost??0)-(b[1].sort??b[1].cost??0)||(a[1].cost||0)-(b[1].cost||0));
  const hasRequirement=req=>game.buildings.some(b=>b.owner==='player'&&b.defId===req&&b.hp>0&&b.progress>=1);
  const optionKey=JSON.stringify([site.defId,faction,definitions.map(([id,def])=>[id,(def.requires||[]).map(hasRequirement)])]);
  if(select.dataset.optionKey!==optionKey){
    const draft=select.value;
    select.innerHTML='<option value="">OFF</option>'+definitions.map(([id,def])=>{
      const required=def.prerequisites||def.requires||[];
      const missing=(Array.isArray(required)?required:[required]).filter(Boolean).filter(req=>!hasRequirement(req));
      const note=missing.length?` · REQUIRES ${missing.map(req=>game.buildingDefs?.[req]?.name||keyName(req)).join(' + ')}`:'';
      return `<option value="${id}">${def.name||keyName(id)}${note}</option>`;
    }).join('');
    select.dataset.optionKey=optionKey;
    if(definitions.some(([id])=>id===draft))select.value=draft;
  }
  const status=game.getProductionRepeatStatus(site.id)||{enabled:false,unitDefId:null,state:'off',reason:''};
  const expanded=toggle.getAttribute('aria-expanded')==='true';
  toggle.textContent=expanded?'DONE ▴':status.enabled?'AUTO ON ▾':'AUTO OFF ▾';
  toggle.setAttribute('aria-label',expanded?'Close automatic training controls':'Configure automatic training');
  toggle.title=status.enabled?`Automatic ${game.unitDefs?.[status.unitDefId]?.name||'unit'} training · ${status.reason||status.state}`:'Configure automatic training';
  const pending=pendingProductionRepeat.has(site.id);
  const authorityKey=JSON.stringify([site.id,status.enabled?status.unitDefId:null]);
  // Keep a chosen blueprint through HUD refreshes and the focus change when
  // START is clicked. Reset only when the selected site or its intent changes.
  if(select.dataset.authorityKey!==authorityKey)
    select.value=status.enabled&&status.unitDefId?status.unitDefId:'';
  select.dataset.authorityKey=authorityKey;
  select.dataset.siteId=String(site.id);
  const requested=select.value||null;
  const active=status.enabled&&status.unitDefId;
  const stops=!!active&&(!requested||requested===status.unitDefId);
  button.textContent=pending?'WAIT…':stops?'STOP':'START';
  button.disabled=pending||paused||gameEnded||(!requested&&!active);
  select.disabled=pending||paused||gameEnded;
  button.title=stops
    ?'Stop automatic training. Any paid unit already training or queued will still finish.'
    :'Start automatic training for this unit. Manual orders finish first; the unit cost is paid when each automatic job starts.';
  const unitName=game.unitDefs?.[status.unitDefId]?.name||status.unitDefId;
  const state=String(status.state|| (status.enabled?'waiting':'off')).toUpperCase();
  const intent=status.enabled?`AUTO · ${unitName||'UNIT'} · ${state}`:'AUTO TRAIN OFF';
  const explanation=status.reason?` · ${status.reason}`:'';
  const statusText=pending?'WAITING FOR SERVER CONFIRMATION':`${intent}${explanation}`;
  const statusLabel=$('#production-repeat-status');
  if(statusLabel.textContent!==statusText)statusLabel.textContent=statusText;
  statusLabel.title=statusText;
  select.title=definitions.map(([id,def])=>{
    const required=def.prerequisites||def.requires||[];
    const missing=(Array.isArray(required)?required:[required]).filter(Boolean).filter(req=>!hasRequirement(req));
    return `${def.name||keyName(id)}${missing.length?` · Waiting for ${missing.map(req=>game.buildingDefs?.[req]?.name||keyName(req)).join(', ')}`:''}`;
  }).join(' | ')||'No units available for this producer.';
}
function updateSupportSellHint() {
  const button=$('#production-list [data-support="sell"]');
  if(!button)return;
  const building=selectedBuilding();
  const hint=button.querySelector('em');
  const name=game.buildingDefs?.[building?.defId]?.name||'structure';
  const message=building?`Sell selected ${name}`:'Select a building first';
  if(hint.textContent!==message)hint.textContent=message;
  button.disabled=!building;
}
function updateBlueprintView() {
  const list=$('#production-list'),button=$('#blueprint-view-toggle');
  const applicable=tab==='structures'||tab==='units';
  list.classList.toggle('compact-blueprint-grid',compactBlueprintView&&applicable);
  button.hidden=!applicable;
  button.setAttribute('aria-pressed',String(compactBlueprintView));
  const label=compactBlueprintView?'Switch to readable blueprint list':'Switch to compact blueprint grid';
  button.setAttribute('aria-label',label);
  button.title=label;
  button.textContent=compactBlueprintView?'☰':'▦';
}
function renderProduction(force=false) {
  if(!game)return;
  updateProductionSite();
  updateBlueprintView();
  updateBlueprintDetails();
  if(!lastProductionSignature||lastProductionTab!==tab){$('#production-list').scrollTop=0;lastProductionTab=tab;}
  $('#production-list').classList.toggle('support-mode',tab==='support'||tab==='research');
  $('#production-list').classList.toggle('research-mode',tab==='research');
  const signature=JSON.stringify([tab,selectedProductionSite()?.id,Math.floor((game.credits?.player||0)/25),game.construction?.defId,game.construction?.ready,
    game.power?.player?.production,game.power?.player?.consumption,
    selectedProductionSite()&&typeof game.getProductionRepeatStatus==='function'?game.getProductionRepeatStatus(selectedProductionSite().id):null,
    [...pendingProductionRepeat.keys()],
    game.buildings.filter(b=>b.owner==='player').map(b=>[b.defId,b.queue?.map(q=>q.defId)]),
    tab==='support'?Math.floor((game.superweapon?.player||0)*20):0,
    tab==='support'?Math.floor(game.commandEnergy?.player||0):0,
    tab==='support'?Object.values(game.commandCooldowns?.player||{}).map(Math.ceil):0,
    tab==='support'?game.research?.player?.tactical:null,
    tab==='support'?game.storm?.phase:null,
    tab==='research'?game.research?.player?.doctrine:null,
    tab==='research'?game.research?.player?.replacementUsed:null,
    tab==='research'?game.research?.player?.project?.id:null,
    tab==='research'?Math.floor((game.research?.player?.project?.progress||0)*100):0,
    tab==='research'?game.research?.player?.tactical:null,
    tab==='research'?game.research?.player?.tacticalProject?.id:null,
    tab==='research'?Math.floor((game.research?.player?.tacticalProject?.progress||0)*100):0,
    tab==='research'?game.buildings.filter(b=>b.owner==='player'&&b.defId==='tech').map(b=>[b.progress>=1,b.powered]):null,
    tab==='support'?game.relays.map(relay=>{
      const sight=fogAt(relay.x,relay.y),intel=relayIntel(relay,sight);
      return [sight,intel.owner,intel.protocol,intel.known?game._relayIsContested(relay):null,intel.known?Math.ceil(relay.protocolCooldown||0):null,sight===2?Math.round(Math.abs(relay.progress||0)*100):null];
    }):null]);
  if(!force&&signature===lastProductionSignature){
    if(game.construction){const bar=$(`#production-list [data-build="${game.construction.defId}"] .queue-progress`);if(bar)bar.style.width=`${Math.round(game.construction.progress*100)}%`;}
    if(tab==='support')updateSupportSellHint();
    return;
  }
  lastProductionSignature=signature;
  if(tab==='research'){
    const research=game.research?.player||{doctrine:null,project:null};
    const centers=game.buildings.filter(b=>b.owner==='player'&&b.defId==='tech'&&b.hp>0);
    const centerReady=centers.some(b=>b.progress>=1&&b.powered);
    const centerBuilding=centers.some(b=>b.progress<1);
    const researchIcons={logistics:'◈',siege:'✹',signal:'ϟ'};
    const researchEffects={logistics:'+25% HARVEST RATE',siege:'+20% STRUCTURE DAMAGE',signal:'FASTER ENERGY & COOLDOWNS'};
    const canAdapt=!!research.doctrine&&['skirmish','multiplayer'].includes(game.mode)&&
      (game.replayVersion==null||game.replayVersion>=DOCTRINE_REPLACEMENT_RULES_VERSION)&&!research.replacementUsed;
    const researchCards=Object.values(DOCTRINE_DEFS).map(d=>{
      const chosen=research.doctrine===d.id;
      const researching=research.project?.id===d.id;
      const replacing=!!research.doctrine&&!chosen;
      const cost=replacing?DOCTRINE_REPLACEMENT_COST:d.cost;
      const duration=replacing?DOCTRINE_REPLACEMENT_TIME:d.researchTime;
      const locked=chosen||!!research.project||(replacing&&!canAdapt);
      const canStart=!locked&&centerReady&&(game.credits?.player||0)>=cost;
      const progress=researching?Math.floor((research.project.progress||0)*100):0;
      const status=researching?`${replacing?'ADAPTING':'RESEARCHING'} · ${progress}%`:
        chosen?research.project?'ACTIVE UNTIL ADAPTATION COMPLETES':`ACTIVE · ${researchEffects[d.id]}`:
        replacing&&research.replacementUsed?'ADAPTATION USED':
        locked?'CHOICE LOCKED':!centers.length?'BUILD A RESEARCH CENTER':
        centerBuilding&&!centerReady?'CENTER UNDER CONSTRUCTION':
        !centerReady?'RESEARCH CENTER NEEDS POWER':!canStart?'INSUFFICIENT CREDITS':
        replacing?'REPLACE CURRENT FOCUS':researchEffects[d.id];
      const help=replacing?'One costly doctrine adaptation this battle. The current focus stays active until research completes.':
        'Complete one initial doctrine before choosing a tactical package.';
      return `<button class="production-item research-card ${chosen?'research-active':''} ${researching?'queued':''}" data-doctrine="${d.id}" ${canStart?'':'disabled'} title="${d.description} · ${help}"><span class="item-icon-fallback">${researchIcons[d.id]}</span><span class="item-text"><strong>${d.name.toUpperCase()}</strong><small class="research-effect">${researchEffects[d.id]}</small><em>${status}</em></span><small class="research-meta">◈ ${fmt(cost)}<br>${duration}S</small>${researching?`<span class="queue-progress" style="width:${progress}%"></span>`:''}</button>`;
    }).join('');
    const packageState=research.tacticalProject;
    const tacticalCards=Object.values(TACTICAL_PACKAGE_DEFS).map(p=>{
      const chosen=research.tactical===p.id;
      const researching=packageState?.id===p.id;
      const locked=!research.doctrine||!!research.tactical||!!packageState;
      const canStart=!locked&&centerReady&&(game.credits?.player||0)>=p.cost;
      const progress=researching?Math.floor((packageState.progress||0)*100):0;
      const status=chosen?'ACTIVE · AVAILABLE IN SUPPORT':researching?`RESEARCHING · ${progress}%`:!research.doctrine?'COMPLETE A DOCTRINE FIRST':locked?'CHOICE LOCKED':!centerReady?'RESEARCH CENTER NEEDS POWER':!canStart?'INSUFFICIENT CREDITS':'READY TO RESEARCH';
      return `<button class="production-item research-card tactical-research-card ${chosen?'research-active':''} ${researching?'queued':''}" data-tactical="${p.id}" ${canStart?'':'disabled'} title="${p.description} · One tactical package per battle"><span class="item-icon-fallback">${p.id==='breach'?'⌖':p.id==='interdict'?'ϟ':'➤'}</span><span class="item-text"><strong>${p.name.toUpperCase()}</strong><small class="research-effect">${p.description}</small><em>${status}</em></span><small class="research-meta">◈ ${fmt(p.cost)}<br>${p.researchTime}S</small>${researching?`<span class="queue-progress" style="width:${progress}%"></span>`:''}</button>`;
    }).join('');
    const doctrineStage=research.doctrine
      ?research.project?'ADAPTATION IN PROGRESS':canAdapt?`ONE ADAPTATION · ${fmt(DOCTRINE_REPLACEMENT_COST)} CR`:'FOCUS LOCKED FOR THIS BATTLE'
      :'CHOOSE ONE FOCUS';
    const doctrineSection=`<div class="support-section-title">FIELD RESEARCH <span>${doctrineStage}</span></div>${researchCards}`;
    const tacticalSection=`<div class="support-section-title tactical-stage-title">TACTICAL PACKAGE <span>UNLOCKS ONE TARGETED ACTION</span></div>${tacticalCards}`;
    // Bring the newly available decision into view once doctrine research ends.
    $('#production-list').innerHTML=research.doctrine
      ? `${tacticalSection}${doctrineSection}` : `${doctrineSection}${tacticalSection}`;
    updateProductionScrollCue();
    return;
  }
  if(tab==='support'){
    const aegisRelayRecovery=faction==='aegis'&&(game.replayVersion==null||game.replayVersion>=18);
    const hasSuper=game.buildings.some(b=>b.owner==='player'&&(b.defId==='superweapon'||b.defId==='warhead'));
    const charge=Math.floor((game.superweapon?.player||0)*100);
    const ready=hasSuper&&charge>=100;
    const weaponName=faction==='vesper'?'NUCLEAR STRIKE':'ION STRIKE';
    const abilityIcons={scan:'◉',overcharge:'ϟ',shield:'◈',stormcall:'⌁',breach:'⌖',interdict:'ϟ',rally:'➤'};
    const abilityCard=a=>{
      const cooldown=Math.ceil(game.commandCooldowns?.player?.[a.id]||0),energy=Math.floor(game.commandEnergy?.player||0);
      const stormcall=a.id==='stormcall';
      const stormActive=['warning','surge'].includes(game.storm?.phase);
      const relayOwned=game.relays.some(relay=>relay.owner==='player');
      const relaySecure=game.relays.some(relay=>relay.owner==='player'&&!game._relayIsContested(relay));
      const available=energy>=a.cost&&cooldown===0&&(!stormcall||stormActive&&relaySecure);
      const status=cooldown?`COOLDOWN · ${cooldown}S`:energy<a.cost?'ENERGY RECHARGING':stormcall&&!relayOwned?'CAPTURE A RELAY FIRST':stormcall&&!relaySecure?'SECURE AN UNCONTESTED RELAY':stormcall&&!stormActive?'READY DURING ION WARNING / SURGE':a.description;
      const range=stormcall?`WITHIN ${a.radius} OF A SECURE RELAY`:`${a.radius} RANGE`;
      return `<button class="production-item ability-card ${available?'':'unavailable'} ${stormcall?'stormcall-card':''}" data-ability="${a.id}" ${available?'':'disabled'} title="${a.description}"><span class="item-icon-fallback">${abilityIcons[a.id]||'◈'}</span><span class="item-text"><strong>${a.name.toUpperCase()}</strong><small>◌ ${a.cost} ENERGY · ${range}</small><em>${status}</em></span></button>`;
    };
    const chosenPackage=game.research?.player?.tactical;
    const packageAbility=Object.values(COMMAND_ABILITIES).find(a=>a.package===chosenPackage&&chosenPackage);
    const packageDeck=packageAbility?`<div class="support-section-title">TACTICAL PACKAGE <span>RESEARCHED ACTION</span></div>${abilityCard(packageAbility)}`:'';
    const fixedForceNotice=isFixedForceOperation()
      ? '<div class="fixed-force-hint"><strong>FIXED FORCE</strong> · No construction or replacement units. Protect your mission specialist.</div>'
      : '';
    const abilities=Object.values(COMMAND_ABILITIES).filter(a=>!a.package).map(abilityCard).join('');
    const relayNames=['WESTERN RELAY','CENTRAL RELAY','EASTERN RELAY'];
    const logisticsAvailable=!!game._relayLogisticsEnabled?.()&&!isFixedForceOperation();
    const relayProtocols=logisticsAvailable?['shelter','overdrive','logistics']:['shelter','overdrive'];
    const relayCards=game.relays.map((relay,index)=>{
      const visible=fogAt(relay.x,relay.y)===2;
      const intel=relayIntel(relay,fogAt(relay.x,relay.y));
      const contested=intel.known&&game._relayIsContested(relay),protocol=intel.protocol||'shelter';
      const owner=!intel.known?'SIGNAL UNKNOWN':intel.owner==='player'?'YOUR CONTROL':intel.owner==='enemy'?'ENEMY CONTROL':'UNOWNED';
      const state=!intel.known?'SCOUT TO VERIFY':contested?'CONTESTED':intel.owner?'SECURE':'AWAITING CAPTURE';
      const captureProgress=visible?Math.max(0,Math.min(100,Math.round(Math.abs(relay.progress||0)*100))):null;
      const captureSide=(relay.progress||0)>0?'YOUR FORCES':(relay.progress||0)<0?'ENEMY FORCES':'NO FORCE';
      const captureStatus=!visible?'':contested?'CONTESTED · CAPTURE PAUSED':captureProgress>=100?'CAPTURE COMPLETE':captureProgress>0?`${captureSide} CAPTURING · ${captureProgress}%`:'NO CAPTURE IN PROGRESS';
      const captureMeter=visible?`<div class="relay-capture ${contested?'contested':''}"><span class="relay-capture-label">${captureStatus}</span><div class="relay-capture-track" role="progressbar" aria-label="${relayNames[index]||`Relay ${index+1}`} capture progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${captureProgress}"><i style="width:${captureProgress}%"></i></div></div>`:'';
      const cooldown=intel.known?Math.ceil(relay.protocolCooldown||0):0;
      const canSwitch=intel.owner==='player'&&!contested&&!cooldown;
      const current=!intel.known?'PROTOCOL UNKNOWN':protocol.toUpperCase();
      const status=!intel.known?'Move a unit nearby or use Tactical Scan to update relay intel.':
        protocol==='overdrive'?'+0.45 COMMAND ENERGY / SEC · +15% GROUND RELOAD WITHIN 2.3 TILES · NO ION SHELTER':
        protocol==='logistics'?'LOGISTICS · +10% OF ACCEPTED HARVESTER CARGO PER SECURE RELAY · NO ION SHELTER OR RELOAD BONUS':
        intel.owner==='player'&&aegisRelayRecovery?'SHELTER · ION PROTECTION · FRIENDLY INFANTRY +1 HP/SEC':
          'SHELTER · PROTECTS NEARBY FORCES FROM ION STORMS';
      const lockedReason=!intel.known?'Scout to verify this relay.':contested?'The relay is contested.':cooldown?`Switch locked for ${cooldown} seconds.`:intel.owner!=='player'?'Capture this relay first.':'';
      const options=relayProtocols.map(option=>{
        const selected=intel.known&&protocol===option;
        const disabled=!canSwitch||selected;
        const label=option.toUpperCase();
        const reason=selected?'Current protocol.':lockedReason;
        return `<button type="button" class="relay-protocol-toggle ${selected?'selected':''}" data-relay-protocol="${relay.id}" data-next-protocol="${option}" ${disabled?'disabled':''} aria-pressed="${selected}" aria-label="${label} for ${relayNames[index]||`relay ${index+1}`}${reason?`. ${reason}`:''}">${label}</button>`;
      }).join('');
      return `<article class="relay-protocol-card ${intel.known?protocol:''}" aria-label="${relayNames[index]||`RELAY ${index+1}`}, ${owner}, ${state}, ${current}${visible?`, ${captureStatus.toLowerCase()}`:''}${cooldown?`, switch locked ${cooldown} seconds`:''}"><div class="relay-protocol-info"><strong>${relayNames[index]||`RELAY ${index+1}`}</strong><span class="relay-protocol-state">${owner} · ${state}</span>${captureMeter}<small>${status}</small>${cooldown?`<small class="relay-lock-time">SWITCH AVAILABLE IN ${cooldown}S</small>`:''}</div><div class="relay-protocol-options ${logisticsAvailable?'':'two-protocols'}" role="group" aria-label="${relayNames[index]||`Relay ${index+1}`} protocol">${options}</div></article>`;
    }).join('');
    const logisticsGuide=logisticsAvailable?' <strong>Logistics:</strong> +10% accepted Harvester cargo at unload per secure relay (max +30%, storage-capped).':'';
    $('#production-list').innerHTML=`${fixedForceNotice}${packageDeck}<div class="support-section-title command-ability-heading">COMMAND ABILITIES <span>RELAY POWERED</span></div>${abilities}<div id="relay-protocol-heading" class="support-section-title">RELAY PROTOCOLS <span>SECURE RELAYS TO SWITCH</span></div><div class="relay-protocol-guide"><strong>Shelter:</strong> ion protection${aegisRelayRecovery?' and Aegis infantry recovery':''}. <strong>Overdrive:</strong> +0.45 energy/sec and +15% nearby ground reload.${logisticsGuide} Overdrive and Logistics remove shelter. Benefits stop while contested; switching locks for 12 seconds.</div>${relayCards}<div class="support-section-title">TACTICAL SYSTEMS</div><button class="production-item" data-support="power-grid"><span class="item-icon-fallback">ϟ</span><span class="item-text"><strong>POWER GRID</strong><small>BUILDING STANDBY</small><em>Manage power draw and paused systems</em></span></button><button class="production-item" data-support="super" ${ready?'':'disabled'}><span class="item-icon-fallback">◉</span><span class="item-text"><strong>${weaponName}</strong><small>${hasSuper?`${charge}% CHARGED`:'BUILD SUPERWEAPON'}</small><em>${ready?'Target an enemy position':'Charging or offline'}</em></span>${hasSuper?`<span class="queue-progress" style="width:${charge}%"></span>`:''}</button><button class="production-item" data-support="sell"><span class="item-icon-fallback">↗</span><span class="item-text"><strong>SELL STRUCTURE</strong><small>50% REFUND</small><em>Select a building first</em></span></button><button class="production-item" data-support="center"><span class="item-icon-fallback">⌖</span><span class="item-text"><strong>CENTER BASE</strong><small>SPACE</small><em>Return to command yard</em></span></button><button class="production-item" data-support="manual"><span class="item-icon-fallback">?</span><span class="item-text"><strong>FIELD MANUAL</strong><small>GUIDE</small><em>Review commands</em></span></button><button class="production-item" data-support="armory"><span class="item-icon-fallback">◇</span><span class="item-text"><strong>ARMORY / CODEX</strong><small>FIELD INTELLIGENCE</small><em>Review faction roster and specifications</em></span></button>`;
    updateSupportSellHint();
    updateProductionScrollCue();
    return;
  }
  const defs=definitionMap(tab);
  const rank=([id,d])=>{
    if(tab!=='structures')return d.sort??d.cost??0;
    if(id===game.construction?.defId)return -2;
    if(id==='power'&&(game.power?.player?.production||0)<(game.power?.player?.consumption||0))return -1;
    return STRUCTURE_PRIORITY[id]??20+(d.sort??d.cost??0)/10000;
  };
  const site=tab==='units'?selectedProductionSite():null;
  const entries=Object.entries(defs).filter(([id,d])=>id!=='command'&&availableForFaction(d)&&(!site||d.producer===site.defId))
    .sort((a,b)=>rank(a)-rank(b)||(a[1].cost||0)-(b[1].cost||0));
  const list=$('#production-list'), scrollTop=list.scrollTop;
  const focusedInfo=document.activeElement?.closest?.('[data-blueprint-info]');
  const focusedBlueprint=focusedInfo?{id:focusedInfo.dataset.blueprintInfo,kind:focusedInfo.dataset.kind}:null;
  list.innerHTML=entries.map(([id,d])=>productionCard(id,d,tab)).join('') || '<div class="empty-selection">NO BLUEPRINTS</div>';
  list.scrollTop=scrollTop;
  if(focusedBlueprint)list.querySelector(`[data-blueprint-info="${focusedBlueprint.id}"][data-kind="${focusedBlueprint.kind}"]`)?.focus({preventScroll:true});
  updateProductionScrollCue();
}
function updateProductionScrollCue() {
  const list=$('#production-list'), cue=$('#production-scroll-cue');
  const label=tab==='support'?'support options':tab==='research'?'research options':tab==='units'?'units':'blueprints';
  cue.setAttribute('aria-label',`Scroll to more ${label}`);
  cue.title=`More ${label} below`;
  const threshold=tab==='research'?24:3;
  cue.classList.toggle('hidden',list.scrollHeight<=list.clientHeight+threshold||
    (tab==='support'&&list.scrollTop>3)||
    list.scrollTop+list.clientHeight>=list.scrollHeight-threshold);
}
function updateAttackMoveButton(units=selectedObjects().filter(o=>!('w' in o))) {
  syncTargetingFocus();
  const producer=selectedProductionBuilding();
  const bunker=selectedFieldBunker();
  const active=bunker?attackMoveMode==='bunkerAttack'||!!bunker._garrisonTargetId:producer?tab==='units':attackMoveMode==='attack'||(units.length>0&&units.every(unit=>
    unit.order?.type==='move'&&unit.order.attackMove));
  const button=$('#cmd-attack');
  button.querySelector('span').textContent=producer?'▣':'⌖';
  button.lastChild.textContent=producer?'PRODUCE':'ATTACK';
  button.title=bunker?'Set a stationary Field Bunker target. Garrisoned armed infantry fire without moving.':producer?'Open unit production for the selected building':'Attack move (Shift+A)';
  button.setAttribute('aria-label',bunker?'Set a stationary target for Field Bunker garrison':button.title);
  button.classList.toggle('active',active);
  button.setAttribute('aria-pressed',String(active));
  if(producer){
    const rallyButton=$('#cmd-move');
    const targeting=attackMoveMode==='rally';
    rallyButton.classList.toggle('active',targeting);
    rallyButton.setAttribute('aria-pressed',String(targeting));
  }
}
function startAttackTargetOrder() {
  if(selectedFieldBunker())startTargetOrder('bunkerAttack','BUNKER ATTACK','SELECT VISIBLE ENEMY');
  else startTargetOrder('attack','ATTACK MOVE');
}
function matchPaceGroundUnits(units=selectedObjects().filter(object=>!('w' in object))) {
  return units.filter(unit=>unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn&&
    !game.unitDefs?.[unit.defId]?.flying&&game.unitDefs?.[unit.defId]?.speed>0&&
    !(unit.defId==='stealthTank'&&(unit.ghostRunUntil||0)>game.time));
}
function matchPaceAvailable(units=selectedObjects().filter(object=>!('w' in object))) {
  return !!game&&!replayMode&&(game.replayVersion==null||game.replayVersion>=63)&&
    matchPaceGroundUnits(units).length>=2;
}
function updateMatchPaceControl(units) {
  const button=$('#match-pace-toggle');
  const available=!!game&&matchPaceAvailable(units);
  if(!available)matchPaceMode=false;
  button.classList.toggle('hidden',!available);
  button.classList.toggle('active',available&&matchPaceMode);
  button.disabled=!available;
  button.setAttribute('aria-pressed',String(available&&matchPaceMode));
  button.setAttribute('aria-label','Match the speed of the slowest selected ground unit. Air units keep their own speed; obstacles and combat can split the group.');
  button.title='Match the speed of the slowest selected ground unit. Air units keep their own speed; obstacles and combat can split the group.';
}
function matchPaceOrder(method,args,minimumArgs) {
  if(!matchPaceMode||!matchPaceAvailable())return game[method](...args);
  const normalized=[...args];
  while(normalized.length<minimumArgs)normalized.push(false);
  normalized.push(true);
  return game[method](...normalized);
}
function issueMoveCommand(x,y,attackMove=false,queue=false) {
  const resourceHarvest=attackMove!==true&&!queue&&getCell(x,y)?.resource>0&&
    selectedObjects().some(unit=>unit.owner==='player'&&/harvester/.test(unit.defId));
  if(!resourceHarvest){const formed=issueFormationCommand(x,y,attackMove?'attackMove':'move',queue);if(formed)return formed;}
  return matchPaceOrder('issueMove',[x,y,attackMove,queue],4);
}
function issueForceMoveCommand(x,y,queue=false) {
  const formed=issueFormationCommand(x,y,'forceMove',queue);if(formed)return formed;
  return matchPaceOrder('issueForceMove',[x,y,queue],3);
}
function issueReverseMoveCommand(...args) { return matchPaceOrder('issueReverseMove',args,3); }
function cancelDigInTargeting(){
  digInToken++;digInMode=false;digInSelectionKey='';digInPending=false;
  $('#battlefield-wrap')?.classList.remove('dig-in-targeting');
  if(!commandAbilityMode&&!attackMoveMode)hide('#attack-hint');
  syncTargetingFocus();
}
function startDigInTargeting(){
  if(!game)return;
  if(digInMode)return;
  const selected=selectedObjects();
  const eligible=selected.filter(unit=>!('w' in unit)&&unit.owner==='player'&&unit.hp>0&&
    ['rifle','rocket'].includes(unit.defId));
  if(!eligible.length){toast('SELECT RIFLE SQUADS OR ROCKET TROOPERS',true);return;}
  if(replayMode||game.replayVersion!=null&&game.replayVersion<INFANTRY_DIG_IN_RULES_VERSION){toast('DIG IN IS AVAILABLE IN NEW BATTLES',true);return;}
  const ready=eligible.filter(unit=>(unit.abilityCooldown||0)<=0);
  if(!ready.length){
    const cooldown=Math.min(...eligible.map(unit=>Math.ceil(unit.abilityCooldown||0)).filter(value=>value>0));
    toast(`DIG IN RECOVERING${Number.isFinite(cooldown)?` · ${cooldown}S`:''}`,true);
    return;
  }
  if(typeof game.issueDigIn!=='function'){toast('DIG IN IS UNAVAILABLE IN THIS BATTLE',true);return;}
  if(placeId)cancelPlacement();
  cancelCommandAbility();
  if(attackMoveMode){attackMoveMode=false;targetOrderPending=false;targetOrderToken++;hide('#attack-hint');updateAttackMoveButton();}
  setRoutePlanMode(false);
  digInToken++;
  digInMode=true;
  digInSelectionKey=eligible.map(unit=>unit.id).sort().join('|');
  $('#cmd-deploy').classList.add('active');
  $('#battlefield-wrap').classList.add('dig-in-targeting');
  $('#attack-hint').textContent=innerWidth<=670||matchMedia('(pointer: coarse)').matches?'DIG IN · TAP TO SET FACING':'FACE THIS DIRECTION · NO MOVEMENT · ESC TO CANCEL';
  show('#attack-hint');
  syncTargetingFocus();
  toast('DIG IN · CHOOSE A FACING');
}
function issueDigInAt(x,y){
  if(!game||!digInMode||digInPending)return;
  const token=digInToken;
  const result=game.issueDigIn?.(x,y)||{ok:false,reason:'Dig In is unavailable in this battle.'};
  if(result?.pending){
    digInPending=true;
    $('#attack-hint').innerHTML=`DIG IN · WAITING FOR SERVER CONFIRMATION${targetingCancelCopy()}`;
    resultMessage(result,'INFANTRY DIG IN ORDERED','order',{
      onAccepted:()=>{
        if(digInToken!==token||!digInMode)return;
        cancelDigInTargeting();updateUI(true);
      },
      onSettled:ack=>{
        if(digInToken!==token||!digInMode)return;
        digInPending=false;
        if(!ack?.ok){
          if(ack?.transportFailure)cancelDigInTargeting();
          else $('#attack-hint').innerHTML=`DIG IN · ORDER REJECTED · SELECT FACING${targetingCancelCopy()}`;
        }
      }
    });
    return;
  }
  if(resultMessage(result,'INFANTRY DIG IN ORDERED')&&digInToken===token&&digInMode){
    cancelDigInTargeting();updateUI(true);
  }
}
function updateSelectionCard() {
  const rosterState=selectionRoster.sync({selection:game?.selection||[],units:game?.units||[],buildings:game?.buildings||[],unitDefs:game?.unitDefs||{}});
  updateSelectionRoster(rosterState);
  const selected=selectedObjects();
  if(attackMoveMode==='assignRefinery'&&!isHarvesterHomeSelection(selected))cancelActiveTargeting();
  updateFormationControl(selected);
  if(digInMode){
    const selectedDigInKey=selected.filter(unit=>!('w' in unit)&&unit.owner==='player'&&unit.hp>0&&
      ['rifle','rocket'].includes(unit.defId)).map(unit=>unit.id).sort().join('|');
    if(selectedDigInKey!==digInSelectionKey)cancelDigInTargeting();
  }
  $('#selection-count').textContent=`${String(selected.length).padStart(2,'0')} ACTIVE`;
  $('#mobile-deck-peek').textContent=`COMMAND DECK · ${String(selected.length).padStart(2,'0')} ACTIVE`;
  const units=selected.filter(o=>!('w' in o));
  const productionBuilding=selectedProductionBuilding();
  const fieldBunker=selectedFieldBunker();
  $('#command-actions').setAttribute('aria-label',productionBuilding?'Selected production building commands':fieldBunker?'Selected Field Bunker commands':'Selected unit commands');
  $('#command-actions').classList.toggle('production-commands',!!productionBuilding||!!fieldBunker);
  $('#command-actions').classList.toggle('bunker-commands',!!fieldBunker);
  updateMatchPaceControl(units);
  updateRoutePlanControl(units);
  const bloomHarvesters=units.filter(unit=>unit.owner==='player'&&unit.hp>0&&unit.defId==='harvester'&&
    unit._harvestPhase!=='return'&&unit.cargo<(game.unitDefs?.harvester?.capacity||700));
  const bloomEscorts=units.filter(unit=>unit.owner==='player'&&unit.hp>0&&unit.defId!=='harvester'&&
    !game.unitDefs?.[unit.defId]?.flying&&game.unitDefs?.[unit.defId]?.weapon&&
    game.unitDefs[unit.defId].weapon.target!=='air');
  const bloomCommandReady=!replayMode&&typeof game.issueBloomExpedition==='function'&&
    (game.replayVersion==null||game.replayVersion>=52)&&game.storm?.bloom?.until>game.time&&
    bloomHarvesters.length>0&&bloomEscorts.length>=bloomHarvesters.length;
  const harvestButton=$('#cmd-harvest');
  harvestButton.classList.toggle('bloom-command',bloomCommandReady);
  harvestButton.lastChild.textContent=bloomCommandReady?'BLOOM':'HARVEST';
  harvestButton.title=bloomCommandReady
    ?'Launch an escorted Stormglass Bloom mining run (Shift+H). Press H for ordinary harvesting.'
    :'Harvest crystal (H). During a Stormglass Bloom, select a Harvester and armed ground escort together to launch an expedition.';
  harvestButton.setAttribute('aria-label',harvestButton.title);
  const reversingArmor=reverseMoveUnits(units);
  const showReverse=reversingArmor.length>0&&!units.some(unit=>unit.defId==='harvester');
  harvestButton.classList.toggle('hidden',showReverse);
  const reverseButton=$('#cmd-reverse');
  reverseButton.classList.toggle('hidden',!showReverse);
  reverseButton.disabled=!reversingArmor.length;
  const reverseActive=reversingArmor.length>0&&reversingArmor.every(unit=>unit.order?.type==='move'&&unit.order.reverse);
  reverseButton.classList.toggle('active',reverseActive);
  reverseButton.setAttribute('aria-pressed',String(reverseActive));
  reverseButton.setAttribute('aria-label','Reverse selected armor at 65% speed while keeping its front opposite its travel direction. Shift+M.');
  const fieldUnit=units.length===1&&selected.length===1&&units[0].owner==='player'&&
    (game.replayVersion==null||game.replayVersion>=36)&&
    ['guardian','stealthTank'].includes(units[0].defId)?units[0]:null;
  const fieldAbilityCohort=getFieldAbilityCohort(game);
  const fieldAbilityGroup=fieldAbilityCohort?.ids.length>1?fieldAbilityCohort:null;
  const mobileRecommissionUnit=units.length===1&&selected.length===1&&units[0].owner==='player'&&
    units[0].defId==='engineer'&&matchMedia('(max-width: 670px)').matches?units[0]:null;
  const fieldAbility=fieldUnit?.defId==='guardian'?'brace':fieldUnit?'ghostRun':null;
  const digInUnits=units.filter(unit=>unit.owner==='player'&&unit.hp>0&&['rifle','rocket'].includes(unit.defId));
  const digInRulesAvailable=!replayMode&&(game.replayVersion==null||game.replayVersion>=INFANTRY_DIG_IN_RULES_VERSION)&&
    typeof game.issueDigIn==='function';
  const digInReadyUnits=digInUnits.filter(unit=>(unit.abilityCooldown||0)<=0);
  const digInCooldowns=digInUnits.filter(unit=>(unit.abilityCooldown||0)>0).map(unit=>Math.ceil(unit.abilityCooldown));
  const digInCooldown=digInCooldowns.length?Math.min(...digInCooldowns):0;
  const digInOrderStatus=unit=>{
    if(unit?.order?.type!=='digIn')return null;
    const readyAt=Number.isFinite(unit.order.readyAt)?unit.order.readyAt:game.time;
    const expiresAt=Number.isFinite(unit.order.expiresAt)?unit.order.expiresAt:readyAt+INFANTRY_DIG_IN_DURATION_SECONDS;
    if(game.time<readyAt){
      const elapsed=Math.max(0,Math.min(INFANTRY_DIG_IN_SETUP_SECONDS,INFANTRY_DIG_IN_SETUP_SECONDS-(readyAt-game.time)));
      return `SETTING UP ${elapsed.toFixed(1)}/${INFANTRY_DIG_IN_SETUP_SECONDS.toFixed(1)}S`;
    }
    return game.time<expiresAt?`DUG IN ${Math.ceil(expiresAt-game.time)}S`:null;
  };
  const digInStates=digInUnits.map(digInOrderStatus).filter(Boolean);
  const digInStatus=digInStates[0]||null;
  const wreckCoverRulesAvailable=!replayMode&&
    (game.replayVersion==null||game.replayVersion>=WRECK_COVER_RULES_VERSION);
  const wreckCoverHint=wreckCoverRulesAvailable&&units.some(unit=>unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn&&
    game.unitDefs?.[unit.defId]?.armor==='infantry'&&!game.unitDefs?.[unit.defId]?.flying&&
    (game.wrecks||[]).some(wreck=>wreck.expiresAt>game.time&&!wreck.campaignFreightCache&&
      fogAt(wreck.x,wreck.y)===2&&Math.hypot(unit.x-wreck.x,unit.y-wreck.y)>WRECK_COVER_RADIUS&&
      Math.hypot(unit.x-wreck.x,unit.y-wreck.y)<=WRECK_COVER_PROXIMITY));
  const digInTooltip=`Dig In · face a direction without moving. ${INFANTRY_DIG_IN_SETUP_SECONDS}s setup, ${INFANTRY_DIG_IN_DURATION_SECONDS}s protection; the 30s shared cooldown starts on use. Frontal direct ballistic and cannon damage is reduced by ${Math.round((1-INFANTRY_DIG_IN_DAMAGE_MULTIPLIER)*100)}%; explosives and flanking bypass it.`;
  const loadedHarvesters=units.filter(unit=>unit.owner==='player'&&unit.defId==='harvester'&&unit.cargo>0);
  const gunships=units.filter(unit=>unit.owner==='player'&&game.unitDefs?.[unit.defId]?.flying&&
    Number.isFinite(game.unitDefs?.[unit.defId]?.ammoMax));
  const rearmMode=loadedHarvesters.length===0&&gunships.length>0;
  const airServiceAvailable=game.replayVersion==null||game.replayVersion>=AIR_SERVICE_RULES_VERSION;
  const showReturn=loadedHarvesters.length>0||rearmMode;
  const returnButton=$('#cmd-return');
  returnButton.classList.toggle('hidden',!showReturn);
  $('#cmd-deploy').classList.toggle('hidden',showReturn);
  const hasRefinery=game.buildings.some(building=>building.owner==='player'&&building.defId==='refinery'&&building.hp>0&&building.progress>=1);
  const hasHelipad=game.buildings.some(building=>building.owner==='player'&&building.defId==='helipad'&&building.hp>0&&building.progress>=1&&building.powered);
  const missingAmmo=gunships.some(unit=>unit.ammo<game.unitDefs[unit.defId].ammoMax-.001);
  returnButton.disabled=rearmMode?!airServiceAvailable||!hasHelipad||!missingAmmo:!showReturn||!hasRefinery;
  returnButton.lastChild.textContent=rearmMode?'REARM':'RETURN';
  returnButton.title=rearmMode?!airServiceAvailable?'Early rearm is available in new operations':
    !hasHelipad?'Build and power a Helipad to rearm gunships':!missingAmmo?'Gunship ammunition is full':
      'Return selected gunships to a powered Helipad, refill ammunition, then hold (J)':
    hasRefinery?'Return partial cargo to a refinery (J)':'Build a refinery to unload cargo';
  returnButton.setAttribute('aria-label',returnButton.title);
  const rearming=rearmMode&&gunships.every(unit=>unit.order?.type==='rearm');
  returnButton.classList.toggle('active',rearming);
  returnButton.setAttribute('aria-pressed',String(rearming));
  const fieldButton=$('#cmd-deploy');
  delete fieldButton.dataset.digIn;
  if(mobileRecommissionUnit){
    delete fieldButton.dataset.unitAbility;
    delete fieldButton.dataset.unitId;
    fieldButton.dataset.recommissionWreck='true';
    fieldButton.querySelector('span').textContent='⛭';
    fieldButton.lastChild.textContent='RESTORE';
    fieldButton.disabled=!recommissionRulesAvailable();
    fieldButton.classList.remove('active');
    fieldButton.title=fieldButton.disabled
      ?'Recommissioning unavailable in this archived or older battle. Start a new battle to enable it.'
      :'Recommission wreck · choose a compatible visible wreck · powered Field Workshop within 6 tiles · 40% cost · 12 seconds';
    fieldButton.setAttribute('aria-label',fieldButton.title);
  }else if(fieldAbilityGroup){
    delete fieldButton.dataset.recommissionWreck;
    delete fieldButton.dataset.unitId;
    fieldButton.dataset.unitAbility=fieldAbilityGroup.abilityId;
    const brace=fieldAbilityGroup.abilityId==='brace';
    const label=brace?'BRACE':'GHOST RUN';
    const ready=fieldAbilityGroup.readyIds.length;
    const total=fieldAbilityGroup.ids.length;
    const active=fieldAbilityGroup.activeIds.length;
    const cooling=fieldAbilityGroup.coolingIds.length;
    const needsMove=fieldAbilityGroup.needsMoveIds.length;
    const activeRemaining=Math.max(0,Math.ceil(fieldAbilityGroup.activeRemaining||0));
    const nextCooldown=Math.max(0,Math.ceil(fieldAbilityGroup.nextCooldown||0));
    const lockedIds=fieldAbilityGroup.ids.filter(id=>fieldAbilityLocks.has(id));
    const lockedCount=lockedIds.length;
    const locked=lockedCount>0;
    const pending=!!pendingFieldAbility;
    const abilityRulesAvailable=!replayMode&&(game.replayVersion==null||game.replayVersion>=36);
    fieldButton.querySelector('span').textContent=brace?'⬡':'◇';
    const needsMoveOnly=fieldAbilityGroup.abilityId==='ghostRun'&&ready===0&&needsMove>0;
    const labelText=pending?'WAITING':needsMoveOnly?'MOVE TO ARM':locked?`${brace?'BRACED':'GHOST'} ${active+lockedCount}`:
      ready?`${brace?'BRACE':'GHOST'} ${ready}/${total}`:active?`${brace?'BRACED':'GHOST'} ${activeRemaining||active}`:
        cooling?`${brace?'BRACE':'GHOST'} ${nextCooldown}`:`${brace?'BRACE':'GHOST'} 0/${total}`;
    fieldButton.lastChild.textContent=labelText;
    fieldButton.disabled=pending||locked||!abilityRulesAvailable||(ready===0&&!needsMoveOnly);
    fieldButton.classList.toggle('active',active>0);
    const parts=[`${label} · ${ready}/${total} ready`];
    if(active)parts.push(`${active} active${activeRemaining?` · ${activeRemaining}s remaining`:''}`);
    if(cooling)parts.push(`${cooling} cooling${nextCooldown?` · next in ${nextCooldown}s`:''}`);
    if(needsMove)parts.push(`${needsMove} need a move order`);
    if(pending)parts.push('waiting for server confirmation');
    else if(locked)parts.push('waiting for the confirmed state update');
    else if(!abilityRulesAvailable)parts.push('unavailable in replay or archived rules');
    else if(needsMoveOnly)parts.push('issue a move order to arm Ghost Run');
    else if(!ready)parts.push(nextCooldown?`next ready in ${nextCooldown}s`:'no units ready');
    else parts.push(brace?'Protect nearby armor for 7 seconds':'Move units first to arm Ghost Run; then accelerate their move while weapons are silent for 6 seconds');
    fieldButton.title=`${parts.join(' · ')} (E)`;
    fieldButton.setAttribute('aria-label',fieldButton.title);
  }else if(fieldUnit){
    delete fieldButton.dataset.recommissionWreck;
    const activeUntil=fieldAbility==='brace'?fieldUnit.braceUntil:fieldUnit.ghostRunUntil;
    const active=Math.max(0,Math.ceil((activeUntil||0)-(game.time||0)));
    const cooldown=Math.max(0,Math.ceil(fieldUnit.abilityCooldown||0));
    const label=fieldAbility==='brace'?'BRACE':'GHOST RUN';
    const locked=fieldAbilityLocks.has(fieldUnit.id);
    const pending=!!pendingFieldAbility;
    const canUse=game.canUseUnitAbility?.(fieldUnit.id,fieldAbility)||{ok:false,reason:'Field action unavailable.'};
    const needsMoveAction=fieldAbility==='ghostRun'&&!canUse.ok&&/Ghost Run requires a move order\./i.test(canUse.reason||'');
    fieldButton.dataset.unitAbility=fieldAbility;
    fieldButton.dataset.unitId=fieldUnit.id;
    fieldButton.querySelector('span').textContent=fieldAbility==='brace'?'⬡':'◇';
    fieldButton.lastChild.textContent=pending?'WAITING':locked?`${fieldAbility==='brace'?'BRACED':'GHOST'} 1`:needsMoveAction?'MOVE TO ARM':fieldAbility==='brace'
      ?active?`BRACED ${active}`:cooldown?`BRACE ${cooldown}`:'BRACE'
      :active?`GHOST ${active}`:cooldown?`GHOST ${cooldown}`:'GHOST';
    fieldButton.disabled=pending||locked||replayMode||paused||(!canUse.ok&&!needsMoveAction);
    fieldButton.classList.toggle('active',active>0);
    fieldButton.title=pending?'Waiting for field ability confirmation':locked?'Waiting for the confirmed state update':active?`${label} active · ${active}s remaining`:
      cooldown?`${label} cooling down · ${cooldown}s remaining`:
      needsMoveAction?'Issue a move order to arm Ghost Run (E)':canUse.ok?`${label} · ${fieldAbility==='brace'?'Protect nearby armor for 7 seconds':'Accelerate an existing move order while weapons are silent for 6 seconds'} (E)`:
        `${label} unavailable · ${canUse.reason||'Choose a valid unit'}`;
    fieldButton.setAttribute('aria-label',fieldButton.title);
  }else if(digInUnits.length&&!showReturn&&!units.some(unit=>unit.defId==='mcv')){
    delete fieldButton.dataset.unitAbility;
    delete fieldButton.dataset.unitId;
    delete fieldButton.dataset.recommissionWreck;
    fieldButton.dataset.digIn='true';
    fieldButton.querySelector('span').textContent='⌖';
    const available=digInRulesAvailable&&digInReadyUnits.length>0;
    fieldButton.lastChild.textContent=available?'DIG IN':digInCooldown>0?`DIG IN ${digInCooldown}`:'DIG IN';
    fieldButton.disabled=!available;
    fieldButton.classList.toggle('active',digInMode);
    fieldButton.title=`${digInTooltip}${digInUnits.length<units.length?` ${digInUnits.length} of ${units.length} selected units can dig in.`:''} ${digInReadyUnits.length}/${digInUnits.length} eligible units ready${digInCooldown?`; next ready in ${digInCooldown}s`:''}${!digInRulesAvailable?'; start a new battle to enable Dig In':''}`;
    fieldButton.setAttribute('aria-label',fieldButton.title);
  }else{
    delete fieldButton.dataset.unitAbility;
    delete fieldButton.dataset.unitId;
    delete fieldButton.dataset.recommissionWreck;
    delete fieldButton.dataset.digIn;
    fieldButton.querySelector('span').textContent='⌂';
    fieldButton.lastChild.textContent='DEPLOY';
    fieldButton.classList.remove('active');
    fieldButton.title='Deploy selected Mobile Command Rig (E)';
    fieldButton.setAttribute('aria-label',fieldButton.title);
  }
  const suppressedUnits=units.filter(unit=>(unit.suppressedUntil||0)>(game?.time||0));
  const disrupted=suppressedUnits.length>0;
  $('#selection-card').classList.toggle('is-disrupted',disrupted);
  for(const [button,order] of [['#cmd-move','forceMove'],['#cmd-guard','guard'],['#cmd-patrol','patrol'],['#cmd-follow','follow'],['#cmd-force','forceFire'],['#cmd-board','board'],['#cmd-unload','unload']]) {
    const active=button==='#cmd-move'&&productionBuilding?attackMoveMode==='rally':units.length>0&&units.every(unit=>unit.order?.type===order);
    $(button).classList.toggle('active',active);
    $(button).setAttribute('aria-pressed',String(active));
  }
  $('#cmd-board').title='Choose a friendly ground or air carrier, or a completed friendly Field Bunker for eligible infantry (L).';
  $('#cmd-board').setAttribute('aria-label',$('#cmd-board').title);
  updateAttackMoveButton(units);
  for(const id of ['attack','move','guard','patrol','follow','stop','harvest','scatter','force','board','unload','deploy'])
    $(`#cmd-${id}`).disabled=units.length===0 || (id==='deploy'&&!units.some(unit=>unit.defId==='mcv')&&!digInUnits.length) || (id==='harvest'&&!units.some(unit=>unit.defId==='harvester')) || (id==='force'&&!units.some(unit=>game.unitDefs?.[unit.defId]?.weapon)) || (id==='board'&&!units.some(unit=>game.unitDefs?.[unit.defId]?.armor==='infantry')) || (id==='unload'&&!units.some(unit=>isTroopCarrier(unit)&&unit.passengerIds?.length));
  const moveButton=$('#cmd-move');
  moveButton.lastChild.textContent=productionBuilding?'RALLY':'MOVE';
  moveButton.title=productionBuilding?(mobileRallyAvailable()?'Rally armed reinforcements to a friendly mobile unit, or choose ground for a fixed point (M).':'Set this building’s reinforcement rally point (M)'):'Force move without engaging (M or Alt+click)';
  moveButton.setAttribute('aria-label',moveButton.title);
  if(productionBuilding){$('#cmd-attack').disabled=false;moveButton.disabled=false;}
  if(fieldBunker){
    const crew=bunkerOccupants(fieldBunker);
    const incoming=bunkerIncomingUnits(fieldBunker);
    const pending=pendingBunkerCommands.has(fieldBunker.id);
    const armedCrew=crew.some(unit=>game.unitDefs?.[unit.defId]?.weapon);
    $('#cmd-attack').disabled=!armedCrew||replayMode||paused;
    $('#cmd-attack').title=armedCrew?'Set a stationary target for garrisoned infantry; the bunker will not move.':'Garrison armed infantry before setting a bunker target.';
    $('#cmd-attack').setAttribute('aria-label','Set a stationary target for Field Bunker garrison');
    moveButton.lastChild.textContent=pending?'WAIT…':'EVACUATE';
    moveButton.disabled=(!crew.length&&!incoming.length)||pending||replayMode||paused;
    moveButton.title=crew.length?'Evacuate occupants to nearby clear ground and cancel incoming garrison orders. Blocked occupants wait for space.':incoming.length?'Cancel incoming garrison orders.':'The Field Bunker is empty.';
    moveButton.setAttribute('aria-label',moveButton.title);
  }
  if(mobileRecommissionUnit)fieldButton.disabled=!recommissionRulesAvailable();
  else if(fieldAbilityGroup)fieldButton.disabled=paused||replayMode||(game.replayVersion!=null&&game.replayVersion<36)||
    (!!pendingFieldAbility||fieldAbilityGroup.ids.some(id=>fieldAbilityLocks.has(id)))||
    (fieldAbilityGroup.readyIds.length===0&&!(fieldAbilityGroup.abilityId==='ghostRun'&&fieldAbilityGroup.needsMoveIds.length>0));
  else if(fieldUnit){
    const check=game.canUseUnitAbility?.(fieldUnit.id,fieldAbility);
    const needsMove=fieldAbility==='ghostRun'&&!check?.ok&&/Ghost Run requires a move order\./i.test(check?.reason||'');
    fieldButton.disabled=replayMode||paused||!!pendingFieldAbility||fieldAbilityLocks.has(fieldUnit.id)||(!check?.ok&&!needsMove);
  }
  else if(fieldButton.dataset.digIn==='true')fieldButton.disabled=!digInRulesAvailable||digInReadyUnits.length===0;
  const armed=units.filter(unit=>unit.owner==='player'&&game.unitDefs?.[unit.defId]?.weapon);
  const stances=new Set(armed.map(unit=>unit.stance||'aggressive'));
  const stance=armed.length===0?'none':stances.size===1?[...stances][0]:'mixed';
  const stanceUI=STANCE_UI[stance]||STANCE_UI.mixed;
  const stanceButton=$('#cmd-stance');
  stanceButton.disabled=armed.length===0;
  stanceButton.dataset.stance=stance;
  stanceButton.querySelector('span').textContent=stanceUI.icon;
  stanceButton.lastChild.textContent=stanceUI.short;
  stanceButton.title=armed.length?`${stanceUI.name} stance · cycle with T`:'Select an armed unit to set combat stance (T)';
  stanceButton.setAttribute('aria-label',armed.length?`Combat stance: ${stanceUI.name}. Cycle with T.`:'Combat stance unavailable; select an armed unit.');
  const medicSelected=medicEscortRulesInGame()&&units.some(unit=>unit.defId==='medic'&&unit.owner==='player');
  $('#cmd-follow').title=engineerEscortRulesInGame()&&selected.some(unit=>unit.defId==='engineer')?
    'Escort with field repair kits (F). Choose a friendly ground vehicle; stop it for five-second repairs. Refill spent kits at a powered Field Workshop.':medicSelected?'Escort a friendly unit (F). Medics prioritize an injured infantry escort target in healing range; otherwise they heal nearby wounded infantry.':'Follow a friendly unit (F)';
  $('#cmd-follow').setAttribute('aria-label',$('#cmd-follow').title);
  const canRepairStructure=selected.some(o=>'w' in o&&o.owner==='player');
  const canOrderEngineer=selected.some(o=>o.defId==='engineer'&&o.owner==='player');
  const canAssignHome=isHarvesterHomeSelection(selected);
  const homeCanAutoDock=canAssignHome&&selected.some(unit=>unit.homeRefineryId!=null);
  const showTargetPriority=updateTargetPriorityControl(units);
  $('#cmd-repair').classList.toggle('hidden',showTargetPriority&&!canRepairStructure&&!canOrderEngineer&&!canAssignHome);
  $('#cmd-repair').disabled=!canRepairStructure&&!canOrderEngineer&&!canAssignHome;
  $('#cmd-repair').lastChild.textContent=canAssignHome?'HOME':canOrderEngineer&&!canRepairStructure?'ENGINEER':'REPAIR';
  $('#cmd-repair').title=canAssignHome?'Choose a completed friendly Refinery as the selected Harvesters’ persistent home. Loaded cargo unloads there, then they keep mining. Press R.':canOrderEngineer&&!canRepairStructure?fieldRepairRulesInGame()?'Engineer tasks (R): patch a damaged friendly vehicle with a field kit, salvage a wreck, rebuild a bridge, or capture a damaged structure.':'Send engineer to a wreck, bridge, or structure (R)':'Repair selected structure (R)';
  $('#cmd-repair').setAttribute('aria-label',canAssignHome?'Choose Home Refinery for selected Harvesters (R)':canOrderEngineer&&!canRepairStructure?'Engineer task (R)':'Repair selected structure (R)');
  const guardButton=$('#cmd-guard');
  guardButton.lastChild.textContent=homeCanAutoDock?'AUTO DOCK':'GUARD';
  guardButton.title=homeCanAutoDock?'Clear the selected Harvesters’ home Refinery and restore automatic refinery routing (G).':'Guard this position (G)';
  guardButton.setAttribute('aria-label',homeCanAutoDock?'Clear Home Refinery and restore automatic docking (G)':'Guard this position (G)');
  const serviceUnits=units.filter(unit=>unit.owner==='player'&&!unit.embarkedIn&&unit.hp>0&&unit.hp<unit.maxHp&&
    !game.unitDefs?.[unit.defId]?.flying&&['light','heavy'].includes(game.unitDefs?.[unit.defId]?.armor));
  const serviceBays=game.buildings.filter(building=>building.owner==='player'&&building.defId==='serviceBay'&&
    building.hp>0&&building.progress>=1);
  const kitEngineers=selectedKitEngineers();
  const onlyKitEngineers=kitEngineers.length>0&&kitEngineers.length===selected.length;
  const missingKits=kitEngineers.some(unit=>(unit.fieldRepairKits||0)<2);
  $('#cmd-service').lastChild.textContent=onlyKitEngineers?'REFILL':'SERVICE';
  $('#cmd-service').disabled=onlyKitEngineers?!missingKits||!serviceBays.some(b=>b.powered):!serviceUnits.length||!serviceBays.length;
  $('#cmd-service').title=onlyKitEngineers?!missingKits?'Both Engineer field repair kits are ready. Use Engineer task (R) on a damaged vehicle.':
    !serviceBays.some(b=>b.powered)?'Build and power a Field Workshop to refill repair kits.':'Return Engineers to a powered Field Workshop. Each kit costs 80 credits and takes 8 seconds. Engineers remain at the Workshop after refill.':
    !serviceUnits.length?'Select a damaged ground vehicle':!serviceBays.length?'Build a Field Workshop first':'Send selected damaged vehicles to a Field Workshop and restore their previous orders';
  $('#cmd-service').setAttribute('aria-label',onlyKitEngineers?'Refill Engineer repair kits at a powered Field Workshop, 80 credits and 8 seconds per kit':'Service damaged ground vehicles at a Field Workshop');
  updateMobileSquads();
  if(!selected.length){
    $('#cmd-repair').disabled=true;$('#cmd-repair').lastChild.textContent='REPAIR';$('#cmd-repair').title='Repair selected structure (R)';$('#cmd-repair').setAttribute('aria-label','Repair selected structure (R)');
    $('#cmd-guard').lastChild.textContent='GUARD';$('#cmd-guard').title='Guard this position (G)';$('#cmd-guard').setAttribute('aria-label','Guard this position (G)');
    $('#selection-card').classList.remove('is-critical','has-promotion-choice','has-power-control','has-bunker-roster');$('#promotion-trigger').classList.add('hidden');$('#selection-content').innerHTML='<div class="empty-selection"><span>⌖</span><strong>NO UNIT SELECTED</strong><small>SELECT A UNIT OR STRUCTURE TO VIEW DETAILS</small></div>';return;
  }
  const first=selected[0],isBuilding='w' in first,def=isBuilding?game.buildingDefs?.[first.defId]:game.unitDefs?.[first.defId];
  const hp=selected.length===1?first.hp:selected.reduce((n,u)=>n+u.hp,0),maxHp=selected.length===1?first.maxHp:selected.reduce((n,u)=>n+u.maxHp,0),pct=Math.max(0,Math.round(hp/maxHp*100));
  const critical=selected.some(o=>o.owner==='player')&&pct<=25;
  $('#selection-card').classList.toggle('is-critical',critical);
  const baseUnitOrder=first.order?.type==='move'&&first.order.reverse?'REVERSING · 65% SPEED':first.order?.bloomExpedition?'BLOOM EXPEDITION':first.order?.bloomExpeditionEscort
    ?'BLOOM ESCORT':first.order?.type==='move'&&first.order.attackMove?'ATTACK MOVE':
      keyName(first.order?.type||'ready').toUpperCase();
  const orderPace=Number.isFinite(first.order?.pace)&&first.order.pace>0?first.order.pace:null;
  const unitOrder=orderPace&&!(first.ghostRunUntil>game.time)
    ?`${baseUnitOrder} · MATCHED PACE ${orderPace.toFixed(2)} T/S`:baseUnitOrder;
  const queuedOrders=!isBuilding&&Array.isArray(first.order?.queue)?first.order.queue.length:0;
  const field=first._harvestTile||first.order?.type==='harvest'&&Number.isFinite(first.order.x)&&Number.isFinite(first.order.y)?first._harvestTile||{x:first.order.x,y:first.order.y}:null;
  const refinerySupported=!isBuilding&&first.owner==='player'&&first.defId==='harvester'&&faction==='aegis'&&field&&game.buildings.some(b=>b.owner==='player'&&b.defId==='refinery'&&b.hp>0&&b.progress>=1&&b.powered&&Math.hypot(field.x+.5-(b.x+b.w/2),field.y+.5-(b.y+b.h/2))<=6);
  const unitDef=!isBuilding?game.unitDefs?.[first.defId]:null;
  const elevatedAdvantage=selected.length===1&&!isBuilding&&first.owner==='player'&&
    !unitDef?.flying&&game._unitOnVantage?.(first);
  const serviceSupported=!isBuilding&&first.owner==='player'&&first.hp<first.maxHp&&!first.embarkedIn&&!unitDef?.flying&&
    ['light','heavy'].includes(unitDef?.armor)&&(game.credits?.player||0)>0&&game.buildings.some(b=>{
      if(b.owner!=='player'||b.defId!=='serviceBay'||b.hp<=0||b.progress<1||!b.powered)return false;
      const dx=Math.max(b.x-first.x,0,first.x-(b.x+b.w));
      const dy=Math.max(b.y-first.y,0,first.y-(b.y+b.h));
      return Math.hypot(dx,dy)<=2.5;
    });
  const nextRefinery=first.defId==='harvester'&&first._harvestPhase==='return'
    ?(first._unloadRefineryId&&game.getEntity(first._unloadRefineryId))||
      game._nearestRefinery(first.owner,first.x,first.y):null;
  const waitingForBay=nextRefinery&&first.cargo>0&&first._unloadRemaining<=0&&
    nextRefinery._unloadHarvesterId&&nextRefinery._unloadHarvesterId!==first.id&&
    game._distanceToEntity(first.x,first.y,nextRefinery)<=0.95;
  const harvesterState=first.defId==='harvester'&&first._unloadRefineryId&&first._unloadRemaining>0
    ?`UNLOADING CARGO · ${Math.ceil(first._unloadRemaining)}S`:waitingForBay?'WAITING FOR UNLOAD BAY':first.defId==='harvester'&&first._harvestPhase==='return'?'RETURNING CARGO':null;
  const recommissionWaiting=first._wreckRecommissionWaiting==='workshop'?'WAITING · POWERED FIELD WORKSHOP':
    first._wreckRecommissionWaiting==='credits'?'WAITING · CREDITS':
      first._wreckRecommissionWaiting==='space'?'WAITING · CLEAR NEARBY GROUND':null;
  const recommissionTarget=first.order?.type==='recommissionWreck'&&
    game.wrecks?.find(wreck=>wreck.id===first.order.wreckId);
  const recommissionState=first.order?.type==='recommissionWreck'
    ?recommissionWaiting||(recommissionTarget&&Math.hypot(first.x-recommissionTarget.x,first.y-recommissionTarget.y)>0.85
      ?'APPROACHING WRECK':`RECOMMISSIONING · ${Math.min(12,Math.floor(first._wreckRecommissionProgress||0))}/12S`):null;
  const serviceOrderState=first.order?.type==='service'?first._serviceWaiting==='power'?'SERVICE PAUSED · NO POWER':
    first._serviceWaiting==='credits'?'SERVICE PAUSED · LOW CREDITS':`FIELD WORKSHOP SERVICE · ${unitOrder}`:null;
  const fieldActive=fieldUnit&&(fieldAbility==='brace'?fieldUnit.braceUntil:fieldUnit.ghostRunUntil)>(game.time||0)
    ?`${fieldAbility==='brace'?'BRACED ARMOR':'GHOST RUN'} · ${Math.ceil((fieldAbility==='brace'?fieldUnit.braceUntil:fieldUnit.ghostRunUntil)-game.time)}S`:null;
  const fieldHint=fieldAbility==='ghostRun'&&!(fieldUnit.abilityCooldown>0)&&
    !['move','forceMove'].includes(first.order?.type)?'GHOST RUN · MOVE TO ARM':null;
  const rearmingAircraft=unitDef?.flying&&Number.isFinite(unitDef.ammoMax)&&first.order?.type==='rearm';
  const rearmPad=rearmingAircraft?game._nearestHelipad?.(first.owner,first.x,first.y):null;
  const aircraftState=rearmingAircraft?!rearmPad?'REARM WAITING · NEED POWERED HELIPAD':
    Math.hypot(first.x-rearmPad.x-rearmPad.w/2,first.y-rearmPad.y-rearmPad.h/2)>.5?'RETURNING TO HELIPAD':
      `REARMING · ${Math.ceil((unitDef.ammoMax-first.ammo)/unitDef.rearmRate)}S`:
    unitDef?.flying&&Number.isFinite(unitDef.ammoMax)&&first.ammo<1?`NO AMMUNITION · ${unitOrder}`:null;
  const singleDigInCooldown=digInUnits.includes(first)&&first.abilityCooldown>0?Math.ceil(first.abilityCooldown):0;
  const medicPatient=first.owner==='player'&&first.defId==='medic'&&first.order?.type==='follow'
    ?game.getEntity(first.order.targetId):null;
  const medicState=medicEscortPatient(medicPatient)?`ESCORT TRIAGE · ${game.unitDefs[medicPatient.defId].name.toUpperCase()}`:null;
  const engineerEscort=first.defId==='engineer'&&first.order?.type==='follow'&&
    engineerEscortVehicle(game.getEntity(first.order.targetId));
  const engineerEscortStatus=engineerEscort?first.fieldRepairKits<1?'ESCORT · REFILL REQUIRED':
    first._fieldRepairWaiting==='target-assigned'?'ESCORT · ANOTHER ENGINEER PATCHING':
    first._fieldRepairWaiting==='target-moving'?'ESCORT · STOP VEHICLE TO PATCH':
    first._fieldRepairProgress>0?`ESCORT PATCH ${Math.floor(first._fieldRepairProgress)}/5S`:'ESCORT READY':null;
  const repairKitState=first.owner==='player'&&first.defId==='engineer'&&(game.replayVersion==null||game.replayVersion>=85)&&Number.isFinite(first.fieldRepairKits)?
    `KITS ${Math.max(0,Math.min(2,first.fieldRepairKits))}/2 · ${first.order?.type==='fieldRepair'
      ?first._fieldRepairWaiting==='target-moving'?'HOLD VEHICLE STILL':`PATCHING ${Math.floor(first._fieldRepairProgress||0)}/5S`
      :first.order?.type==='refillRepairKits'?first._fieldRepairWaiting?`REFILL PAUSED · ${String(first._fieldRepairWaiting).toUpperCase()}`:
        first._fieldRepairRefillProgress>0?`REFILL ${Math.floor(first._fieldRepairRefillProgress)}/8S`:'RETURNING TO WORKSHOP'
        :engineerEscortStatus||(first.fieldRepairKits<1?'REFILL AT WORKSHOP':engineerEscortRulesInGame()?'FOLLOW (F) TO ESCORT':'ENGINEER TASK (R) TO PATCH')}`:null;
  const reinforcementState=first.owner==='player'&&first._productionRally?
    first._productionRally.stage==='approach'?'RENDEZVOUS WITH RALLY UNIT':'FOLLOWING RALLY UNIT':null;
  const tacticalState=fieldActive||digInStatus||(singleDigInCooldown?`DIG IN COOLDOWN · ${singleDigInCooldown}S`:
    disrupted?`WEAPON DISRUPTED · ${Math.ceil(first.suppressedUntil-game.time)}S`:
    fieldHint||recommissionState||repairKitState||serviceOrderState||harvesterState||aircraftState||medicState||reinforcementState||
    (serviceSupported?`FIELD REPAIRS ACTIVE · ${unitOrder}`:refinerySupported?'NETWORK SUPPORTED · +20% EXTRACTION':first.defId==='stealthTank'&&first.revealedUntil<=(game?.time||0)?'CLOAKED · AMBUSH READY':isTroopCarrier(first)?`PASSENGERS ${first.passengerIds?.length||0}/${unitDef.capacity} · ${unitOrder}`:unitOrder));
  const workshopState=first.defId==='serviceBay'?(first.powered?'FIELD REPAIRS ONLINE':'FIELD REPAIRS OFFLINE'):null;
  const groupSummary=selected.length>1&&units.length?(()=>{
    const counts=new Map();
    for(const unit of units){
      const armor=game.unitDefs?.[unit.defId]?.flying?'air':game.unitDefs?.[unit.defId]?.armor||'support';
      const label=armor==='infantry'?'INF':armor==='light'?'LIGHT':armor==='heavy'?'HEAVY':armor==='air'?'AIR':armor.toUpperCase();
      counts.set(label,(counts.get(label)||0)+1);
    }
    const composition=[...counts].map(([label,count])=>`${count} ${label}`).join(' · ');
    const orders=new Set(units.map(unit=>unit.order?.type==='move'&&unit.order.reverse?'reverseMove':
      unit.order?.type==='move'&&unit.order.attackMove?'attackMove':unit.order?.type||'ready'));
    const routed=units.filter(unit=>unit.order?.queue?.length).length;
    const paceValues=units.map(unit=>unit.order?.pace).filter(value=>Number.isFinite(value)&&value>0);
    const paceLabel=units.some(unit=>unit.ghostRunUntil>game.time)?'GHOST RUN ACTIVE':
      paceValues.length?paceValues.every(value=>Math.abs(value-paceValues[0])<0.005)
        ?`MATCHED PACE ${paceValues[0].toFixed(2)} T/S`:'MATCHED PACE':'';
    const digInLine=digInUnits.length?` · DIG IN ${digInReadyUnits.length}/${digInUnits.length} READY${digInStates.length?` · ${digInStates[0]}`:''}`:'';
    return `${composition}${suppressedUnits.length?` · ${suppressedUnits.length} DISRUPTED`:''}${orders.size>1?' · MIXED ORDERS':''}${paceLabel?` · ${paceLabel}`:''}${routed?` · ${routed} ROUTED`:''}${digInLine}`;
  })():'';
  const rallyLeader=productionBuilding?productionRallyUnit(productionBuilding):null;
  const subtitleBase=selected.length>1?(groupSummary||`${selected.length} UNITS SELECTED`):isBuilding?first.powerStandby===true?'PAUSED · STANDBY':rallyLeader?`REINFORCE ${game.unitDefs[rallyLeader.defId].name.toUpperCase()}`:workshopState||(first.repairing?'REPAIRING · ':'')+`${first.owner.toUpperCase()} STRUCTURE`:`${first.owner.toUpperCase()} UNIT · ${tacticalState}`;
  const coverHintText=digInStatus||singleDigInCooldown||fieldActive||recommissionState||serviceOrderState
    ?'NEAR WRECK':'WRECK NEARBY · KEEP BEHIND HULL';
  const subtitle=`${subtitleBase}${wreckCoverHint?` · ${coverHintText}`:''}`;
  const rank=!isBuilding&&selected.length===1?VETERANCY_RANKS[Math.min(VETERANCY_RANKS.length-1,first.veterancy||0)]:null;
  const nextRank=rank?VETERANCY_RANKS[(first.veterancy||0)+1]:null;
  const rankProgress=rank?nextRank?Math.max(0,Math.min(100,Math.round(((first.xp||0)-rank.xp)/(nextRank.xp-rank.xp)*100))):100:0;
  const promotionName=first.promotion==='bulwark'?'BULWARK':first.promotion==='rangefinder'?'RANGEFINDER':'';
  const promotionReady=selected.length===1&&promotionEligible(first);
  $('#selection-card').classList.toggle('has-promotion-choice',promotionReady);
  $('#promotion-trigger').classList.toggle('hidden',!promotionReady);
  const rankBadge=rank?`<span class="veterancy-badge rank-${first.veterancy||0}" title="${rank.name} · ${Math.floor(first.xp||0)} XP · ${Math.floor(((rank.damageMultiplier||1)-1)*100)}% damage and health bonus${promotionName?` · ${promotionName} field modification`:''}">${first.veterancy?'★':'◇'} ${rank.name.toUpperCase()}</span>`:'';
  const rankLine=rank?`<div class="veterancy-track" role="progressbar" aria-label="${rank.name} experience" aria-valuenow="${rankProgress}" aria-valuemin="0" aria-valuemax="100" aria-valuetext="${Math.floor(first.xp||0)} XP${nextRank?` of ${nextRank.xp} XP to ${nextRank.name}`:' · maximum rank'}"><span style="width:${rankProgress}%"></span></div>`:'';
  const homeRefinery=first.owner==='player'&&first.defId==='harvester'&&first.homeRefineryId!=null
    ?game.getEntity?.(first.homeRefineryId)||game.buildings.find(building=>building.id===first.homeRefineryId):null;
  const homeStatus=first.homeRefineryId==null?'AUTO':!homeRefinery||homeRefinery.hp<=0||homeRefinery.progress<1?'OFFLINE':homeRefinery.powerStandby===true?'STANDBY':homeRefinery.powered===false?'OFFLINE':'WORKING';
  const homeMeta=!isBuilding&&selected.length===1&&first.owner==='player'&&first.defId==='harvester'
    ?` · HOME ${homeStatus==='AUTO'?'AUTO':`${homeRefinery?`${buildingSectorLabel(homeRefinery)} · `:''}${homeStatus}`}`:'';
  const chargedCargo=first.owner==='player'&&first.defId==='harvester'?Math.floor(first._stormglassCargo||0):0;
  const cargoMeta=!isBuilding&&selected.length===1&&first.defId==='harvester'
    ?` · CARGO ${Math.floor(first.cargo||0)}/${unitDef.capacity}${chargedCargo?` · CHARGED ${chargedCargo} (+35% ON DELIVERY)`:''}${homeMeta}`:'';
  const assignedHarvesterCount=isBuilding&&first.owner==='player'&&first.defId==='refinery'&&harvesterHomeRulesAvailable()
    ?game.units.filter(unit=>unit.owner==='player'&&unit.defId==='harvester'&&unit.homeRefineryId===first.id).length:0;
  const bayMeta=isBuilding&&selected.length===1&&first.owner==='player'&&first.defId==='refinery'
    ?` · UNLOAD BAY ${first._unloadHarvesterId?'BUSY':'READY'}${harvesterHomeRulesAvailable()?` · HOME HARVESTERS ${assignedHarvesterCount}`:''}`:'';
  const bunkerOccupantsNow=fieldBunker?bunkerOccupants(fieldBunker):[];
  const bunkerCapacity=fieldBunker?(fieldBunker.garrisonCapacity||def?.garrisonCapacity||3):0;
  const bunkerIncoming=fieldBunker?bunkerIncomingUnits(fieldBunker).length:0;
  const bunkerMeta=fieldBunker?` · GARRISON ${bunkerOccupantsNow.length}/${bunkerCapacity}${bunkerIncoming?` · ${bunkerIncoming} INCOMING`:''}${fieldBunker._garrisonEvacuating?' · EXIT BLOCKED':''}`:'';
  const bunkerRoster=fieldBunker?`<div class="bunker-occupant-roster" role="list" aria-label="Field Bunker occupants">${bunkerOccupantsNow.map(unit=>{
    const unitName=game.unitDefs?.[unit.defId]?.name||keyName(unit.defId);
    const health=Math.max(0,Math.round(unit.hp/Math.max(1,unit.maxHp)*100));
    return `<span role="listitem" title="${unitName} · ${health}% health">${unitName}<b>${health}%</b></span>`;
  }).join('')||'<small>NO OCCUPANTS</small>'}</div>`:'';
  const selectedGunships=selected.length===units.length?gunships:[];
  const ammoCapacity=selectedGunships.reduce((sum,unit)=>sum+game.unitDefs[unit.defId].ammoMax,0);
  const readyShots=selectedGunships.reduce((sum,unit)=>sum+Math.floor(Math.max(0,unit.ammo||0)+.001),0);
  const ammoMeta=selectedGunships.length===selected.length&&ammoCapacity>0?`AMMO ${readyShots}/${ammoCapacity} · INTEGRITY ${pct}%`:null;
  const ammoProgress=ammoCapacity?Math.min(100,Math.max(0,selectedGunships.reduce((sum,unit)=>sum+(unit.ammo||0),0)/ammoCapacity*100)):0;
  const ammoLine=ammoMeta?`<div class="ammunition-track" role="progressbar" aria-label="Gunship ammunition" aria-valuenow="${readyShots}" aria-valuemin="0" aria-valuemax="${ammoCapacity}" aria-valuetext="${readyShots} shots ready of ${ammoCapacity}"><span style="width:${ammoProgress}%"></span></div>`:'';
  const meta=ammoMeta||((rank?`INTEGRITY ${pct}% · ${first.kills||0} KILLS · ${nextRank?`${Math.max(0,Math.ceil(nextRank.xp-(first.xp||0)))} XP TO ${nextRank.name.toUpperCase()}`:promotionName?promotionName:'MAX RANK'}`:`ARMOR INTEGRITY · ${pct}%${isBuilding&&first.queue?.length?` · ${first.queue.length} QUEUED`:''}`)+cargoMeta+bayMeta+bunkerMeta+(queuedOrders?` · ${queuedOrders} QUEUED`:''));
  const elevationBadge=elevatedAdvantage?`<small class="elevation-advantage" title="Elevated position improves sight by 1 and weapon reach by 0.5">HIGH GROUND · +1 SIGHT${unitDef?.weapon?' · +0.5 REACH':''}</small>`:'';
  const powerToggleEligible=selected.length===1&&isBuilding&&first.owner==='player'&&first.hp>0&&first.progress>=1&&Number(def?.power)<0;
  $('#selection-card').classList.toggle('has-power-control',!!powerToggleEligible);
  const powerToggleCheck=powerToggleEligible?game.canSetBuildingPower?.(first.id,!first.powerStandby):null;
  const powerCanToggle=powerToggleEligible&&!!powerToggleCheck?.ok&&!replayMode&&!pendingPowerCommands.has(first.id);
  const powerAction=first.powerStandby===true?'RESTORE POWER':'STANDBY';
  const archivedPowerUnavailable=/power routing is unavailable in this archived battle/i.test(powerToggleCheck?.reason||'');
  const powerControl=powerToggleEligible?`<button class="selection-power-toggle" type="button" data-selection-power="${String(first.id).replaceAll('"','&quot;')}" data-standby="${first.powerStandby===true?false:true}" ${powerCanToggle?'':'disabled'} aria-label="${archivedPowerUnavailable?`${def?.name||'Building'} controls unavailable in this archived battle. Start a new battle to enable them.`:`${first.powerStandby===true?'Restore power to':'Put'} ${def?.name||'building'} ${first.powerStandby===true?'online':'on standby'}`}" title="${archivedPowerUnavailable?'Start a new battle to enable power controls.':powerToggleCheck?.reason||''}">${pendingPowerCommands.has(first.id)?'WAITING FOR SERVER':powerAction}</button>`:'';
  const selectedEngineer=selected.length===1&&!isBuilding&&first.owner==='player'&&first.defId==='engineer';
  const recommissionEnabled=selectedEngineer&&recommissionRulesAvailable();
  const archivedRecommission=replayMode||game.replayVersion!=null&&game.replayVersion<72;
  const ironReclaimedRestore=currentMode==='campaign'&&missionIndex===15;
  const recommissionControl=selectedEngineer?`<button class="selection-recommission${ironReclaimedRestore?' selection-recommission-iron-reclaimed':''}" type="button" data-recommission-wreck ${recommissionEnabled?'':'disabled'} aria-label="${archivedRecommission?'Recommissioning unavailable in this archived battle. Start a new battle to enable it.':ironReclaimedRestore?'Restore the marked Guardian wreck with this Engineer at the powered Field Workshop.':'Choose a compatible visible wreck to recommission. Requires a powered Field Workshop within 6 tiles and credits; takes 12 seconds.'}" title="${archivedRecommission?'Start a new battle to enable recommissioning.':!recommissionEnabled?'Recommissioning is unavailable in this battle.':ironReclaimedRestore?'Select the marked Guardian wreck · powered Field Workshop nearby · costs 520 credits · restored at 40% integrity · 12 seconds':'Select a compatible visible wreck · powered Field Workshop within 6 tiles · 40% unit cost · 12 seconds'}">${archivedRecommission?'NEW BATTLE REQUIRED':ironReclaimedRestore?'<span class="selection-recommission-desktop">RECOMMISSION WRECK</span><span class="selection-recommission-mobile">RESTORE</span>':'RECOMMISSION WRECK'}</button><small class="selection-recommission-help">${archivedRecommission?'Unavailable in this archived battle · start a new battle.':ironReclaimedRestore?'Marked Guardian · 520 credits · 40% integrity · 12s · powered Workshop.':'Restore a compatible visible vehicle at 40% health · 40% cost · 12s · powered Workshop within 6 tiles.'}</small>`:'';
  $('#selection-card').classList.toggle('has-bunker-roster',!!fieldBunker);
  $('#selection-content').innerHTML=`<div class="selection-detail"><div class="selection-icon">${assetHTML(first.defId,first.faction||(first.owner==='enemy'?game.enemyFaction:faction))}</div><div class="selection-info"><div class="selection-heading"><h3>${selected.length>1?(units.length?'COMBAT GROUP':'STRUCTURES'):def?.name||keyName(first.defId)}</h3>${rankBadge}</div><small>${subtitle}</small><div class="health-bar"><span style="width:${pct}%"></span></div><div class="selection-meta">${meta}</div>${bunkerRoster}${powerControl}${recommissionControl}${elevationBadge}${ammoLine||rankLine}</div></div>`;
}
function placeSquadControlBar() {
  const bar=$('#mobile-squads');
  const commandPanel=$('#command-panel');
  const selectionCard=$('#selection-card');
  if(!bar||!commandPanel||!selectionCard)return;
  if(window.matchMedia('(min-width: 671px)').matches){
    if(bar.parentElement!==commandPanel||bar.nextElementSibling!==$('#command-actions'))
      commandPanel.insertBefore(bar,$('#command-actions'));
  }else{
    const battlefield=$('#battlefield-wrap');
    if(battlefield&&bar.parentElement!==battlefield)battlefield.append(bar);
  }
}
placeSquadControlBar();
function setSquadControlsExpanded(expanded){
  const toggle=$('#mobile-squads-toggle');
  $('#mobile-squads').dataset.expanded=String(expanded);
  toggle.setAttribute('aria-expanded',String(expanded));
  toggle.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} squad controls`);
  toggle.querySelector('.mobile-squads-chevron').textContent=expanded?'⌃':'⌄';
}
function updateMobileSquads() {
  if(!game)return;
  const livingIds=new Set([...game.units,...game.buildings].filter(entity=>entity.hp>0).map(entity=>entity.id));
  const selected=new Set(game.selection||[]);
  for(const slot of $('#mobile-squads').querySelectorAll('[data-squad-slot]')) {
    const digit=slot.dataset.squadSlot;
    const ids=(groups[digit]||[]).filter(id=>livingIds.has(id));
    const active=ids.length>0&&ids.length===selected.size&&ids.every(id=>selected.has(id));
    const recall=slot.querySelector('[data-squad-recall]');
    const assign=slot.querySelector('[data-squad-assign]');
    slot.classList.toggle('is-empty',ids.length===0);
    slot.classList.toggle('is-selected',active);
    recall.querySelector('span').textContent=ids.length?String(ids.length):'—';
    recall.disabled=ids.length===0;
    recall.setAttribute('aria-pressed',String(active));
    recall.setAttribute('aria-label',ids.length?`Select and center squad ${digit}, ${ids.length} ${ids.length===1?'unit':'units'}${active?', selected':''}`:`Squad ${digit} is empty`);
    assign.disabled=selected.size===0;
    assign.title=selected.size?`Assign ${selected.size} selected ${selected.size===1?'unit':'units'} to squad ${digit}`:'Select units to assign a squad';
  }
}
function updateUI(force=false) {
  syncTargetingFocus();
  if(!game){
    $('#ai-profile-badge').classList.add('hidden');
    resetAiProfileDisclosure();
    return;
  }
  const aiProfile = activeAiCommanderProfile();
  const aiBadge = $('#ai-profile-badge');
  const aiToggle = $('#ai-profile-toggle');
  const aiChipLabel = $('#ai-profile-chip-label');
  const aiPlan = game.mode === 'skirmish' && game.aiCounterPlan?.id === 'anti-armor-screen'
    ? game.aiCounterPlan : null;
  const aiPlanNote = $('#ai-counterplan-note');
  aiBadge.classList.toggle('hidden', !aiProfile);
  aiBadge.classList.toggle('has-counter-plan', !!aiPlan);
  aiPlanNote.classList.toggle('hidden', !aiPlan);
  if (aiProfile) {
    if(aiBadge.dataset.profile!==aiProfile.id){
      resetAiProfileDisclosure();
    }
    $('#ai-profile-name').textContent = aiProfile.name.toUpperCase();
    $('#ai-profile-description').textContent=aiProfile.description;
    aiBadge.dataset.profile = aiProfile.id;
    aiChipLabel.textContent = `${aiProfile.name.toUpperCase()} · INTEL`;
    aiToggle.setAttribute('aria-label',`${aiToggle.getAttribute('aria-expanded')==='true'?'Collapse':'Expand'} ${aiProfile.name} commander intelligence`);
    aiToggle.lastElementChild.textContent=aiToggle.getAttribute('aria-expanded')==='true'?'▴':'▾';
    const contact = aiPlan && Number.isFinite(aiPlan.target?.x) && Number.isFinite(aiPlan.target?.y)
      ? ` · LAST CONTACT ${String(Math.floor(aiPlan.target.x)).padStart(2, '0')}//${String(Math.floor(aiPlan.target.y)).padStart(2, '0')}` : '';
    if (aiPlan) aiPlanNote.textContent = `ANTI-ARMOR SCREEN${contact}`;
    const planDescription = aiPlan ? ' The enemy observed your armor and is setting an anti-armor screen near its last contact.' : '';
    aiBadge.title = aiProfile.description + planDescription;
    aiBadge.setAttribute('aria-label', `Enemy commander ${aiProfile.name}. ${aiProfile.description}${planDescription}`);
  } else {
    resetAiProfileDisclosure();
    delete aiBadge.dataset.profile;
    aiBadge.removeAttribute('title');
    aiBadge.removeAttribute('aria-label');
  }
  scanTacticalDamage();
  renderBattlefieldPicker();
  refreshPointerLabel();
  updateRelayLocator();
  updateSalvageLocator();
  $('.minimap-wrap').classList.toggle('radar-offline',!game.radar?.player&&!missionUplinkTargets().length);
  $('#credits-value').textContent=fmt(game.credits?.player);
  const p=game.power?.player||{};const production=p.production||0,consumption=p.consumption||0;
  $('#power-value').textContent=`${fmt(production)} / ${fmt(consumption)}`;
  $('#power-grid-trigger').disabled=replayMode;
  $('#power-grid-trigger').setAttribute('aria-label',`Open Power Grid controls. ${fmt(production)} power produced, ${fmt(consumption)} drawn, ${fmt(production-consumption)} headroom.`);
  $('#power-meter span').style.width=`${Math.min(100,production/Math.max(1,consumption)*100)}%`;
  $('#power-meter span').style.background=production<consumption?'#fd7868':'#c9ff66';
  renderPowerGrid();
  $('#game-status').textContent=production<consumption?'LOW POWER':'ONLINE';
  $('#game-status').style.color=production<consumption?'#fd7868':'';
  $('#energy-value').textContent=`${Math.floor(game.commandEnergy?.player||0)} / 100`;
  $('#relay-value').textContent=`${(game.relays||[]).filter(r=>r.owner==='player').length} / ${(game.relays||[]).length}`;
  const dominion=$('#relay-dominion'),d=game.relayDominion;
  const dominionVisible=currentMode!=='campaign'&&(currentMode==='skirmish'||currentMode==='multiplayer')&&game.victoryMode!=='elimination'&&d&&(d.owner==='player'||d.owner==='enemy');
  dominion.classList.toggle('hidden',!dominionVisible);
  if(dominionVisible){
    dominion.dataset.owner=d.owner;
    const required=Math.max(1,Number(d.required)||90),elapsed=Math.max(0,Number(d.elapsed)||0),remaining=Math.max(0,Math.ceil(required-elapsed));
    const key=`${d.owner}:${remaining}:${required}`;
    if(key!==dominionDisplayKey){
      dominionDisplayKey=key;
      $('#dominion-owner').textContent=d.owner==='player'?'YOUR RELAYS DOMINATING':'ENEMY RELAYS DOMINATING';
      $('#dominion-countdown').textContent=`${remaining} SEC TO ${d.owner==='player'?'VICTORY':'DEFEAT'}`;
      dominion.setAttribute('aria-valuemax',String(required));dominion.setAttribute('aria-valuenow',String(Math.min(required,Math.floor(elapsed))));
      dominion.setAttribute('aria-valuetext',`${remaining} seconds until ${d.owner==='player'?'victory':'defeat'}`);
    }
    $('#dominion-progress').style.width=`${Math.min(100,elapsed/required*100)}%`;
  }else {dominionDisplayKey='';delete dominion.dataset.owner;}
  const stormPhase=(game.storm?.phase||'calm').toUpperCase();
  const playerStormcall=game.storm?.lure?.owner==='player'&&game.storm.lure.until>game.time&&['WARNING','SURGE'].includes(stormPhase);
  const stormRemaining=Math.max(0,Math.ceil((ION_STORM_PHASE_SECONDS[game.storm?.phase]||0)-(game.storm?.phaseTime||0)));
  const bloom=game.storm?.bloom?.until>game.time?game.storm.bloom:null;
  const bloomRemaining=bloom?Math.max(0,Math.ceil(bloom.until-game.time)):0;
  if((currentMode==='multiplayer'||currentMode==='skirmish')&&playing){
    const bloomUntil=bloom?.until||null;
    if(bloomUntil!==lastPublicBloomUntil){
      if(bloomUntil){
        toast('STORMGLASS BLOOM · SELECT HARVESTER + ESCORT · BLOOM COMMAND · +35% ON DELIVERY',false,5500);
        audio.play('alert');
      }
      lastPublicBloomUntil=bloomUntil;
    }
  }
  $('#storm-status-button small').textContent=bloom?'STORMGLASS':'ION STORM';
  $('#storm-value').textContent=bloom?`BLOOM ${bloomRemaining}S`:playerStormcall?`${stormPhase} ↗`:stormPhase;
  const stormButton=$('#storm-status-button');
  stormButton.title=bloom
    ?`Stormglass Bloom at sector ${Math.floor(bloom.x)}, ${Math.floor(bloom.y)} · ${bloomRemaining}s left · select a Harvester and armed ground escort, then choose BLOOM or Shift+H · charged cargo earns 35% extra on delivery · click to center`
    :`${stormPhase} · ${stormRemaining}s until ${stormPhase==='CALM'?'warning':stormPhase==='WARNING'?'surge':stormPhase==='SURGE'?'recovery':'calm'} · click to center storm`;
  stormButton.setAttribute('aria-label',bloom
    ?`Center on public Stormglass Bloom at sector ${Math.floor(bloom.x)} by ${Math.floor(bloom.y)}. ${bloomRemaining} seconds left. Crystal gathered there earns 35 percent extra when delivered.`
    :`Center on ion storm. ${stormPhase.toLowerCase()}, ${stormRemaining} seconds until next phase.`);
  stormButton.classList.toggle('bloom-active',Boolean(bloom));
  $('.storm-status').classList.toggle('storm-active',stormPhase==='SURGE');
  $('.storm-status').classList.toggle('storm-warning',stormPhase==='WARNING');
  $('.storm-status').classList.toggle('storm-called',Boolean(playerStormcall));
  const callRemaining=playerStormcall?Math.max(0,Math.ceil(game.storm.lure.until-game.time)):0;
  const callStatus=game.storm?.lure?.relayId?(game.storm.lure.pulseResolved?'PULSE FIRED':'PULSE ARMED'):stormPhase;
  $('#systems-status').textContent=production<consumption?'▲ POWER DEFICIT · BUILD A PLANT':playerStormcall?`▲ STORMCALL ${callStatus} · ${callRemaining}S`:stormPhase==='SURGE'?`▲ ION SURGE · ${stormRemaining}S LEFT · SHELTER FORCES`:bloom?`▲ STORMGLASS BLOOM · +35% ON DELIVERY · ${bloomRemaining}S`:stormPhase==='WARNING'?`▲ ION SURGE IN ${stormRemaining}S`:stormPhase==='RECOVERY'?`▲ STORM CLEARING · ${stormRemaining}S`:`▲ NEXT ION WARNING IN ${stormRemaining}S`;
  updateCampaignGuidance(p);
  updateCampaignTracker();
  $('#clock-display').textContent=`${String(Math.floor(gameSeconds/60)).padStart(2,'0')}:${String(Math.floor(gameSeconds%60)).padStart(2,'0')}`;
  renderProduction(force);updateSelectionCard();
  if(force)drawMinimap();
}
function updateRelayLocator() {
  const locator=$('#relay-locator');
  const campaignPlacementTip=currentMode==='campaign'&&missionIndex===0&&
    game?.construction?.ready&&['power','refinery'].includes(game.construction.defId);
  if(!playing||replayMode||!game||game.status!=='playing'||placeId||campaignPlacementTip){
    locator.classList.add('hidden');
    delete locator.dataset.scoutUnknown;
    delete locator.dataset.scoutReason;
    return;
  }
  // During an enemy Dominion countdown, point to a visible enemy-held relay
  // first so the player can interrupt it. Otherwise retain the neutral target.
  // Ownership is inspected only after confirming the relay is currently visible.
  const counteringEnemyDominion=game.victoryMode!=='elimination'&&game.relayDominion?.owner==='enemy';
  // Relay coordinates are public map landmarks. During an unseen enemy
  // countdown, offer scouting destinations without reading hidden ownership.
  let selection=chooseRelayLocator(game.relays,fogAt,counteringEnemyDominion,relayScoutIndex);
  let scoutReason=selection?.scoutUnknown?'dominion':null;
  // Give the opening a fog-safe direction when no relay is in live sight yet.
  // This uses only the public relay coordinates and visibility values; it does
  // not inspect a fogged relay's owner or expose its marker on the field.
  const hasVisibleRelay=(game.relays||[]).some(item=>fogAt(item.x,item.y)===2);
  if(!selection&&!hasVisibleRelay&&(game.relays||[]).length){
    const yard=game.buildings.find(building=>building.owner==='player'&&/yard|command|hq/.test(building.defId))||
      game.buildings.find(building=>building.owner==='player');
    const origin=yard?{x:yard.x+yard.w/2,y:yard.y+yard.h/2}:{x:game.width*.25,y:game.height*.5};
    const relay=[...game.relays].sort((a,b)=>
      Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y))[0];
    selection={relay,scoutUnknown:true};
    scoutReason='opening';
  }
  const relay=selection?.relay,scoutUnknown=selection?.scoutUnknown;
  if(!relay){locator.classList.add('hidden');delete locator.dataset.scoutUnknown;delete locator.dataset.scoutReason;return;}
  const index=game.relays.indexOf(relay);
  const name=['WESTERN','CENTRAL','EASTERN'][index]||`RELAY ${index+1}`;
  const sectorX=Math.floor(relay.x),sectorY=Math.floor(relay.y);
  if(scoutUnknown){
    locator.dataset.compactLabel='SCOUT RELAY';
    $('#relay-locator-text').textContent=`SCOUT ${name} RELAY · STATUS UNKNOWN · ${sectorX}//${sectorY}`;
    locator.setAttribute('aria-label',scoutReason==='opening'
      ?`Center on public ${name.toLowerCase()} relay site at sector ${sectorX} by ${sectorY}. Ownership is unknown under fog.`
      :`Center on public ${name.toLowerCase()} relay site at sector ${sectorX} by ${sectorY}. Ownership is unknown under fog. Activate again to scout the next site.`);
    locator.title='Scout public relay site; current ownership unknown';
    locator.dataset.relayId=relay.id;
    locator.dataset.scoutUnknown='true';
    locator.dataset.scoutReason=scoutReason;
    locator.classList.remove('hidden');
    return;
  }
  delete locator.dataset.scoutUnknown;
  delete locator.dataset.scoutReason;
  const progress=Math.max(0,Math.min(100,Math.round(Math.abs(relay.progress||0)*100)));
  const contested=game._relayIsContested(relay);
  locator.dataset.compactLabel=contested?'CONTESTED':relay.owner==='enemy'?'ENEMY RELAY':'NEUTRAL RELAY';
  const capture=contested?' · CONTESTED':relay.owner===null&&progress>0?` · ${relay.progress>0?'YOUR':'ENEMY'} ${progress}%`:'';
  const ownership=relay.owner==='enemy'?'ENEMY-HELD ':'NEUTRAL ';
  $('#relay-locator-text').textContent=`${ownership}${name} RELAY · ${sectorX}//${sectorY}${capture}`;
  locator.setAttribute('aria-label',`Center battlefield on visible ${ownership.toLowerCase()}${name.toLowerCase()} relay at sector ${sectorX} by ${sectorY}${contested?', capture contested':relay.owner===null&&progress>0?`, ${relay.progress>0?'your':'enemy'} capture ${progress} percent`:''}`);
  locator.title=`Center on the visible ${ownership.toLowerCase()}${name.toLowerCase()} relay`;
  locator.dataset.relayId=relay.id;
  locator.classList.remove('hidden');
}
function updateSalvageLocator(){
  const locator=$('#salvage-locator');
  const drop=game?.salvageDrop;
  if(currentMode==='multiplayer'){
    const phase=drop?.phase||null;
    if(phase!==lastPublicSalvagePhase){
      if(phase==='incoming') {toast('PUBLIC SALVAGE DROP INBOUND · FIND THE AMBER BEACON',false,5000);audio.play('alert');}
      else if(phase==='active') {toast('SALVAGE LANDED · HOLD THE SITE WITH AN ARMED GROUND UNIT',false,5000);audio.play('ready');}
      else if(phase==='claimed') {toast(drop.claimedBy==='player'?'YOUR FORCES SECURED THE SALVAGE DROP':'ENEMY FORCES SECURED THE SALVAGE DROP',drop.claimedBy!=='player',5000);audio.play(drop.claimedBy==='player'?'salvage':'alert');}
      else if(phase==='expired')toast('PUBLIC SALVAGE DROP EXPIRED');
      lastPublicSalvagePhase=phase;
    }
  }
  if(!playing||!game||game.status!=='playing'||!drop||!['incoming','active'].includes(drop.phase)){
    locator.classList.add('hidden');
    return;
  }
  const remaining=Math.max(0,Math.ceil((drop.phase==='incoming'?drop.landsAt:drop.expiresAt)-game.time));
  const progress=Math.max(0,Math.min(100,Math.round(100*(drop.captureProgress||0)/SALVAGE_DROP_CAPTURE_SECONDS)));
  const phaseText=drop.phase==='incoming'?`LANDING IN ${remaining}S`
    :drop.contested?`CONTESTED · CAPTURE PAUSED · ${remaining}S`
      :drop.captureOwner==='player'?`YOUR SQUAD SECURING · ${progress}%`
      :drop.captureOwner==='enemy'?`ENEMY SECURING · ${progress}%`
        :`SECURE WITH ARMED GROUND UNIT · ${remaining}S`;
  locator.dataset.phase=drop.phase;
  locator.dataset.owner=drop.captureOwner||'neutral';
  locator.dataset.contested=String(Boolean(drop.contested));
  $('#salvage-locator-status').textContent=phaseText;
  $('#salvage-locator-progress').style.width=`${drop.phase==='incoming'?100*Math.max(0,1-remaining/Math.max(1,drop.landsAt-drop.warningAt)):progress}%`;
  locator.setAttribute('aria-label',`Center on public salvage drop at sector ${Math.floor(drop.x)} by ${Math.floor(drop.y)}. ${phaseText.toLowerCase()}`);
  locator.title=`Center on public salvage drop · ${phaseText.toLowerCase()}`;
  locator.classList.remove('hidden');
}
function updateCampaignTracker(forDebrief=false) {
  const panel=$('#campaign-tracker');
  if(currentMode!=='campaign'||!game||(!forDebrief&&(!playing||game.status!=='playing'))){
    panel.classList.add('hidden');
    return null;
  }
  const state=game.campaignState||{};
  const live=(entity)=>!!entity&&entity.hp>0;
  const hpText=entity=>live(entity)?`${Math.ceil(entity.hp/entity.maxHp*100)}% integrity`:'DESTROYED';
  const playerBuildings=game.buildings.filter(b=>b.owner==='player'&&live(b));
  const command=playerBuildings.find(b=>b.defId==='command');
  const timer=(seconds)=>`${Math.max(0,Math.ceil(seconds))}s`;
  let title='', primary='', secondary='';
  switch(missionIndex){
    case 0: {
      const refineries=playerBuildings.filter(b=>b.defId==='refinery');
      const count=refineries.filter(b=>b.progress>=1&&b.powered).length;
      const building=refineries.find(b=>b.progress<1);
      const raidRules=game.replayVersion==null
        ?state.firstHarvestRaidRulesVersion>=54:game.replayVersion>=54;
      if(raidRules){
        const raiders=Array.isArray(state.firstHarvestRaidUnitIds)?state.firstHarvestRaidUnitIds:[];
        const raidersAlive=raiders.filter(id=>live(game.getEntity(id))).length;
        title='Expand, repel the raid, and bank credits';
        primary=`Refineries ${Math.min(count,state.refineryTarget||2)} / ${state.refineryTarget||2}${building?` · building ${Math.floor(building.progress*100)}%`:''} · Credits ${fmt(game.credits?.player)} / 2,200`;
        secondary=state.firstHarvestRaidRepelled?'Raider screen repelled · secure your economy'
          :state.firstHarvestRaidFired?`Vesper raiders ${raidersAlive} / ${raiders.length} active · defend the crystal line`
            :state.firstHarvestRaidWarned?`Vesper raid in ${timer(19-(state.elapsed||0))} · rally at the marked line`
              :'Keep an armed squad ready to defend the Harvester';
      }else{
        title='Expand the refinery network and bank credits';
        primary=`Refineries ${Math.min(count,state.refineryTarget||2)} / ${state.refineryTarget||2}${building?` · building ${Math.floor(building.progress*100)}%`:''}`;
        secondary=`Credits ${fmt(game.credits?.player)} / 2,200`;
      }
      break;
    }
    case 1: {
      const target=game.getEntity(state.targetId);
      const engineers=game.units.filter(u=>u.owner==='player'&&u.defId==='engineer'&&live(u)).length;
      title='Capture the Vesper radar array';
      primary=`Array ${target?.owner==='player'?'CAPTURED':hpText(target)}`;
      secondary=`Engineers ${engineers} alive`;
      break;
    }
    case 2: {
      const flankRoute=game.replayVersion==null||game.replayVersion>=42;
      const flankIds=Array.isArray(state.lastLightFlankUnitIds)?state.lastLightFlankUnitIds:[];
      const flankAlive=flankIds.filter(id=>live(game.getEntity(id))).length;
      title=flankRoute?'Hold the yard or repel the eastern flank':'Hold the command yard through the assault';
      primary=flankRoute&&state.lastLightFlankFired&&flankIds.length
        ?`Flank force ${flankAlive} / ${flankIds.length} remaining · or survive ${timer((state.duration||180)-state.elapsed)}`
        :`Survive ${timer((state.duration||180)-state.elapsed)} remaining`;
      secondary=flankRoute&&!state.lastLightFlankFired
        ?`Eastern flank arrives in ${timer((game.difficulty==='easy'?140:150)-state.elapsed)} · Command yard ${hpText(command)}`
        :`Command yard ${hpText(command)}`;
      break;
    }
    case 3: {
      const target=game.getEntity(state.targetId);
      const stagedObjective=game.replayVersion==null||game.replayVersion>=35;
      if(!stagedObjective){
        title='Destroy the Vesper forward relay';
        primary=`Forward relay ${hpText(target)}`;
        secondary=`Command yard ${hpText(command)} · ${timer((state.deadline||420)-state.elapsed)} to deadline`;
      }else if(state.phase==='secure-relay'){
        const relay=game.relays.find(item=>item.id===state.relayId);
        const relayState=relay?.owner==='player'&&!relay.contested?'SECURED':relay?.contested?'CONTESTED':'UNSECURED';
        title='Hold the central relay to collapse the forward shield';
        primary=`Central relay ${relayState} · hold ${Math.floor(state.holdElapsed||0)} / ${state.holdDuration||8}s`;
        secondary=`Forward array shielded · ${timer((state.deadline||420)-state.elapsed)} to deadline`;
      }else{
        title='Destroy the exposed Vesper forward array';
        primary=`Forward array ${hpText(target)}`;
        secondary=`Command yard ${hpText(command)} · ${timer((state.deadline||420)-state.elapsed)} to deadline`;
      }
      break;
    }
    case 4: {
      const refineries=playerBuildings.filter(b=>b.defId==='refinery');
      const count=refineries.filter(b=>b.progress>=1&&b.powered).length;
      const building=refineries.find(b=>b.progress<1);
      const routeObjectiveActive=game.replayVersion==null
        ?state.routeObjectiveRulesVersion===46:game.replayVersion>=46;
      const route=routeObjectiveActive?game.campaignRoutePayoffId:'none';
      title=route==='ghost-channel'?'Attack the payroll courier directly and fund the counterstrike':
        route==='iron-current'?'Recover the freight cache and fund the counterstrike':
          'Fund the counterstrike before the patrols arrive';
      primary=`Refineries ${Math.min(count,state.refineryTarget||2)} / ${state.refineryTarget||2}${building?` · building ${Math.floor(building.progress*100)}%`:''} · credits ${fmt(game.credits?.player)} / 4,800`;
      const remaining=`${timer((state.deadline||360)-state.elapsed)} remaining`;
      secondary=route==='ghost-channel'
        ?`Courier ${state.courierRewardClaimed?'INTERCEPTED':'ACTIVE'} · ${remaining}${state.signalTraceRemaining>0?` · trace ${timer(state.signalTraceRemaining)}`:''}`
        :route==='iron-current'
          ?`Freight cache ${state.freightCacheRecovered?'RECOVERED':game.wrecks?.some(wreck=>wreck.id===state.freightCacheId)?'AVAILABLE · Engineer required':'LOST'} · ${remaining}`
          :`${remaining}${state.courierRewardClaimed?' · payroll cache recovered':''}`+
            (game.campaignRoutePayoffId==='ghost-channel'?` · signal trace ${timer(state.signalTraceRemaining||0)}`:
              game.campaignRoutePayoffId==='iron-current'?` · freight cache ${game.wrecks?.some(wreck=>wreck.id===state.freightCacheId)?'available':'recovered'}`:'');
      break;
    }
    case 5: {
      const escort=game.getEntity(state.escortId), exit=state.extraction||{x:48,y:17};
      const distance=escort?Math.hypot(escort.x-exit.x,escort.y-exit.y):null;
      const staged=(game.replayVersion==null||game.replayVersion>=43)&&Array.isArray(state.transmissionUplinks);
      const routeTradeoff=staged&&(game.replayVersion==null
        ?state.ashesUplinkRulesVersion>=48:game.replayVersion>=48);
      const routeContinuation=staged&&(game.replayVersion==null
        ?state.ashesRouteRulesVersion===51:game.replayVersion>=51);
      const route=routeContinuation?game.campaignRoutePayoffId:'none';
      if(staged&&state.phase==='transmit-codes'){
        const uplink=state.transmissionUplinks.find(item=>item.id===state.transmissionUplinkId);
        title='Transmit the patrol codes, then extract';
        primary=`Analyst ${hpText(escort)} · signal ${Math.floor(state.transmissionElapsed||0)} / ${state.transmissionDuration||8}s`;
        secondary=route==='ghost-channel'
          ?'GHOST ROUTE · north burst, then deploy a signal shadow with armed escort'
          :route==='iron-current'
            ?'IRON ROUTE · south upload, then recover the supply cache with an Engineer'
            :routeTradeoff
          ?uplink?.id==='north'?'NORTH · 5s burst · clear the visible interceptor':
            uplink?.id==='south'?'SOUTH · 8s low-power · quiet extraction':
              'NORTH · 5s + intercept  /  SOUTH · 8s + quiet return'
          :uplink?`${uplink.id.toUpperCase()} uplink locked · keep the analyst inside its ring`:
            'Choose the north or south uplink with the analyst';
      }else if(route==='ghost-channel'&&state.phase==='deploy-signal-shadow'){
        title='Deploy the Ghost Channel signal shadow';
        primary=`Armed escort at shadow point ${Math.floor(state.ghostShadowElapsed||0)} / ${state.ghostShadowDuration||3}s · analyst ${hpText(escort)}`;
        secondary='Move an armed unit to the marked shadow point and hold it there. The extraction interceptor follows once the decoy is live.';
      }else if(route==='iron-current'&&state.phase==='recover-supply-cache'){
        title='Recover the Iron Current supply cache';
        primary=`Supply cache ${state.routeCacheRecovered?'RECOVERED':game.wrecks?.some(wreck=>wreck.id===state.routeCacheId)?'AVAILABLE':'LOST'} · analyst ${hpText(escort)}`;
        secondary='Send an Engineer to the marked cache, then escort the analyst to extraction.';
      }else{
        title=staged?'Extract the analyst with the patrol codes':'Escort the analyst to the extraction beacon';
        primary=`Analyst ${hpText(escort)}`;
        const intercept=routeTradeoff&&state.transmissionUplinkId==='north'
          ?state.extractionInterceptFired
            ?`Keep flamer close · Aegis intercept ${state.extractionInterceptUnitIds.filter(id=>live(game.getEntity(id))).length} / ${state.extractionInterceptUnitIds.length} active`
            :state.extractionInterceptWarned
              ?`Move on warning · flamer close · intercept in ${timer(5-(state.extractionInterceptWarningElapsed||0))}`:''
          :routeTradeoff&&state.transmissionUplinkId==='south'?'Southern low-power route · no extraction patrol':'';
        secondary=intercept|| (distance===null?'Extraction distance unavailable':distance<=(state.extraction?.radius||2.2)?'At extraction beacon':
          staged?`Lead with escorts · ${distance.toFixed(1)} sectors to extraction`:`${distance.toFixed(1)} sectors to extraction`);
      }
      break;
    }
    case 6: {
      const target=game.getEntity(state.targetId);
      const stagedObjective=game.replayVersion==null||game.replayVersion>=33;
      if(!stagedObjective){
        title='Destroy the Vesper Construction Yard';
        primary=`Enemy yard ${hpText(target)}`;
        secondary=`Command yard ${hpText(command)}`;
      }else if(state.phase==='secure-relay'){
        const relay=game.relays.find(item=>item.id===state.relayId);
        const relayState=relay?.owner==='player'&&!relay.contested?'SECURED':relay?.contested?'CONTESTED':'UNSECURED';
        title='Secure the central relay to break the command shield';
        primary=`Central relay ${relayState} · hold ${Math.floor(state.holdElapsed||0)} / ${state.holdDuration||8}s`;
        secondary=`Vesper command yard shielded · ${hpText(target)}`;
      }else{
        title='Destroy the exposed Vesper command yard';
        primary=`Enemy command yard ${hpText(target)}`;
        secondary=`Command yard ${hpText(command)}`;
      }
      break;
    }
    case 7: {
      const shelter=game.relays[0];
      title='Secure the western relay shelter through the ion storm';
      primary=`Western shelter ${shelter?.owner==='player'&&!shelter.contested?'SECURED':shelter?.contested?'CONTESTED':'UNSECURED'} · ${Math.floor(state.shelterHoldElapsed||0)} / 10s`;
      secondary=`Command yard ${hpText(command)} · ${String(game.storm?.phase||'calm').toUpperCase()}`;
      break;
    }
    case 8: {
      const held=game.relays.filter(r=>r.owner==='player'&&!r.contested).length;
      const reserveNames={'yard-guard':'Yard Guard','eastern-armor':'Eastern Armor','crossing-screen':'Crossing Screen'};
      const reserve=(game.replayVersion??24)>=24
        ?reserveNames[state.relayPairChoice]||'Choose the first pair for a reserve'
        :null;
      title='Capture and hold two Resonance Relays';
      primary=`Relays ${held} / ${state.relayTargetCount||2} · hold ${Math.floor(state.holdElapsed||0)} / ${state.holdDuration||25}s`;
      secondary=`${reserve?`${reserve} · `:''}yard ${hpText(command)}`;
      break;
    }
    case 9: {
      const target=game.getEntity(state.targetId);
      const mobileChiefRules=game.replayVersion==null||game.replayVersion>=34;
      const visible=live(target)&&game.isVisible(target);
      const chiefCondition=visible?hpText(target):live(target)?'out of sight':'DESTROYED';
      if(!mobileChiefRules){
        title='Eliminate the signal chief';
        primary=`Signal chief ${chiefCondition}`;
      }else if(state.chiefEscapePhase==='alerted'){
        title='Intercept the signal chief before extraction';
        primary=`Chief spotted · flight starts in ${timer(state.chiefEscapeDelayRemaining||0)}`;
      }else if(state.chiefEscapePhase==='escaping'){
        title='Intercept the signal chief before extraction';
        primary=`Chief fleeing southeast · ${chiefCondition} · direct attack`;
      }else if(state.chiefEscapePhase==='intercepted'){
        title='Signal chief intercepted';
        primary='Evacuation codes secured';
      }else{
        title='Find the signal chief at the eastern outpost';
        primary='Scout with the stealth escort · chief not yet spotted';
      }
      secondary=`Command yard ${hpText(command)} · ${timer((state.deadline||300)-state.elapsed)} to deadline`;
      break;
    }
    case 10: { const beacon=game.getEntity(state.fallbackId); title='Protect the fallback beacon'; primary=`Survive ${timer((state.duration||120)-state.elapsed)} remaining`; secondary=`Fallback beacon ${hpText(beacon)}`; break; }
    case 11: {
      const relaysHeld=game.relays.filter(relay=>relay.owner==='player'&&!relay.contested).length;
      const assault=state.phase==='destroy-command';
      const target=game.getEntity(state.targetId);
      const reformRules=game.replayVersion==null
        ?state.dawnFreeShieldReformRulesVersion===60:game.replayVersion>=60;
      const shieldCanReform=reformRules&&
        (state.shieldReformCount||0)<1;
      const reformWarning=assault&&shieldCanReform&&state.shieldReformWarningActive;
      title=reformWarning?'Retake both relays before the shield reforms':
        assault?'Destroy the Vesper Command Yard':
          state.shieldReformCount?'Break the restored shield: hold both relays':'Break the relay shield: hold both relays';
      primary=reformWarning?`Relay link ${relaysHeld} / ${state.relayTargetCount||2} · shield returns in ${timer(7-state.shieldReformWarningElapsed)}`:
        assault?`Enemy command yard ${hpText(target)}`:`Relays held ${relaysHeld} / ${state.relayTargetCount||2}`;
      secondary=assault?`${shieldCanReform?'Defend both relays':reformRules?'Shield permanently offline':'Enemy yard exposed'} · your yard ${hpText(command)}`:
        `Hold progress ${Math.floor(state.holdElapsed||0)} / ${state.holdDuration||18}s · yard ${hpText(command)}`;
      break;
    }
    case 12: {
      const engineer=game.getEntity(state.engineerId);
      const relay=game.relays.find(item=>item.id===state.relayId);
      const extracting=state.phase==='extract-engineer';
      const destination=state.extraction||{x:21.5,y:29.5};
      const distance=engineer?Math.hypot(engineer.x-destination.x,engineer.y-destination.y):null;
      title=extracting?'Extract the engineer on the west bank':'Secure the eastern landing relay';
      primary=extracting
        ?engineer?.embarkedIn?'Engineer aboard · land at the west beacon':`Engineer ${distance===null?'position unavailable':`${distance.toFixed(1)} sectors to extraction`}`
        :`Relay ${relay?.owner==='player'&&!relay.contested?'SECURED':relay?.contested?'CONTESTED':'NOT SECURED'} · hold ${Math.floor(state.holdElapsed||0)} / ${state.holdDuration||12}s`;
      secondary=`Engineer ${hpText(engineer)} · recovery window ${timer((state.deadline||240)-state.elapsed)}`;
      break;
    }
    case 13: {
      const engineer=game.getEntity(state.engineerId);
      const vault=game.getEntity(state.targetId);
      const extracting=state.phase==='extract-engineer';
      const destination=state.extraction||{x:13.5,y:34.5};
      const distance=engineer?Math.hypot(engineer.x-destination.x,engineer.y-destination.y):null;
      title=extracting?'Bring the signal engineer home':'Hold the engineer beside the signal vault';
      primary=extracting
        ?`Extraction ${distance===null?'position unavailable':`${distance.toFixed(1)} sectors away`}`
        :`Vault uplink ${Math.floor(state.hackElapsed||0)} / ${state.hackDuration||8}s · ${hpText(vault)}`;
      secondary=`Engineer ${hpText(engineer)} · window ${timer((state.deadline||210)-state.elapsed)}`;
      break;
    }
    case 14: {
      const holding=state.phase==='hold-freight';
      const relayAssaultRules=(state.ironCurrentRulesVersion||0)>=55;
      const relay=game.relays.find(item=>item.id===state.relayId);
      const relayStatus=relay?.owner==='player'&&!relay.contested?'SECURED':relay?.contested?'CONTESTED':'UNSECURED';
      const finalTank=state.assaultWaveThreeUnitId?game.getEntity(state.assaultWaveThreeUnitId):null;
      const finalEscort=relayAssaultRules&&state.assaultWaveThreeEscortUnitId?game.getEntity(state.assaultWaveThreeEscortUnitId):null;
      const finalArmorActive=state.assaultWaveThreeFired&&(finalTank?.hp>0||finalEscort?.hp>0);
      const holdComplete=(state.holdElapsed||0)>=(state.holdDuration||22);
      title=!holding?'Fund the freight reserve':finalArmorActive?relayAssaultRules?'Stop the freight relay assault':'Defend the yard from final armor':
        state.assaultWaveThreeFired&&holdComplete?'Secure the freight relay for departure':'Hold the freight relay under assault';
      primary=!holding
        ?`Reserve ${fmt(Math.min(game.credits?.player||0,state.reserveTarget||3000))} / ${fmt(state.reserveTarget||3000)} credits`
        :state.assaultWaveThreeFired&&!finalArmorActive&&holdComplete
          ?`Freight relay ${relayStatus} · final hold ${Math.floor(state.postAssaultHoldElapsed||0)} / ${state.postAssaultHoldDuration||12}s`
          :`Freight relay ${relayStatus} · ${Math.floor(state.holdElapsed||0)} / ${state.holdDuration||22}s${relayAssaultRules&&relay?.owner==='enemy'&&!relay.contested?` · line cut in ${Math.ceil((state.enemyRelayHoldDuration||20)-(state.enemyRelayHoldElapsed||0))}s`:''}`;
      secondary=`Command yard ${hpText(command)} · ${finalArmorActive?relayAssaultRules
        ?`assault group ${[finalTank,finalEscort].filter(unit=>unit?.hp>0).length} remaining · redirect Guardian reserve`
        :`final tank ${hpText(finalTank)}`:
        state.assaultWaveThreeFired?'final armor cleared':holding?'final assault incoming':'assault waves incoming'}`;
      break;
    }
    case 15: {
      const ironView=getIronReclaimedView(game);
      const engineer=game.getEntity(state.engineerId);
      const guardian=state.recommissionedVehicleId?game.getEntity(state.recommissionedVehicleId):null;
      const wreck=(game.wrecks||[]).find(item=>item.id===state.wreckId);
      const target=state.phase==='recommission-wreck'?wreck
        :state.phase==='escort-to-relay'?state.rendezvous:state.extraction;
      const distanceTo=(unit,point)=>unit&&point?Math.hypot(unit.x-point.x,unit.y-point.y):null;
      const engineerDistance=distanceTo(engineer,target),guardianDistance=distanceTo(guardian,target);
      const targetDistance=[engineerDistance,guardianDistance].filter(Number.isFinite);
      title=ironView?.phaseLabel||'Recommission the marked Guardian';
      primary=ironView?.phase==='recommission-wreck'
        ?wreck?`Marked Guardian wreck · ${timer((state.deadline||260)-(state.elapsed||0))} recovery window remaining${ironView.recommissionProgress>0?` · restore ${Math.floor(ironView.recommissionProgress)} / ${ironView.recommissionDuration}s`:''}`:'Marked Guardian wreck unavailable'
        :ironView?.phase==='escort-to-relay'
          ?`East recovery marker · ${targetDistance.length?`${Math.min(...targetDistance).toFixed(1)} sectors away`:'pair location unavailable'} · ${ironView.routeLabel}`
          :`Field Workshop · ${targetDistance.length?`${Math.min(...targetDistance).toFixed(1)} sectors away`:'pair location unavailable'}`;
      secondary=`Engineer ${hpText(engineer)} · Guardian ${guardian?hpText(guardian):'WRECK · AWAITING RECOMMISSION'} · ${timer((state.deadline||260)-(state.elapsed||0))} remaining${ironView?.warning?' · patrol warning':''}`;
      break;
    }
    case 16: {
      const view=getCounterbatteryView(game);
      title='Silence both siege batteries';
      primary=`Crawlers ${view?.destroyed||0} / ${view?.total||2} silenced · ${timer(view?.remainingSeconds||0)} remaining`;
      const radar=game.getEntity(state.forwardRadarId);
      const warning=(state.waves||[]).find(wave=>wave.warned&&!wave.fired);
      secondary=`Command yard ${hpText(command)} · Forward Radar ${hpText(radar)}${warning?` · reinforcements in ${timer(5-(warning.warningElapsed||0))}`:''}`;
      break;
    }
  }
  panel.classList.toggle('hidden',forDebrief);
  panel.classList.toggle('campaign-tracker-guided',missionIndex===0);
  panel.classList.toggle('campaign-tracker-targets',missionIndex===16);
  panel.classList.toggle('campaign-tracker-placement',missionIndex===0&&$('#campaign-guidance').classList.contains('campaign-guidance-is-placement'));
  const set=(selector,value)=>{const el=$(selector);if(el.textContent!==value)el.textContent=value;};
  set('#campaign-tracker-title',title);set('#campaign-progress-primary',primary);set('#campaign-progress-secondary',secondary);
  const targetLinks=$('#campaign-target-links');
  targetLinks.classList.toggle('hidden',missionIndex!==16||forDebrief);
  if(missionIndex===16){
    const targets=getCounterbatteryView(game)?.targets||[];
    for(const button of targetLinks.querySelectorAll('[data-campaign-target]')){
      const target=targets[Number(button.dataset.campaignTarget)];
      const name=Number(button.dataset.campaignTarget)===0?'NORTH':'SOUTH';
      const label=`${target?.alive?'⌖':'✓'} ${name} BATTERY${target?.alive?(target.visible?'':' · INTEL'):' · SILENCED'}`;
      if(button.textContent!==label)button.textContent=label;
      button.disabled=!target?.alive;
      button.setAttribute('aria-label',target?.alive
        ?`Center camera on ${name.toLowerCase()} siege battery ${target.visible?'in sight':'intelligence location'}`
        :`${name.toLowerCase()} siege battery silenced`);
    }
  }
  const orderView = currentMode === 'campaign' ? getCampaignFieldOrderView(game) : null;
  const orderPanel = $('#campaign-field-order-tracker');
  if (orderPanel) {
    orderPanel.classList.toggle('hidden', !orderView);
    if (orderView) {
      set('#campaign-field-order-title', orderView.title);
      set('#campaign-field-order-status', `${String(orderView.status || 'ACTIVE').toUpperCase()} · ${orderView.progressText || ''}`.trim());
    }
  }
  return {title,primary,secondary};
}
function updateQuickStartGuidance(powerState) {
  const panel=$('#campaign-guidance');
  panel.classList.remove('campaign-guidance-iron-reclaimed');
  if(!quickStartGuidance||replayMode||currentMode!=='skirmish'||!playing||game?.status!=='playing'){
    panel.classList.add('hidden');return;
  }
  const combatSelected=selectedObjects().some(unit=>unit.owner==='player'&&game.unitDefs?.[unit.defId]&&unit.defId!=='harvester');
  const knownRelay=game.relays.some(relay=>fogAt(relay.x,relay.y)>0);
  const heldRelays=game.relays.filter(relay=>relay.owner==='player'&&!game._relayIsContested(relay));
  const touchGuide=matchMedia('(pointer: coarse)').matches||innerWidth<=670;
  if(combatSelected)quickStartStage=Math.max(quickStartStage,1);
  if(knownRelay)quickStartStage=Math.max(quickStartStage,2);
  if(heldRelays.length)quickStartStage=Math.max(quickStartStage,3);
  if(heldRelays.length>=2)quickStartStage=Math.max(quickStartStage,4);
  let tip;
  if(game.victoryMode!=='elimination'&&game.relayDominion?.owner==='enemy'){
    const seconds=Math.max(0,Math.ceil(game.relayDominion.required-game.relayDominion.elapsed));
    const enemyRelayInSight=game.relays.some(relay=>fogAt(relay.x,relay.y)===2&&relay.owner==='enemy');
    tip={key:'counter-relay',title:'Break the enemy relay hold',copy:enemyRelayInSight
      ?touchGuide
        ?`${seconds}s left. Tap the enemy-held relay locator, then ATTACK into its ring to stop the countdown.`
        :`${seconds}s left. Click the enemy-held relay locator, then attack-move combat units into its ring.`
      :touchGuide
        ?`${seconds}s left. Use Support › Tactical Scan to find an enemy relay, then ATTACK into its ring.`
        :`${seconds}s left. Scout or use Support › Tactical Scan to reveal an enemy relay, then attack-move into its ring.`};
  }else if((powerState.production||0)<(powerState.consumption||0)){
    tip={key:'power',title:'Restore power to the base',copy:'Build and place a Power Plant from Structures. Low power slows production and disables advanced systems.'};
  }else if(quickStartStage===0){
    tip={key:'select',title:'Select your combat squad',copy:touchGuide
      ?'Tap a soldier, scout, or tank. Hold and drag to select several. Keep the Harvester gathering crystal.'
      :'Click a soldier, scout, or tank; drag to select several. Pan with WASD or arrows. Keep the Harvester gathering crystal.'};
  }else if(game.victoryMode==='elimination'&&quickStartStage<=1){
    tip={key:'elimination-scout',title:'Locate the enemy Command Yard',copy:touchGuide
      ?'Move your squad across the map. Destroy the enemy Command Yard, combat forces, and active industry.'
      :'Scout beyond your perimeter. Destroy the enemy Command Yard, combat forces, and active industry.'};
  }else if(game.victoryMode==='elimination'){
    tip={key:'elimination-push',title:'Finish the enemy force',copy:'Protect your Command Yard while you eliminate enemy combat forces and active industry.'};
  }else if(quickStartStage===1){
    tip={key:'scout',title:'Scout beyond your base',copy:touchGuide
      ?'Tap ATTACK, then tap open ground. Your squad will engage threats while revealing Resonance Relays.'
      :'Right-click open ground with your selected squad. Reveal the frontier to locate its Resonance Relays.'};
  }else if(quickStartStage===2||heldRelays.length===0){
    const visibleNeutral=game.relays.some(relay=>fogAt(relay.x,relay.y)===2&&relay.owner===null);
    const visibleEnemy=game.relays.some(relay=>fogAt(relay.x,relay.y)===2&&relay.owner==='enemy');
    const captureCopy=visibleNeutral
      ?touchGuide
        ?'Tap the neutral relay locator to center it. Select a combat squad, tap ATTACK, then tap inside its ring. Keep enemy ground units out until capture completes.'
        :'Click the neutral relay locator to center it. With a combat squad selected, right-click inside its ring to attack-move in. Keep enemy ground units out until capture completes.'
      :visibleEnemy
        ?touchGuide
          ?'The visible relay belongs to the enemy. Select a combat squad, tap ATTACK, then tap inside its ring to contest and take it.'
          :'The visible relay belongs to the enemy. Select a combat squad and right-click inside its ring to contest and take it.'
        :'The relay is out of sight. Scout the area where you last saw it, or use Support › Tactical Scan to reveal its area; its locator returns when visible.';
    tip={key:'capture',title:'Secure a Resonance Relay',copy:captureCopy};
  }else if(quickStartStage===3){
    const stormReady=['warning','surge'].includes(game.storm?.phase)&&
      (game.commandEnergy?.player||0)>=COMMAND_ABILITIES.stormcall.cost&&
      (game.commandCooldowns?.player?.stormcall||0)<=0;
    tip=stormReady
      ?{key:'stormcall',title:'The storm is yours to steer',copy:'Open Support and choose Relay Stormcall. Target ground near your secure relay to pulse enemy forces during the surge.'}
      :{key:'expand',title:'Control the second relay',copy:'Train reinforcements in Units, then claim another relay. Holding two starts a victory countdown; Structures builds your defense.'};
  }else{
    const remaining=Math.max(0,Math.ceil((game.relayDominion?.required||90)-(game.relayDominion?.elapsed||0)));
    tip={key:'hold',title:'Hold the frontier',copy:`Keep two relays uncontested for victory. ${remaining} seconds remain on the current countdown; defend both approaches.`};
  }
  $('#campaign-guidance-label').textContent='FIELD GUIDE · FIRST DEPLOYMENT';
  panel.classList.add('quick-start-guidance');
  panel.dataset.stage=tip.key;
  panel.classList.toggle('hidden',campaignGuidanceDismissedKey===tip.key);
  panel.classList.remove('campaign-guidance-is-placement');
  if(campaignGuidanceKey!==tip.key){
    campaignGuidanceKey=tip.key;
    $('#campaign-guidance-title').textContent=tip.title;
  }
  if($('#campaign-guidance-copy').textContent!==tip.copy)$('#campaign-guidance-copy').textContent=tip.copy;
  $('#campaign-guidance-progress').classList.add('hidden');
}
function updateCampaignGuidance(powerState) {
  const panel=$('#campaign-guidance');
  panel.classList.toggle('campaign-guidance-iron-reclaimed',
    currentMode==='campaign'&&missionIndex===15&&!replayMode&&playing&&game?.status==='playing');
  if(quickStartGuidance&&currentMode==='skirmish'){
    updateQuickStartGuidance(powerState);return;
  }
  if(replayMode||currentMode!=='campaign'||![0,15].includes(missionIndex)||!playing||game?.status!=='playing'){
    panel.classList.add('hidden');panel.classList.remove('quick-start-guidance','campaign-guidance-iron-reclaimed');campaignGuidanceKey='';campaignGuidanceDismissedKey='';return;
  }
  if(missionIndex===15){
    panel.classList.remove('quick-start-guidance','campaign-guidance-is-placement');
    $('#campaign-guidance-label').textContent='BONUS FIELD GUIDE · IRON RECLAIMED';
    const state=game.campaignState||{};
    const ironView=getIronReclaimedView(game);
    const engineerRestoring=ironView?.recommissionProgress>0;
    const touchGuide=matchMedia('(pointer: coarse)').matches||innerWidth<=670;
    let tip;
    if(state.phase==='recommission-wreck'){
      tip=engineerRestoring
        ?{key:'iron-reclaimed-restoring',title:'Keep the Engineer at the Workshop',copy:'The marked Guardian is being restored. Protect the Engineer until the 12 second recommission finishes.'}
        :{key:'iron-reclaimed-wreck',title:'Restore the marked Guardian',copy:touchGuide
          ?'Select the Engineer, tap RESTORE, then tap the marked Guardian hull. Keep the Engineer at the powered Workshop. Costs 520 credits; the Guardian returns at 40% integrity.'
          :'Select the Engineer, click RECOMMISSION WRECK, then click the marked Guardian hull. Keep the Engineer at the powered Workshop. Costs 520 credits; the Guardian returns at 40% integrity.'};
    }else if(state.phase==='escort-to-relay'){
      tip=state.routeChoice
        ?{key:`iron-reclaimed-escort-${state.routeChoice}`,title:`Escort through the ${state.routeChoice} pass`,copy:state.routeAmbushFired
          ?'Clear the patrol with the Guardian and armed escort. Keep the Engineer at the Workshop until the pass is secure, then bring both survivors to the east recovery marker.'
          :`Lead with the Guardian and armed escort; keep the Engineer at the Workshop. ${ironView?.warning||'A route patrol is closing in.'}`}
        :{key:'iron-reclaimed-route',title:'Choose a route to the east marker',copy:touchGuide
          ?'Select the restored Guardian and armed escort. Clear the north or south pass first, then bring the Engineer through to the east recovery marker.'
          :'Send the restored Guardian and armed escort through either pass. Keep the Engineer at the Workshop until the route is clear, then escort them east.'};
    }else{
      tip={key:'iron-reclaimed-extract',title:'Extract the same Engineer and Guardian',copy:touchGuide
        ?'Move both units to the marked Field Workshop. Keep them close and alive until extraction completes.'
        :'Order the same Engineer and restored Guardian to the marked Field Workshop. Keep them close and alive until extraction completes.'};
    }
    panel.dataset.stage=tip.key;
    panel.classList.toggle('hidden',campaignGuidanceDismissedKey===tip.key);
    if(campaignGuidanceKey!==tip.key){
      campaignGuidanceKey=tip.key;
      $('#campaign-guidance-title').textContent=tip.title;
    }
    if($('#campaign-guidance-copy').textContent!==tip.copy)$('#campaign-guidance-copy').textContent=tip.copy;
    $('#campaign-guidance-progress').classList.add('hidden');
    return;
  }
  panel.classList.remove('quick-start-guidance');
  $('#campaign-guidance-label').textContent='FIELD TIP · OPERATION 01';
  const liveBuildings=game.buildings.filter(building=>building.owner==='player'&&building.hp>0);
  const refineries=liveBuildings.filter(building=>building.defId==='refinery');
  const refineryCount=refineries.filter(building=>building.progress>=1&&building.powered).length;
  const placedRefinery=refineries.find(building=>building.progress<1);
  const harvester=game.units.find(unit=>unit.owner==='player'&&unit.defId==='harvester'&&unit.hp>0);
  const credits=Math.max(0,Math.floor(game.credits?.player||0));
  const raidState=game.campaignState||{};
  const raidRules=game.replayVersion==null
    ?raidState.firstHarvestRaidRulesVersion>=54:game.replayVersion>=54;
  const touchGuide=matchMedia('(pointer: coarse)').matches||innerWidth<=670;
  let tip;
  if(raidRules&&raidState.firstHarvestRaidWarned&&!raidState.firstHarvestRaidRepelled){
    tip=raidState.firstHarvestRaidFired
      ?{key:'raid-active',stage:'raid-attack',title:'Defend the crystal line',
        copy:`Vesper raiders are striking the crystal line. ${touchGuide?'Select defenders, press ATTACK, then tap the lead buggy.':'Select defenders, then right-click the visible lead buggy.'}`}
      :{key:'raid-warning',stage:'raid-warning',title:'Vesper raiders inbound',
        copy:`Move defenders to the marked line now. ${touchGuide?'Select them, press ATTACK, then tap the line.':'Use Shift+A, then click the marked line.'} Protect the Harvester and refineries.`};
  }else if((powerState.production||0)<(powerState.consumption||0)){
    const construction=game.construction;
    if(placeId==='power'||construction?.defId==='power'&&construction.ready){
      tip={key:'place-power',title:'Place a Power Plant',copy:'Choose clear ground inside your base perimeter to restore power.'};
    }else if(construction?.defId==='power'){
      tip={key:'build-power',title:'Power Plant in production',copy:'Place it when construction is complete to clear the power deficit.'};
    }else if(construction){
      tip={key:'power-after-current',title:'Restore base power',copy:'Finish the current structure, then queue a Power Plant from Structures.'};
    }else{
      tip={key:'power',title:'Restore base power',copy:'Queue a Power Plant from Structures to clear the deficit and keep your base systems online.'};
    }
  }else if(refineryCount<2){
    const construction=game.construction;
    if(placedRefinery){
      tip={key:'finish-refinery',title:'Second refinery constructing',copy:`Construction ${Math.floor(placedRefinery.progress*100)}% complete. Keep the base powered until the refinery is operational.`};
    }else if(placeId==='refinery'||construction?.defId==='refinery'&&construction.ready){
      tip={key:'place-refinery',title:'Place the second refinery',copy:'Choose open ground inside your perimeter, close to a crystal field.'};
    }else if(construction?.defId==='refinery'){
      tip={key:'build-refinery',title:'Second refinery in production',copy:'When construction is complete, select the refinery card and place it inside your perimeter.'};
    }else if(construction){
      tip={key:'finish-construction',title:'Expand the refinery network',copy:'Finish the current structure, then queue a Crystal Refinery from Structures.'};
    }else{
      tip={key:'queue-refinery',title:'Build a second refinery',copy:'Open Structures and queue a Crystal Refinery. It must be placed within your base perimeter.'};
    }
  }else if(!harvester||harvester.order?.type!=='harvest'){
    tip={key:'harvester',title:'Keep crystal flowing',copy:harvester?'Select your Harvester and order it to harvest a crystal field. It returns to a refinery to deliver its load.':'Your Harvester is lost. Train a replacement from the War Factory to restore crystal income.'};
  }else{
    const bucket=Math.floor(credits/100);
    tip={key:`income-${bucket}`,stage:'income',title:'Bank 2,200 credits',copy:`Your Harvester gathers crystal and delivers it to a refinery automatically. Credits: ${credits.toLocaleString()} / 2,200.`,progress:Math.min(2200,credits)};
  }
  const stage=tip.stage||tip.key;
  panel.dataset.stage=stage;
  if(tip.key!==campaignGuidanceKey){
    campaignGuidanceKey=tip.key;
    $('#campaign-guidance-title').textContent=tip.title;
    $('#campaign-guidance-copy').textContent=tip.copy;
    panel.classList.toggle('hidden',campaignGuidanceDismissedKey===stage);
  }else panel.classList.toggle('hidden',campaignGuidanceDismissedKey===stage);
  panel.classList.toggle('campaign-guidance-is-placement',tip.key==='place-refinery'||tip.key==='place-power');
  const progress=$('#campaign-guidance-progress');
  progress.classList.toggle('hidden',tip.progress==null);
  if(tip.progress!=null){
    const amount=Math.floor(tip.progress);
    if(progress.getAttribute('aria-valuenow')!==String(amount))progress.setAttribute('aria-valuenow',String(amount));
    const width=`${amount/22}%`;
    const fill=$('#campaign-guidance-progress-fill');if(fill.style.width!==width)fill.style.width=width;
  }
}
function processEvents() {
  if(!game?.events?.length)return;
  renderer3d?.captureUnitLosses?.(game.events,game);
  const events=game.events.splice(0);
  for(const e of events){
    const type=typeof e==='string'?e:e.type||'';
    const msg=typeof e==='string'?e:e.message||e.text;
    if (!replayMode && currentMode !== 'multiplayer') recordBattleMoment(battleMoments, e);
    if(type==='incomingAttack'){
      if(game.mode==='skirmish'&&game.difficulty==='easy'&&!replayMode){
        toast('CADET INTEL · ENEMY ASSAULT LAUNCHED · PREPARE DEFENSES',true,6000);
        audio.play('alert');
      }
      continue;
    }
    if(type==='engineerRaidSpotted'){
      const raider=game.getEntity?.(e.unitId);
      if(game.mode!=='skirmish'||replayMode||raider?.owner!=='enemy'||raider.hp<=0||
          !game.isVisible(raider,'player')||!Number.isFinite(e.sectorX)||!Number.isFinite(e.sectorY))continue;
      // Keep the observed sector fixed: the alert must not track a raider into fog.
      if(!tacticalAlert||game.time>=tacticalAlert.until||tacticalAlert.priority<=4){
        tacticalAlert={kind:'engineer',defId:'engineer',x:e.sectorX+0.5,y:e.sectorY+0.5,
          priority:4,until:game.time+10};
        renderTacticalAlert();
      }
      toast('HOSTILE ENGINEER SPOTTED · INTERCEPT OR REPAIR ABOVE 75%',true,6500);
      audio.play('alert');continue;
    }
    if(type==='buildingCaptured'){
      const target=game.getEntity?.(e.id);
      const name=(game.buildingDefs?.[target?.defId]?.name||'Structure').toUpperCase();
      toast(e.owner==='player'?`${name} CAPTURED`:`ENEMY CAPTURED YOUR ${name}`,e.owner!=='player',5500);
      audio.play(e.owner==='player'?'ready':'alert');updateSelectionCard();continue;
    }
    if(type==='buildingPowerChanged'){
      const building=game.getEntity?.(e.id??e.buildingId);
      if(building?.owner==='player'){
        const name=(game.buildingDefs?.[building.defId]?.name||'Structure').toUpperCase();
        toast(e.standby===true?`${name} ON STANDBY`:`${name} POWER RESTORED`);
        audio.play(e.standby===true?'order':'ready');
        powerGridSignature='';renderPowerGrid(true);updateSelectionCard();
      }
      continue;
    }
    if(type==='salvageDropIncoming'){
      toast('PUBLIC SALVAGE DROP INBOUND · FIND THE AMBER BEACON',false,5000);audio.play('alert');continue;
    }
    if(type==='salvageDropLanded'){
      toast('SALVAGE LANDED · HOLD THE SITE WITH AN ARMED GROUND UNIT',false,5000);audio.play('ready');continue;
    }
    if(type==='salvageDropClaimed'){
      toast(e.owner==='player'?`SALVAGE SECURED · +${fmt(e.credits)} CREDITS · +${fmt(e.commandEnergy)} ENERGY`:'ENEMY FORCES SECURED THE SALVAGE DROP',e.owner!=='player',5000);
      audio.play(e.owner==='player'?'salvage':'alert');continue;
    }
    if(type==='salvageDropExpired'){toast('PUBLIC SALVAGE DROP EXPIRED');continue;}
    if(type==='stormglassBloom'){
      toast('STORMGLASS BLOOM · HARVEST THE CYAN FIELD · +35% ON DELIVERY',false,5500);
      audio.play('alert');continue;
    }
    if(type==='stormglassBloomEnded')continue;
    if(type==='aiCounterPlanStarted'){
      toast('ENEMY ADAPTING · ANTI-ARMOR SCREEN FORMING',true,6000);
      audio.play('alert');continue;
    }
    // The deploy command already confirms success. Its event also fires for the AI.
    if(type==='mcvDeployed')continue;
    if(type==='stormcallPulse'||type==='stormcallCanceled'){
      if(e.owner!=='player'&&fogAt(e.x,e.y)!==2)continue;
      if(type==='stormcallPulse')audio.play('ionpulse');
    }
    if(type==='constructionReady'&&e.defId&&game.construction?.ready&&game.construction.defId===e.defId){
      setRoutePlanMode(false);placeId=e.defId;placementToken++;placementPending=false;setPlacementHint();show('#placement-hint');syncTargetingFocus();toast(`${game.buildingDefs?.[e.defId]?.name||keyName(e.defId)} ready to place`);audio.play('constructionComplete');
    }
    if(type==='unitReady'&&e.owner==='player')audio.play('unitReady');
    if(type==='doctrineReady'&&e.owner==='player'){
      toast(`${DOCTRINE_DEFS[e.id]?.name||'Field research'} complete · focus active`);
      audio.play('constructionComplete');
    }
    if(type==='tacticalPackageReady'&&e.owner==='player'){
      toast(`${TACTICAL_PACKAGE_DEFS[e.id]?.name||'Tactical package'} ready · open Support to deploy`);
      audio.play('constructionComplete');
    }
    if(type==='constructionComplete'&&(!e.owner||e.owner==='player'))audio.play('constructionComplete');
    if(type==='buildingLost'&&e.owner==='player')audio.play('explosion');
    if(type==='bridgeDestroyed'&&(e.attackerOwner==='player'||fogAt(e.x+1.5,e.y+2)===2)){
      audio.play('explosion');toast(e.attackerOwner==='player'?'BRIDGE DEMOLISHED':'BRIDGE COLLAPSED');
    }
    if(type==='bridgeRepaired'){
      const bridge=game.getEntity?.(e.id);
      if(bridge&&fogAt(bridge.x+bridge.w/2,bridge.y+bridge.h/2)===2)toast('BRIDGE RESTORED');
    }
    if(type==='superweapon')audio.play('superweapon');
    if(type==='campaignThreatWarning')audio.play('alert');
    if(type==='unitSuppressed'){
      const target=game.getEntity?.(e.id),source=game.getEntity?.(e.sourceId);
      if(target?.owner==='player')toast(`${keyName(target.defId).toUpperCase()} WEAPON DISRUPTED`,true);
      else if(source?.owner==='player')toast('SPECTER AMBUSH · TARGET DISRUPTED');
      updateSelectionCard();
    }
    if(type==='unitAbility'){
      if(e.owner==='enemy'&&fogAt(e.x,e.y)!==2)continue;
      // The issuing control confirms the whole action once, including cohorts.
      if(e.owner==='player'){updateSelectionCard();continue;}
    }
    if(type==='vesperSalvage'){
      if(e.owner==='player'){
        toast(`VESPER SALVAGE · +${fmt(e.amount)} CREDITS`);
        audio.play('salvage');
      }
      continue;
    }
    if(type==='wreckRecovered'){
      if(e.owner==='player'){
        toast(`FIELD SALVAGE SECURED · +${fmt(e.value)} CREDITS`);
        audio.play('salvage');
      }
      continue;
    }
    if(type==='wreckRecommissioned'){
      if(e.owner==='player'){
        const name=UNIT_DEFS[e.defId]?.name||keyName(e.defId||'vehicle');
        toast(`${name.toUpperCase()} RECOMMISSIONED · 40% INTEGRITY`);
        audio.play('unitReady');
        updateSelectionCard();
      }
      continue;
    }
    if(type==='wreckRecoveryWaiting'){
      if(e.owner==='player')toast('COMMAND STORAGE FULL · ENGINEER WAITING',true);
      continue;
    }
    if(type==='unitBoarded'||type==='unitUnloaded'){
      const carrier=game.getEntity?.(e.carrierId);
      if(carrier?.owner==='player')toast(type==='unitBoarded'?'INFANTRY BOARDED':'INFANTRY DEPLOYED');
      updateSelectionCard();
    }
    if(type==='veterancy'){
      const veteran=game.getEntity?.(e.id);
      if(veteran?.owner==='player'){
        toast(`${keyName(veteran.defId).toUpperCase()} PROMOTED · ${VETERANCY_RANKS[e.level]?.name.toUpperCase()||'VETERAN'}`);
        audio.play('unitReady');
        updateSelectionCard();
      }
    }
    if(type==='unitPromoted'){
      if(e.owner==='player')updateSelectionCard();
      continue;
    }
    if(msg&&(!/damage|hit|shoot/i.test(type)))toast(msg,
      type==='campaignThreatWarning'||/error|invalid|low|lost|destroyed|attack/i.test(type),
      type==='campaignThreatWarning'?6300:3600);
    if(/victory|defeat|gameover|game_over/i.test(type)&&game.status!=='playing')finishGame(/victory/i.test(type)||e.winner==='player',e);
  }
}
function interruptMultiplayerMatch(replacedCode='') {
  if(currentMode!=='multiplayer'||!playing||gameEnded)return;
  const moved=Boolean(replacedCode);
  resetProductionRepeatControls();
  gameEnded=true;paused=true;syncTargetingFocus();lobby=null;matchRoomCode=null;opponentReconnecting=false;
  postMatchOpponent=null;postMatchFriendRequestPending=false;
  postMatchRematch=null;rematchOffer=null;rematchRequestPending=false;rematchResponsePending=false;rematchStatus='';
  renderPostMatchRematch();renderRematchOffer();
  closeTrackedDialog('#manual', false);
  hide('#pause-modal');audio.stopAmbient();audio.play('error');
  $('#multiplayer-status-text').textContent=moved?'COMMAND SEAT MOVED':'LIVE ROOM UNAVAILABLE';
  $('#end-modal .end-panel').classList.remove('campaign-finale','campaign-aftermath');
  $('#campaign-epilogue').classList.add('hidden');
  $('#end-kicker').textContent=moved?'OTHER CONNECTION ACTIVE':'CONNECTION INTERRUPTED';
  $('#end-title').textContent=moved?'COMMAND MOVED':'MATCH UNAVAILABLE';
  $('#end-title').style.color='#f3d28a';
  $('#end-copy').textContent=moved
    ?`This commander seat is active in another tab. Continue there, or return to Multiplayer and join room ${replacedCode} to take control here.`
    :'The live room could not be restored after reconnection. Its outcome is unavailable here. Return to the title screen to create or join another room.';
  if(moved)$('#join-room-code').value=replacedCode;
  $('#campaign-identity').classList.add('hidden');
  $('#campaign-field-order-result').classList.add('hidden');
  $('#campaign-result').classList.add('hidden');
  $('#campaign-handoff').classList.add('hidden');
  $('#skirmish-debrief').classList.add('hidden');
  $('#skirmish-debrief-facts').replaceChildren();
  $('#skirmish-debrief-note').textContent='';
  $('#end-stats').replaceChildren();$('#end-stats').classList.add('hidden');
  $('#end-record-status').textContent=moved?'MATCH CONTINUES IN OTHER TAB':'MATCH RESULT UNAVAILABLE';
  $('#post-match-opponent').classList.add('hidden');
  $('#end-next').classList.add('hidden');
  $('#end-restart').classList.add('hidden');
  $('#end-replay').classList.add('hidden');
  show('#end-modal');$('#end-menu').focus();
}
function showPostMatchOpponent(terminalEvent) {
  const code=typeof terminalEvent?.opponentFriendCode==='string'
    ?terminalEvent.opponentFriendCode.toUpperCase():'';
  postMatchOpponent=currentMode==='multiplayer'&&/^[A-Z0-9]{8}$/.test(code)
    ?{code,name:String(terminalEvent.opponentName||'Rival commander'),status:''}:null;
  postMatchFriendRequestPending=false;
  const panel=$('#post-match-opponent');
  panel.classList.toggle('hidden',!postMatchOpponent);
  if(!postMatchOpponent)return;
  $('#post-match-opponent-name').textContent=postMatchOpponent.name;
  $('#post-match-opponent-code').textContent=`FRIEND CODE · ${code}`;
  $('#post-match-opponent-status').textContent='';
  const button=$('#post-match-add-opponent');
  button.disabled=false;
  button.textContent='ADD OPPONENT ↗';
}
function renderPostMatchRematch() {
  const panel=$('#post-match-rematch');
  if(!panel)return;
  panel.classList.toggle('hidden',!postMatchRematch||
    rematchOffer?.matchId===postMatchRematch?.matchId);
  const button=$('#post-match-rematch-request');
  button.disabled=rematchRequestPending;
  button.textContent=rematchRequestPending?'OFFER PENDING':'OFFER REMATCH ↗';
  $('#post-match-rematch-status').textContent=rematchStatus;
}
function renderRematchOffer() {
  const active=!!rematchOffer&&Number(rematchOffer.expiresAt)>Date.now();
  if(!active)rematchOffer=null;
  const mapName=SKIRMISH_MAPS.find(map=>map.id===rematchOffer?.mapId)?.name||'the same battlefield';
  const rule=rematchOffer?.victoryMode==='elimination'?'Elimination':'Relay Dominion';
  const title=`${rematchOffer?.from?.name||'Your last opponent'} wants a rematch`;
  const detail=`${mapName} · ${rule} · private room · both commanders ready up again`;
  for(const [panelId,titleId,detailId] of [
    ['#end-rematch-offer','#end-rematch-offer-title','#end-rematch-offer-detail'],
    ['#multiplayer-rematch-offer','#multiplayer-rematch-offer-title','#multiplayer-rematch-offer-detail']]){
    const panel=$(panelId);
    panel.classList.toggle('hidden',!active);
    if(!active)continue;
    $(titleId).textContent=title;
    $(detailId).textContent=detail;
    panel.querySelectorAll('[data-rematch-accept],[data-rematch-decline]')
      .forEach(button=>{button.disabled=rematchResponsePending;});
  }
  renderPostMatchRematch();
}
function showPostMatchRematch(terminalEvent) {
  postMatchRematch=currentMode==='multiplayer'&&terminalEvent?.rematchEligible===true&&
    terminalEvent?.ranked!==true&&typeof terminalEvent.matchId==='string'&&terminalEvent.matchId.length>0
    ?{matchId:terminalEvent.matchId}:null;
  rematchRequestPending=false;rematchResponsePending=false;rematchStatus='';
  renderPostMatchRematch();renderRematchOffer();
}
function campaignLossReview(index, state, objective, forceCount, kills) {
  const playerBuildings = game.buildings.filter(building => building.owner === 'player' && building.hp > 0);
  const command = game.buildings.find(building => building.owner === 'player' && building.defId === 'command');
  const live = entity => !!entity && entity.hp > 0;
  const integrity = entity => live(entity) ? `${Math.ceil(entity.hp / entity.maxHp * 100)}%` : 'destroyed';
  const refineries = playerBuildings.filter(building => building.defId === 'refinery' && building.progress >= 1 && building.powered).length;
  const credits = Math.floor(Number(game.credits?.player) || 0);
  const relays = (game.relays || []).filter(relay => relay.owner === 'player').length;
  const stateFor = id => game.getEntity(state[id]);
  const dawnfallRelay = game.relays.find(relay => relay.id === state.relayId);
  const freightRelay = game.relays.find(relay => relay.id === state.relayId);
  const freightStatus = freightRelay?.owner === 'player' && !freightRelay.contested ? 'secure' : freightRelay?.contested ? 'contested' : 'unsecured';
  const finaleCanReform=(game.replayVersion==null
    ?state.dawnFreeShieldReformRulesVersion===60:game.replayVersion>=60)&&(state.shieldReformCount||0)<1;
  const counterbattery=getCounterbatteryView(game);
  const rows = {
    16: [`${counterbattery?.destroyed||0} / 2 siege batteries silenced · Command Yard ${integrity(command)}.`, 'Scout a pass with your armor, keep Rockets behind the screen, and escort the infantry with the Medic. Reinforce one assault while keeping defenders at the Yard.'],
    0: [`${refineries}/2 powered refineries · ${credits.toLocaleString()} / 2,200 credits at loss.`, refineries < 2 ? 'Bring a second refinery online early, then protect the harvest long enough to bank 2,200 credits.' : 'Keep the refinery network powered and defend the banked credits until the objective registers.'],
    1: [`Radar array ${integrity(stateFor('targetId'))} · ${game.units.filter(unit => unit.owner === 'player' && unit.defId === 'engineer' && live(unit)).length} engineers alive.`, 'Clear the route with armed units first; send an engineer to capture the damaged array once it is safe.'],
    2: [`Command yard ${integrity(command)} · ${Math.floor(state.elapsed || 0)} / ${state.duration || 180} seconds survived.`, 'Pull damaged units back to repair and keep the command yard out of the enemy approach until the full timer expires.'],
    3: [`Forward relay ${integrity(stateFor('targetId'))} · command yard ${integrity(command)}.`, 'Concentrate fire on the forward relay and keep a screen near the yard so the objective target falls before your base.'],
    4: [`${refineries}/2 powered refineries · ${credits.toLocaleString()} / 4,800 credits · ${Math.max(0, Math.ceil((state.deadline || 360) - state.elapsed))}s left at loss.`, 'Start the second refinery sooner, raid completed outposts for salvage, and intercept the courier if the bank is short near the deadline.'],
    5: [`Analyst ${integrity(stateFor('escortId'))} · ${objective?.secondary || 'extraction not reached'}.`,
      (game.replayVersion==null?state.ashesRouteRulesVersion===51:game.replayVersion>=51)&&game.campaignRoutePayoffId==='ghost-channel'
        ?'Use the northern uplink, hold an armed escort at the signal-shadow marker, then destroy the interceptor before moving the analyst to extraction.'
        :(game.replayVersion==null?state.ashesRouteRulesVersion===51:game.replayVersion>=51)&&game.campaignRoutePayoffId==='iron-current'
          ?'Use the southern uplink, recover the marked cache with an Engineer, then clear the extraction approach for the analyst.'
          :Array.isArray(state.transmissionUplinks)&&(game.replayVersion==null||game.replayVersion>=43)
        ?'Screen the chosen uplink through its five or eight second transmission, then lead the analyst through the northern pass to extraction.'
        :'Keep the analyst behind the escort screen and clear the extraction approach before moving them into the beacon.'],
    6: game.replayVersion!=null&&game.replayVersion<33
      ? [`Enemy construction yard ${integrity(stateFor('targetId'))} · command yard ${integrity(command)}.`, 'Commit armor and anti-structure fire to the Construction Yard while keeping defenders between enemy forces and your command yard.']
      : state.phase==='secure-relay'
        ? [`Central relay ${dawnfallRelay?.owner==='player'&&!dawnfallRelay.contested?'secured':dawnfallRelay?.contested?'contested':'unsecured'} · hold ${Math.floor(state.holdElapsed||0)} / ${state.holdDuration||8}s · Vesper yard shielded.`, 'Capture the central relay and keep it uncontested for the full 8 seconds; then shift your assault force onto the exposed Construction Yard.']
        : [`Exposed Vesper command yard ${integrity(stateFor('targetId'))} · command yard ${integrity(command)}.`, 'The relay shield is down. Commit armor and anti-structure fire to the Construction Yard while keeping defenders between enemy forces and your command yard.'],
    7: [`Western relay ${game.relays[0]?.owner === 'player' && !game.relays[0]?.contested ? 'held' : game.relays[0]?.contested ? 'contested' : 'not held'} · hold ${Math.floor(state.shelterHoldElapsed || 0)} / 10s · yard ${integrity(command)}.`, 'Clear the western shelter and keep a unit on it through the ion storm; reinforce the yard before the storm front arrives.'],
    8: [`${relays} relays held · ${Math.floor(state.holdElapsed || 0)} / ${state.holdDuration || 25}s hold progress.`, 'Split capture forces across two relays, then reinforce the weaker point so both stay yours for the full hold.'],
    9: game.replayVersion!=null&&game.replayVersion<34
      ? [`Signal chief ${integrity(stateFor('targetId'))} · command yard ${integrity(command)} · ${Math.max(0, Math.ceil((state.deadline || 300) - state.elapsed))}s remain.`, 'Use the stealth escort to locate the chief early, then focus fire before the deadline while a separate force guards the yard.']
      : [state.chiefEscapePhase==='escaped'
        ? `The signal chief reached the southeast extraction zone · command yard ${integrity(command)}.`
        : `Signal chief ${state.chiefEscapePhase==='escaping'?'was fleeing toward extraction':state.chiefEscapePhase==='alerted'?'was alerted':'was not intercepted'} · command yard ${integrity(command)} · ${Math.max(0, Math.ceil((state.deadline || 300) - state.elapsed))}s remained.`,
      'Scout the eastern outpost early. When the chief appears, order your armed escort to attack them directly before they reach southeast extraction.'],
    10: [`Fallback beacon ${integrity(stateFor('fallbackId'))} · ${Math.floor(state.elapsed || 0)} / ${state.duration || 120}s defended.`, 'Stage defenders on the western pass and repair the beacon under cover; the forward yard can be sacrificed if the beacon stays protected.'],
    11: [`${relays} relays held · command yard ${integrity(command)} · phase ${state.phase === 'destroy-command' ? 'command yard exposed' : state.shieldReformCount ? 'relay shield restored' : 'relay shield active'}.`, state.phase === 'destroy-command' ? finaleCanReform?'Keep two relays uncontested while your assault force attacks the exposed Command Yard; the enemy can restore its shield once.':'Shift your assault force onto the exposed Command Yard while protecting your own yard.' : 'Capture both central relays and hold them together until the shield drops; preserve enough armor for the yard assault.'],
    12: [`Engineer ${integrity(stateFor('engineerId'))} · landing hold ${Math.floor(state.holdElapsed || 0)} / ${state.holdDuration || 12}s · ${Math.max(0, Math.ceil((state.deadline || 240) - state.elapsed))}s window.`, state.phase === 'extract-engineer' ? 'Board the engineer for the west-bank crossing and keep the dropship alive through landing.' : 'Clear the eastern landing, keep the engineer nearby, and hold the relay before the recovery window closes.'],
    13: [`Engineer ${integrity(stateFor('engineerId'))} · vault upload ${Math.floor(state.hackElapsed || 0)} / ${state.hackDuration || 8}s · ${Math.max(0, Math.ceil((state.deadline || 210) - state.elapsed))}s window.`, state.phase === 'extract-engineer' ? 'Take the same engineer back to the western beacon as soon as the upload completes.' : 'Keep the engineer beside the vault for the full upload; use the covert escort to clear threats without pulling the engineer away.'],
    14: [state.reserveCommitted
      ? `Reserve committed · freight relay ${freightStatus} · final hold ${Math.floor(state.postAssaultHoldElapsed || 0)} / ${state.postAssaultHoldDuration || 12}s · yard ${integrity(command)}.`
      : `Reserve ${Math.min(credits, state.reserveTarget || 3000).toLocaleString()} / ${(state.reserveTarget || 3000).toLocaleString()} credits · freight relay ${freightStatus} · yard ${integrity(command)}.`,
    state.phase !== 'hold-freight' ? 'Harvest until the 3,000-credit reserve is committed, then move a durable screen onto the freight relay.' :
      (state.ironCurrentRulesVersion||0)>=55
        ? 'Redirect the Guardian reserve to the freight relay before the final armor group arrives. Clear both attackers and keep Vesper from holding the crossing.'
        : 'Rotate fresh defenders onto the freight relay, destroy the final tank, then keep the relay secure through the last 12 seconds.'],
  };
  const [observation, action] = rows[index] || [`${kills} enemy kills · ${forceCount} forces remain. ${objective?.primary || 'Mission objective incomplete.'}`, 'Use the objective tracker to prioritize its remaining condition, and preserve a reserve force for the final push.'];
  return { observation, action };
}

function renderSkirmishDebrief(victory) {
  const section=$('#skirmish-debrief');
  const facts=$('#skirmish-debrief-facts');
  const relays=game.relays||[];
  const secure=relays.filter(relay=>relay.owner==='player'&&!relay.contested).length;
  const enemyHeld=relays.filter(relay=>relay.owner==='enemy'&&!relay.contested).length;
  const contested=relays.filter(relay=>relay.contested).length;
  const units=game.units.filter(unit=>unit.owner==='player'&&unit.hp>0).length;
  const structures=game.buildings.filter(building=>building.owner==='player'&&building.hp>0).length;
  const rule=game.victoryMode==='elimination'?'ELIMINATION':'RELAY DOMINION';
  const rows=[
    ['VICTORY RULE',`${rule} · ${victory?'SECURED':'NOT REACHED'}`],
    ['RELAY LINE',`${secure} / ${relays.length} player secure · ${enemyHeld} enemy held · ${contested} contested`],
    ['FORCE AT CLOSE',`${units} ${units===1?'unit':'units'} · ${structures} ${structures===1?'structure':'structures'} standing`],
  ];
  facts.replaceChildren(...rows.map(([label,value])=>{
    const row=document.createElement('div');row.className='skirmish-debrief-fact';
    row.append(createTextElement('small','',label),createTextElement('strong','',value));
    return row;
  }));
  $('#skirmish-debrief-note').textContent=game.victoryMode==='elimination'
    ?'Elimination requires the opposing Command Yard, combat force, and active industry to be destroyed. Compare your surviving units and structures before redeploying.'
    :'Relay Dominion requires an uncontested majority through the countdown. Contested relays do not count toward the secure total.';
  section.classList.remove('hidden');
}

function finishGame(victory, terminalEvent=null) {
  clearPendingFieldAbility();
  if(gameEnded||!game||!playing)return;gameEnded=true;paused=true;syncTargetingFocus();
  resetProductionRepeatControls();
  cancelDigInTargeting();
  showPostMatchOpponent(terminalEvent);
  showPostMatchRematch(terminalEvent);
  clearSoloRecovery();updateSoloRecoveryButton();
  closeTrackedDialog('#manual', false);
  closeTrackedDialog('#promotion-modal', false);
  if (!$('#save-slots-modal').classList.contains('hidden')) closeSaveSlots(false);
  const missionId=currentMode==='campaign'?CAMPAIGN_MISSIONS[missionIndex]?.id:null;
  const finaleVictory=victory&&missionId==='dawn-of-the-free';
  const afterDawnVictory=victory&&missionId==='after-the-dawn';
  const ironReclaimedVictory=victory&&missionId==='iron-reclaimed';
  const counterbatteryVictory=victory&&missionId==='counterbattery';
  const bonusVictory=afterDawnVictory||ironReclaimedVictory||counterbatteryVictory;
  const endPanel=$('#end-modal .end-panel');
  endPanel.classList.toggle('campaign-finale',finaleVictory);
  endPanel.classList.toggle('campaign-aftermath',afterDawnVictory);
  endPanel.classList.toggle('campaign-recovery-complete',ironReclaimedVictory);
  const epilogue=$('#campaign-epilogue');
  epilogue.classList.toggle('hidden',!finaleVictory&&!bonusVictory);
  epilogue.textContent=finaleVictory
    ?'At first light, the relay towers go dark. Across the valley, the people raise their own signal.'
    :afterDawnVictory?'The last evacuation signal is accounted for. One final recovery remains: an abandoned Guardian and its Engineer are still waiting beyond the valley.'
      :ironReclaimedVictory?'The Engineer and the recommissioned Guardian made it back together. Beyond the recovery route, Vesper batteries are ranging the canyon passes.':counterbatteryVictory?'Both siege batteries fall silent. The canyon routes reopen, and the forward crews can bring their wounded home.':'';
  $('#end-stats').classList.remove('hidden');
  $('#skirmish-debrief').classList.add('hidden');
  $('#skirmish-debrief-facts').replaceChildren();
  $('#skirmish-debrief-note').textContent='';
  $('#campaign-loss-review').classList.add('hidden');
  $('#campaign-loss-observation').textContent='';
  $('#campaign-loss-action').textContent='';
  const earnedCampaignVeteran = victory && currentMode === 'campaign' ? deriveCampaignVeteran(game) : null;
  const previousCampaignBest=currentMode==='campaign'?campaignRecord(localStorage,difficulty,CAMPAIGN_MISSIONS[missionIndex]?.id):0;
  hide('#pause-modal');
  audio.stopAmbient();audio.play(victory?'victory':'defeat');
  if(victory&&currentMode==='campaign'){
    const result=game.campaignResult;
    if(result){
      if(saveCampaignResult(localStorage,difficulty,missionIndex,CAMPAIGN_MISSIONS[missionIndex].id,result,game.campaignSupplyId||'none'))
        saveCampaignVeteran(localStorage,difficulty,CAMPAIGN_MISSIONS[missionIndex].id,earnedCampaignVeteran);
      if(missionIndex===13||missionIndex===14)campaignRoutePayoffId=campaignChosenBranchId(localStorage,difficulty)||'none';
    }
    else if(!campaignBranchCode(missionId))advanceCampaignLegacyCompletion(localStorage,difficulty,missionIndex);
  }
  $('#end-kicker').textContent=currentMode==='multiplayer'?(victory?'MATCH WON':'MATCH LOST'):finaleVictory?'CAMPAIGN COMPLETE':ironReclaimedVictory?'BONUS RECOVERY COMPLETE':bonusVictory?'BONUS OPERATION COMPLETE':victory?'MISSION COMPLETE':'COMMAND LOST';
  $('#end-title').textContent=finaleVictory?'THE VALLEY IS FREE':afterDawnVictory?'SIGNAL RECOVERED':ironReclaimedVictory?'GUARDIAN RESTORED':counterbatteryVictory?'BATTERIES SILENCED':victory?'VICTORY':'DEFEAT';
  $('#end-title').style.color=victory?'#c9ff66':'#ff7869';
  const mission=currentMode==='campaign'?CAMPAIGN_MISSIONS[missionIndex]:null;
  const nextMissionIds=mission?campaignNextChoices(mission.id):[];
  const campaignIdentity=$('#campaign-identity'),handoff=$('#campaign-handoff');
  campaignIdentity.classList.toggle('hidden',!mission);
  handoff.classList.toggle('hidden',!mission);
  const veteranResult = $('#campaign-veteran-result');
  veteranResult.classList.toggle('hidden', !mission || !victory);
  $('#campaign-veteran-detail').replaceChildren();
  if(mission){
    const factionName=mission.faction==='vesper'?'VESPER COLLECTIVE':'AEGIS DIRECTORATE';
    const carryoverName=CAMPAIGN_CARRYOVERS.find(item=>item.id===(game.campaignCarryoverId||'none'))?.name||'No carryover';
    const supply=CAMPAIGN_SUPPLIES.find(item=>item.id===(game.campaignSupplyId||'none'));
    const supplyResult=supply&&supply.id!=='none' ? ` · ${supply.name.toUpperCase()} ${victory?'SPENT':'PRESERVED'}` : '';
    const identityCode=mission.id==='after-the-dawn'?'BONUS OPERATION · AIRLIFT':mission.id==='iron-reclaimed'?'BONUS OPERATION · RECOVERY':mission.id==='counterbattery'?'BONUS OPERATION · SIEGE':campaignBranchCode(mission.id)?`BRANCH OPERATION ${campaignBranchCode(mission.id)}`:`OPERATION ${String(missionIndex+1).padStart(2,'0')} / 12`;
    campaignIdentity.innerHTML=`<span>${identityCode}</span><strong>${mission.title.replace(/^Mission \d+: /,'')}</strong><small>${factionName} · ${victory?'OBJECTIVE SECURED':'OBJECTIVE NOT MET'} · ${carryoverName.toUpperCase()}${supplyResult}</small>`;
    if (victory) {
      const detail = $('#campaign-veteran-detail');
      if (earnedCampaignVeteran) {
        const copy = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = `${campaignVeteranRank(earnedCampaignVeteran)} ${campaignVeteranName(earnedCampaignVeteran)}`;
        const note = document.createElement('small');
        note.textContent = nextMissionIds.length
          ? 'Survived this operation. One attachment joins the next opening force; ranked use follows your verified result.'
          : 'Survived the final operation. This unit is preserved in your campaign record.';
        copy.append(name, note);
        detail.append(createVeteranPortrait(earnedCampaignVeteran), copy);
      } else {
        const note = document.createElement('p');
        note.textContent = 'No armed unit survived to reinforce the next operation.';
        detail.append(note);
      }
    }
    const orderResult = $('#campaign-field-order-result');
    const orderView = getCampaignFieldOrderView(game);
    orderResult.classList.remove('hidden');
    orderResult.replaceChildren();
    if (!orderView) {
      orderResult.classList.add('no-order');
      const label = document.createElement('span'); label.textContent = 'OPTIONAL FIELD ORDER';
      const result = document.createElement('strong'); result.textContent = 'NO ORDER SELECTED';
      orderResult.append(label, result);
    } else {
      orderResult.classList.remove('no-order');
      const label = document.createElement('span'); label.textContent = `FIELD ORDER · ${orderView.status === 'completed' ? 'COMPLETED' : 'FAILED'}`;
      const title = document.createElement('strong'); title.textContent = orderView.title;
      const detail = document.createElement('small');
      const nextIndex=campaignIndexById(nextMissionIds[0]);
      const nextIntelId = nextIndex>=0?getCampaignCarryoverUnlocks(nextIndex, [orderView.id || game.campaignFieldOrderId])[1]:null;
      const nextIntel = CAMPAIGN_CARRYOVERS.find(item=>item.id===nextIntelId);
      detail.textContent = orderView.status === 'completed'
        ? `Bonus earned · ${orderView.rewardText}${nextIntel ? ` · ${nextIntel.name} unlocked for the next operation` : ''}`
        : 'Bonus not earned';
      orderResult.append(label, title, detail);
    }
    const next=CAMPAIGN_MISSIONS[campaignIndexById(nextMissionIds[0])];
    const failure=terminalEvent?.reason;
    const objectiveAtLoss=!victory?updateCampaignTracker(true):null;
    const lossReview=$('#campaign-loss-review');
    if(!victory){
      const remainingForces=game.units.filter(unit=>unit.owner==='player'&&unit.hp>0).length;
      const review=campaignLossReview(missionIndex,game.campaignState||{},objectiveAtLoss,remainingForces,Math.max(0,Number(game.kills?.player)||0));
      $('#campaign-loss-observation').textContent=review.observation;
      $('#campaign-loss-action').textContent=review.action;
      lossReview.classList.remove('hidden');
    }
    $('#end-copy').textContent=finaleVictory?'The relay shield is broken and the final command yard has fallen. The crystal frontier belongs to its people.':afterDawnVictory?'The rescue team brought the evacuation record home. The valley can now account for those who escaped.':ironReclaimedVictory?'The marked Guardian and its Engineer reached the Field Workshop together. The recovery objective is complete.':counterbatteryVictory?'Both marked Siege Crawlers were destroyed before the deadline. The Command Yard survived.':victory?'Operation complete. Your command moves the campaign forward.':failure||'The operation was lost. Your progress is preserved; review the objective and redeploy when ready.';
    const elapsed=gameSeconds;
    const kills=Math.max(0,Number(game.kills?.player)||0);
    const forceCount=game.units.filter(u=>u.owner==='player'&&u.hp>0).length;
    const held=(game.relays||[]).filter(relay=>relay.owner==='player').length;
    const metrics=[['TIME',`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`],['ENEMY KILLS',kills],['FORCES LEFT',forceCount]];
    if((game.relays||[]).length)metrics.push(['RELAYS HELD',`${held} / ${game.relays.length}`]);
    if(game.faction==='vesper')metrics.push(['SALVAGE',`+${fmt(game.salvageEarned?.player||0)}`]);
    $('#end-stats').innerHTML=metrics.map(([label,value])=>`<div><small>${label}</small><span>${value}</span></div>`).join('');
    handoff.innerHTML=finaleVictory
      ?'<span>THE SHARD VALLEY CAMPAIGN</span><strong>Twelve core operations. One chosen route. One free frontier.</strong><p>The main war is complete. A bonus airlift rescue is now unlocked, or you can revisit any operation to improve its medal.</p>'
      :afterDawnVictory&&next
        ?`<span>NEXT OPERATION · BONUS RECOVERY</span><strong>${next.title.replace(/^Mission \d+: /,'')}</strong><p>${campaignBriefingCopy(next,difficulty)}</p>`
        :ironReclaimedVictory&&next
          ?`<span>NEXT OPERATION · COUNTERBATTERY</span><strong>${next.title}</strong><p>${campaignBriefingCopy(next,difficulty)}</p>`
        :counterbatteryVictory
          ?'<span>SIEGE BROKEN</span><strong>The canyon routes are open.</strong><p>Replay Counterbattery with another Field Order, or return to the campaign to improve your medals.</p>'
        :ironReclaimedVictory
          ?'<span>RECOVERY COMPLETE</span><strong>The Engineer and Guardian made it home.</strong><p>Return to the campaign to revisit the valley.</p>'
          :afterDawnVictory
            ?'<span>AFTERMATH COMPLETE</span><strong>Every signal brought home.</strong><p>Replay the rescue to improve your medal, or return to the campaign to revisit the valley.</p>'
            :victory&&nextMissionIds.length>1
              ?'<span>THE BLACK SHARD FORK</span><strong>Choose the next front.</strong><p>Infiltrate the signal vault in Ghost Channel, or hold the industrial line in Iron Current. Either route reconnects with Red Ledger.</p>'
              :victory&&next
                ?`<span>NEXT OPERATION // ${campaignMissionCode(next,campaignIndexById(next.id))}</span><strong>${next.title.replace(/^Mission \d+: /,'')}</strong><p>${campaignBriefingCopy(next,difficulty)}</p>`
                :objectiveAtLoss
                  ?`<span>OBJECTIVE AT LOSS</span><strong>${objectiveAtLoss.title}</strong><p>${objectiveAtLoss.primary}<br>${objectiveAtLoss.secondary}</p>`
                  :'<span>REDEPLOYMENT READY</span><strong>Learn from the loss</strong><p>Your mission progress is intact. Replay this operation to try a new approach.</p>';
  }else{
    campaignIdentity.replaceChildren();handoff.replaceChildren();$('#campaign-field-order-result').classList.add('hidden');
    const relayWin=terminalEvent?.reason==='relayDominion';
    const multiplayerReason=currentMode==='multiplayer'?terminalEvent?.reason:null;
    $('#end-copy').textContent=multiplayerReason==='forfeit'
      ?victory?'The rival commander forfeited the match.':'You forfeited the match.'
      :multiplayerReason==='disconnect'
        ?victory?'The rival commander did not reconnect in time. You win by disconnect.':'Your connection expired before you rejoined. The rival commander wins.'
        :relayWin
          ?victory?'Relay Dominion secured. You held the majority through the final countdown.':'The rival commander achieved Relay Dominion. Contest the relays before the countdown expires.'
          :game.victoryMode==='elimination'
            ?victory?'The enemy Command Yard, combat forces, and active industry have been eliminated.':'Your command force was eliminated. Regroup and deploy again.'
            :victory?'The frontier is under your command.':'Your command base has fallen. Regroup and deploy again.';
    const metrics=[['TIME',`${String(Math.floor(gameSeconds/60)).padStart(2,'0')}:${String(Math.floor(gameSeconds%60)).padStart(2,'0')}`],
      ['UNITS',game.units.filter(u=>u.owner==='player').length],['CREDITS',fmt(game.credits?.player)]];
    if(game.faction==='vesper')metrics.push(['SALVAGE',`+${fmt(game.salvageEarned?.player||0)}`]);
    $('#end-stats').innerHTML=metrics.map(([label,value])=>`<div><small>${label}</small><span>${value}</span></div>`).join('');
    if(currentMode==='skirmish')renderSkirmishDebrief(victory);
  }
  const medalPanel=$('#campaign-result');
  if(medalPanel){
    const result=currentMode==='campaign'&&victory?game.campaignResult:null;
    medalPanel.classList.toggle('hidden',!result);
    if(result){
      const best=Math.max(previousCampaignBest,result.stars);
      const medals=[['OBJECTIVE COMPLETE',true],['KEY ASSET PRESERVED',Boolean(result.keyAssetSurvived)],['PAR TIME',result.stars===3]];
      medalPanel.innerHTML=`<div class="campaign-result-total"><div class="campaign-result-stars" aria-label="${result.stars} of 3 stars">${'★'.repeat(result.stars)}${'☆'.repeat(3-result.stars)}</div><strong>${result.stars} / 3 STARS</strong><small>${result.stars>previousCampaignBest?'NEW PERSONAL BEST':`${difficulty.toUpperCase()} BEST: ${best} / 3`}</small></div><ul class="campaign-medals">${medals.map(([name,earned])=>`<li class="${earned?'earned':''}"><span>${earned?'★':'☆'}</span>${name}<b>${earned?'EARNED':'NOT EARNED'}</b></li>`).join('')}</ul>`;
    }
  }
  const recordStatus=$('#end-record-status');
  const benchmarkPanel=$('#solo-benchmark');
  soloBenchmarkRequestVersion++;
  if(benchmarkPanel){benchmarkPanel.classList.add('hidden');benchmarkPanel.textContent='';}
  const commands=activeRunRecorder?.commands||[];
  const envelope=activeReplayEnvelope;
  activeRunRecorder?.dispose();activeRunRecorder=null;activeReplayEnvelope=null;
  let storedCurrentReplay=false;
  if(currentMode!=='multiplayer'&&envelope){
    try{
      validateSoloReplay(envelope,commands,soloClock.completedTicks);
      replayArchive(); // Preserve an older single-replay record before adding this result.
      const replay={version:SOLO_REPLAY_VERSION,envelope,commands,completedTicks:soloClock.completedTicks};
      const scenario=currentMode==='campaign'?CAMPAIGN_MISSIONS[missionIndex]?.title:SKIRMISH_MAPS.find(map=>map.id===game?.mapId)?.name;
      const archived=addSoloReplayToArchive(replay,{savedAt:Date.now(),mode:currentMode,scenario,difficulty,faction,
        ...(currentMode==='skirmish'?{victoryMode:envelope.victoryMode||'dominion'}:{}),
        result:victory?'victory':'defeat',kills:Math.max(0,Number(game.kills?.player)||0),
        stars:currentMode==='campaign'&&victory?game.campaignResult?.stars:null,
        moments:selectReplayMoments(battleMoments,soloClock.completedTicks)});
      if(activeRunId&&currentMode!=='multiplayer')savePendingSoloSubmission({runId:activeRunId,profileId:network.profile?.id,replayId:archived.id,createdAt:Date.now()});
      storedCurrentReplay=true;
    }catch(error){console.warn('Local battle replay could not be saved.',error);toast('REPLAY STORAGE FULL OR UNAVAILABLE',true);}
  }
  $('#end-replay').classList.toggle('hidden',!storedCurrentReplay);
  updateReplayAvailability();
  if(recordStatus)recordStatus.textContent=currentMode==='multiplayer'?'LIVE MULTIPLAYER MATCH':`${activeRunId?'SUBMITTING VERIFIED SOLO RESULT…':'OFFLINE GAME · RESULT SAVED ON THIS DEVICE ONLY'}${currentMode==='campaign'?` · DOCTRINE: ${CAMPAIGN_DOCTRINES.find(item=>item.id===campaignDoctrineId)?.name||'Standard'}`:''}`;
  renderPendingSubmissionControls();
  if(activeRunId&&currentMode!=='multiplayer'){
    const finishingRunId=activeRunId;
    activeRunId=null;
    const pending=loadPendingSoloSubmission();
    const submission=pending?.runId===finishingRunId
      ?retryPendingSoloSubmission()
      :network.finishRun(finishingRunId,{commands,completedTicks:soloClock.completedTicks}).then(()=>true);
    submission.then(ok=>{if(recordStatus)recordStatus.textContent=ok?'VERIFIED RESULT SUBMITTED':pendingSubmissionMessage();if(ok){if(pending?.runId!==finishingRunId)showSoloBenchmark(envelope);if(envelope?.mode==='campaign')refreshCampaignDossier();}else if(benchmarkPanel){benchmarkPanel.textContent='NO VERIFIED BENCHMARK · THIS RUN HAS NOT BEEN ACCEPTED BY THE COMMAND NETWORK.';benchmarkPanel.classList.remove('hidden');}})
      .catch(error=>{if(recordStatus)recordStatus.textContent=loadPendingSoloSubmission()?.runId===finishingRunId?'RESULT SAVED LOCALLY · SUBMISSION PENDING':'RESULT SAVED LOCALLY · SUBMISSION FAILED AND COULD NOT BE QUEUED';if(benchmarkPanel){benchmarkPanel.textContent='NO VERIFIED BENCHMARK · THIS RUN COULD NOT BE VERIFIED.';benchmarkPanel.classList.remove('hidden');}console.warn(error);});
  }
  $('#end-next').classList.toggle('hidden',!(victory&&currentMode==='campaign'&&nextMissionIds.length));
  $('#end-next').innerHTML=nextMissionIds.length>1?'CHOOSE YOUR ROUTE <span>↗</span>':'NEXT OPERATION <span>↗</span>';
  $('#end-restart').innerHTML=currentMode==='campaign'?'REPLAY OPERATION <span>↗</span>':'PLAY AGAIN <span>↗</span>';
  $('#end-restart').classList.toggle('hidden',currentMode==='multiplayer');
  show('#end-modal');
  $('#end-modal').querySelector('button:not(:disabled):not(.hidden)')?.focus();
}

function networkFeedback(message, warning=false) {
  const target=$('#multiplayer-feedback');
  if(target){target.textContent=message;target.style.color=warning?'#ffab91':'';}
}
function pendingSubmissionMessage() {
  const pending=loadPendingSoloSubmission();
  if(!pending)return 'OFFLINE GAME · RESULT SAVED ON THIS DEVICE ONLY';
  if(pending.terminalReason)return 'LOCAL REPLAY SAVED · ONLINE VERIFICATION UNAVAILABLE FOR THIS RUN';
  if(!network.profile)return 'RESULT SAVED LOCALLY · SIGN IN TO RETRY SUBMISSION';
  if(network.profile.id!==pending.profileId)return 'RESULT PENDING · SWITCH TO THE COMMANDER PROFILE THAT STARTED THIS RUN';
  if(!replayArchive().some(entry=>entry.id===pending.replayId))return 'RESULT SAVED LOCALLY · REPLAY NEEDED TO RETRY SUBMISSION';
  return 'RESULT SAVED LOCALLY · SUBMISSION PENDING — RETRY FROM COMMANDER RECORDS';
}
async function showSoloBenchmark(envelope, rulesVersion=SOLO_REPLAY_VERSION) {
  const panel=$('#solo-benchmark');
  if(!panel||!envelope)return;
  const requestVersion=++soloBenchmarkRequestVersion;
  panel.classList.remove('hidden');
  panel.textContent='LOADING VERIFIED SCENARIO BENCHMARK…';
  const filters={mode:envelope.mode,scenarioId:envelope.scenarioId,difficulty:envelope.difficulty,faction:envelope.faction};
  if(envelope.mode==='campaign')Object.assign(filters,{doctrineId:envelope.doctrineId||'standard',fieldOrderId:envelope.fieldOrderId||'none',carryoverId:envelope.carryoverId||'none',veteran:envelope.campaignVeteran?(envelope.campaignVeteran.veterancy===2?'elite':'veteran'):'none',supplyId:envelope.supplyId||'none',...(campaignRouteBoard(envelope.scenarioId)?{routePayoffId:envelope.routePayoffId||'none'}:{})});
  if(envelope.mode==='skirmish')Object.assign(filters,{skirmishOpening:envelope.skirmishOpening||'established',victoryMode:envelope.victoryMode||'dominion',aiCommanderProfileId:aiCommanderProfileForSeed(envelope.seed,rulesVersion).id});
  try {
    const data=await network.leaderboard(filters);
    if(requestVersion!==soloBenchmarkRequestVersion||$('#end-modal')?.classList.contains('hidden'))return;
    const entries=data?.entries||[];
    if(!entries.length){panel.textContent='NO VERIFIED BENCHMARK EXISTS FOR THIS EXACT SETUP YET.';return;}
    const leader=entries[0],name=leader.player?.name||'Commander';
    const score=Math.round(Number(leader.score)||0).toLocaleString();
    const seconds=Math.max(0,Math.round(Number(leader.seconds)||0));
    const time=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    const scenario=envelope.mode==='campaign'?CAMPAIGN_MISSIONS.find(mission=>mission.id===envelope.scenarioId)?.title?.replace(/^Mission \d+: /,''):SKIRMISH_MAPS.find(map=>map.id===envelope.scenarioId)?.name;
    const routeName=campaignRouteBoard(envelope.scenarioId)
      ?CAMPAIGN_ROUTE_PAYOFFS.find(item=>item.id===(envelope.routePayoffId||'none'))?.name:'';
    panel.textContent=`VERIFIED ${scenario||'SCENARIO'} BENCHMARK · ${name} · ${score} POINTS · ${time}${routeName?` · ${routeName.toUpperCase()}`:''} · SAME FACTION, DIFFICULTY AND SETUP`;
  } catch(error) {
    if(requestVersion!==soloBenchmarkRequestVersion||$('#end-modal')?.classList.contains('hidden'))return;
    panel.textContent=`VERIFIED RESULT ACCEPTED · SCENARIO BENCHMARK UNAVAILABLE (${error.message||'connection error'}).`;
  }
}
function retryPendingSoloSubmission() {
  if(pendingSubmissionPromise)return pendingSubmissionPromise;
  const pending=loadPendingSoloSubmission();
  if(!pending||pending.terminalReason||!network.profile||!network.token||network.profile.id!==pending.profileId)return Promise.resolve(false);
  const entry=replayArchive().find(item=>item.id===pending.replayId);
  if(!entry)return Promise.resolve(false);
  pendingSubmissionPromise=(async()=>{
    try {
      // Duplicate finish requests are safe: the server returns its accepted result.
      await network.finishRun(pending.runId,{commands:entry.replay.commands,completedTicks:entry.replay.completedTicks});
      if(loadPendingSoloSubmission()?.runId===pending.runId)clearPendingSoloSubmission();
      if(!$('#end-modal')?.classList.contains('hidden'))showSoloBenchmark(entry.replay.envelope,entry.replay.version);
      if(entry.replay.envelope?.mode==='campaign')refreshCampaignDossier();
      return true;
    } catch(error) {
      pendingSubmissionError=error?.message||'Submission could not be completed.';
      if(/expired|supersed|unknown run|run not found|missing or already finished|outdated ruleset/i.test(pendingSubmissionError)){
        savePendingSoloSubmission({...pending,terminalReason:pendingSubmissionError});
        pendingSubmissionError='';
      }
      return false;
    } finally { pendingSubmissionPromise=null;renderPendingSubmissionControls(); }
  })();
  renderPendingSubmissionControls();
  return pendingSubmissionPromise;
}
let pendingSubmissionError='';
let pendingSubmissionPromise=null;
function renderPendingSubmissionControls() {
  const pending=loadPendingSoloSubmission();
  const archive=$('.local-replay-archive');
  if(archive){
    let status=$('#pending-record-status');
    if(!status){status=document.createElement('p');status.id='pending-record-status';status.setAttribute('role','status');archive.append(status);}
    let retry=$('#retry-pending-record');
    if(!pending){status.textContent='';retry?.remove();}
    else {
      status.textContent=pendingSubmissionMessage()+(pendingSubmissionError?` · ${pendingSubmissionError}`:'');
      if(pending.terminalReason){retry?.remove();}
      else {
        if(!retry){retry=document.createElement('button');retry.id='retry-pending-record';retry.type='button';retry.className='button-secondary';retry.textContent='RETRY RESULT SUBMISSION';archive.append(retry);retry.addEventListener('click',async()=>{retry.disabled=true;pendingSubmissionError='';const ok=await retryPendingSoloSubmission();if(!ok)networkFeedback(pendingSubmissionMessage(),true);retry.disabled=false;});}
        retry.disabled=!!pendingSubmissionPromise||!network.profile||network.profile.id!==pending.profileId||!replayArchive().some(item=>item.id===pending.replayId);
      }
    }
  }
  const end=$('#end-record-status');
  if(end&&pending&&!pending.terminalReason){let retry=$('#retry-end-record');if(!retry){retry=document.createElement('button');retry.id='retry-end-record';retry.type='button';retry.className='button-secondary';retry.textContent='RETRY SUBMISSION';end.insertAdjacentElement('afterend',retry);retry.addEventListener('click',async()=>{retry.disabled=true;pendingSubmissionError='';const ok=await retryPendingSoloSubmission();end.textContent=ok?'VERIFIED RESULT SUBMITTED':pendingSubmissionMessage();retry.disabled=false;});}retry.disabled=!!pendingSubmissionPromise||!network.profile||network.profile.id!==pending.profileId||!replayArchive().some(item=>item.id===pending.replayId);}
  else $('#retry-end-record')?.remove();
}
async function ensureNetworkReady() {
  if(!networkReadyPromise){
    networkReadyPromise=network.init().then(profile=>{networkAvailable=true;updateProfileUI();retryPendingSoloSubmission().catch(()=>{});return profile;})
      .catch(error=>{networkReadyPromise=null;networkAvailable=false;throw error;});
  }
  return networkReadyPromise;
}
async function networkProfileWithin(timeoutMs) {
  if(network.profile)return network.profile;
  let timer;
  try {
    return await Promise.race([ensureNetworkReady(),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error('Leaderboard connection timed out; this battle will be saved locally.')),timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
function updateProfileUI() {
  if(!network.profile)return;
  const handle=$('#profile-handle');
  if(handle&&document.activeElement!==handle)handle.value=network.profile.name||'';
  const code=$('#friend-code-value');if(code)code.textContent=network.profile.code||'—';
}
function createTextElement(tag,className,value){const element=document.createElement(tag);if(className)element.className=className;element.textContent=String(value);return element;}
function currentInviteUrl(){return new URL(`/?join=${encodeURIComponent(lobby?.code||'')}`,location.origin).href;}
function renderFriends(data) {
  const list=$('#friends-list');if(!list)return;
  list.replaceChildren();
  const friends=data?.friends||[],incoming=data?.incoming||[];
  $('#friends-count').textContent=`${friends.filter(f=>f.online).length} ONLINE · ${friends.length} TOTAL`;
  for(const request of incoming){
    const li=createTextElement('li','friend-entry','');
    li.append(createTextElement('span','roster-avatar','+'));
    const person=createTextElement('span','roster-person','');
    person.append(createTextElement('strong','roster-name',request.from?.name||'Commander'),createTextElement('small','roster-detail','INCOMING FRIEND REQUEST'));
    li.append(person);
    const button=createTextElement('button','quiet-button','ACCEPT');button.type='button';button.dataset.acceptRequest=request.id;li.append(button);list.append(li);
  }
  for(const friend of friends){
    const li=createTextElement('li','friend-entry','');
    li.append(createTextElement('span','roster-avatar',(friend.name||'?').slice(0,1).toUpperCase()));
    const person=createTextElement('span','roster-person','');
    person.append(createTextElement('strong','roster-name',friend.name||'Commander'),createTextElement('small','roster-detail',`${friend.online?'ONLINE':'OFFLINE'} · ${friend.code||''}`));
    li.append(person);
    if(lobby?.status==='waiting'&&!lobby.matchmaking&&(lobby.players||[]).length<2&&!playing){
      const button=createTextElement('button','quiet-button',friend.online?'INVITE':'COPY LINK');button.type='button';
      if(friend.online)button.dataset.inviteFriend=friend.id;
      else {button.dataset.copyFriendInvite=friend.id;button.title='Copy this room link to share with your offline friend.';}
      li.append(button);
    }
    list.append(li);
  }
  if(!friends.length&&!incoming.length){const li=createTextElement('li','empty-list-state','');li.append(createTextElement('span','empty-state-mark','◎'));const body=createTextElement('span','','');body.append(createTextElement('strong','','No friends yet'),createTextElement('small','','Add a friend code above to build your crew.'));li.append(body);list.append(li);}
}
async function refreshFriends(){const data=await network.friends();renderFriends(data);return data;}
function renderCasualMatchmaking(message=null){
  const card=$('#matchmaking-card');if(!card)return;
  card.classList.toggle('hidden',!!lobby?.matchmaking);
  const find=$('#find-casual-match'),cancel=$('#cancel-casual-search'),status=$('#matchmaking-status');
  const rankedFind=$('#find-ranked-match'),rankedCancel=$('#cancel-ranked-search'),rankedStatus=$('#ranked-status');
  const searching=casualSearchActive;
  const queueStatus=matchmakingMode==='ranked'?rankedStatus:status;
  const displayMode=matchmakingMode||matchmakingNoticeMode;
  const displayStatus=displayMode==='ranked'?rankedStatus:status;
  find.classList.toggle('hidden',searching&&matchmakingMode!=='casual');cancel.classList.toggle('hidden',!searching||matchmakingMode!=='casual');
  rankedFind.classList.toggle('hidden',searching&&matchmakingMode!=='ranked');rankedCancel.classList.toggle('hidden',!searching||matchmakingMode!=='ranked');
  find.disabled=!network.connected||!!lobby||searching;
  rankedFind.disabled=!network.connected||!!lobby||searching||!rankedRatingLoaded;
  cancel.disabled=false;rankedCancel.disabled=false;
  if(message!==null)displayStatus.textContent=message;
  else if(searching){
    if(casualSearchReconnecting)queueStatus.textContent='Connection lost. Reconnecting before search can continue.';
    else {
      const elapsed=Math.max(0,Math.floor((casualSearchElapsedMs+Math.max(0,Date.now()-casualSearchStartedAt))/1000));
      const time=elapsed>=60?`${Math.floor(elapsed/60)}m ${String(elapsed%60).padStart(2,'0')}s`:`${elapsed}s`;
      const band=matchmakingMode==='ranked'&&matchmakingRating!==null&&matchmakingRatingRange!==null
        ? matchmakingRatingRange>=Number.MAX_SAFE_INTEGER?' · all ratings now eligible':
          ` · rating ${matchmakingRating} ±${matchmakingRatingRange}` : '';
      queueStatus.textContent=`Searching${band}${casualSearchPosition!==null?` · position ${casualSearchPosition}`:''} · ${time} elapsed.`;
    }
  }else if(!network.connected)status.textContent='Command network offline. Reconnect to search for a match.';
  if(message===null&&!searching){
    if(!rankedRatingLoaded)rankedStatus.textContent=`Ranked search locked. ${rankedUnavailableReason}`;
    else rankedStatus.textContent=`Season ${rankedRating.season} · Rating ${rankedRating.rating} · ${rankedRating.wins}-${rankedRating.losses} record.`;
  }
}
function leaveCasualSearch(message='Search cancelled.'){
  if(!casualSearchActive)return false;
  if(network.connected)network.send('queue_leave');
  matchmakingNoticeMode=matchmakingMode;
  casualSearchActive=false;matchmakingMode=null;casualSearchReconnecting=false;casualSearchPosition=null;
  if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=null;
  renderCasualMatchmaking(message);
  return true;
}
function renderLobby(){
  const room=$('#room-lobby');if(!room)return;
  const firstReveal=!!lobby&&room.classList.contains('hidden');
  room.classList.toggle('hidden',!lobby);
  if(!lobby){
    // Leaving a room must remove its invitations immediately, even if the
    // next friends request is slow or the network has disconnected.
    $('#friends-list')?.querySelectorAll('[data-invite-friend],[data-copy-friend-invite]')
      .forEach(button=>button.remove());
    return;
  }
  $('#room-code').textContent=lobby.code||'—';
  $('#room-share-link').textContent=currentInviteUrl();
  const casual=!!lobby.matchmaking&&!lobby.ranked;
  const ranked=!!lobby.matchmaking&&!!lobby.ranked;
  $('.room-share-row').classList.toggle('hidden',!!lobby.matchmaking);
  $('.lobby-settings').classList.toggle('matchmaking-locked',!!lobby.matchmaking);
  const mapSelect=$('#room-map'),victorySelect=$('#room-victory-mode');
  if(!mapSelect.options.length)mapSelect.replaceChildren(...SKIRMISH_MAPS.map(map=>new Option(map.name,map.id)));
  const map=SKIRMISH_MAPS.find(item=>item.id===lobby.settings?.mapId)||SKIRMISH_MAPS[0];
  const victoryMode=lobby.matchmaking?'dominion':lobby.settings?.victoryMode==='elimination'?'elimination':'dominion';
  const canEdit=!lobby.matchmaking&&lobby.status==='waiting'&&lobby.hostId===network.profile?.id&&network.connected;
  mapSelect.value=map.id;victorySelect.value=victoryMode;
  mapSelect.disabled=!canEdit;victorySelect.disabled=!canEdit;
  $('#room-setting-note').textContent=lobby.matchmaking?`Random battlefield and Relay Dominion are locked for ${ranked?'ranked':'casual'} matchmaking.`:`${map.description} ${canEdit?'Changing either choice resets both ready checks.':'The host chooses the battlefield and victory rule.'}`;
  const players=lobby.players||[];
  const roster=$('#room-roster');roster.replaceChildren();
  for(const player of players){
    const li=createTextElement('li','','');li.append(createTextElement('span','roster-avatar',(player.name||'?').slice(0,1).toUpperCase()));
    const person=createTextElement('span','roster-person','');
    person.append(createTextElement('strong','roster-name',player.name||'Commander'),createTextElement('small','roster-detail',`${player.faction==='vesper'?'VESPER COLLECTIVE':'AEGIS DIRECTORATE'}${player.id===lobby.hostId?' · HOST':''}${player.connected===false?' · RECONNECTING':''}`));
    li.append(person,createTextElement('span',`roster-ready${player.ready&&player.connected!==false?' is-ready':''}`,player.connected===false?'OFFLINE':player.ready?'READY':'NOT READY'));roster.append(li);
  }
  const me=players.find(p=>p.id===network.profile?.id);
  $('#ready-toggle').disabled=!me;
  $('#ready-toggle').setAttribute('aria-pressed',String(!!me?.ready));
  $('#ready-toggle').textContent=me?.ready?'CANCEL READY':'MARK READY';
  const canStart=players.length===2&&players.every(p=>p.ready&&p.connected!==false)&&lobby.hostId===network.profile?.id;
  $('#start-multiplayer-game').disabled=!canStart;
  $('#start-multiplayer-game').title=lobby.hostId!==network.profile?.id?'Only the host can start.':players.length<2?'Waiting for another commander.':players.some(p=>p.connected===false)?'Waiting for a commander to reconnect.':!players.every(p=>p.ready)?'Both commanders must mark ready.':'Begin the match.';
  $('#lobby-status').textContent=lobby.matchmaking?(players.some(p=>p.connected===false)?'A commander is reconnecting.':canStart?'Both commanders ready. The host can deploy.':`${ranked?'Ranked':'Casual'} match found. Both commanders must mark ready; the host starts when ready.`):
    players.length<2?'Waiting for a second commander.':players.some(p=>p.connected===false)?'A commander is reconnecting.':canStart?'Both commanders ready. The host can deploy.':'Waiting for both commanders to mark ready.';
  $('#lobby-heading').textContent=ranked?'RANKED MATCH LOBBY':casual?'CASUAL MATCH LOBBY':'MISSION LOBBY';
  renderCasualMatchmaking();
  if(firstReveal)requestAnimationFrame(()=>{
    if(room.classList.contains('hidden'))return;
    room.scrollIntoView({behavior:'smooth',block:'start'});
    (lobby?.hostId===network.profile?.id?mapSelect:$('#ready-toggle')).focus({preventScroll:true});
  });
  refreshFriends().catch(()=>{});
}
async function openMultiplayer(){
  openTrackedDialog('#multiplayer-modal');renderLobby();renderCasualMatchmaking();networkFeedback('Connecting to the command network…');
  try{await ensureNetworkReady();networkFeedback(casualSearchActive?`Your ${matchmakingMode||'casual'} search is active.`:'Command network online. Create a room or enter an invite code.');await refreshFriends();loadRankedRecords();}
  catch(error){networkFeedback(`Multiplayer server unavailable: ${error.message}`,true);}
}
async function openLeaderboard(){
  openTrackedDialog('#leaderboard-modal');
  leaderboardServerRulesVersion = null;
  leaderboardResultsStatus().textContent='Loading leaderboard records.';
  renderReplayArchive();
  loadBattleHistory();
  loadMultiplayerHistory();
  loadRankedRecords();
  renderPendingSubmissionControls();
  updateLeaderboardScenarioOptions();
  updateLeaderboardOpeningOptions();
  updateLeaderboardVictoryModeOptions();
  updateLeaderboardAiProfileOptions();
  updateLeaderboardDoctrineOptions();
  updateLeaderboardCarryoverOptions();
  updateLeaderboardVeteranOptions();
  updateLeaderboardSupplyOptions();
  updateLeaderboardRoutePayoffOptions();
  try{
    await ensureNetworkReady();
    const health=await network.request('/health').catch(()=>null);
    leaderboardServerRulesVersion=Number.isInteger(health?.rulesVersion)?health.rulesVersion:'unreported';
    await retryPendingSoloSubmission();renderPendingSubmissionControls();await refreshLeaderboard();
  }
  catch(error){showLeaderboardError(error);}
}
function renderRankedRecords(rating, entries=[]){
  $('#ranked-season').textContent=String(rating.season);
  $('#ranked-own-record').textContent=`Your rating: ${rating.rating} · ${rating.wins}-${rating.losses} · ${rating.games} games`;
  const list=$('#ranked-leaderboard-list');list.replaceChildren();
  for(const [index,entry] of entries.slice(0,10).entries()){
    const row=createTextElement('li','ranked-leaderboard-entry','');
    row.append(createTextElement('span','ranked-place',String(index+1)),createTextElement('span','ranked-name',entry.name||'Commander'),createTextElement('span','ranked-rating',Number(entry.rating).toLocaleString()));
    list.append(row);
  }
  $('#ranked-records-status').textContent=entries.length?`Top ${Math.min(entries.length,10)} commanders · season ${rating.season}.`: 'No ranked results have been recorded this season.';
}
async function loadRankedRecords(){
  const version=++rankedDataRequestVersion,status=$('#ranked-records-status');
  try{
    await ensureNetworkReady();
    const rating=await network.rankedRating();
    if(version!==rankedDataRequestVersion)return;
    if(rating==null||!Number.isSafeInteger(rating.season)||rating.season<=0||
       !Number.isSafeInteger(rating.rating)||rating.rating<0||
       !['wins','losses','games'].every(key=>Number.isSafeInteger(rating[key])&&rating[key]>=0)||
       rating.games!==rating.wins+rating.losses)
      throw new Error('Ranked season information is unavailable.');
    const board=await network.rankedLeaderboard();
    if(version!==rankedDataRequestVersion)return;
    if(!Array.isArray(board?.entries))throw new Error('Ranked standings are unavailable.');
    rankedRating=rating;rankedRatingLoaded=true;
    rankedUnavailableReason='Ranked season support has not been confirmed.';
    renderRankedRecords(rankedRating,board.entries);
    renderCasualMatchmaking();
  }catch(error){
    if(version!==rankedDataRequestVersion)return;
    rankedRating=null;rankedRatingLoaded=false;
    const olderServer=/^not found\b/i.test(error.message||'');
    rankedUnavailableReason=olderServer?'This server version does not support ranked matchmaking.':'Could not verify this server\'s current ranked season.';
    $('#ranked-season').textContent='—';$('#ranked-own-record').textContent='Your ranked record is unavailable.';
    $('#ranked-leaderboard-list').replaceChildren();
    status.textContent=olderServer?'Ranked matchmaking is unavailable on this server version.':'Ranked standings unavailable. '+(error.message||'Please retry.');
    $('#ranked-status').textContent=`Ranked search locked. ${rankedUnavailableReason}`;
    renderCasualMatchmaking();
  }
}
function setBattleHistoryState(message, state='') {
  const status=$('#my-battles-status');
  status.textContent=message;
  status.className=`my-battles-status${state?` ${state}`:''}`;
}
async function loadBattleHistory(){
  const version=++battleHistoryRequestVersion;
  const list=$('#my-battles-list');
  list.replaceChildren();
  $('#my-battles-count').textContent='…';
  setBattleHistoryState('Loading your server verified battles…','loading');
  try {
    await ensureNetworkReady();
    const data=await network.battleHistory();
    if(version===battleHistoryRequestVersion)renderBattleHistory(data);
  } catch(error) {
    if(version!==battleHistoryRequestVersion)return;
    $('#my-battles-count').textContent='—';
    setBattleHistoryState(`Battle history unavailable. ${error.message||'Please try again.'}`,'error');
  }
}
function renderBattleHistory(data){
  const entries=Array.isArray(data?.entries)?data.entries:[];
  const list=$('#my-battles-list');list.replaceChildren();
  $('#my-battles-count').textContent=`${entries.length} BATTLE${entries.length===1?'':'S'}`;
  if(!entries.length){setBattleHistoryState('No server verified solo battles yet. Finish a solo run while connected to record it.','empty');return;}
  setBattleHistoryState('Showing results verified by the command network.','');
  for(const entry of entries){
    if(!entry||!['victory','defeat'].includes(entry.result))continue;
    const row=document.createElement('article');row.className='my-battle-row';
    const heading=document.createElement('div');heading.className='my-battle-title';
    const title=createTextElement('strong','',entry.scenarioName||entry.scenarioId||'Solo operation');
    const outcome=createTextElement('b',`my-battle-result ${entry.result}`,entry.result.toUpperCase());
    heading.append(title,outcome);
    const details=document.createElement('div');details.className='my-battle-details';
    const mode=entry.mode==='campaign'?'CAMPAIGN':entry.mode==='skirmish'?'SKIRMISH':String(entry.mode||'SOLO').toUpperCase();
    const difficultyName=String(entry.difficulty||'normal').toUpperCase();
    const factionName=entry.faction?String(entry.faction).toUpperCase():'';
    details.append(createTextElement('span','',`${mode} · ${difficultyName}${factionName?` · ${factionName}`:''}${entry.mode==='skirmish'?` · ${entry.victoryMode==='elimination'?'ELIMINATION':'RELAY DOMINION'}`:''}`));
    const choices=[];
    if(entry.mode==='campaign'){
      const doctrine=CAMPAIGN_DOCTRINES.find(item=>item.id===entry.doctrineId);
      if(doctrine&&doctrine.id!=='standard')choices.push(doctrine.name);
      if(entry.fieldOrderId&&entry.fieldOrderId!=='none'){
        const missionIndex=CAMPAIGN_MISSIONS.findIndex(mission=>mission.id===entry.scenarioId);
        const fieldOrder=missionIndex>=0?fieldOrdersForMission(missionIndex).find(order=>order.id===entry.fieldOrderId):null;
        if(fieldOrder)choices.push(fieldOrder.title);
      }
      const carryover=CAMPAIGN_CARRYOVERS.find(item=>item.id===entry.carryoverId);
      if(carryover&&carryover.id!=='none')choices.push(carryover.name);
      if(validateCampaignVeteran(entry.deployedVeteran)&&entry.deployedVeteran)
        choices.push(`${campaignVeteranRank(entry.deployedVeteran)} ${campaignVeteranName(entry.deployedVeteran)} deployed`);
      if(entry.result==='victory'&&validateCampaignVeteran(entry.campaignVeteran)&&entry.campaignVeteran)
        choices.push(`${campaignVeteranName(entry.campaignVeteran)} survived`);
      const supply=CAMPAIGN_SUPPLIES.find(item=>item.id===entry.supplyId);
      if(supply&&supply.id!=='none')choices.push(supply.name);
      if(campaignRouteBoard(entry.scenarioId)){
        const routePayoff=CAMPAIGN_ROUTE_PAYOFFS.find(item=>item.id===(entry.routePayoffId||'none'));
        if(routePayoff)choices.push(routePayoff.name);
      }
    }else if(entry.mode==='skirmish'){
      if(entry.skirmishOpening==='command-rig')choices.push('Command Rig start');
      choices.push(entry.victoryMode==='elimination'?'Elimination rules':'Relay Dominion rules');
      const commander=AI_COMMANDER_PROFILES.find(profile=>profile.id===entry.aiCommanderProfileId);
      if(commander)choices.push(`vs ${commander.name}`);
    }
    if(choices.length)details.append(createTextElement('span','my-battle-choices',choices.join(' · ')));
    const seconds=Number(entry.seconds);
    if(Number.isFinite(seconds)&&seconds>=0)details.append(createTextElement('span','',`TIME ${clockText(seconds)}`));
    const kills=Number(entry.kills);
    if(Number.isFinite(kills)&&kills>=0)details.append(createTextElement('span','',`${Math.floor(kills)} KILLS`));
    if(entry.score!==undefined&&entry.score!==null&&Number.isFinite(Number(entry.score)))details.append(createTextElement('span','my-battle-score',`VERIFIED SCORE ${Math.round(Number(entry.score)).toLocaleString()}`));
    const completed=new Date(entry.completedAt);
    if(entry.completedAt&&Number.isFinite(completed.getTime()))details.append(createTextElement('time','',completed.toLocaleString()));
    row.append(heading,details);list.append(row);
  }
  if(!list.children.length){$('#my-battles-count').textContent='0 BATTLES';setBattleHistoryState('No verified solo battles are available.','empty');}
}
function setMultiplayerHistoryState(message, state='') {
  const status=$('#my-1v1-matches-status');
  status.textContent=message;
  status.className=`my-battles-status${state?` ${state}`:''}`;
}
async function loadMultiplayerHistory({append=false}={}){
  if(append&&(multiplayerHistoryLoading||multiplayerHistoryLoaded>=multiplayerHistoryTotal))return;
  const version=++multiplayerHistoryRequestVersion;
  const list=$('#my-1v1-matches-list');
  const more=$('#my-1v1-matches-more');
  if(!append){list.replaceChildren();multiplayerHistoryLoaded=0;multiplayerHistoryTotal=0;$('#my-1v1-matches-count').textContent='…';}
  multiplayerHistoryLoading=true;
  more.disabled=true;
  more.classList.add('hidden');
  setMultiplayerHistoryState(append?'Loading more 1v1 matches…':'Loading your recorded 1v1 matches…','loading');
  try {
    await ensureNetworkReady();
    const data=await network.request(`/multiplayer/history?limit=30&offset=${append?multiplayerHistoryLoaded:0}`);
    if(version===multiplayerHistoryRequestVersion)renderMultiplayerHistory(data,append);
  } catch(error) {
    if(version!==multiplayerHistoryRequestVersion)return;
    if(!append)$('#my-1v1-matches-count').textContent='—';
    const reason=/^not found\b/i.test(error.message||'')
      ?'The connected server does not support 1v1 history yet.'
      :`${append?'More matches':'1v1 match history'} unavailable. ${error.message||'Please try again.'}`;
    setMultiplayerHistoryState(reason,'error');
  } finally {
    if(version===multiplayerHistoryRequestVersion){
      multiplayerHistoryLoading=false;
      more.disabled=false;
      more.classList.toggle('hidden',multiplayerHistoryLoaded>=multiplayerHistoryTotal);
    }
  }
}
function renderMultiplayerHistory(data,append=false){
  const entries=Array.isArray(data?.entries)?data.entries.filter(entry=>entry&&['victory','defeat'].includes(entry.result)):[];
  const list=$('#my-1v1-matches-list');if(!append)list.replaceChildren();
  multiplayerHistoryLoaded+=entries.length;
  multiplayerHistoryTotal=Number.isSafeInteger(data?.total)&&data.total>=multiplayerHistoryLoaded
    ?data.total:multiplayerHistoryLoaded;
  if(append&&!entries.length)multiplayerHistoryTotal=multiplayerHistoryLoaded;
  $('#my-1v1-matches-count').textContent=`${multiplayerHistoryTotal} MATCH${multiplayerHistoryTotal===1?'':'ES'}`;
  if(!list.children.length&&!entries.length){setMultiplayerHistoryState('No recorded 1v1 matches yet. Complete a live match while connected to record it.','empty');return;}
  setMultiplayerHistoryState(multiplayerHistoryLoaded<multiplayerHistoryTotal
    ?`Showing ${multiplayerHistoryLoaded} of ${multiplayerHistoryTotal} server-recorded matches.`
    :'Showing your server-recorded 1v1 matches.','');
  for(const entry of entries){
    const row=document.createElement('article');row.className='my-battle-row';
    const heading=document.createElement('div');heading.className='my-battle-title';
    heading.append(createTextElement('strong','',entry.opponent?.name?`vs. ${entry.opponent.name}`:'1v1 opponent'));
    heading.append(createTextElement('b',`my-battle-result ${entry.result}`,entry.result.toUpperCase()));
    const details=document.createElement('div');details.className='my-battle-details';
    const map=SKIRMISH_MAPS.find(item=>item.id===entry.mapId)?.name||entry.mapId||'Unknown battlefield';
    const mode=entry.victoryMode==='elimination'?'ELIMINATION':'RELAY DOMINION';
    details.append(createTextElement('span','',`${entry.ranked?'RANKED':'CASUAL'} · ${map} · ${mode}`));
    const ratingDelta=Number(entry.ratingDelta);
    if(entry.ranked&&Number.isFinite(ratingDelta))details.append(createTextElement('span',`ranked-delta ${ratingDelta>=0?'positive':'negative'}`,`RATING ${ratingDelta>=0?'+':''}${ratingDelta}`));
    if(entry.ranked&&Number.isFinite(Number(entry.ratingBefore))&&Number.isFinite(Number(entry.ratingAfter)))details.append(createTextElement('span','',`${entry.ratingBefore} → ${entry.ratingAfter}`));
    const reason={forfeit:'FORFEIT',disconnect:'DISCONNECT',relayDominion:'RELAY HOLD'}[entry.reason];
    if(reason)details.append(createTextElement('span','',reason));
    const seconds=Number(entry.durationSeconds);
    if(Number.isFinite(seconds)&&seconds>=0)details.append(createTextElement('span','',`TIME ${clockText(seconds)}`));
    const completed=new Date(entry.completedAt);
    if(entry.completedAt&&Number.isFinite(completed.getTime()))details.append(createTextElement('time','',completed.toLocaleString()));
    row.append(heading,details);list.append(row);
  }
  if(!list.children.length){$('#my-1v1-matches-count').textContent='0 MATCHES';setMultiplayerHistoryState('No recorded 1v1 matches yet. Complete a live match while connected to record it.','empty');}
}
function updateLeaderboardScenarioOptions(){
  const mode=$('#leaderboard-mode').value,select=$('#leaderboard-scenario');
  const scenarios=mode==='campaign'?CAMPAIGN_MISSIONS.map(mission=>({id:mission.id,name:mission.title.replace(/^Mission \d+: /,'')})):
    mode==='skirmish'?SKIRMISH_MAPS.map(map=>({id:map.id,name:map.name})):[];
  const previous=select.value;
  select.replaceChildren(new Option(mode==='campaign'?'All Missions':mode==='skirmish'?'All Maps':'All Scenarios',''));
  for(const scenario of scenarios)select.add(new Option(scenario.name,scenario.id));
  if(scenarios.some(scenario=>scenario.id===previous))select.value=previous;
  select.disabled=!mode;
}
function updateLeaderboardOpeningOptions(){
  const select=$('#leaderboard-opening');
  select.disabled=$('#leaderboard-mode').value!=='skirmish';
  if(!['established','command-rig'].includes(select.value))select.value='established';
}
function updateLeaderboardVictoryModeOptions(){
  const select=$('#leaderboard-victory-mode'),skirmish=$('#leaderboard-mode').value==='skirmish';
  select.disabled=!skirmish;
  if(!['dominion','elimination'].includes(select.value))select.value='dominion';
}
function updateLeaderboardAiProfileOptions(){
  const select=$('#leaderboard-ai-profile');
  const skirmish=$('#leaderboard-mode').value==='skirmish';
  select.disabled=!skirmish;
  if(!skirmish)select.value='';
}
function updateLeaderboardDoctrineOptions(){
  const select=$('#leaderboard-doctrine'),previous=select.value;
  select.replaceChildren(new Option('All Doctrines',''));
  for(const doctrine of CAMPAIGN_DOCTRINES)select.add(new Option(doctrine.name,doctrine.id));
  select.value=CAMPAIGN_DOCTRINES.some(doctrine=>doctrine.id===previous)?previous:'';
  if($('#leaderboard-mode').value==='skirmish')select.value='';
  select.disabled=$('#leaderboard-mode').value==='skirmish';
}
function updateLeaderboardFieldOrderOptions(){
  const select=$('#leaderboard-field-order'),previous=select.value,mode=$('#leaderboard-mode').value,scenarioId=$('#leaderboard-scenario').value;
  const missionIndices=mode!=='campaign'?[]:scenarioId?[CAMPAIGN_MISSIONS.findIndex(mission=>mission.id===scenarioId)]:CAMPAIGN_MISSIONS.map((_,index)=>index);
  const available=missionIndices.filter(index=>index>=0).flatMap(index=>fieldOrdersForMission(index).map(order=>({id:order.id,title:order.title,mission:CAMPAIGN_MISSIONS[index]})));
  const unique=new Map();for(const order of available)if(!unique.has(order.id))unique.set(order.id,order);
  select.replaceChildren(new Option('All Field Orders',''));
  if(mode==='campaign')select.add(new Option('No Field Order','none'));
  for(const order of unique.values())select.add(new Option(`${order.title}${mode==='campaign'&&!scenarioId?` · ${order.mission.title.replace(/^Mission \d+: /,'')}`:''}`,order.id));
  select.value=mode==='campaign'&&(previous==='none'||unique.has(previous))?previous:'';
  select.disabled=mode!=='campaign';
}
function updateLeaderboardCarryoverOptions() {
  const select=$('#leaderboard-carryover'),previous=select.value;
  const campaign=$('#leaderboard-mode').value==='campaign';
  select.replaceChildren(new Option('All Carryovers',''));
  if(campaign)for(const carryover of CAMPAIGN_CARRYOVERS)select.add(new Option(carryover.name,carryover.id));
  select.value=campaign&&CAMPAIGN_CARRYOVERS.some(item=>item.id===previous)?previous:'';
  select.disabled=!campaign;
}
function updateLeaderboardVeteranOptions() {
  const select=$('#leaderboard-veteran');
  const scenario=$('#leaderboard-scenario').value;
  const supported=$('#leaderboard-mode').value==='campaign'&&scenario!==CAMPAIGN_MISSIONS[0].id;
  select.disabled=!supported;
  if(!supported)select.value='';
}
function updateLeaderboardSupplyOptions() {
  const select=$('#leaderboard-supply'),previous=select.value;
  const campaign=$('#leaderboard-mode').value==='campaign';
  select.replaceChildren(new Option('All Requisitions',''));
  if(campaign)for(const supply of CAMPAIGN_SUPPLIES)select.add(new Option(supply.name,supply.id));
  select.value=campaign&&CAMPAIGN_SUPPLIES.some(item=>item.id===previous)?previous:'';
  select.disabled=!campaign;
}
function updateLeaderboardRoutePayoffOptions() {
  const select=$('#leaderboard-route-payoff'),previous=select.value;
  const mode=$('#leaderboard-mode').value,scenarioId=$('#leaderboard-scenario').value;
  const supported=mode==='campaign'&&(!scenarioId||campaignRouteBoard(scenarioId));
  select.replaceChildren(new Option('All Routes',''));
  if(supported)for(const payoff of CAMPAIGN_ROUTE_PAYOFFS)select.add(new Option(payoff.name,payoff.id));
  select.value=supported&&CAMPAIGN_ROUTE_PAYOFFS.some(item=>item.id===previous)?previous:'';
  select.disabled=!supported;
}
async function refreshLeaderboard(){
  const requestVersion=++leaderboardRequestVersion;
  leaderboardResultsStatus().textContent='Updating leaderboard records.';
  const filters={mode:$('#leaderboard-mode').value,scenarioId:$('#leaderboard-scenario').value,difficulty:$('#leaderboard-difficulty').value,doctrineId:$('#leaderboard-doctrine').value,fieldOrderId:$('#leaderboard-field-order').value,carryoverId:$('#leaderboard-carryover').value,veteran:$('#leaderboard-veteran').value,supplyId:$('#leaderboard-supply').value,routePayoffId:$('#leaderboard-route-payoff').value,
    skirmishOpening:$('#leaderboard-mode').value==='skirmish'?$('#leaderboard-opening').value:'',
    victoryMode:$('#leaderboard-mode').value==='skirmish'?$('#leaderboard-victory-mode').value:'',
    aiCommanderProfileId:$('#leaderboard-mode').value==='skirmish'?$('#leaderboard-ai-profile').value:''};
  try{const data=await network.leaderboard(filters);if(requestVersion===leaderboardRequestVersion)renderLeaderboard(data);}
  catch(error){if(requestVersion===leaderboardRequestVersion)showLeaderboardError(error);}
}
function leaderboardResultsStatus(){
  let status=$('#leaderboard-results-status');
  if(!status){
    status=document.createElement('p');
    status.id='leaderboard-results-status';
    status.className='visually-hidden';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    status.setAttribute('aria-atomic','true');
    $('.leaderboard-table-wrap')?.before(status);
  }
  return status;
}
function announceLeaderboardResults(count){
  const filterIds=['leaderboard-mode','leaderboard-scenario','leaderboard-difficulty','leaderboard-opening','leaderboard-victory-mode','leaderboard-ai-profile','leaderboard-doctrine','leaderboard-field-order','leaderboard-carryover','leaderboard-veteran','leaderboard-supply','leaderboard-route-payoff'];
  const selected=filterIds.map(id=>{
    const select=$(`#${id}`);
    return select&&!select.disabled&&select.value?select.options[select.selectedIndex]?.textContent:null;
  }).filter(Boolean);
  const context=selected.length?` for ${selected.join(', ')}`:' across all modes';
  leaderboardResultsStatus().textContent=`Leaderboard updated. ${count} record${count===1?'':'s'} found${context}.`;
}
function showLeaderboardError(error){
  const body=$('#leaderboard-list');body.replaceChildren();
  $('#leaderboard-count').textContent='0 RECORDS';
  leaderboardResultsStatus().textContent=`Leaderboard unavailable: ${error.message||'request failed'}.`;
  const empty=$('#leaderboard-empty');empty.classList.remove('hidden');empty.querySelector('strong').textContent='Records unavailable';empty.querySelector('p').textContent=error.message;
  $('#leaderboard-note').classList.add('hidden');
}
function renderLeaderboard(data){
  const entries=data?.entries||[],body=$('#leaderboard-list');body.replaceChildren();
  $('#leaderboard-count').textContent=`${entries.length} RECORD${entries.length===1?'':'S'}`;
  const empty=$('#leaderboard-empty');
  empty.classList.toggle('hidden',entries.length>0);
  const filtered=!!($('#leaderboard-mode').value||$('#leaderboard-scenario').value||$('#leaderboard-difficulty').value||$('#leaderboard-doctrine').value||$('#leaderboard-field-order').value||$('#leaderboard-carryover').value||$('#leaderboard-veteran').value||$('#leaderboard-supply').value||$('#leaderboard-route-payoff').value||($('#leaderboard-mode').value==='skirmish'&&$('#leaderboard-victory-mode').value)||$('#leaderboard-ai-profile').value);
  empty.querySelector('strong').textContent=filtered?'No matching records':'No current ruleset records yet';
  empty.querySelector('p').textContent=!filtered
    ?'Complete a solo battle to join this board. Past verified results remain in My Battles.'
    :$('#leaderboard-mode').value==='skirmish'
      ?'Try another map, opening, victory rule, enemy commander, or difficulty to see verified skirmishes.'
      :$('#leaderboard-mode').value==='campaign'
        ?'Try another mission, difficulty, doctrine, Field Order, Carryover Intel, Survivor Attachment, Requisition, or Branch Route to see verified operations.'
        :'Choose Campaign or Skirmish, then narrow the results by scenario and setup.';
  const note=$('#leaderboard-note');
  const serverNotice=leaderboardServerRulesVersion==='unreported'
    ? ` Server replay rules version is unavailable; new v${SOLO_REPLAY_VERSION} solo runs may remain unranked.`
    : leaderboardServerRulesVersion!=null&&leaderboardServerRulesVersion!==SOLO_REPLAY_VERSION
      ? ` Connected server uses replay rules v${leaderboardServerRulesVersion}; this client uses v${SOLO_REPLAY_VERSION}. New solo runs will remain unranked until the server updates.`:'';
  note.textContent=`${data?.note||'Ranked results are verified against completed solo replays.'}${serverNotice}`;
  note.classList.remove('hidden');
  announceLeaderboardResults(entries.length);
  entries.forEach((entry,index)=>{
    const row=document.createElement('tr');
    const operation=entry.mode==='campaign'?'CAMPAIGN':'SKIRMISH';
    const seconds=Math.max(0,Math.round(entry.seconds||0));
    row.append(createTextElement('td','',String(index+1).padStart(2,'0')),createTextElement('td','',entry.player?.name||'Commander'));
    const scenarioCell=document.createElement('td');
    const doctrineName=CAMPAIGN_DOCTRINES.find(item=>item.id===(entry.doctrineId||'standard'))?.name||'Standard';
    const carryoverName=CAMPAIGN_CARRYOVERS.find(item=>item.id===(entry.carryoverId||'none'))?.name||'No carryover';
    const veteranName=validateCampaignVeteran(entry.deployedVeteran)&&entry.deployedVeteran
      ?`${campaignVeteranRank(entry.deployedVeteran)} ${campaignVeteranName(entry.deployedVeteran)}`:'NO SURVIVOR';
    const supplyName=CAMPAIGN_SUPPLIES.find(item=>item.id===(entry.supplyId||'none'))?.name||'No requisition';
    const routePayoffName=entry.mode==='campaign'&&campaignRouteBoard(entry.scenarioId)
      ?CAMPAIGN_ROUTE_PAYOFFS.find(item=>item.id===(entry.routePayoffId||'none'))?.name||'No Route Intel':'';
    const fieldOrder=entry.mode==='campaign'&&entry.fieldOrderId&&entry.fieldOrderId!=='none'?fieldOrdersForMission(CAMPAIGN_MISSIONS.findIndex(mission=>mission.id===entry.scenarioId)).find(order=>order.id===entry.fieldOrderId):null;
    const orderMeta=entry.mode==='campaign'?(fieldOrder?` · ${fieldOrder.title.toUpperCase()} · ${(entry.fieldOrderStatus||entry.fieldOrderResult||'ORDER').toUpperCase()}`:' · NO FIELD ORDER'):'';
    const openingMeta=entry.mode==='skirmish'?(entry.skirmishOpening==='command-rig'?' · COMMAND RIG':' · FORWARD BASE'):'';
    const victoryMeta=entry.mode==='skirmish'?` · ${(entry.victoryMode||'dominion')==='elimination'?'ELIMINATION':'RELAY DOMINION'}`:'';
    const enemyCommander=AI_COMMANDER_PROFILES.find(profile=>profile.id===entry.aiCommanderProfileId);
    const commanderMeta=entry.mode==='skirmish'&&enemyCommander?` · VS ${enemyCommander.name.toUpperCase()}`:'';
    scenarioCell.append(createTextElement('strong','record-scenario',entry.scenarioName||`${operation} RUN`),createTextElement('small','record-meta',`${operation} · ${(entry.difficulty||'normal').toUpperCase()}${openingMeta}${victoryMeta}${commanderMeta}${entry.mode==='campaign'?` · ${doctrineName.toUpperCase()} · ${carryoverName.toUpperCase()} · ${veteranName.toUpperCase()} · ${supplyName.toUpperCase()}${routePayoffName?` · ${routePayoffName.toUpperCase()}`:''}`:''}${orderMeta}`));
    row.append(scenarioCell);
    for(const value of [(entry.result||'victory').toUpperCase(),Math.round(entry.score||0).toLocaleString(),`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`])row.append(createTextElement('td','',value));
    body.append(row);
  });
}
async function copyValue(value,label){
  try{await navigator.clipboard.writeText(value);networkFeedback(`${label} copied.`);}
  catch{networkFeedback(`Copy unavailable. Use: ${value}`,true);}
}
function sendMatchCommand(command,data={}){
  return network.command(command,{ids:[...(game?.selection||[])],...data});
}
function installMultiplayerCommandAdapters(target){
  const commands={
    issueMove:(x,y,attackMove=false,queue=false,matchPace=false)=>({x,y,attackMove,queue,...(matchPace===true?{matchPace:true}:{})}),issueForceMove:(x,y,queue=false,matchPace=false)=>({x,y,queue,...(matchPace===true?{matchPace:true}:{})}),issueFormationMove:(x,y,formationId,movement='move',queue=false,matchPace=false)=>({x,y,formationId,movement,queue,...(matchPace===true?{matchPace:true}:{})}),issueReverseMove:(x,y,queue=false,matchPace=false)=>({x,y,queue,...(matchPace===true?{matchPace:true}:{})}),issueAttack:(targetId,queue=false)=>({targetId,queue}),
    issueHarvest:()=>({}),issueBloomExpedition:()=>({}),issueReturnCargo:()=>({}),issueRearm:()=>({}),issueStop:()=>({}),issueGuard:()=>({}),issueAssignRefinery:(refineryId=null)=>({refineryId}),issuePatrol:(x,y)=>({x,y}),issueFollow:targetId=>({targetId}),issueBoard:carrierId=>({carrierId}),issueGarrison:buildingId=>({buildingId}),issueEvacuateGarrison:buildingId=>({buildingId}),issueUnload:(x,y)=>({x,y}),issueForceFire:(x,y)=>({x,y}),issueDigIn:(x,y)=>({x,y}),issueScatter:()=>({}),issueDeploy:()=>({}),issueSetStance:stance=>({stance}),issueSetTargetPriority:priority=>({priority}),
    issueEngineer:targetId=>({targetId}),issueFieldRepair:targetId=>({targetId}),issueRefillRepairKits:()=>({}),
    issueRecoverWreck:wreckId=>({wreckId}),issueRecommissionWreck:wreckId=>({wreckId}),issueServiceAtWorkshop:workshopId=>({workshopId}),startConstruction:defId=>({defId}),cancelConstruction:()=>({}),
    issueBuild:(defId,x,y)=>({defId,x,y}),queueUnit:(defId,producerId)=>({defId,...(producerId!==undefined?{producerId}:{})}),chooseDoctrine:doctrineId=>({doctrineId}),chooseTacticalPackage:packageId=>({packageId}),
    issuePromoteUnit:(unitId,promotionId)=>({unitId,promotionId}),
    useUnitAbility:(unitId,abilityId)=>({unitId,abilityId}),
    useSelectedUnitAbility:abilityId=>({abilityId}),
    cancelQueuedUnit:(buildingId,index)=>({buildingId,index}),setRally:(buildingId,x,y)=>({buildingId,x,y}),setRallyTarget:(buildingId,unitId=null)=>({buildingId,unitId}),
    toggleRepair:buildingId=>({buildingId}),sellBuilding:buildingId=>({buildingId}),
    useSuperweapon:(x,y)=>({x,y}),useCommandAbility:(abilityId,x,y)=>({abilityId,x,y}),
    setRelayProtocol:(relayId,protocol)=>({relayId,protocol}),
    setBuildingPower:(buildingId,standby)=>({buildingId,standby}),setProductionRepeat:(buildingId,unitDefId=null)=>({buildingId,unitDefId}),
  };
  for(const [name,encode] of Object.entries(commands))target[name]=(...args)=>sendMatchCommand(name,encode(...args));
}
function hydrateMultiplayerState(state){
  if(!state)return;
  const next=Game.deserialize(state);
  const priorPulseIds=new Set((game?.effects||[]).filter(effect=>effect.source==='stormcall').map(effect=>effect.id));
  const freshPulse=(next.effects||[]).find(effect=>effect.source==='stormcall'&&!priorPulseIds.has(effect.id));
  const priorRecoveryIds=new Set((game?.effects||[]).filter(effect=>effect.type==='recommission').map(effect=>effect.id));
  const freshRecovery=(next.effects||[]).some(effect=>effect.type==='recommission'&&
    effect.owner==='player'&&!priorRecoveryIds.has(effect.id));
  if(game&&currentMode==='multiplayer'&&game.width===next.width&&game.height===next.height){
    for(let y=0;y<next.height;y++)for(let x=0;x<next.width;x++)Object.assign(game.terrain[y][x],next.terrain[y][x]);
    next.terrain=game.terrain;
    next.selection=(game.selection||[]).filter(id=>[...next.units,...next.buildings].some(o=>o.id===id&&o.owner==='player'));
  }
  if(game&&currentMode==='multiplayer'&&game.terrain===next.terrain)
    renderer3d?.adoptMultiplayerSnapshot?.(game,next);
  next.events=[];
  installMultiplayerCommandAdapters(next);
  game=next;faction=next.faction;relayScoutIndex=0;
  reconcileFieldAbilityLocks();
  gameSeconds=Math.max(gameSeconds,next.time||0);
  if(freshPulse&&playing){
    audio.play('ionpulse');
    toast(freshPulse.owner==='player'?'RELAY PULSE DISCHARGED':'ENEMY RELAY PULSE');
  }
  if(freshRecovery&&playing){
    audio.play('unitReady');
    toast('FIELD VEHICLE RECOMMISSIONED');
  }
  if(playing)updateUI(true);
}
async function startMultiplayerGame(message){
  clearPendingFieldAbility();
  resetProductionRepeatControls();
  selectionRoster.reset();
  finishDeploymentIntro();
  matchPaceMode=false;
  selectedFormation='';formationSelectionKey='';formationPreviewCache={key:'',at:0,preview:null};
  battlefieldPickerAddSquadMode=false;
  setBattlefieldPickerOpen(false);
  abandonActiveRun();
  clearSoloRecovery();updateSoloRecoveryButton();
  placementToken++;placementPending=false;commandAbilityToken++;commandAbilityPending=false;
  activePlayback=null;replayMode=false;replayAccumulator=0;replaySeekTarget=null;
  $('#game-shell').classList.remove('replay-mode');hide('#replay-controls');
  currentMode='multiplayer';missionIndex=0;gameEnded=false;paused=false;playing=false;placeId=null;attackMoveMode=false;cancelDigInTargeting();commandAbilityMode=null;setRoutePlanMode(false);
  postMatchOpponent=null;postMatchFriendRequestPending=false;
  postMatchRematch=null;rematchOffer=null;rematchRequestPending=false;rematchResponsePending=false;rematchStatus='';
  renderPostMatchRematch();renderRematchOffer();
  lastPublicSalvagePhase=null;
  lastPublicBloomUntil=null;
  matchRoomCode=message.code||lobby?.code||null;
  opponentReconnecting=false;
  game=null;gameSeconds=0;soloClock.reset();musicCombat=0;groups={};lastProductionSignature='';
  resetTacticalFeed();
  await ensureRenderer();
  playing=true;
  hydrateMultiplayerState(message.state);
  resetCommandDeckForOperation();
  setMobileRadarOpen(false);
  setMobileDeckExpanded(true);
  closeTrackedDialog('#multiplayer-modal', false);closeTrackedDialog('#leaderboard-modal', false);
  closeTrackedDialog('#setup', false);
  hide('#menu');hide('#pause-modal');hide('#end-modal');show('#game-shell');
  $('#multiplayer-status').classList.remove('hidden');
  $('#multiplayer-status-text').textContent=`ROOM ${matchRoomCode||'LIVE'} · ${faction==='vesper'?'VESPER':'AEGIS'}`;
  $('.operation-name strong').textContent=SKIRMISH_MAPS.find(map=>map.id===game.mapId)?.name.toUpperCase()||'RIVAL COMMANDERS';
  $('#objective-text').textContent=objectiveLabel();
  $('#save-game').classList.add('hidden');$('#load-game').classList.add('hidden');$('#restart-game').classList.add('hidden');
  camera.zoom=1;$('#zoom-value').textContent='100%';resizeCanvases();centerOnBase();frameOpeningForces();updateUI(true);toast('LIVE MULTIPLAYER MATCH · COMMAND ONLINE');audio.play('confirm');audio.startAmbient();lastTime=performance.now();$('#menu-toggle').focus();
}
function updateAudioMood(){
  if(!game)return;
  const combatEffect=(game.effects||[]).some(fx=>/^(projectile|impact|explosion|muzzle|ion|nuke)$/.test(fx.type));
  const friends=game.units.filter(unit=>unit.owner==='player'&&unit.hp>0&&!unit.embarkedIn);
  const contact=game.units.some(enemy=>enemy.owner==='enemy'&&enemy.hp>0&&!enemy.embarkedIn&&game.isVisible(enemy)&&
    friends.some(unit=>Math.hypot(unit.x-enemy.x,unit.y-enemy.y)<9));
  musicCombat=Math.max(combatEffect?1:(contact?0.62:0),musicCombat*.89);
  const storm={calm:0,warning:.4,surge:1,recovery:.2}[game.storm?.phase]||0;
  audio.setMood({combat:musicCombat,storm});
}
function frame(now) {
  requestAnimationFrame(frame);
  recordPresentedFrame(now);
  if(!playing||!game)return;
  const elapsed=Math.max(0,(now-lastTime)/1000),dt=Math.min(.05,elapsed);lastTime=now;
  advanceDeploymentIntro(now);
  if(replayMode&&activePlayback&&replaySeekTarget!==null){
    try{
      if(replaySeekTarget<activePlayback.tick){
        game=activePlayback.reset();selectionRoster.reset();gameSeconds=game.time;replayAccumulator=0;
      }
      const steps=Math.min(120,replaySeekTarget-activePlayback.tick);
      if(steps>0){game=activePlayback.step(steps);gameSeconds=game.time;game.events.length=0;}
      if(activePlayback.tick>=replaySeekTarget){
        replaySeekTarget=null;
        $('#replay-seek-status').textContent=`PAUSED AT ${clockText(activePlayback.tick*SOLO_STEP_SECONDS)}`;
        refreshFrameRateReadout(now);
      }
      updateUI(true);drawMinimap();updateReplayControls();
    }catch(error){
      replaySeekTarget=null;paused=true;replayAccumulator=0;
      $('#replay-seek-status').textContent='SEEK FAILED · RESTART OR EXIT REPLAY';
      refreshFrameRateReadout(now);
      console.warn('Battle replay seek stopped.',error);toast('BATTLE REPLAY SEEK FAILED',true);updateReplayControls();
    }
  }
  if(!paused&&!gameEnded){
    if(replayMode&&activePlayback){
      replayAccumulator+=Math.min(.25,elapsed)*replaySpeed;
      const steps=Math.min(120,Math.floor(replayAccumulator/SOLO_STEP_SECONDS));
      if(steps>0){
        replayAccumulator-=steps*SOLO_STEP_SECONDS;
        try{
          game=activePlayback.step(steps);
          gameSeconds=game.time;
          game.events.length=0;
          if(activePlayback.finished){paused=true;replayAccumulator=0;toast('REPLAY COMPLETE · RESTART OR RETURN TO TITLE');}
        }catch(error){paused=true;replayAccumulator=0;console.warn('Battle replay stopped.',error);toast('REPLAY COULD NOT CONTINUE',true);}
        updateReplayControls();
      }
    }else if(currentMode!=='multiplayer'){
      soloRecoveryElapsed += elapsed;
      if(soloRecoveryElapsed >= 20){checkpointSoloRecovery();soloRecoveryElapsed=0;}
      soloClock.advance(elapsed,step=>{
        game.update(step);
        if(currentMode==='campaign')updateCampaign(game,missionIndex,step);
        gameSeconds=game.time;
        return game.status==='playing';
      });
    }else gameSeconds=Math.max(gameSeconds,game.time||0);
    displayTime+=dt;uiTimer+=dt;minimapTimer+=dt;
    const left=panKeys.has('ArrowLeft')||panKeys.has('KeyA')||panKeys.has('KeyQ')||panKeys.has('PanLeft');
    const right=panKeys.has('ArrowRight')||panKeys.has('KeyD')||panKeys.has('PanRight');
    const up=panKeys.has('ArrowUp')||panKeys.has('KeyW')||panKeys.has('PanUp');
    const down=panKeys.has('ArrowDown')||panKeys.has('KeyS')||panKeys.has('PanDown');
    const panX=Number(right)-Number(left),panY=Number(down)-Number(up);
    if(panX||panY){
      const distance=13*TILE_SIZE*dt/Math.max(1,Math.hypot(panX,panY));
      panCameraByScreen(-panX*distance,-panY*distance);
    }
    clampCamera();
    if(!replayMode&&currentMode!=='multiplayer'){
      processEvents();
      const winner=game.winner||game.victor;
      if(winner)finishGame(winner==='player'||winner==='aegis'&&faction==='aegis'||winner==='vesper'&&faction==='vesper');
      if(game.status==='victory')finishGame(true);if(game.status==='defeat')finishGame(false);
    }
    if(uiTimer>.45){updateUI();updateAudioMood();updateReplayControls();uiTimer=0;}
    if(minimapTimer>.22){drawMinimap();minimapTimer=0;}
  }
  render(displayTime);
}

$('#quick-start').addEventListener('click',()=>{
  let firstDeployment=true;
  try {
    firstDeployment=localStorage.getItem('frontier.quick-start-seen-v1')!=='1';
    localStorage.setItem('frontier.quick-start-seen-v1','1');
  } catch {}
  beginGame({faction:'aegis',difficulty:'easy',mapId:firstDeployment?'shard-valley':'random',guided:true,victoryMode:'dominion'});
});
$('#deployment-intro-enter').addEventListener('click',()=>finishDeploymentIntro());
$('#ai-profile-toggle').addEventListener('click',()=>{
  const badge=$('#ai-profile-badge');
  const toggle=$('#ai-profile-toggle');
  const expanded=!badge.classList.contains('is-expanded');
  badge.classList.toggle('is-expanded',expanded);
  toggle.setAttribute('aria-expanded',String(expanded));
  toggle.setAttribute('aria-label',`${expanded?'Collapse':'Expand'} ${$('#ai-profile-name').textContent.toLowerCase()} commander intelligence`);
  toggle.lastElementChild.textContent=expanded?'▴':'▾';
});
$('#game-shell').addEventListener('pointerdown',event=>{
  if(deploymentIntro)finishDeploymentIntro(!event.target.closest('#deployment-intro-enter'));
},true);
$('#game-shell').addEventListener('wheel',()=>{if(deploymentIntro)finishDeploymentIntro(true);},{capture:true,passive:true});
window.addEventListener('keydown',()=>{if(deploymentIntro)finishDeploymentIntro();},true);
$('#storm-status-button').addEventListener('click',()=>{
  if(!game||!playing)return;
  const bloom=game.storm?.bloom?.until>game.time?game.storm.bloom:null;
  const target=bloom||game.storm;
  if(target)centerCamera(target.x,target.y);
});
$('#campaign-target-links').addEventListener('click',event=>{
  const button=event.target.closest('[data-campaign-target]');
  if(!button||button.disabled||currentMode!=='campaign'||missionIndex!==16)return;
  const target=getCounterbatteryView(game)?.targets[Number(button.dataset.campaignTarget)];
  if(!target?.alive)return;
  setMobileRadarOpen(false);
  centerCamera(target.x,target.y);
});
$('#relay-locator').addEventListener('click',()=>{
  const locator=$('#relay-locator');
  const relay=game?.relays?.find(item=>item.id===locator.dataset.relayId);
  const counteringEnemyDominion=game?.victoryMode!=='elimination'&&game?.relayDominion?.owner==='enemy';
  const scoutUnknown=locator.dataset.scoutUnknown==='true';
  const openingScout=locator.dataset.scoutReason==='opening';
  const hasVisibleRelay=(game?.relays||[]).some(item=>fogAt(item.x,item.y)===2);
  const eligible=relay&&(scoutUnknown
    ?openingScout
      ?!hasVisibleRelay&&fogAt(relay.x,relay.y)!==2
      :counteringEnemyDominion&&!relayIntel(relay,fogAt(relay.x,relay.y)).known
    :fogAt(relay.x,relay.y)===2&&
      (relay.owner===null||counteringEnemyDominion&&relay.owner==='enemy'));
  if(!eligible){updateRelayLocator();return;}
  centerCamera(relay.x,relay.y);
  if(scoutUnknown&&!openingScout){relayScoutIndex++;updateRelayLocator();}
  if(window.matchMedia('(max-width: 670px)').matches){
    const fieldTop=canvas.getBoundingClientRect().top;
    const locatorBottom=locator.getBoundingClientRect().bottom-fieldTop;
    const targetY=Math.min(visibleH-56,Math.max(visibleH*.58,locatorBottom+86));
    panCameraByScreen(0,targetY-toScreen(relay.x,relay.y).y);
  }
});
$('#salvage-locator').addEventListener('click',()=>{
  const drop=game?.salvageDrop;
  if(!drop||!['incoming','active'].includes(drop.phase))return;
  centerCamera(drop.x,drop.y);
  if(window.matchMedia('(max-width: 670px)').matches){
    const locatorBottom=$('#salvage-locator').getBoundingClientRect().bottom-canvas.getBoundingClientRect().top;
    const targetY=Math.min(visibleH-54,Math.max(visibleH*.58,locatorBottom+62));
    panCameraByScreen(0,targetY-toScreen(drop.x,drop.y).y);
  }
  drawMinimap();
});
$('#tactical-alert').addEventListener('click',()=>{
  if(!tacticalAlert||!game||game.time>=tacticalAlert.until||replayMode)return;
  centerCamera(tacticalAlert.x,tacticalAlert.y);
  drawMinimap();
});
$('#configure-game').addEventListener('click',openSetup);
$('#campaign-menu').addEventListener('click',openCampaign);
$('#multiplayer-menu').addEventListener('click',openMultiplayer);
$('#leaderboard-menu').addEventListener('click',openLeaderboard);
$('#my-battles-refresh').addEventListener('click',loadBattleHistory);
$('#my-1v1-matches-refresh').addEventListener('click',()=>loadMultiplayerHistory());
$('#my-1v1-matches-more').addEventListener('click',()=>loadMultiplayerHistory({append:true}));
$('#replay-menu').addEventListener('click',watchLastReplay);
$('#local-replay-list').addEventListener('click',event=>{
  const watch=event.target.closest('[data-watch-replay]');
  if(watch){const entry=replayArchive().find(item=>item.id===watch.dataset.watchReplay);if(entry)watchReplayRecord(entry.replay,entry.metadata);return;}
  const remove=event.target.closest('[data-delete-replay]');
  if(remove){
    if(remove.dataset.confirmDelete!=='true'){
      for(const other of $('#local-replay-list').querySelectorAll('[data-confirm-delete="true"]')){
        other.dataset.confirmDelete='false';other.textContent='DELETE';
        other.setAttribute('aria-label',other.dataset.originalLabel||'Delete local replay');
      }
      remove.dataset.originalLabel ||= remove.getAttribute('aria-label')||'Delete local replay';
      remove.dataset.confirmDelete='true';remove.textContent='CONFIRM?';
      remove.setAttribute('aria-label',remove.dataset.originalLabel.replace(/^Delete /,'Confirm deletion of '));
      remove.title='Click again within five seconds to delete this local replay';
      setTimeout(()=>{if(remove.isConnected&&remove.dataset.confirmDelete==='true'){
        remove.dataset.confirmDelete='false';remove.textContent='DELETE';remove.removeAttribute('title');
        remove.setAttribute('aria-label',remove.dataset.originalLabel);
      }},5000);
      return;
    }
    try{deleteSoloReplayFromArchive(remove.dataset.deleteReplay);renderReplayArchive();updateReplayAvailability();toast('LOCAL REPLAY DELETED');}
    catch(error){console.warn('Local replay could not be deleted.',error);toast('REPLAY DELETE FAILED',true);}
  }
});
$('#leaderboard-mode').addEventListener('change',()=>{updateLeaderboardScenarioOptions();updateLeaderboardOpeningOptions();updateLeaderboardVictoryModeOptions();updateLeaderboardAiProfileOptions();updateLeaderboardDoctrineOptions();updateLeaderboardFieldOrderOptions();updateLeaderboardCarryoverOptions();updateLeaderboardVeteranOptions();updateLeaderboardSupplyOptions();updateLeaderboardRoutePayoffOptions();refreshLeaderboard();});
$('#leaderboard-scenario').addEventListener('change',()=>{updateLeaderboardFieldOrderOptions();updateLeaderboardVeteranOptions();updateLeaderboardRoutePayoffOptions();refreshLeaderboard();});
$('#leaderboard-difficulty').addEventListener('change',refreshLeaderboard);
$('#leaderboard-opening').addEventListener('change',refreshLeaderboard);
$('#leaderboard-victory-mode').addEventListener('change',refreshLeaderboard);
$('#leaderboard-ai-profile').addEventListener('change',refreshLeaderboard);
$('#leaderboard-doctrine').addEventListener('change',refreshLeaderboard);
$('#leaderboard-field-order').addEventListener('change',refreshLeaderboard);
$('#leaderboard-carryover').addEventListener('change',refreshLeaderboard);
$('#leaderboard-veteran').addEventListener('change',refreshLeaderboard);
$('#leaderboard-supply').addEventListener('change',refreshLeaderboard);
$('#leaderboard-route-payoff').addEventListener('change',refreshLeaderboard);
for(const id of ['multiplayer-close','multiplayer-back'])$(`#${id}`).addEventListener('click',()=>{pendingJoinCode=null;leaveCasualSearch(`Search cancelled because you left multiplayer${matchmakingMode==='ranked'?' (ranked)':''}.`);closeTrackedDialog('#multiplayer-modal');});
for(const id of ['leaderboard-close','leaderboard-back'])$(`#${id}`).addEventListener('click',()=>closeTrackedDialog('#leaderboard-modal'));
async function saveProfileHandle(){
  const input=$('#profile-handle');
  try{await ensureNetworkReady();const profile=await network.rename(input.value.trim());input.value=profile.name;networkFeedback('Callsign updated.');await refreshFriends();}
  catch(error){networkFeedback(error.message,true);}
}
$('#save-profile-handle').addEventListener('click',saveProfileHandle);
$('#profile-handle').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();saveProfileHandle();}});
$('#copy-friend-code').addEventListener('click',()=>network.profile?.code&&copyValue(network.profile.code,'Friend code'));
async function startPublicMatchmaking(mode){
  const ranked=mode==='ranked';
  try{
    await ensureNetworkReady();
    if(lobby)throw new Error('Leave the current room before searching.');
    if(ranked&&!rankedRatingLoaded)throw new Error('Ranked season support is unavailable on this server.');
    if(!network.send('queue_join',{ranked}))throw new Error('Live server unavailable.');
    matchmakingMode=ranked?'ranked':'casual';matchmakingNoticeMode=matchmakingMode;
    casualSearchActive=true;casualSearchReconnecting=false;casualSearchPosition=null;casualSearchElapsedMs=0;casualSearchStartedAt=Date.now();
    if(casualSearchTimer)clearInterval(casualSearchTimer);casualSearchTimer=setInterval(()=>{if(casualSearchActive&&!casualSearchReconnecting)renderCasualMatchmaking();},1000);
    renderCasualMatchmaking(`Joining the ${ranked?'ranked':'casual'} matchmaking queue…`);
    networkFeedback(`${ranked?'Ranked':'Casual'} search started. You can cancel it or close multiplayer to stop searching.`);
  }catch(error){casualSearchActive=false;matchmakingMode=null;renderCasualMatchmaking(error.message);networkFeedback(error.message,true);}
}
$('#find-casual-match').addEventListener('click',()=>startPublicMatchmaking('casual'));
$('#find-ranked-match').addEventListener('click',()=>startPublicMatchmaking('ranked'));
$('#cancel-casual-search').addEventListener('click',()=>{
  leaveCasualSearch('Search cancelled.');networkFeedback('Casual search cancelled.');
});
$('#cancel-ranked-search').addEventListener('click',()=>{
  leaveCasualSearch('Ranked search cancelled.');networkFeedback('Ranked search cancelled.');
});
$('#ranked-records-refresh').addEventListener('click',loadRankedRecords);
$('#friend-request-form').addEventListener('submit',async event=>{
  event.preventDefault();const code=$('#friend-request-input').value.trim().toUpperCase();if(!code)return;
  try{await ensureNetworkReady();await network.requestFriend(code);$('#friend-request-input').value='';networkFeedback('Friend request sent.');await refreshFriends();}
  catch(error){networkFeedback(error.message,true);}
});
$('#friends-list').addEventListener('click',async event=>{
  const accept=event.target.closest('[data-accept-request]');
  if(accept){try{await network.acceptFriend(accept.dataset.acceptRequest);networkFeedback('Friend added.');await refreshFriends();}catch(error){networkFeedback(error.message,true);}return;}
  const copyInvite=event.target.closest('[data-copy-friend-invite]');
  if(copyInvite&&lobby?.status==='waiting'&&!lobby.matchmaking&&(lobby.players||[]).length<2&&!playing){await copyValue(currentInviteUrl(),'Room invite link');return;}
  const invite=event.target.closest('[data-invite-friend]');
  if(invite&&lobby?.status==='waiting'&&!lobby.matchmaking&&(lobby.players||[]).length<2&&!playing){
    if(network.send('invite_friend',{friendId:invite.dataset.inviteFriend}))networkFeedback('Sending lobby invitation…');else networkFeedback('Live server unavailable.',true);
  }
});
$('#create-room').addEventListener('click',async()=>{
  try{await ensureNetworkReady();leaveCasualSearch('Search cancelled because you entered a private room.');if(!network.send('create_lobby',{faction}))throw new Error('Live server unavailable.');networkFeedback('Creating a private room…');}
  catch(error){networkFeedback(error.message,true);}
});
$('#join-room-form').addEventListener('submit',async event=>{
  event.preventDefault();const code=$('#join-room-code').value.trim().toUpperCase();if(!code)return;
  try{await ensureNetworkReady();pendingJoinCode=null;leaveCasualSearch('Search cancelled because you joined a private room.');if(!network.send('join_lobby',{code,faction}))throw new Error('Live server unavailable.');networkFeedback(`Joining room ${code}…`);}
  catch(error){networkFeedback(error.message,true);}
});
$('#copy-room-link').addEventListener('click',()=>lobby&&copyValue(currentInviteUrl(),'Invite link'));
for(const id of ['room-map','room-victory-mode'])$(`#${id}`).addEventListener('change',()=>{
  if(!lobby||lobby.hostId!==network.profile?.id||lobby.status!=='waiting'){renderLobby();return;}
  if(!network.send('set_settings',{mapId:$('#room-map').value,victoryMode:$('#room-victory-mode').value})){
    renderLobby();networkFeedback('Live server unavailable.',true);
  }
});
$('#leave-room').addEventListener('click',()=>{network.send('leave_lobby');lobby=null;$('#lobby-heading').textContent='MISSION LOBBY';renderLobby();renderCasualMatchmaking('You left the room. Search for a casual match whenever you’re ready.');refreshFriends().catch(()=>{});networkFeedback('You left the room.');});
$('#ready-toggle').addEventListener('click',()=>{const me=lobby?.players?.find(p=>p.id===network.profile?.id);if(me)network.send('set_ready',{ready:!me.ready});});
$('#start-multiplayer-game').addEventListener('click',()=>{if(!$('#start-multiplayer-game').disabled)network.send('start_match');});
function closeCampaign() { closeMissionBriefing(); hide('#campaign-select'); (campaignReturnFocus?.isConnected ? campaignReturnFocus : $('#campaign-menu')).focus(); }
$('#campaign-close').addEventListener('click',closeCampaign);
$('#campaign-select .modal-close').addEventListener('click',closeCampaign);
$('#campaign-difficulty').addEventListener('click',event=>{
  const button=event.target.closest('[data-difficulty]');
  if(!button||!['easy','normal','hard'].includes(button.dataset.difficulty))return;
  campaignDifficulty=button.dataset.difficulty;
  document.querySelectorAll('#campaign-difficulty button').forEach(item=>{
    const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active));
  });
  renderCampaignList();
});
$('#campaign-list').addEventListener('click',e=>{const btn=e.target.closest('[data-mission]');if(btn&&!btn.disabled)openMissionBriefing(Number(btn.dataset.mission),btn);});
$('#doctrine-options').addEventListener('click',event=>{const card=event.target.closest('[data-doctrine]');if(card)selectCampaignDoctrine(card.dataset.doctrine);});
$('#doctrine-options').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  const cards=[...$('#doctrine-options').querySelectorAll('[data-doctrine]')],current=cards.indexOf(document.activeElement);
  if(current<0||!cards.length)return;
  event.preventDefault();
  const next=cards[(current+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+cards.length)%cards.length];
  selectCampaignDoctrine(next.dataset.doctrine);next.focus();
});
$('#carryover-options').addEventListener('click',event=>{
  const card=event.target.closest('[data-carryover]');
  if(card&&!card.disabled)selectCampaignCarryover(card.dataset.carryover);
});
$('#carryover-options').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  const cards=[...$('#carryover-options').querySelectorAll('[data-carryover]:not(:disabled)')];
  const current=cards.indexOf(document.activeElement);
  if(current<0||!cards.length)return;
  event.preventDefault();
  const next=cards[(current+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+cards.length)%cards.length];
  selectCampaignCarryover(next.dataset.carryover);
});
$('#requisition-options').addEventListener('click',event=>{
  const card=event.target.closest('[data-supply]');
  if(card&&!card.disabled)selectCampaignSupply(card.dataset.supply);
});
$('#requisition-options').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  const cards=[...$('#requisition-options').querySelectorAll('[data-supply]:not(:disabled)')];
  const current=cards.indexOf(document.activeElement);
  if(current<0||!cards.length)return;
  event.preventDefault();
  const next=cards[(current+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+cards.length)%cards.length];
  selectCampaignSupply(next.dataset.supply);next.focus();
});
$('#briefing-back').addEventListener('click',closeMissionBriefing);
$('#field-order-options').addEventListener('click',event=>{const card=event.target.closest('[data-field-order]');if(card)selectCampaignFieldOrder(card.dataset.fieldOrder);});
$('#field-order-options').addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  const cards=[...$('#field-order-options').querySelectorAll('[data-field-order]')],current=cards.indexOf(document.activeElement);
  if(current<0||!cards.length)return;
  event.preventDefault();
  const next=cards[(current+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+cards.length)%cards.length];
  selectCampaignFieldOrder(next.dataset.fieldOrder);next.focus();
});
$('#briefing-deploy').addEventListener('click',()=>{
  if(briefingMissionIndex===null)return;
  const index=briefingMissionIndex;
  beginGame({mode:'campaign',missionIndex:index,difficulty:campaignDifficulty,fieldOrderId:campaignFieldOrderId,carryoverId:campaignCarryoverId,supplyId:campaignSupplyId});
});
$('#load-menu').addEventListener('click',()=>openSaveSlots('load'));
$('#recover-game').addEventListener('click',()=>{
  const recovery=loadSoloRecovery();
  if(!recovery){updateSoloRecoveryButton();return;}
  void loadSaved(recovery.data,true);
});
$('#how-to-menu').addEventListener('click',openManual);
$('#armory-menu').addEventListener('click',openArmory);
$('#power-grid-trigger').addEventListener('click',openPowerGrid);
$('#power-grid-close').addEventListener('click',closePowerGrid);
$('#power-grid-modal').addEventListener('click',event=>{if(event.target===$('#power-grid-modal'))closePowerGrid();});
$('#power-grid-list').addEventListener('click',event=>{
  const locate=event.target.closest('[data-locate-power-building]');
  if(locate){
    const building=game?.buildings.find(item=>String(item.id)===locate.dataset.locatePowerBuilding&&item.owner==='player'&&item.hp>0);
    if(!building){toast('BUILDING NO LONGER AVAILABLE',true);return;}
    game.select([building.id]);
    centerCamera(building.x+(building.w||0)/2,building.y+(building.h||0)/2);
    updateSelectionCard();
    closePowerGrid();
    return;
  }
  const button=event.target.closest('[data-power-building]');
  if(!button||button.disabled)return;
  const standby=button.dataset.standby==='true';
  setBuildingStandby(button.dataset.powerBuilding,standby);
});
$('#selection-card').addEventListener('click',event=>{
  const rosterToggle=event.target.closest('#selection-roster-toggle');
  if(rosterToggle&&!rosterToggle.classList.contains('hidden')){
    const expanded=rosterToggle.getAttribute('aria-expanded')!=='true';
    rosterToggle.setAttribute('aria-expanded',String(expanded));
    rosterToggle.setAttribute('aria-label',expanded?'Hide unit type roster':'Show unit type roster');
    return;
  }
  const rosterButton=event.target.closest('[data-selection-roster]');
  if(rosterButton&&!rosterButton.disabled){
    const ids=selectionRoster.choose(rosterButton.dataset.selectionRoster);
    if(!ids)return;
    cancelActiveTargeting();
    game.select(ids);
    updateUI(true);
    return;
  }
  const recommission=event.target.closest('[data-recommission-wreck]');
  if(recommission&&!recommission.disabled){startRecommissionTarget();return;}
  const button=event.target.closest('[data-selection-power]');
  if(!button||button.disabled)return;
  setBuildingStandby(button.dataset.selectionPower,button.dataset.standby==='true');
});
$('#armory').addEventListener('click',event=>{if(event.target===$('#armory'))closeTrackedDialog('#armory');});
$('#armory').addEventListener('keydown',event=>{if(event.key==='Tab')containModalTab(event,$('#armory'));});
$('#armory-list').addEventListener('click',event=>{const item=event.target.closest('[data-armory-item]');if(!item)return;armorySelected=item.dataset.armoryItem;renderArmory();$('#armory-list [data-armory-item="'+CSS.escape(armorySelected)+'"]')?.focus();});
document.querySelectorAll('[data-armory-faction]').forEach(button=>button.addEventListener('click',()=>{armoryFaction=button.dataset.armoryFaction;armorySelected='';renderArmory();}));
document.querySelectorAll('[data-armory-kind]').forEach(button=>button.addEventListener('click',()=>{armoryKind=button.dataset.armoryKind;armorySelected='';renderArmory();}));
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>{
  const id=`#${el.dataset.close}`;
  if(trackedDialogIds.includes(id))closeTrackedDialog(id);
  else hide(id);
}));
document.querySelectorAll('.faction-card').forEach(el=>el.addEventListener('click',()=>setFaction(el.dataset.faction)));
document.querySelectorAll('#difficulty-options button').forEach(el=>el.addEventListener('click',()=>setDifficulty(el.dataset.difficulty)));
document.querySelectorAll('#map-options button').forEach(el=>el.addEventListener('click',()=>setSkirmishMap(el.dataset.map)));
document.querySelectorAll('#opening-options button').forEach(el=>el.addEventListener('click',()=>setSkirmishOpening(el.dataset.opening)));
document.querySelectorAll('.victory-mode-option').forEach(el=>el.addEventListener('click',()=>setSkirmishVictoryMode(el.dataset.victoryMode)));
$('#launch-game').addEventListener('click',()=>beginGame({skirmishOpening,victoryMode:skirmishVictoryMode}));
$('#menu-toggle').addEventListener('click',()=>togglePause());
$('#mute-toggle').textContent=audio.muted?'♩':'♫';
$('#mute-toggle').addEventListener('click',()=>{audio.setMuted(!audio.muted);localStorage.setItem(AUDIO_KEY,String(audio.muted));$('#mute-toggle').textContent=audio.muted?'♩':'♫';if(!audio.muted)audio.play('confirm');});
$('#resume-game').addEventListener('click',()=>togglePause(false));
$('#graphics-quality-options').addEventListener('click',event=>{
  const button=event.target.closest('[data-graphics-quality]');
  if(button)selectGraphicsQuality(button.dataset.graphicsQuality);
});
renderGraphicsQuality();
$('#save-game').addEventListener('click',saveGame);
$('#save-slots-close').addEventListener('click',()=>closeSaveSlots());
$('#save-slots-cancel').addEventListener('click',()=>closeSaveSlots());
$('#save-slots-modal').addEventListener('click',event=>{if(event.target.id==='save-slots-modal')closeSaveSlots();});
$('#save-slots-modal').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeSaveSlots();return;}
  if(event.key!=='Tab')return;
  const controls=[...$('#save-slots-modal').querySelectorAll('button:not(:disabled)')].filter(button=>button.getClientRects().length);
  if(!controls.length)return;
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
$('#load-game').addEventListener('click',()=>openSaveSlots('load'));
$('#restart-game').addEventListener('click',()=>beginGame({mode:currentMode,missionIndex,difficulty,mapId:game?.mapId,skirmishOpening:game?.skirmishOpening,victoryMode:game?.victoryMode||skirmishVictoryMode,fieldOrderId:game?.campaignFieldOrderId||'none',carryoverId:game?.campaignCarryoverId||'none',supplyId:game?.campaignSupplyId||'none',routePayoffId:game?.campaignRoutePayoffId||'none',campaignVeteran:game?.campaignVeteran||null}));
$('#help-game').addEventListener('click',()=>{openManual();});
$('#quit-game').addEventListener('click',returnToMenu);
$('#end-next').addEventListener('click',()=>{
  const choices=campaignNextChoices(CAMPAIGN_MISSIONS[missionIndex]?.id);
  campaignDifficulty=difficulty;
  returnToMenu();
  openCampaign();
  if(choices.length!==1){
    $('#campaign-list .campaign-fork-heading')?.scrollIntoView({block:'center'});
    $('#campaign-list [data-mission="13"]')?.focus({preventScroll:true});
    return;
  }
  const nextIndex=campaignIndexById(choices[0]);
  if(nextIndex>=0)openMissionBriefing(nextIndex,$(`#campaign-list [data-mission="${nextIndex}"]`));
});
$('#end-restart').addEventListener('click',()=>{if(currentMode!=='multiplayer')beginGame({mode:currentMode,missionIndex,difficulty,mapId:game?.mapId,skirmishOpening:game?.skirmishOpening,victoryMode:game?.victoryMode||skirmishVictoryMode,fieldOrderId:game?.campaignFieldOrderId||'none',carryoverId:game?.campaignCarryoverId||'none',supplyId:game?.campaignSupplyId||'none',routePayoffId:game?.campaignRoutePayoffId||'none',campaignVeteran:game?.campaignVeteran||null});});
$('#end-replay').addEventListener('click',watchLastReplay);
$('#post-match-rematch-request').addEventListener('click',async()=>{
  if(!postMatchRematch||rematchRequestPending)return;
  rematchRequestPending=true;rematchStatus='Contacting your previous opponent…';renderPostMatchRematch();
  try{
    await ensureNetworkReady();
    if(!network.send('rematch_request',{matchId:postMatchRematch.matchId}))
      throw new Error('Command network unavailable. Try again after reconnecting.');
  }catch(error){rematchRequestPending=false;rematchStatus=error.message||'Rematch unavailable.';renderPostMatchRematch();}
});
document.querySelectorAll('[data-rematch-accept],[data-rematch-decline]').forEach(button=>button.addEventListener('click',()=>{
  if(!rematchOffer||rematchResponsePending)return;
  rematchResponsePending=true;renderRematchOffer();
  const accepted=button.hasAttribute('data-rematch-accept');
  if(!network.send(accepted?'rematch_accept':'rematch_decline',{requestId:rematchOffer.requestId})){
    rematchResponsePending=false;renderRematchOffer();
    networkFeedback('Command network unavailable. Reconnect before responding to the rematch.',true);
  }
}));
$('#post-match-add-opponent').addEventListener('click',async()=>{
  if(!postMatchOpponent||postMatchFriendRequestPending)return;
  const opponent=postMatchOpponent;
  postMatchFriendRequestPending=true;
  const button=$('#post-match-add-opponent');
  button.disabled=true;
  $('#post-match-opponent-status').textContent='Sending friend request…';
  try{
    await ensureNetworkReady();
    await network.requestFriend(opponent.code);
    if(postMatchOpponent!==opponent)return;
    opponent.status='sent';
    button.textContent='REQUEST SENT';
    $('#post-match-opponent-status').textContent=`Request sent to ${opponent.name}. They can accept it from Friends.`;
    refreshFriends().catch(()=>{});
  }catch(error){
    if(postMatchOpponent!==opponent)return;
    const detail=String(error.message||'Request unavailable.');
    if(/already friends/i.test(detail)){
      opponent.status='friends';
      button.textContent='ALREADY FRIENDS';
      $('#post-match-opponent-status').textContent=`${opponent.name} is already in your friends list.`;
    }else if(/request already sent/i.test(detail)){
      opponent.status='sent';
      button.textContent='REQUEST SENT';
      $('#post-match-opponent-status').textContent=`Your request to ${opponent.name} is pending.`;
    }else if(/already sent you a request/i.test(detail)){
      opponent.status='incoming';
      button.textContent='REQUEST RECEIVED';
      $('#post-match-opponent-status').textContent=`${opponent.name} has requested you. Open Multiplayer to accept.`;
    }else{
      button.disabled=false;
      $('#post-match-opponent-status').textContent=detail;
    }
  }finally{
    if(postMatchOpponent===opponent)postMatchFriendRequestPending=false;
  }
});
$('#end-menu').addEventListener('click',returnToMenu);
$('#replay-toggle').addEventListener('click',()=>togglePause());
$('#replay-speed').addEventListener('click',()=>{replaySpeed=({1:2,2:4,4:8,8:1})[replaySpeed]||1;replayAccumulator=0;updateReplayControls();});
$('#replay-track').addEventListener('input',requestReplaySeek);
$('#replay-moment-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-replay-moment]');
  if(!button||!activePlayback)return;
  const moment=replayMoments[Number(button.dataset.replayMoment)];
  if(!moment)return;
  $('#replay-track').value=String(Math.max(0,moment.tick-45));
  requestReplaySeek();
});
$('#replay-restart').addEventListener('click',()=>{
  if(!activePlayback)return;
  clearPendingFieldAbility();
  replaySeekTarget=null;$('#replay-seek-status').textContent='';
  game=activePlayback.reset();selectionRoster.reset();gameSeconds=0;replayAccumulator=0;paused=false;
  centerOnBase();updateUI(true);updateReplayControls();lastTime=performance.now();
});
$('#replay-exit').addEventListener('click',returnToMenu);
$('#campaign-guidance-dismiss').addEventListener('click',()=>{
  if(quickStartGuidance&&currentMode==='skirmish')quickStartGuidance=false;
  campaignGuidanceDismissedKey=$('#campaign-guidance').dataset.stage||campaignGuidanceKey;
  $('#campaign-guidance').classList.add('hidden');
});
$('#zoom-out').addEventListener('click',()=>changeZoom(-1));
$('#zoom-in').addEventListener('click',()=>changeZoom(1));
function setMobileRadarOpen(opened){
  $('#game-shell').classList.toggle('mobile-radar-open',opened);
  $('#mobile-radar-toggle').setAttribute('aria-expanded',String(opened));
  $('#mobile-radar-toggle').setAttribute('aria-label',opened?'Hide minimap':'Show minimap');
}
$('#mobile-radar-toggle').addEventListener('click',()=>setMobileRadarOpen(!$('#game-shell').classList.contains('mobile-radar-open')));
function setMobileDeckExpanded(expanded){
  const panel=$('#command-panel');
  const toggle=$('#mobile-deck-toggle');
  panel.classList.toggle('deck-collapsed',!expanded);
  toggle.setAttribute('aria-expanded',String(expanded));
  toggle.setAttribute('aria-label',expanded?'Focus battlefield and collapse command deck':'Expand command deck for production and selection');
  toggle.querySelector('.mobile-deck-toggle-label').textContent=expanded?'FIELD':'OPEN DECK';
  if(playing){
    resizeCanvases();
    if(expanded)updateProductionScrollCue();
  }
}
$('#mobile-deck-toggle').addEventListener('click',()=>setMobileDeckExpanded($('#command-panel').classList.contains('deck-collapsed')));
document.querySelectorAll('.tab').forEach(el=>el.addEventListener('click',()=>{if(tab!==el.dataset.tab)closeBlueprintDetails();tab=el.dataset.tab;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===el));renderProduction();}));
$('#radar-blueprint-link').addEventListener('click',()=>{
  setMobileDeckExpanded(true);
  tab='structures';
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  renderProduction(true);
  if($('#game-shell').classList.contains('mobile-radar-open'))setMobileRadarOpen(false);
  const blueprint=$('#production-list [data-build="radar"]');
  if(blueprint)requestAnimationFrame(()=>{
    blueprint.scrollIntoView({behavior:'auto',block:'start'});
    if(!blueprint.disabled)blueprint.focus({preventScroll:true});
  });
});
$('#relay-status-button').addEventListener('click',()=>{
  if(!game)return;
  setMobileDeckExpanded(true);
  tab='support';
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));
  renderProduction(true);
  const list=$('#production-list');
  const owned=game.relays.find(relay=>relay.owner==='player');
  const target=owned
    ? $(`#production-list [data-relay-protocol="${owned.id}"]`)?.closest('.relay-protocol-card')
    : $('#relay-protocol-heading');
  if(target){
    const listTop=list.getBoundingClientRect().top;
    const targetTop=target.getBoundingClientRect().top;
    const scrollTop=list.scrollTop+targetTop-listTop-12;
    list.scrollTo({top:scrollTop,behavior:'auto'});
  }
});
$('#production-list').addEventListener('scroll',updateProductionScrollCue,{passive:true});
$('#production-repeat-toggle').addEventListener('click',()=>{
  const toggle=$('#production-repeat-toggle'),wrap=$('#production-repeat-controls');
  const expanded=toggle.getAttribute('aria-expanded')!=='true';
  toggle.setAttribute('aria-expanded',String(expanded));
  wrap.classList.toggle('mobile-expanded',expanded);
  updateProductionSite();
  updateProductionScrollCue();
});
$('#production-repeat-apply').addEventListener('click',()=>{
  const site=selectedProductionSite();
  if(!site||paused||gameEnded||pendingProductionRepeat.has(site.id)||typeof game?.setProductionRepeat!=='function')return;
  const status=game.getProductionRepeatStatus?.(site.id)||{enabled:false,unitDefId:null};
  const requested=$('#production-repeat-unit').value||null;
  const stopping=status.enabled&&(!requested||requested===status.unitDefId);
  const unitDefId=stopping?null:requested;
  if(!stopping&&!unitDefId)return;
  const result=game.setProductionRepeat(site.id,unitDefId);
  if(result?.pending){
    const token=Symbol('production-repeat');
    pendingProductionRepeat.set(site.id,token);
    updateProductionSite();
    resultMessage(result,'','order',{
      onAccepted:()=>updateUI(true),
      onSettled:()=>{
        if(pendingProductionRepeat.get(site.id)!==token)return;
        pendingProductionRepeat.delete(site.id);
        updateUI(true);
      },
    });
  }else if(resultMessage(result,unitDefId?`AUTO TRAIN · ${game.unitDefs?.[unitDefId]?.name||keyName(unitDefId)}`:'AUTO TRAIN STOPPED')){
    updateUI(true);
  }
});
$('#production-repeat-unit').addEventListener('change',()=>{
  const site=selectedProductionSite();
  if(site)updateProductionRepeatControls(site);
});
$('#blueprint-view-toggle').addEventListener('click',()=>{
  compactBlueprintView=!compactBlueprintView;
  try { localStorage.setItem('cc-blueprint-view',compactBlueprintView?'grid':'list'); } catch {}
  updateBlueprintView();
  updateProductionScrollCue();
});
$('#production-scroll-cue').addEventListener('click',()=>$('#production-list').scrollBy({top:Math.max(90,$('#production-list').clientHeight-28),behavior:'smooth'}));
new ResizeObserver(updateProductionScrollCue).observe($('#production-list'));
$('#production-list').addEventListener('pointerdown',e=>{
  const info=e.target.closest('[data-blueprint-info]');
  if(!info||!game)return;
  // Income can rebuild the deck between pointer down and click. Prevent a
  // retargeted click from ordering the card underneath the former info button.
  blueprintPointerGuardUntil=performance.now()+750;
});
$('#production-list').addEventListener('click',e=>{
  const info=e.target.closest('[data-blueprint-info]');
  if(info&&game){
    e.preventDefault();e.stopPropagation();
    blueprintPointerGuardUntil=0;
    showBlueprintDetails(info.dataset.blueprintInfo,info.dataset.kind);
    return;
  }
  const cancel=e.target.closest('[data-cancel-queue]');
  if(cancel&&game){
    e.preventDefault();e.stopPropagation();
    const index=Number(cancel.dataset.queueIndex);
    if(Number.isSafeInteger(index)&&index>=0)resultMessage(game.cancelQueuedUnit(cancel.dataset.cancelQueue,index),'UNIT ORDER CANCELED');
    updateUI(true);return;
  }
  const btn=e.target.closest('[data-build],[data-support],[data-ability],[data-doctrine],[data-tactical],[data-relay-protocol]');if(!btn||!game)return;
  if(performance.now()<blueprintPointerGuardUntil){e.preventDefault();e.stopPropagation();blueprintPointerGuardUntil=0;return;}
  if(btn.dataset.relayProtocol){
    resultMessage(game.setRelayProtocol(btn.dataset.relayProtocol,btn.dataset.nextProtocol),'RELAY PROTOCOL SWITCHED');
    updateUI(true);return;
  }
  if(btn.dataset.doctrine){
    const research=DOCTRINE_DEFS[btn.dataset.doctrine];
    const replacing=!!game.research?.player?.doctrine;
    resultMessage(game.chooseDoctrine(btn.dataset.doctrine),
      replacing?`${research?.name||'Doctrine'} adaptation underway; current focus remains active`:
        `${research?.name||'Research'} underway`);
    updateUI(true);
    return;
  }
  if(btn.dataset.tactical){
    const tactical=TACTICAL_PACKAGE_DEFS[btn.dataset.tactical];
    resultMessage(game.chooseTacticalPackage(btn.dataset.tactical),`${tactical?.name||'Tactical package'} underway`);
    updateUI(true);
    return;
  }
  if(btn.dataset.ability){startCommandAbility(btn.dataset.ability);return;}
  if(btn.dataset.support){const action=btn.dataset.support;
    if(action==='center')centerOnBase();else if(action==='manual')openManual();else if(action==='armory')openArmory();else if(action==='power-grid')openPowerGrid();else if(action==='super')startTargetOrder('super','STRATEGIC STRIKE');
    else if(action==='sell'){const b=selectedBuilding();if(!b)toast('SELECT A STRUCTURE',true);else if(game.sellBuilding)resultMessage(game.sellBuilding(b.id),'STRUCTURE SOLD');else toast('SELL UNAVAILABLE',true);}return;
  }
  const id=btn.dataset.build;
  if(btn.dataset.kind==='structures'){
    if(game.construction?.defId===id&&!game.construction.ready){toast('CONSTRUCTION IN PROGRESS');}
    else if(game.construction?.defId===id&&game.construction.ready){setRoutePlanMode(false);placeId=id;placementToken++;placementPending=false;setPlacementHint();show('#placement-hint');syncTargetingFocus();toast('SELECT A BUILD SITE');}
    else {const r=game.startConstruction?game.startConstruction(id):{ok:true};resultMessage(r,`Constructing ${game.buildingDefs?.[id]?.name||keyName(id)}`);}
  } else {
    const site=selectedProductionSite();
    resultMessage(site?game.queueUnit(id,site.id):game.queueUnit(id),`Training ${game.unitDefs?.[id]?.name||keyName(id)}${site?` at ${game.buildingDefs[site.defId].name}`:''}`);
  }
  updateUI(true);
});
$('#blueprint-details-close').addEventListener('click',()=>closeBlueprintDetails(true));
$('#production-list').addEventListener('contextmenu',e=>{
  const btn=e.target.closest('[data-build]');if(!btn||!game)return;e.preventDefault();
  const id=btn.dataset.build;
  if(btn.dataset.kind==='structures'&&game.construction?.defId===id){resultMessage(game.cancelConstruction(),'CONSTRUCTION CANCELED');cancelPlacement(false);}
  else if(btn.dataset.kind==='units'){
    const view=unitProductionView(id);
    if(view.producer)resultMessage(game.cancelQueuedUnit(view.producer.id,view.queueIndex),'UNIT ORDER CANCELED');
  }
  updateUI(true);
});
$('#promotion-trigger').addEventListener('click',()=>{
  const selected=selectedObjects();
  if(selected.length===1)openPromotion(selected[0]);
});
$('#promotion-close').addEventListener('click',()=>closeTrackedDialog('#promotion-modal'));
$('#promotion-modal').addEventListener('click',event=>{
  const option=event.target.closest('[data-promotion]');
  if(!option||!game||promotionPending||!promotionUnitId)return;
  const unit=game.getEntity?.(promotionUnitId);
  if(!promotionEligible(unit)){
    toast('THIS UNIT CAN NO LONGER BE MODIFIED',true);
    closeTrackedDialog('#promotion-modal');
    return;
  }
  const id=promotionUnitId, choice=option.dataset.promotion;
  if(!game.issuePromoteUnit){toast('FIELD MODIFICATIONS UNAVAILABLE',true);return;}
  const token=promotionToken;
  const result=game.issuePromoteUnit(id,choice);
  if(result?.pending){
    promotionPending=true;
    for(const button of document.querySelectorAll('#promotion-modal [data-promotion]'))button.disabled=true;
    $('#promotion-live-note').textContent='Waiting for match confirmation…';
  }
  const accepted=resultMessage(result,`${choice==='bulwark'?'BULWARK':'RANGEFINDER'} FIELD MOD INSTALLED`,'unitReady',{
    onAccepted:()=>{if(promotionToken===token&&promotionUnitId===id){closeTrackedDialog('#promotion-modal');updateUI(true);}},
    onSettled:ack=>{if(!ack?.ok&&promotionToken===token&&promotionUnitId===id){promotionPending=false;for(const button of document.querySelectorAll('#promotion-modal [data-promotion]'))button.disabled=false;$('#promotion-live-note').textContent='Choose a field modification to continue.';}}
  });
  if(!result?.pending&&accepted){closeTrackedDialog('#promotion-modal');updateUI(true);}
});
$('#cmd-attack').addEventListener('click',()=>{
  if(selectedProductionBuilding()){
    closeBlueprintDetails();tab='units';
    document.querySelectorAll('.tab').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));
    setMobileDeckExpanded(true);updateUI(true);
  }else startAttackTargetOrder();
});
function activateMoveOrRally(){
  if(selectedFieldBunker()){issueBunkerCommand(selectedFieldBunker().id,'evacuate');return;}
  startTargetOrder(selectedProductionBuilding()?'rally':'forceMove',selectedProductionBuilding()?'RALLY POINT':'FORCE MOVE');
}
$('#cmd-move').addEventListener('click',activateMoveOrRally);
$('#production-site-auto').addEventListener('click',()=>{
  game?.select([]);updateUI(true);
  $('#production-list [data-build]:not(:disabled)')?.focus({preventScroll:true});
});
$('#cmd-reverse').addEventListener('click',()=>startTargetOrder('reverseMove','REVERSE MOVE'));
$('#match-pace-toggle').addEventListener('click',()=>{
  if(!playing||paused||!matchPaceAvailable())return;
  matchPaceMode=!matchPaceMode;
  updateSelectionCard();
});
$('#formation-select').addEventListener('change',event=>{
  if(!formationPreviewAvailable()){
    selectedFormation='';event.currentTarget.value='';updateFormationControl(selectedObjects());return;
  }
  selectedFormation=['line','column','screen'].includes(event.currentTarget.value)?event.currentTarget.value:'';
  formationPreviewCache={key:'',at:0,preview:null};
  refreshFormationTargetHint();
});
$('#route-plan-toggle').addEventListener('click',()=>{
  if(game&&playing&&!paused&&!replayMode)setRoutePlanMode(!routePlanMode);
});
$('#command-actions').addEventListener('click',event=>{
  if(routePlanMode&&event.target.closest('button:not(#cmd-attack):not(#cmd-move):not(#cmd-reverse)'))setRoutePlanMode(false);
},true);
$('#cmd-guard').addEventListener('click',activateGuardCommand);
$('#cmd-patrol').addEventListener('click',()=>startTargetOrder('patrol','PATROL'));
$('#cmd-follow').addEventListener('click',startFollowOrder);
$('#cmd-service').addEventListener('click',()=>{
  const engineers=selectedKitEngineers();
  if(engineers.length&&engineers.length===selectedObjects().length){
    resultMessage(game.issueRefillRepairKits(),'RETURNING FOR PAID KIT REFILLS');updateUI(true);
  }else startTargetOrder('service','SERVICE','SELECT FRIENDLY FIELD WORKSHOP');
});
$('#cmd-board').addEventListener('click',()=>startTargetOrder('board','BOARD','SELECT FRIENDLY CARRIER OR FIELD BUNKER'));
$('#cmd-unload').addEventListener('click',()=>startTargetOrder('unload','UNLOAD','SELECT DROP SITE'));
$('#cmd-stop').addEventListener('click',()=>resultMessage(game?.issueStop?.()));
$('#cmd-harvest').addEventListener('click',()=>{
  if($('#cmd-harvest').classList.contains('bloom-command'))
    resultMessage(game?.issueBloomExpedition?.(),'STORMGLASS EXPEDITION ORDERED');
  else resultMessage(game?.issueHarvest?.(),'HARVEST ORDERED');
});
function returnSelection(){
  if(!game)return;
  const selected=selectedObjects();
  const cargo=selected.some(unit=>unit.defId==='harvester'&&unit.cargo>0);
  const air=selected.some(unit=>game.unitDefs?.[unit.defId]?.flying&&Number.isFinite(game.unitDefs?.[unit.defId]?.ammoMax));
  resultMessage(!cargo&&air?game.issueRearm():game.issueReturnCargo(),!cargo&&air?'GUNSHIPS RETURNING TO REARM':'HARVESTER RETURNING CARGO');
}
$('#cmd-return').addEventListener('click',returnSelection);
$('#cmd-repair').addEventListener('click',activateRepairCommand);
$('#battlefield-picker-toggle').addEventListener('click',()=>setBattlefieldPickerOpen(!battlefieldPickerIsOpen(),{focusFirst:!battlefieldPickerIsOpen()}));
$('#battlefield-picker-add-squad').addEventListener('click',()=>setBattlefieldPickerAddSquadMode(!battlefieldPickerAddSquadMode));
$('#battlefield-picker-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-battlefield-object]');
  if(button)activateBattlefieldObject(button.dataset.battlefieldObject,{additive:event.shiftKey});
});
$('#battlefield-picker-list').addEventListener('keydown',event=>{
  const options=[...$('#battlefield-picker-list').querySelectorAll('button[data-battlefield-object]')];
  const index=options.indexOf(event.target.closest('button[data-battlefield-object]'));
  if(index<0||!options.length)return;
  if(event.key==='Enter'&&event.shiftKey){
    event.preventDefault();
    activateBattlefieldObject(options[index].dataset.battlefieldObject,{additive:true});
    return;
  }
  let next=-1;
  if(event.key==='ArrowDown')next=(index+1)%options.length;
  else if(event.key==='ArrowUp')next=(index-1+options.length)%options.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=options.length-1;
  if(next>=0){event.preventDefault();options[next].focus();}
});
$('#cmd-scatter').addEventListener('click',()=>resultMessage(game?.issueScatter?.(),'SQUAD SCATTERED'));
$('#cmd-force').addEventListener('click',()=>startTargetOrder('force','FORCE FIRE'));
$('#cmd-stance').addEventListener('click',cycleStance);
$('#target-priority-select').addEventListener('change',event=>setTargetPriority(event.currentTarget.value));
function activateFieldAbilityOrDeploy(){
  if(!game||!playing||paused||replayMode||gameEnded)return;
  const button=$('#cmd-deploy');
  if(button.dataset.digIn==='true'){
    startDigInTargeting();
    return;
  }
  if(button.dataset.recommissionWreck==='true'){
    startRecommissionTarget();
    return;
  }
  const abilityId=button.dataset.unitAbility;
  if(abilityId){
    if(pendingFieldAbility)return;
    const cohort=getFieldAbilityCohort(game);
    if(!cohort||cohort.abilityId!==abilityId)return;
    if(cohort.ids.some(id=>fieldAbilityLocks.has(id)))return;
    if(!cohort.readyIds.length){
      if(abilityId==='ghostRun'&&cohort.needsMoveIds.length)startTargetOrder('forceMove','MOVE TO ARM');
      return;
    }
    const label=abilityId==='brace'?'BRACE':'GHOST RUN';
    const successLabel=cohort.ids.length===1
      ?abilityId==='brace'?'GUARDIAN BRACED':'SPECTER GHOST RUN':null;
    if(currentMode==='multiplayer'){
      const result=game.useSelectedUnitAbility?.(abilityId)||{ok:false,reason:'Field ability command unavailable.'};
      if(result?.ok===false){toast(result.reason||'Field ability unavailable.',true);audio.play('error');return;}
      if(result?.pending&&result.acknowledgement){
        const token=fieldAbilityContextToken;
        pendingFieldAbility={abilityId,token};
        updateSelectionCard();
        result.acknowledgement.then(ack=>{
          const current=pendingFieldAbility;
          if(!current||current.token!==token||fieldAbilityContextToken!==token||currentMode!=='multiplayer')return;
          pendingFieldAbility=null;
          if(!ack?.ok){
            toast(ack?.transportFailure?'Field ability confirmation was lost. Check the battlefield before retrying.':ack?.reason||'Field ability was not accepted by the server.',true);
            audio.play('error');
          }else{
            lockFieldAbilityIds(ack.activatedIds,abilityId);
            const activated=Array.isArray(ack.activatedIds)?ack.activatedIds.length:0;
            const skipped=Array.isArray(ack.skippedIds)?ack.skippedIds.length:0;
            toast(successLabel||`${label} · ${activated} ACTIVATED${skipped?` · ${skipped} SKIPPED`:''}`);
            audio.play('order');
          }
          if(game&&playing)updateSelectionCard();
        }).catch(()=>{
          const current=pendingFieldAbility;
          if(!current||current.token!==token||fieldAbilityContextToken!==token||currentMode!=='multiplayer')return;
          pendingFieldAbility=null;
          toast('Field ability confirmation was lost. Check the battlefield before retrying.',true);
          audio.play('error');
          if(game&&playing)updateSelectionCard();
        });
      }
    }else{
      const result=activateSelectedUnitAbility(game,abilityId);
      if(result?.ok===false){toast(result.reason||'Field ability unavailable.',true);audio.play('error');}
      else{
        const activated=Array.isArray(result?.activatedIds)?result.activatedIds.length:0;
        const skipped=Array.isArray(result?.skippedIds)?result.skippedIds.length:0;
        toast(successLabel||`${label} · ${activated} ACTIVATED${skipped?` · ${skipped} SKIPPED`:''}`);
        audio.play('order');
      }
      updateSelectionCard();
    }
  }else resultMessage(game.issueDeploy?.(),'COMMAND RIG DEPLOYED');
}
$('#cmd-deploy').addEventListener('click',activateFieldAbilityOrDeploy);
$('#command-actions').addEventListener('click',event=>{
  if(digInMode&&!event.target.closest('#cmd-deploy'))cancelDigInTargeting();
},true);
$('#battlefield-wrap').addEventListener('click',event=>{
  if(digInMode&&event.target.closest('button'))cancelDigInTargeting();
},true);

canvas.addEventListener('pointermove',e=>{
  if(e.pointerType==='touch'&&touchPointerId!==e.pointerId)return;
  setPointer(e);
  if(pointer.pan||pointer.touchPan&&pointer.down){
    if(pointer.touchPan&&!pointer.touchMoved&&!pointer.touchSelecting&&Math.hypot(pointer.x-pointer.sx,pointer.y-pointer.sy)>8){
      // A deliberate hold then drag selects a squad; an immediate drag pans.
      if(performance.now()-pointer.touchStartedAt>=420&&!placeId&&!commandAbilityMode&&!attackMoveMode&&!digInMode){
        pointer.touchSelecting=true;pointer.dragging=true;
      }else pointer.touchMoved=true;
    }
    if(pointer.touchSelecting)return;
    if(pointer.pan||pointer.touchMoved)panCameraByScreen(e.clientX-pointer.panX,e.clientY-pointer.panY);
    pointer.panX=e.clientX;pointer.panY=e.clientY;
    if(pointer.touchMoved)setPointer(e);
  }else if(pointer.down&&!digInMode&&Math.hypot(pointer.x-pointer.sx,pointer.y-pointer.sy)>5)pointer.dragging=true;
});
canvas.addEventListener('pointerleave',()=>{
  if(pointer.down)return;
  pointer.inside=false;
  $('#coord-label').textContent='SECTOR -- // --';
});
canvas.addEventListener('pointerdown',e=>{
  if(!game||paused||replayMode)return;
  if(e.pointerType==='touch'){
    if(touchPointerId!==null)return;
    touchPointerId=e.pointerId;
  }
  setPointer(e);
  if(e.button===1){pointer.pan=true;pointer.panX=e.clientX;pointer.panY=e.clientY;canvas.setPointerCapture(e.pointerId);return;}
  if(e.button!==0)return;
  pointer.down=true;pointer.dragging=false;pointer.forceMove=e.altKey&&!placeId&&!commandAbilityMode&&!attackMoveMode&&!digInMode;
  pointer.touchPan=e.pointerType==='touch';pointer.touchMoved=false;pointer.touchSelecting=false;
  pointer.touchStartedAt=pointer.touchPan?performance.now():0;
  pointer.panX=e.clientX;pointer.panY=e.clientY;pointer.sx=pointer.x;pointer.sy=pointer.y;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup',e=>{
  if(e.pointerType==='touch'){
    if(touchPointerId!==e.pointerId)return;
    touchPointerId=null;
  }
  if(!game||paused||replayMode){pointer.down=false;pointer.pan=false;pointer.dragging=false;pointer.forceMove=false;pointer.touchPan=false;pointer.touchMoved=false;pointer.touchSelecting=false;return;}
  setPointer(e);
  if(pointer.pan){pointer.pan=false;return;}
  if(e.button!==0||!pointer.down)return;
  pointer.down=false;
  if(pointer.touchPan){
    const moved=pointer.touchMoved,selecting=pointer.touchSelecting;
    pointer.touchPan=false;pointer.touchMoved=false;pointer.touchSelecting=false;
    if(selecting){selectBox(pointer.sx,pointer.sy,pointer.x,pointer.y,false);pointer.dragging=false;return;}
    if(moved)return;
  }
  if(pointer.forceMove){pointer.forceMove=false;pointer.dragging=false;const queue=e.shiftKey||routePlanMode;resultMessage(issueForceMoveCommand(pointer.wx,pointer.wy,queue),queue?'FORCE MOVE QUEUED':'FORCE MOVE ORDERED');return;}
  if(pointer.dragging){selectBox(pointer.sx,pointer.sy,pointer.x,pointer.y,e.shiftKey);pointer.dragging=false;return;}
  if(placeId){attemptPlacement(pointer.wx,pointer.wy);return;}
  if(digInMode){
    issueDigInAt(pointer.wx,pointer.wy);
    return;
  }
  if(commandAbilityMode){if(commandAbilityPending)return;const id=commandAbilityMode,token=commandAbilityToken;const result=game.useCommandAbility(id,pointer.wx,pointer.wy);if(result?.pending){commandAbilityPending=true;$('#attack-hint').innerHTML=`${COMMAND_ABILITIES[id].name.toUpperCase()} · WAITING FOR SERVER CONFIRMATION${targetingCancelCopy()}`;resultMessage(result,`${COMMAND_ABILITIES[id].name.toUpperCase()} DEPLOYED`,id==='stormcall'?'stormcall':'order',{onAccepted:()=>{if(commandAbilityToken===token&&commandAbilityMode===id){cancelCommandAbility();updateUI(true);}},onSettled:ack=>{if(commandAbilityToken===token&&commandAbilityMode===id){commandAbilityPending=false;if(!ack?.ok){if(ack?.transportFailure)cancelCommandAbility();else $('#attack-hint').innerHTML=`${COMMAND_ABILITIES[id].name.toUpperCase()} · ORDER REJECTED · SELECT TARGET${targetingCancelCopy()}`;}}}});}else if(resultMessage(result,`${COMMAND_ABILITIES[id].name.toUpperCase()} DEPLOYED`,id==='stormcall'?'stormcall':'order')){cancelCommandAbility();updateUI(true);}return;}
  if(attackMoveMode){issueTargetOrder(pointer.wx,pointer.wy,e.shiftKey||routePlanMode);return;}
  if(e.pointerType==='touch'&&routePlanMode){issueContext(pointer.wx,pointer.wy,true);return;}
  if(e.ctrlKey&&selectedObjects().some(o=>game.unitDefs?.[o.defId]?.weapon)){resultMessage(game.issueForceFire(pointer.wx,pointer.wy),'FORCE FIRE ORDERED');return;}
  selectAt(pointer.wx,pointer.wy,e.shiftKey);
});
canvas.addEventListener('pointercancel',e=>{
  if(e.pointerType==='touch'){
    if(touchPointerId!==e.pointerId)return;
    touchPointerId=null;
  }
  pointer.down=false;pointer.dragging=false;pointer.pan=false;pointer.forceMove=false;pointer.touchPan=false;pointer.touchMoved=false;pointer.touchSelecting=false;
});
canvas.addEventListener('contextmenu',e=>{e.preventDefault();if(!game||paused||replayMode||pointer.touchPan||pointer.touchSelecting)return;setPointer(e);issueContext(pointer.wx,pointer.wy,e.shiftKey);});
canvas.addEventListener('wheel',e=>{e.preventDefault();if(!game)return;const p=eventPoint(e);changeZoom(e.deltaY<0?1:-1,p.x,p.y);},{passive:false});
const cameraPanOffsets={up:[0,-1],left:[-1,0],down:[0,1],right:[1,0]};
const cameraKeyDirections={KeyW:'up',KeyA:'left',KeyS:'down',KeyD:'right',KeyQ:'left',ArrowUp:'up',ArrowLeft:'left',ArrowDown:'down',ArrowRight:'right'};
function nudgeCamera(direction,tiles=3){
  if(!game)return;
  const [dx,dy]=cameraPanOffsets[direction];
  panCameraByScreen(-dx*tiles*TILE_SIZE,-dy*tiles*TILE_SIZE);
}
document.querySelectorAll('[data-camera-pan]').forEach(button=>{
  const direction=button.dataset.cameraPan;
  const heldKey=`Pan${direction[0].toUpperCase()}${direction.slice(1)}`;
  button.addEventListener('pointerdown',event=>{
    if(!game||!playing||paused)return;
    panKeys.add(heldKey);
    button.setPointerCapture(event.pointerId);
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])
    button.addEventListener(type,()=>panKeys.delete(heldKey));
  button.addEventListener('click',()=>{
    if(!game||!playing||paused)return;
    nudgeCamera(direction);
  });
});
minimap.addEventListener('pointerdown',e=>{
  if(!game)return;
  const r=minimap.getBoundingClientRect();
  if(!game.radar?.player&&!missionUplinkTargets().length){
    const drop=game.salvageDrop;
    const markerX=r.left+(drop?.x||0)/game.width*r.width;
    const markerY=r.top+(drop?.y||0)/game.height*r.height;
    if(drop&&['incoming','active'].includes(drop.phase)&&
      Math.hypot(e.clientX-markerX,e.clientY-markerY)<=14){centerCamera(drop.x,drop.y);return;}
    toast('RADAR OFFLINE · BUILD RADAR ARRAY',true);return;
  }
  centerCamera((e.clientX-r.left)/r.width*game.width,(e.clientY-r.top)/r.height*game.height);
});
$('.command-panel').addEventListener('click',e=>{if(replayMode){e.preventDefault();e.stopPropagation();}},true);
$('#mobile-squads').addEventListener('click',e=>{
  const toggle=e.target.closest('#mobile-squads-toggle');
  if(toggle){
    const expanded=toggle.getAttribute('aria-expanded')==='true';
    setSquadControlsExpanded(!expanded);
    return;
  }
  const assign=e.target.closest('[data-squad-assign]');
  const recall=e.target.closest('[data-squad-recall]');
  if(!game||!playing||paused||replayMode||(!assign&&!recall))return;
  if(assign){
    const digit=assign.dataset.squadAssign;
    if(!(game.selection||[]).length)return;
    groups[digit]=[...game.selection];
    toast(`SQUAD ${digit} ASSIGNED`);
  }else{
    const digit=recall.dataset.squadRecall;
    const alive=new Set([...game.units,...game.buildings].filter(entity=>entity.hp>0).map(entity=>entity.id));
    const ids=(groups[digit]||[]).filter(id=>alive.has(id));
    if(!ids.length)return;
    game.select(ids);
    const members=selectedObjects();
    if(members.length)centerCamera(
      members.reduce((sum,member)=>sum+member.x+(member.w||0)/2,0)/members.length,
      members.reduce((sum,member)=>sum+member.y+(member.h||0)/2,0)/members.length);
  }
  if(matchMedia('(max-width: 670px) and (max-height: 719px)').matches)setSquadControlsExpanded(false);
  updateSelectionCard();
});
window.addEventListener('keydown',e=>{
  const openTracked = trackedDialogIds.find(id => !$(id).classList.contains('hidden'));
  if (openTracked) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (openTracked === '#multiplayer-modal') pendingJoinCode = null;
      closeTrackedDialog(openTracked);
    } else if (e.key === 'Tab') containModalTab(e, $(openTracked));
    return;
  }
  if (!$('#save-slots-modal').classList.contains('hidden')) return;
  if (!$('#pause-modal').classList.contains('hidden')) {
    if (e.key === 'Escape') { e.preventDefault(); togglePause(false); }
    else if (e.key === 'Tab') containModalTab(e, $('#pause-modal'));
    return;
  }
  if (!$('#end-modal').classList.contains('hidden')) {
    if (e.key === 'Tab') containModalTab(e, $('#end-modal'));
    return;
  }
  if(!$('#campaign-select').classList.contains('hidden')){
    const briefingOpen=!$('#mission-briefing').classList.contains('hidden');
    if(e.key==='Escape'){e.preventDefault();briefingOpen?closeMissionBriefing():closeCampaign();return;}
    if(e.key==='Tab'){
      const scope=briefingOpen?$('#mission-briefing'):$('#campaign-panel');
      const scoped=[...scope.querySelectorAll('button:not(:disabled):not([tabindex="-1"]),select,[href],input,[tabindex]:not([tabindex="-1"])')];
      const controls=briefingOpen?[$('#campaign-select .modal-close'),...scoped]:scoped;
      const visible=controls.filter(el=>!el.closest('.hidden')&&el.getClientRects().length);
      const first=visible[0],last=visible.at(-1),active=document.activeElement;
      if(visible.length&&(e.shiftKey&&(active===first||!scope.contains(active)&&active!==$('#campaign-select .modal-close')))){e.preventDefault();last.focus();}
      else if(visible.length&&(!e.shiftKey&&(active===last||!scope.contains(active)&&active!==$('#campaign-select .modal-close')))){e.preventDefault();first.focus();}
    }
    return;
  }
  if(e.key==='Escape'&&matchMedia('(max-width: 670px)').matches&&$('#ai-profile-badge').classList.contains('is-expanded')){
    e.preventDefault();
    resetAiProfileDisclosure();
    return;
  }
  if(e.key==='Escape'&&battlefieldPickerIsOpen()){
    e.preventDefault();setBattlefieldPickerOpen(false,{restoreFocus:true});return;
  }
  if(e.key==='Escape'&&blueprintInspect){e.preventDefault();closeBlueprintDetails(true);return;}
  if(e.code==='KeyO'&&playing&&!paused&&
    !e.target.closest?.('input,select,textarea,[contenteditable="true"]')){
    e.preventDefault();
    setBattlefieldPickerOpen(!battlefieldPickerIsOpen(),{focusFirst:!battlefieldPickerIsOpen(),restoreFocus:true});
    return;
  }
  if(replayMode&&playing){
    if(e.key==='Escape'){e.preventDefault();returnToMenu();return;}
    if(e.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;
    if(e.target.closest?.('#replay-controls'))return;
    if(['KeyW','KeyA','KeyS','KeyD','KeyQ'].includes(e.code)){
      e.preventDefault();if(!e.repeat)nudgeCamera(cameraKeyDirections[e.code],.75);panKeys.add(e.code);
      return;
    }
    if(e.target.closest?.('button,a,summary,[role="button"]'))return;
    if(e.code==='Space'){e.preventDefault();togglePause();return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){
      e.preventDefault();if(!e.repeat)nudgeCamera(cameraKeyDirections[e.code],.75);panKeys.add(e.code);
    }
    return;
  }
  if(e.key==='Escape'){if(!$('#manual').classList.contains('hidden'))closeManual();else if(!$('#setup').classList.contains('hidden'))closeSetup();else if(!cancelActiveTargeting()&&playing)togglePause();return;}
  if(!playing||paused||e.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;
  if(['KeyW','KeyA','KeyS','KeyD','KeyQ'].includes(e.code)&&
    !(e.shiftKey&&['KeyA','KeyS'].includes(e.code))){
    e.preventDefault();if(!e.repeat)nudgeCamera(cameraKeyDirections[e.code],.75);panKeys.add(e.code);return;
  }
  if(e.code==='KeyA'&&e.shiftKey&&!e.repeat){e.preventDefault();panKeys.delete(e.code);startAttackTargetOrder();return;}
  if(e.code==='KeyS'&&e.shiftKey&&!e.repeat){e.preventDefault();panKeys.delete(e.code);resultMessage(game.issueStop(),'ORDERS STOPPED');return;}
  if(e.target.closest?.('button,a,summary,[role="button"]'))return;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)){
    e.preventDefault();if(!e.repeat)nudgeCamera(cameraKeyDirections[e.code],.75);panKeys.add(e.code);return;
  }
  if(e.code==='Space')e.preventDefault();
  if(e.code==='Space')centerOnBase();
  if(e.code==='KeyG')activateGuardCommand();
  if(e.code==='KeyP')startTargetOrder('patrol','PATROL');
  if(e.code==='KeyF')startFollowOrder();
  if(e.code==='KeyL'&&selectedObjects().some(o=>game.unitDefs?.[o.defId]?.armor==='infantry'))startTargetOrder('board','BOARD','SELECT FRIENDLY CARRIER OR FIELD BUNKER');
  if(e.code==='KeyU'&&selectedObjects().some(o=>isTroopCarrier(o)&&o.passengerIds?.length))startTargetOrder('unload','UNLOAD','SELECT DROP SITE');
  if(e.code==='KeyV')startTargetOrder('force','FORCE FIRE');
  if(e.code==='KeyM'){
    if(e.shiftKey&&reverseMoveUnits().length)startTargetOrder('reverseMove','REVERSE MOVE');
    else if(!e.shiftKey)activateMoveOrRally();
  }
  if(e.code==='KeyN'){e.preventDefault();if(!e.repeat)cycleUnits();}
  if(e.code==='KeyH'){
    if(e.shiftKey)resultMessage(game.issueBloomExpedition?.()||{ok:false,reason:'Stormglass expeditions are unavailable.'},'STORMGLASS EXPEDITION ORDERED');
    else resultMessage(game.issueHarvest(),'HARVEST ORDERED');
  }
  if(e.code==='KeyJ')returnSelection();
  if(e.code==='KeyX')resultMessage(game.issueScatter(),'SQUAD SCATTERED');
  if(e.code==='KeyT'&&!e.repeat){e.preventDefault();cycleStance();}
  if(e.code==='KeyE'&&!e.repeat&&($('#cmd-deploy').dataset.unitAbility||$('#cmd-deploy').dataset.digIn==='true'||selectedObjects().some(o=>o.defId==='mcv')))
    activateFieldAbilityOrDeploy();
  if(e.code==='KeyR'){
    activateRepairCommand();
  }
  if(e.code==='KeyB'&&!isFixedForceOperation()){tab='structures';document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===tab));renderProduction();}
  if(e.code.startsWith('Digit')){const digit=e.code.slice(5);if(digit==='0')return;if(e.ctrlKey){groups[digit]=[...(game.selection||[])];toast(`SQUAD ${digit} ASSIGNED`);updateMobileSquads();}else if(groups[digit]){game.select(groups[digit].filter(id=>[...game.units,...game.buildings].some(o=>o.id===id)));const first=selectedObjects()[0];if(first&&e.shiftKey)centerCamera(first.x,first.y);updateSelectionCard();}}
});
window.addEventListener('keyup',e=>{panKeys.delete(e.code);if(e.key==='Shift')shiftHeld=false;});
window.addEventListener('keydown',e=>{if(e.key==='Shift')shiftHeld=true;},true);
window.addEventListener('blur',()=>{panKeys.clear();shiftHeld=false;touchPointerId=null;pointer.down=false;pointer.pan=false;pointer.forceMove=false;pointer.touchPan=false;pointer.touchMoved=false;pointer.touchSelecting=false;});
window.addEventListener('resize',()=>{placeSquadControlBar();if(playing)resizeCanvases();});
ensureNetworkReady().catch(()=>{});
updateReplayAvailability();
updateSoloRecoveryButton();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') checkpointSoloRecovery();
  if (document.visibilityState !== 'visible') recentFrameTimes.length = 0;
  refreshFrameRateReadout();
});
window.addEventListener('pagehide', checkpointSoloRecovery);
requestAnimationFrame(frame);
