import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { GameAudio, trackFor } from '../lib/game-audio';
import commander from '../lib/generated/commander-audio.json';
class FakeNode {
  pan = { value: 0 };
  gain = { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() };
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}
class FakeSource extends FakeNode {
  buffer: unknown;
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
const contexts: FakeContext[] = [],
  media: FakeMedia[] = [];
class FakeContext {
  state = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  gains: FakeNode[] = [];
  sources: FakeSource[] = [];
  constructor() {
    contexts.push(this);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createGain() {
    const n = new FakeNode();
    this.gains.push(n);
    return n;
  }
  createMediaElementSource() {
    return new FakeNode();
  }
  createStereoPanner() {
    return new FakeNode();
  }
  createBufferSource() {
    const n = new FakeSource();
    this.sources.push(n);
    return n;
  }
  decodeAudioData = vi.fn(async () => ({ duration: 2 }));
}
class FakeMedia {
  paused = true;
  loop = false;
  preload = '';
  error: null = null;
  constructor(public src: string) {
    media.push(this);
  }
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  removeAttribute = vi.fn();
  addEventListener = vi.fn();
}
let audio: GameAudio;
const doc = { hidden: false };
beforeEach(() => {
  contexts.length = 0;
  media.length = 0;
  doc.hidden = false;
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('Audio', FakeMedia);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
  audio = new GameAudio();
  audio.mount();
});
afterEach(() => {
  audio.dispose();
  vi.unstubAllGlobals();
});
async function ready() {
  audio.unlock();
  await vi.waitFor(() => expect(audio.getSnapshot().status).toBe('ready'));
}
async function spoken() {
  await vi.waitFor(() => expect(audio.getSnapshot().caption).not.toBeNull());
}
describe('Audio playback lifecycle', () => {
  test('a battle plays its map score and its culture commander, then returns to the realm', async () => {
    await ready();
    audio.setScene('ironpass', 'ironclad');
    expect(media.map((m) => m.src)).toEqual([
      trackFor('ironpass', 'exploration').file,
      trackFor('ironpass', 'combat').file,
    ]);
    expect(media.every((m) => !m.paused)).toBe(true);
    expect(audio.getSnapshot().speaker).toBe('Colonel Brand Hammar');
    audio.say('radioCheck');
    await spoken();
    const clip = commander.voices.ironclad.clips.radioCheck[0];
    expect(fetch).toHaveBeenLastCalledWith(clip.file, expect.anything());
    expect(audio.getSnapshot().caption).toBe(clip.text);
    audio.setScene(null, 'no-such-culture');
    expect(media[0].src).toBe(trackFor(null, 'exploration').file);
    expect(audio.getSnapshot()).toMatchObject({
      map: null,
      speaker: 'Commander Ravn',
      caption: null,
    });
  });
  test('alerts-only cancels an in-flight routine download, persists, and still plays warnings', async () => {
    await ready();
    const save = vi.spyOn(localStorage, 'setItem');
    let resolve!: (value: Response | PromiseLike<Response>) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    audio.say('unitReady');
    audio.setPreferences({ chatter: 'alerts' });
    expect(save).toHaveBeenLastCalledWith(
      'noordheim.audio.v1',
      expect.stringContaining('"chatter":"alerts"'),
    );
    resolve(new Response(new ArrayBuffer(8)));
    await new Promise((r) => setTimeout(r, 10));
    expect(contexts[0].sources).toHaveLength(0);
    audio.say('move');
    expect(contexts[0].sources).toHaveLength(0);
    audio.say('baseUnderAttack');
    await spoken();
    expect(contexts[0].sources).toHaveLength(1);
  });

  test('operation time quiets routine lines, reconnects do not rewind it, and a new match resets it', async () => {
    await ready();
    audio.setOperation('first', 4 * 60000);
    audio.say('move');
    await spoken();
    audio.setOperation('first', 5 * 60000);
    expect(contexts[0].sources[0].stop).toHaveBeenCalledOnce();
    expect(audio.getSnapshot().caption).toBeNull();
    audio.setOperation('first', 0);
    doc.hidden = true;
    audio.visibility();
    doc.hidden = false;
    await ready();
    audio.say('unitReady');
    expect(contexts[0].sources).toHaveLength(1);
    audio.setOperation('second', 0);
    audio.say('move');
    await spoken();
    expect(contexts[0].sources).toHaveLength(2);
  });

  test('combat sounds honor gesture, channel mute, global mute and bounded polyphony', async () => {
    audio.playWeapon('rifle', 0, 0.5);
    expect(contexts).toHaveLength(0);
    await ready();
    for (let i = 0; i < 30; i++) audio.playWeapon('cannon', 0.4, 0.6);
    await vi.waitFor(() => expect(contexts[0].sources).toHaveLength(12));
    audio.setPreferences({ effects: 0 });
    expect(
      contexts[0].sources.every((s) => s.stop.mock.calls.length === 1),
    ).toBe(true);
    audio.playWeapon('rifle', 0, 0.5);
    await Promise.resolve();
    expect(contexts[0].sources).toHaveLength(12);
  });
  test('combat downloads completing after mute never play', async () => {
    await ready();
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    audio.playWeapon('rocket', 0, 0.5);
    audio.setPreferences({ muted: true });
    resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await new Promise((r) => setTimeout(r, 10));
    expect(contexts[0].sources).toHaveLength(0);
  });
  test('does not create a context, download, or play before a gesture', () => {
    audio.say('deploy');
    audio.setMood('combat');
    expect(contexts).toHaveLength(0);
    expect(media).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  test('streams looping music, ducks it under speech, and restores it after the line', async () => {
    await ready();
    expect(media).toHaveLength(2);
    expect(media.every((m) => m.loop && !m.paused)).toBe(true);
    audio.say('move');
    await spoken();
    const c = contexts[0];
    expect(c.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0.35 * 0.24,
      0,
      0.12,
    );
    c.sources[0].onended!();
    expect(audio.getSnapshot().caption).toBeNull();
    expect(c.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0.35,
      0,
      0.8,
    );
    audio.setMood('combat');
    expect(c.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.8);
    expect(c.gains[2].gain.setTargetAtTime).toHaveBeenLastCalledWith(
      0.35,
      0,
      0.8,
    );
  });
  test.each([
    ['baseUnderAttack', 'Command station under attack'],
    ['lowPower', 'Power grid overloaded'],
  ] as const)(
    '%s interrupts an acknowledgement without overlapping voice sources',
    async (cue, caption) => {
      await ready();
      audio.say('move');
      await spoken();
      const first = contexts[0].sources[0];
      audio.say(cue);
      expect(first.stop).toHaveBeenCalledOnce();
      expect(first.onended).toBeNull();
      await vi.waitFor(() =>
        expect(audio.getSnapshot().caption).toContain(caption),
      );
      expect(contexts[0].sources).toHaveLength(2);
    },
  );
  test('muting while a voice downloads prevents late playback', async () => {
    await ready();
    let resolve!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    audio.say('deploy');
    audio.setPreferences({ muted: true });
    resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await new Promise((r) => setTimeout(r, 10));
    expect(contexts[0].sources).toHaveLength(0);
    expect(audio.getSnapshot().caption).toBeNull();
    expect(media.every((m) => m.paused)).toBe(true);
  });
  test('tab hiding stops voice and music and discards hidden alerts', async () => {
    await ready();
    audio.say('move');
    await spoken();
    doc.hidden = true;
    audio.visibility();
    audio.say('underAttack');
    expect(contexts[0].suspend).toHaveBeenCalledOnce();
    expect(media.every((m) => m.paused)).toBe(true);
    expect(audio.getSnapshot().caption).toBeNull();
    doc.hidden = false;
    audio.visibility();
    await ready();
    expect(contexts[0].sources).toHaveLength(1);
    expect(media.every((m) => !m.paused)).toBe(true);
  });
  test('audio failures are contained and disposal releases every playing channel', async () => {
    await ready();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false })),
    );
    audio.say('deploy');
    await vi.waitFor(() =>
      expect(audio.getSnapshot().status).toBe('unavailable'),
    );
    expect(audio.getSnapshot().caption).toBeNull();
    audio.dispose();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(media.every((m) => m.paused)).toBe(true);
  });
});
