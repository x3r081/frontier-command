/** Small, original Web Audio soundscape for game feedback. No media files required. */
export class AudioSystem {
  constructor({ volume = 0.36, muted = false } = {}) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = Boolean(muted);
    this.context = null;
    this.master = null;
    this.unlocked = false;
    this.ambientWanted = false;
    this.ambient = null;
    this.musicTimer = null;
    this.musicVoices = new Set();
    this.musicStep = 0;
    this.mood = { combat: 0, storm: 0 };
    this.musicBlend = { combat: 0, storm: 0 };
    this.noiseBuffer = null;
    this.lastPlayed = new Map();
    this.activeVoices = 0;

    // Creating the AudioContext waits for an actual pointer or keyboard gesture.
    this._onGesture = () => this.unlock();
    if (globalThis.document?.addEventListener) {
      for (const type of ['pointerdown', 'keydown', 'touchstart']) {
        document.addEventListener(type, this._onGesture, { capture: true, passive: true });
      }
    }
  }

  _removeGestureListeners() {
    if (!globalThis.document?.removeEventListener) return;
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      document.removeEventListener(type, this._onGesture, true);
    }
  }

  /** Safe to call explicitly inside a button/pointer handler. */
  unlock() {
    if (this.unlocked) {
      if (this.context?.state === 'suspended') {
        this.context.resume().then(() => this._scheduleMusic()).catch(() => {});
      }
      return true;
    }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return false;
    try {
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.context.destination);
      this.unlocked = true;
      this._removeGestureListeners();
      if (this.context.state === 'suspended') this.context.resume().then(() => this._scheduleMusic()).catch(() => {});
      if (this.ambientWanted && !this.muted) this._startAmbient();
      return true;
    } catch {
      this.context = null;
      this.master = null;
      return false;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, now, 0.025);
    if (this.muted) this._stopAmbient();
    else if (this.ambientWanted) this._startAmbient();
  }

  _tone({ frequency, end = frequency, duration = 0.1, gain = 0.12,
    type = 'sine', delay = 0, attack = 0.006 }) {
    if (!this.context || this.activeVoices >= 28) return;
    const ctx = this.context;
    const now = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, frequency), now);
    if (end !== frequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), now + duration);
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + Math.min(attack, duration * 0.45));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(envelope).connect(this.master);
    this.activeVoices++;
    oscillator.onended = () => {
      oscillator.disconnect();
      envelope.disconnect();
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.012);
  }

  _noise({ duration = 0.12, gain = 0.11, delay = 0, cutoff = 1100, highpass = 0 }) {
    if (!this.context || this.activeVoices >= 28) return;
    const ctx = this.context;
    if (!this.noiseBuffer) {
      const length = Math.ceil(ctx.sampleRate);
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const now = ctx.currentTime + delay;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = cutoff;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.007, duration * 0.2));
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(low);
    let finalFilter = low;
    let high = null;
    if (highpass > 0) {
      high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = highpass;
      low.connect(high);
      finalFilter = high;
    }
    finalFilter.connect(envelope).connect(this.master);
    this.activeVoices++;
    source.onended = () => {
      source.disconnect(); low.disconnect(); high?.disconnect(); envelope.disconnect();
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    source.start(now);
    source.stop(now + duration + 0.012);
  }

  /** Play one of: click, confirm, error, select, order, constructionComplete,
   * unitReady, hit, explosion, salvage, alert, stormcall, ionpulse, victory,
   * defeat, superweapon. */
  play(name) {
    if (this.muted) return false;
    // If constructed during the gesture itself, this still allows first-click audio.
    if (!this.unlocked && globalThis.navigator?.userActivation?.isActive) this.unlock();
    if (!this.unlocked || !this.context) return false;
    if (this.context.state === 'suspended') this.context.resume().then(() => this._scheduleMusic()).catch(() => {});

    const key = String(name || '').replace(/[^a-z]/gi, '').toLowerCase();
    const aliases = {
      uiclick: 'click', uiconfirm: 'confirm', uierror: 'error', invalid: 'error',
      selection: 'select', unitselected: 'select', command: 'order',
      constructioncomplete: 'construction', buildingcreated: 'construction', buildcomplete: 'construction',
      unitready: 'ready', unitcreated: 'ready', combat: 'hit', damage: 'hit',
      impact: 'hit', boom: 'explosion', gamewon: 'victory', gamelost: 'defeat',
    };
    const sound = aliases[key] || key;
    const cooldown = { click: 35, select: 70, order: 80, hit: 65, explosion: 100, salvage: 160 }[sound] || 0;
    const time = globalThis.performance?.now?.() ?? Date.now();
    if (time - (this.lastPlayed.get(sound) ?? -Infinity) < cooldown) return false;
    this.lastPlayed.set(sound, time);

    switch (sound) {
      case 'click':
        this._tone({ frequency: 660, end: 530, duration: 0.052, gain: 0.085, type: 'triangle' }); break;
      case 'confirm':
        this._tone({ frequency: 570, end: 670, duration: 0.09, gain: 0.11, type: 'triangle' });
        this._tone({ frequency: 850, end: 960, duration: 0.1, gain: 0.08, type: 'sine', delay: 0.075 }); break;
      case 'error':
        this._tone({ frequency: 235, end: 165, duration: 0.18, gain: 0.1, type: 'sawtooth' });
        this._tone({ frequency: 185, end: 120, duration: 0.17, gain: 0.06, type: 'triangle', delay: 0.045 }); break;
      case 'select':
        this._tone({ frequency: 710, end: 620, duration: 0.058, gain: 0.07, type: 'sine' }); break;
      case 'order':
        this._tone({ frequency: 430, end: 675, duration: 0.11, gain: 0.085, type: 'triangle' });
        this._tone({ frequency: 845, duration: 0.05, gain: 0.035, delay: 0.065 }); break;
      case 'construction':
        [523, 659, 784, 1047].forEach((frequency, i) => this._tone({ frequency, duration: 0.19, gain: 0.075, type: 'triangle', delay: i * 0.085 })); break;
      case 'ready':
        this._tone({ frequency: 720, end: 860, duration: 0.12, gain: 0.09, type: 'triangle' });
        this._tone({ frequency: 1080, duration: 0.15, gain: 0.055, delay: 0.1 }); break;
      case 'hit':
        this._noise({ duration: 0.07, gain: 0.1, cutoff: 1700, highpass: 350 });
        this._tone({ frequency: 145, end: 80, duration: 0.085, gain: 0.07, type: 'triangle' }); break;
      case 'explosion':
        this._noise({ duration: 0.37, gain: 0.23, cutoff: 850 });
        this._tone({ frequency: 105, end: 38, duration: 0.35, gain: 0.19, type: 'sine' });
        this._noise({ duration: 0.09, gain: 0.08, cutoff: 3500, highpass: 950, delay: 0.04 }); break;
      case 'salvage':
        this._noise({ duration: 0.065, gain: 0.038, cutoff: 2600, highpass: 900 });
        this._tone({ frequency: 490, end: 650, duration: 0.11, gain: 0.085, type: 'triangle', delay: 0.035 });
        this._tone({ frequency: 830, end: 1040, duration: 0.16, gain: 0.06, type: 'sine', delay: 0.12 }); break;
      case 'alert':
        for(let i=0;i<3;i++) {
          this._tone({ frequency:i===2?620:780, end:i===2?510:660,
            duration:0.11, gain:0.085, type:'triangle', delay:i*0.16 });
          this._tone({ frequency:i===2?310:390, duration:0.12,
            gain:0.043, type:'sine', delay:i*0.16 });
        }
        break;
      case 'stormcall':
        this._tone({ frequency: 132, end: 220, duration: 0.42, gain: 0.075, type: 'sawtooth' });
        this._tone({ frequency: 410, end: 920, duration: 0.56, gain: 0.07, type: 'triangle', delay: 0.08 });
        this._noise({ duration: 0.56, gain: 0.09, cutoff: 2600, highpass: 480, delay: 0.15 });
        this._tone({ frequency: 1175, end: 850, duration: 0.28, gain: 0.045, type: 'sine', delay: 0.43 }); break;
      case 'ionpulse':
        this._tone({ frequency: 920, end: 188, duration: 0.24, gain: 0.085, type: 'sawtooth' });
        this._noise({ duration: 0.28, gain: 0.13, cutoff: 1800, highpass: 320, delay: 0.055 });
        this._tone({ frequency: 118, end: 58, duration: 0.34, gain: 0.13, type: 'triangle', delay: 0.065 }); break;
      case 'victory':
        [392, 523, 659, 784, 1047].forEach((frequency, i) => this._tone({ frequency, duration: i === 4 ? 0.7 : 0.25, gain: 0.085, type: 'triangle', delay: i * 0.13 })); break;
      case 'defeat':
        [392, 294, 220, 147].forEach((frequency, i) => this._tone({ frequency, end: frequency * 0.92, duration: i === 3 ? 0.58 : 0.26, gain: 0.075, type: 'triangle', delay: i * 0.17 })); break;
      case 'superweapon':
        this._tone({ frequency: 170, end: 960, duration: 0.48, gain: 0.105, type: 'sawtooth' });
        this._noise({ duration: 0.46, gain: 0.25, cutoff: 1000, delay: 0.47 });
        this._tone({ frequency: 115, end: 34, duration: 0.45, gain: 0.21, delay: 0.47 }); break;
      default: return false;
    }
    return true;
  }

  startAmbient() {
    this.ambientWanted = true;
    if (this.unlocked && !this.muted) this._startAmbient();
  }

  _startAmbient() {
    if (this.ambient || !this.context || this.muted) return;
    const ctx = this.context;
    const mix = ctx.createGain();
    mix.gain.value = 0.012;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 190;
    mix.connect(filter).connect(this.master);
    const low = ctx.createOscillator();
    low.type = 'sine'; low.frequency.value = 55;
    const fifth = ctx.createOscillator();
    fifth.type = 'triangle'; fifth.frequency.value = 82.4;
    const fifthLevel = ctx.createGain(); fifthLevel.gain.value = 0.27;
    low.connect(mix); fifth.connect(fifthLevel).connect(mix);
    const pulse = ctx.createOscillator(); pulse.type = 'sine'; pulse.frequency.value = 0.075;
    const pulseDepth = ctx.createGain(); pulseDepth.gain.value = 0.004;
    pulse.connect(pulseDepth).connect(mix.gain);
    low.start(); fifth.start(); pulse.start();
    this.ambient = { mix, filter, low, fifth, fifthLevel, pulse, pulseDepth };
    this._scheduleMusic();
    if (ctx.state === 'suspended') ctx.resume().then(() => this._scheduleMusic()).catch(() => {});
  }

  /** Update the instrumental layer; each intensity is clamped to 0..1. */
  setMood({ combat = this.mood.combat, storm = this.mood.storm } = {}) {
    this.mood.combat = Math.max(0, Math.min(1, Number(combat) || 0));
    this.mood.storm = Math.max(0, Math.min(1, Number(storm) || 0));
  }

  /** Alias for callers that model soundscape changes as state updates. */
  updateMusicState(state) { this.setMood(state); }

  _scheduleMusic() {
    if (this.musicTimer !== null || !this.ambient || this.muted || !this.context) return;
    if (this.context.state === 'suspended') return;
    const blend = this.musicBlend;
    blend.combat += (this.mood.combat - blend.combat) * 0.16;
    blend.storm += (this.mood.storm - blend.storm) * 0.16;
    const combat = blend.combat;
    const storm = blend.storm;
    const stepSeconds = 30 / (68 + combat * 34 + storm * 12); // steady eighth-note pulse
    this._playMusicStep(combat, storm);
    this.musicStep++;
    this.musicTimer = globalThis.setTimeout(() => {
      this.musicTimer = null;
      this._scheduleMusic();
    }, stepSeconds * 1000);
  }

  _playMusicStep(combat, storm) {
    const step = this.musicStep;
    const barStep = step % 16;
    const root = 110 * (2 ** ([0, -5, -3, -7][Math.floor(step / 16) % 4] / 12));
    const stormLead = storm > 0.42 && storm > combat * 0.78;
    const fightLead = !stormLead && combat > 0.36;
    const scale = stormLead ? [0, 1, 5, 7, 8, 12, 13, 17]
      : [0, 3, 5, 7, 10, 12, 15, 17];
    const calmLine = [0, 3, 7, 5, 10, 7, 3, 5, 0, 5, 10, 7, 12, 10, 7, 3];
    const combatLine = [0, 7, 10, 7, 3, 10, 12, 10, 0, 7, 15, 12, 10, 7, 3, 7];
    const stormLine = [0, 5, 1, 8, 7, 13, 5, 1, 12, 8, 7, 1, 5, 13, 8, 0];
    const line = stormLead ? stormLine : fightLead ? combatLine : calmLine;
    const note = line[barStep];
    const tone = (semitones, octave = 1) => root * octave * (2 ** (semitones / 12));
    const ctx = this.context;
    const now = ctx.currentTime;
    const beat = 60 / (68 + combat * 34 + storm * 12);

    // A soft, slowly changing three-note pad supplies the harmony under all motifs.
    if (barStep === 0) {
      const chord = stormLead ? [0, 1, 7] : [0, 3, 7];
      chord.forEach((interval, index) => this._musicTone({
        frequency: tone(interval, 2), duration: beat * 3.7,
        gain: (stormLead ? 0.008 : 0.011) * (index === 0 ? 1 : 0.76),
        type: index === 1 && !stormLead ? 'triangle' : 'sine', attack: beat * 0.7,
        release: beat * 1.2, cutoff: stormLead ? 980 : 720,
      }));
    }

    // Low notes anchor each beat; the calm motif leaves larger gaps and room to breathe.
    if (barStep % 2 === 0 && (fightLead || stormLead || barStep === 0 || barStep === 8)) {
      this._musicTone({ frequency: tone(0, 1), end: tone(-12, 1), duration: beat * 0.8,
        gain: fightLead ? 0.027 : stormLead ? 0.022 : 0.018, type: 'sine', attack: 0.035, cutoff: 260 });
    }

    const playsMelody = fightLead || stormLead ? true : barStep % 2 === 0;
    if (playsMelody) {
      const octave = fightLead && barStep % 4 === 2 ? 2 : stormLead && barStep % 4 === 3 ? 2 : 1;
      const duration = stormLead ? beat * 1.45 : fightLead ? beat * 0.72 : beat * 1.55;
      this._musicTone({ frequency: tone(note, octave), duration,
        gain: stormLead ? 0.018 : fightLead ? 0.022 : 0.016,
        type: stormLead ? 'triangle' : fightLead ? 'triangle' : 'sine',
        attack: stormLead ? 0.055 : 0.025, release: stormLead ? 0.2 : 0.08,
        cutoff: stormLead ? 1800 : fightLead ? 2400 : 1450,
      });
    }

    // Combat uses a muted kick/hat pattern; storms use occasional airy impacts.
    if (fightLead && barStep % 4 === 0) {
      this._musicTone({ frequency: barStep === 8 ? 58 : 48, end: 34, duration: beat * 0.34,
        gain: 0.026, type: 'sine', attack: 0.006, cutoff: 180 });
    } else if (fightLead && barStep % 4 === 2) {
      this._musicNoise(beat * 0.12, 0.009, 4200);
    } else if (stormLead && barStep === 12) {
      this._musicNoise(beat * 0.48, 0.012, 2300);
    }
  }

  _musicTone({ frequency, end = frequency, duration, gain, type = 'sine', attack = 0.02,
    release = 0.08, cutoff = 4000 }) {
    if (!this.context || this.musicVoices.size >= 14) return;
    const ctx = this.context;
    const now = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, frequency), now);
    if (end !== frequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), now + duration);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.04, gain), now + Math.max(0.004, Math.min(attack, duration * 0.35)));
    envelope.gain.setTargetAtTime(0.0001, now + Math.max(attack, duration - release), Math.max(0.012, release * 0.32));
    oscillator.connect(filter).connect(envelope).connect(this.master);
    const voice = { source: oscillator, nodes: [oscillator, filter, envelope] };
    this.musicVoices.add(voice);
    oscillator.onended = () => {
      voice.nodes.forEach(node => node.disconnect());
      this.musicVoices.delete(voice);
    };
    oscillator.start(now);
    oscillator.stop(now + duration + 0.05);
  }

  _musicNoise(duration, gain, cutoff) {
    if (!this.context || this.musicVoices.size >= 14) return;
    const ctx = this.context;
    if (!this.noiseBuffer) {
      const length = Math.ceil(ctx.sampleRate);
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const samples = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    const now = ctx.currentTime;
    source.buffer = this.noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(Math.min(0.02, gain), now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    const voice = { source, nodes: [source, filter, envelope] };
    this.musicVoices.add(voice);
    source.onended = () => {
      voice.nodes.forEach(node => node.disconnect());
      this.musicVoices.delete(voice);
    };
    source.start(now);
    source.stop(now + duration + 0.012);
  }

  _stopMusic() {
    if (this.musicTimer !== null) {
      globalThis.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.musicVoices) {
      const envelope = voice.nodes.at(-1);
      try {
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setTargetAtTime(0.0001, now, 0.012);
        voice.source.stop(now + 0.05);
      } catch {
        voice.source.onended = null;
        voice.nodes.forEach(node => node.disconnect());
        this.musicVoices.delete(voice);
      }
    }
  }

  _stopAmbient() {
    this._stopMusic();
    if (!this.ambient || !this.context) return;
    const nodes = this.ambient;
    this.ambient = null;
    const now = this.context.currentTime;
    nodes.mix.gain.cancelScheduledValues(now);
    nodes.mix.gain.setTargetAtTime(0, now, 0.08);
    for (const source of [nodes.low, nodes.fifth, nodes.pulse]) source.stop(now + 0.45);
    nodes.low.onended = () => {
      for (const node of Object.values(nodes)) node.disconnect();
    };
  }

  stopAmbient() {
    this.ambientWanted = false;
    this._stopAmbient();
  }

  dispose() {
    this._removeGestureListeners();
    this.stopAmbient();
    this.context?.close?.().catch(() => {});
    this.context = null;
    this.master = null;
    this.unlocked = false;
  }
}

export default AudioSystem;
