import commander from './generated/commander-audio.json';
import { voiceFor } from './commanders';
import soundtrack from './generated/music-audio.json';
import type { WeaponFamily } from './combat-presentation';
import {
  CUE_RULES,
  DEFAULT_AUDIO,
  RadioQueue,
  normalizePreferences,
  type AudioPreferences,
  type MusicMood,
  type VoiceCue,
} from './audio-policy';

type Voice = keyof typeof commander.voices;
type ScoredMap = keyof typeof soundtrack.maps;
/** The map's own score, or the realm soundtrack off the battlefield. */
export const trackFor = (map: string | null, mood: MusicMood) =>
  map && map in soundtrack.maps
    ? soundtrack.maps[map as ScoredMap][mood]
    : soundtrack.tracks[mood];

export type AudioSnapshot = {
  preferences: AudioPreferences;
  status: 'waiting' | 'ready' | 'unavailable';
  mood: MusicMood;
  caption: string | null;
  /** The commander on the radio for the current battle. */
  speaker: string;
  /** The map whose score is playing, or null for the realm soundtrack. */
  map: string | null;
};
const INITIAL: AudioSnapshot = {
  preferences: DEFAULT_AUDIO,
  status: 'waiting',
  mood: 'exploration',
  caption: null,
  speaker: commander.voices.ravn.commander,
  map: null,
};
const STORAGE_KEY = 'noordheim.audio.v1';
type Channel = {
  element: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
};

