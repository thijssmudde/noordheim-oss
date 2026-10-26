'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Music2, Radio, Volume2, VolumeX } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { GameAudio, trackFor } from '@/lib/game-audio';
import { commanderFor } from '@/lib/commanders';
import { CommanderPortrait } from './commander-portrait';
import { cultureOf } from '@/lib/tactics';
import {
  BattleAudioDirector,
  type AudioBattle,
  type RadioChatter,
} from '@/lib/audio-policy';

const AudioContext = createContext<GameAudio | null>(null);
export function GameAudioProvider({ children }: { children: ReactNode }) {
  const [audio] = useState(() => new GameAudio());
  useEffect(() => {
    audio.mount();
    const activate = (event: Event) => {
      if (event.isTrusted && audio.getSnapshot().status !== 'ready')
        audio.unlock();
    };
    window.addEventListener('pointerdown', activate, true);
    window.addEventListener('keydown', activate, true);
    document.addEventListener('visibilitychange', audio.visibility);
    return () => {
      window.removeEventListener('pointerdown', activate, true);
      window.removeEventListener('keydown', activate, true);
      document.removeEventListener('visibilitychange', audio.visibility);
      audio.dispose();
    };
  }, [audio]);
  return (
    <AudioContext.Provider value={audio}>{children}</AudioContext.Provider>
  );
}
export function useGameAudio() {
  const audio = useContext(AudioContext);
  if (!audio) throw new Error('GameAudioProvider is required');
  return audio;
}
/** Mutes everything inside: the home screen's attract battle is seen, not heard. */
export function SilentAudio({ children }: { children: ReactNode }) {
  return <AudioContext.Provider value={null}>{children}</AudioContext.Provider>;
}
export function useOptionalGameAudio() {
  return useContext(AudioContext);
}
function useAudioSnapshot() {
  const audio = useGameAudio();
  return useSyncExternalStore(
    audio.subscribe,
    audio.getSnapshot,
    audio.getServerSnapshot,
  );
}
export function useBattleAudio(
  battle: AudioBattle | null | undefined,
  owner: string,
) {
  const audio = useGameAudio(),
    director = useRef(new BattleAudioDirector());
  useEffect(() => {
    // A missing snapshot during reconnect is not a new operation.
    if (battle) {
      audio.setOperation(battle.id, battle.tickAt - battle.startedAt);
      audio.setScene(battle.mapId ?? null, cultureOf(battle, owner));
    }
    const frame = director.current.update(
      document.hidden ? null : (battle ?? null),
      owner,
    );
    audio.setMood(frame.mood);
    frame.cues.forEach(audio.say);
  }, [audio, battle, owner]);
  useEffect(
    () => () => {
      audio.setMood('exploration');
      audio.setScene(null, undefined);
    },
    [audio],
  );
}
export function CommanderCaption() {
  const { caption, speaker } = useAudioSnapshot();
  if (!caption) return null;
  return (
    <output className="tac-radio-caption">
      <Radio size={17} aria-hidden="true" />
      <span>
        <strong>
          {speaker.toUpperCase()} <span>· LIVE COMMS</span>
        </strong>
        <span className="tac-radio-message">{caption}</span>
      </span>
    </output>
  );
}
export function CommanderRadio({ culture }: { culture?: string }) {
  const { caption, speaker } = useAudioSnapshot();
  const commander = commanderFor(culture);
  const speaking = Boolean(caption && speaker === commander.name);
  return (
    <section
      className={`tac-commander-radio tac-plate${speaking ? ' is-speaking' : ''}`}
      aria-label={`${commander.name} · ${speaking ? 'Speaking' : 'Standing by'}`}
      title={commander.name}
    >
      <CommanderPortrait culture={culture} />
      <div className="tac-commander-radio-copy">
        <span>
          <Radio size={10} aria-hidden="true" />{' '}
          {speaking ? 'On air' : 'Command'}
        </span>
        <strong>{commander.name}</strong>
      </div>
    </section>
  );
}
export function AudioControls({ className = '' }: { className?: string }) {
  const audio = useGameAudio(),
    { preferences, status, mood, map } = useAudioSnapshot();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={className}
        aria-label="Music, combat and commander audio settings"
        title="Game audio"
        onClick={() => {
          audio.unlock();
          setOpen(true);
        }}
      >
        {preferences.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="tac-help tac-audio-settings">
          <DialogTitle>
            <Radio size={22} /> NORTHERN COMMAND · AUDIO
          </DialogTitle>
          <DialogDescription>
            Field weapons, a commander for every faction, and a score for every map.
          </DialogDescription>
          <div className="tac-audio-master">
            <div>
              <strong>Game sound</strong>
              <small>
                {preferences.muted
                  ? 'All audio muted'
                  : status === 'waiting'
                    ? 'Click Enable audio to begin'
                    : status === 'unavailable'
                      ? 'Audio could not load. Try enabling it again.'
                      : 'Radio and soundtrack connected'}
              </small>
            </div>
            <Switch
              aria-label="Game sound"
              checked={!preferences.muted}
              onCheckedChange={(checked) => {
                audio.setPreferences({ muted: !checked });
                if (checked) audio.unlock();
              }}
            />
          </div>
          {status !== 'ready' && (
            <button
              className="tac-primary"
              onClick={() => {
                audio.setPreferences({ muted: false });
                audio.unlock();
              }}
            >
              Enable audio <Volume2 size={17} />
            </button>
          )}
          {(['music', 'voice', 'effects'] as const).map((channel) => (
            <div className="tac-audio-channel" key={channel}>
              <div>
                <label id={`audio-${channel}`}>
                  {channel === 'music' ? (
                    <Music2 size={17} />
                  ) : (
                    <Radio size={17} />
                  )}
                  {channel === 'music'
                    ? 'Music'
                    : channel === 'voice'
                      ? 'Commander voice'
                      : 'Combat effects'}
                </label>
                <output>{Math.round(preferences[channel] * 100)}%</output>
              </div>
              <Slider
                aria-labelledby={`audio-${channel}`}
                value={[Math.round(preferences[channel] * 100)]}
                min={0}
                max={100}
                step={1}
                disabled={preferences.muted}
                onValueChange={(value) =>
                  audio.setPreferences({
                    [channel]: (Array.isArray(value) ? value[0] : value) / 100,
                  })
                }
              />
              <small>
                {channel === 'music'
                  ? 'Fades between calm and combat; softens during radio calls.'
                  : channel === 'voice'
                    ? 'Orders, reinforcements, field warnings, and mission results.'
                    : 'Weapon fire follows its position and distance from your camera.'}
              </small>
            </div>
          ))}
          <div className="tac-audio-channel">
            <div>
              <label htmlFor="audio-chatter">
                <Radio size={17} /> Radio chatter
              </label>
              <select
                id="audio-chatter"
                value={preferences.chatter}
                onChange={(event) =>
                  audio.setPreferences({
                    chatter: event.target.value as RadioChatter,
                  })
                }
              >
                <option value="adaptive">Adaptive</option>
                <option value="alerts">Alerts only</option>
                <option value="full">Full radio</option>
              </select>
            </div>
            <small>
              {preferences.chatter === 'adaptive'
                ? 'Routine lines become less frequent, then stop after five minutes. Important warnings stay on.'
                : preferences.chatter === 'alerts'
                  ? 'Skip selection, movement and production chatter. Keep field warnings and mission results.'
                  : 'Play routine acknowledgements and reports throughout the operation.'}
            </small>
          </div>
          <div className="tac-audio-track">
            <Music2 size={19} />
            <div>
              <small>
                {mood === 'combat' ? 'COMBAT SCORE' : 'NORTHERN SOUNDSCAPES'}
              </small>
              <strong>{trackFor(map, mood).title}</strong>
              <span>Original Noordheim soundtrack</span>
            </div>
          </div>
          <button
            className="tac-primary"
            disabled={preferences.muted || !preferences.voice}
            onClick={() => {
              audio.unlock();
              audio.say('radioCheck');
            }}
          >
            <Radio size={16} /> Test commander radio
          </button>
          <p className="tac-audio-note">
            Your audio preferences are saved on this device. Audio pauses when
            you leave this tab.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