/** One audio scene shared by the battlefront and persistent realm. No runtime provider calls. */
export class GameAudio {
  private snapshot = INITIAL;
  private listeners = new Set<() => void>();
  private context: AudioContext | null = null;
  private music: Partial<Record<MusicMood, Channel>> = {};
  private voiceGain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private activeCue: VoiceCue | null = null;
  private queue = new RadioQueue();
  private operationId: string | null = null;
  private operationElapsed = 0;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private variants = new Map<VoiceCue, number>();
  private voice: Voice = 'ravn';
  private loading = false;
  private generation = 0;
  private disposed = false;
  private abort = new AbortController();
  private effectsGain: GainNode | null = null;
  private effects = new Set<AudioBufferSourceNode>();
  private effectsLoading = 0;
  private effectsGeneration = 0;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  getServerSnapshot = () => INITIAL;
  private update(patch: Partial<AudioSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  mount() {
    this.disposed = false;
    this.abort = new AbortController();
    this.update({ status: 'waiting', caption: null });
    try {
      this.update({
        preferences: normalizePreferences(
          JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'),
        ),
      });
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
    this.configureRadio();
  }
  setOperation = (id: string | null, elapsed: number) => {
    if (id !== this.operationId) {
      this.stopRadio();
      this.queue.reset();
      this.operationId = id;
      this.operationElapsed = 0;
    }
    this.operationElapsed = Math.max(
      this.operationElapsed,
      Number.isFinite(elapsed) ? elapsed : 0,
    );
    this.configureRadio();
  };
  private configureRadio() {
    this.queue.configure(
      this.snapshot.preferences.chatter,
      this.operationElapsed,
    );
    if (this.activeCue && !this.queue.allows(this.activeCue)) {
      this.stopCurrent();
      this.pump();
    }
  }
  setPreferences = (patch: Partial<AudioPreferences>) => {
    const preferences = normalizePreferences({
      ...this.snapshot.preferences,
      ...patch,
    });
    this.update({ preferences });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      /* The controls still work without persistence. */
    }
    if (preferences.muted || !preferences.voice) this.stopRadio();
    this.configureRadio();
    if (preferences.muted || !preferences.effects) this.stopEffects();
    if (preferences.muted || !preferences.music)
      Object.values(this.music).forEach((c) => c.element.pause());
    else if (this.context?.state === 'running') this.startMusic();
    this.mix();
  };
  /** Called synchronously from a real gesture, before awaiting network mutations. */
  unlock = () => {
    if (this.disposed || document.hidden) return;
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.voiceGain = this.context.createGain();
        this.voiceGain.connect(this.context.destination);
        for (const mood of ['exploration', 'combat'] as const) {
          const element = new Audio(trackFor(this.snapshot.map, mood).file);
          element.loop = true;
          element.preload = 'none';
          const source = this.context.createMediaElementSource(element),
            gain = this.context.createGain();
          gain.gain.value = 0;
          source.connect(gain).connect(this.context.destination);
          element.addEventListener(
            'error',
            () => this.update({ status: 'unavailable' }),
            { signal: this.abort.signal },
          );
          this.music[mood] = { element, source, gain };
        }
        this.effectsGain = this.context.createGain();
        this.effectsGain.connect(this.context.destination);
      }
      const context = this.context;
      void context
        .resume()
        .then(() => {
          if (this.context !== context || this.disposed || document.hidden)
            return;
          this.update({
            status: context.state === 'running' ? 'ready' : 'waiting',
          });
          this.mix();
          this.pump();
        })
        .catch(() => this.update({ status: 'waiting' }));
      this.startMusic();
      this.mix();
    } catch {
      this.update({ status: 'unavailable' });
    }
  };
  private startMusic() {
    if (
      this.snapshot.preferences.muted ||
      !this.snapshot.preferences.music ||
      document.hidden
    )
      return;
    for (const channel of Object.values(this.music)) {
      if (!channel.element.paused) continue;
      const context = this.context;
      void channel.element.play().catch((error: unknown) => {
        if (
          this.context !== context ||
          this.disposed ||
          document.hidden ||
          this.snapshot.preferences.muted ||
          !this.snapshot.preferences.music
        )
          return;
        this.update({
          status:
            error instanceof DOMException && error.name === 'NotAllowedError'
              ? 'waiting'
              : 'unavailable',
        });
      });
    }
  }
  /** Follow the battle's map score and the player's culture commander. */
  setScene = (map: string | null, culture: string | undefined) => {
    const voice = voiceFor(culture),
      scored = map && map in soundtrack.maps ? map : null;
    if (voice !== this.voice) {
      this.stopRadio();
      this.voice = voice;
      this.variants.clear();
      this.update({ speaker: commander.voices[voice].commander });
    }
    if (scored === this.snapshot.map) return;
    this.update({ map: scored });
    for (const [mood, channel] of Object.entries(this.music)) {
      channel.element.pause();
      channel.element.src = trackFor(scored, mood as MusicMood).file;
    }
    if (this.context?.state === 'running') this.startMusic();
  };
  setMood = (mood: MusicMood) => {
    if (this.snapshot.mood === mood) return;
    this.update({ mood });
    this.mix();
  };
  private mix() {
    if (!this.context) return;
    const { preferences: p, mood } = this.snapshot,
      now = this.context.currentTime;
    const ramp = (param: AudioParam, value: number, seconds: number) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, seconds);
    };
    if (this.voiceGain) ramp(this.voiceGain.gain, p.muted ? 0 : p.voice, 0.04);
    if (this.effectsGain)
      ramp(this.effectsGain.gain, p.muted ? 0 : p.effects, 0.025);
    for (const [name, channel] of Object.entries(this.music)) {
      ramp(
        channel.gain.gain,
        p.muted || name !== mood ? 0 : p.music * (this.activeCue ? 0.24 : 1),
        this.activeCue ? 0.12 : 0.8,
      );
    }
  }
  say = (cue: VoiceCue) => {
    if (
      this.disposed ||
      !this.context ||
      document.hidden ||
      this.snapshot.preferences.muted ||
      !this.snapshot.preferences.voice
    )
      return;
    if (!this.queue.enqueue(cue, Date.now())) return;
    if (
      this.activeCue &&
      CUE_RULES[cue].priority >= 70 &&
      CUE_RULES[cue].priority > CUE_RULES[this.activeCue].priority
    )
      this.stopCurrent();
    this.pump();
  };
  /** Bounded positional one-shots; late downloads never play after mute/tab changes. */
  playWeapon = (family: WeaponFamily, pan: number, level: number) => {
    const context = this.context,
      generation = this.effectsGeneration;
    if (
      !context ||
      context.state !== 'running' ||
      this.disposed ||
      document.hidden ||
      this.snapshot.preferences.muted ||
      !this.snapshot.preferences.effects ||
      this.effects.size + this.effectsLoading >= 12
    )
      return;
    const started = Date.now();
    this.effectsLoading++;
    void this.buffer(`/audio/combat/${family}.wav`)
      .then((buffer) => {
        if (
          generation !== this.effectsGeneration ||
          this.context !== context ||
          this.disposed ||
          document.hidden ||
          context.state !== 'running' ||
          Date.now() - started > 400
        )
          return;
        const source = context.createBufferSource(),
          gain = context.createGain(),
          panner = context.createStereoPanner();
        source.buffer = buffer;
        gain.gain.value = Math.max(0, Math.min(0.9, level));
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        source.connect(gain).connect(panner).connect(this.effectsGain!);
        this.effects.add(source);
        source.onended = () => {
          this.effects.delete(source);
          source.disconnect();
          gain.disconnect();
          panner.disconnect();
        };
        source.start();
      })
      .catch(() => {
        /* A missing weapon sound cannot interrupt a battle. */
      })
      .finally(() => {
        this.effectsLoading--;
      });
  };
  private stopEffects() {
    this.effectsGeneration++;
    for (const source of this.effects) source.stop();
    this.effects.clear();
  }
  private buffer(file: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(file);
    if (!buffer) {
      const context = this.context!;
      buffer = fetch(file, { signal: this.abort.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Radio asset unavailable');
          return response.arrayBuffer();
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .catch((error) => {
          this.buffers.delete(file);
          throw error;
        });
      this.buffers.set(file, buffer);
    }
    return buffer;
  }
  private pump() {
    if (
      this.loading ||
      this.source ||
      this.context?.state !== 'running' ||
      this.disposed ||
      document.hidden
    )
      return;
    const cue = this.queue.next(Date.now());
    if (!cue) return;
    const generation = this.generation,
      started = Date.now(),
      clips = commander.voices[this.voice].clips[cue];
    const index = this.variants.get(cue) ?? 0,
      clip = clips[index % clips.length];
    this.variants.set(cue, index + 1);
    this.loading = true;
    this.activeCue = cue;
    void this.buffer(clip.file)
      .then((buffer) => {
        if (this.generation !== generation || this.disposed) return;
        this.loading = false;
        if (
          document.hidden ||
          this.context?.state !== 'running' ||
          Date.now() - started > (CUE_RULES[cue].priority >= 70 ? 14000 : 5000)
        ) {
          this.activeCue = null;
          this.pump();
          return;
        }
        const source = this.context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.voiceGain!);
        this.source = source;
        this.update({ caption: clip.text });
        this.mix();
        source.onended = () => {
          if (this.source !== source) return;
          source.disconnect();
          this.source = null;
          this.activeCue = null;
          this.update({ caption: null });
          this.mix();
          this.pump();
        };
        source.start();
      })
      .catch(() => {
        if (this.generation !== generation || this.disposed) return;
        this.stopCurrent();
        this.update({ status: 'unavailable' });
        this.pump();
      });
  }
  private stopCurrent() {
    this.generation++;
    this.loading = false;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    this.activeCue = null;
    this.update({ caption: null });
    this.mix();
  }
  private stopRadio() {
    this.queue.clear();
    this.stopCurrent();
  }
  visibility = () => {
    if (document.hidden) {
      this.stopEffects();
      this.stopRadio();
      Object.values(this.music).forEach((c) => c.element.pause());
      void this.context?.suspend().catch(() => {});
    } else if (this.context) this.unlock();
  };
  dispose() {
    this.stopEffects();
    this.stopRadio();
    this.disposed = true;
    this.abort.abort();
    Object.values(this.music).forEach((c) => {
      c.element.pause();
      c.element.removeAttribute('src');
      c.element.load();
      c.source.disconnect();
      c.gain.disconnect();
    });
    this.music = {};
    this.voiceGain?.disconnect();
    this.voiceGain = null;
    this.effectsGain?.disconnect();
    this.effectsGain = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.buffers.clear();
  }
}
