'use client';

import Image from 'next/image';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  commandLimit,
  HARVESTER_LIMIT,
  STRUCTURE_LIMIT,
  TECH_SITES,
  startingCredits,
} from '@/lib/tactics';
import { MAPS, type MapId } from '@/lib/maps';
import {
  DIFFICULTIES,
  difficultyKeys,
  type Difficulty,
} from '@/lib/tactical-difficulty';
import {
  DEFAULT_SKIRMISH_MODE,
  SKIRMISH_MODES,
  skirmishModes,
  type SkirmishMode,
} from '@/lib/skirmish-modes';

/** The skirmish mission picker: solo launches only, one picture card per mode. */
export function SkirmishModePicker({
  value,
  onChange,
  disabled,
}: {
  value: SkirmishMode;
  onChange: (mode: SkirmishMode) => void;
  disabled: boolean;
}) {
  return (
    <div className="tac-mode-picker">
      <div className="tac-difficulty-heading">
        <span id="operation-mode">Mission</span>
      </div>
      <RadioGroup
        className="tac-mode-options"
        value={value}
        onValueChange={(next) => onChange(next as SkirmishMode)}
        disabled={disabled}
        aria-labelledby="operation-mode"
      >
        {skirmishModes.map((key) => (
          <label
            key={key}
            className={`tac-difficulty-option tac-mode-option ${key === value ? 'selected' : ''}`}
          >
            <RadioGroupItem value={key} />
            <Image
              src={SKIRMISH_MODES[key].picture}
              alt=""
              width={400}
              height={192}
              unoptimized
              draggable={false}
            />
            <strong>{SKIRMISH_MODES[key].name}</strong>
            <span>{SKIRMISH_MODES[key].tagline}</span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

export function OperationSettings({
  value,
  onChange,
  locked,
  disabled,
  enemyCount = 1,
  playerSlots = 1,
  mapId,
  onEnemyCountChange,
  mode,
  onModeChange,
}: {
  /** The solo skirmish mission; the picker shows only when it can change. */
  mode?: SkirmishMode;
  onModeChange?: (mode: SkirmishMode) => void;
  /** The chosen battlefield; enemy counts above its strongholds are disabled. */
  mapId?: MapId;
  enemyCount?: number;
  playerSlots?: number;
  onEnemyCountChange?: (count: number) => void;
  value: Difficulty;
  onChange: (difficulty: Difficulty) => void;
  locked: boolean;
  disabled: boolean;
}) {
  const rules = DIFFICULTIES[value];
  const map = mapId ? MAPS[mapId] : undefined;
  const maxEnemies = map?.capacity.enemies ?? 8;
  const skirmish = mode ?? DEFAULT_SKIRMISH_MODE,
    rulesOf = SKIRMISH_MODES[skirmish].rules;
  const troops = commandLimit({ playerSlots, commanders: [] });
  return (
    <section className="tac-operation-settings" aria-label="Operation settings">
      {onModeChange && !locked && (
        <SkirmishModePicker
          value={skirmish}
          onChange={onModeChange}
          disabled={disabled}
        />
      )}
      <div className="tac-settings-grid">
        <div>
          <div className="tac-difficulty-heading">
            <span id="operation-difficulty">Difficulty</span>
            {locked && <span>Set for this operation</span>}
          </div>
          {locked ? (
            <strong className="tac-difficulty-current">{rules.name}</strong>
          ) : (
            <RadioGroup
              className="tac-difficulty-options"
              value={value}
              onValueChange={(next) => onChange(next as Difficulty)}
              disabled={disabled}
              aria-labelledby="operation-difficulty"
              aria-describedby="difficulty-description"
            >
              {difficultyKeys.map((key) => (
                <label
                  key={key}
                  className={`tac-difficulty-option ${key === value ? 'selected' : ''}`}
                >
                  <RadioGroupItem value={key} />
                  {DIFFICULTIES[key].name}
                </label>
              ))}
            </RadioGroup>
          )}
        </div>
        <label className="ops-field">
          Enemy armies
          <select
            aria-label="Enemy armies"
            value={enemyCount}
            disabled={disabled || locked}
            onChange={(event) =>
              onEnemyCountChange?.(Number(event.target.value))
            }
          >
            {Array.from({ length: 8 }, (_, i) => (
              <option key={i + 1} value={i + 1} disabled={i + 1 > maxEnemies}>
                {i + 1}
                {i + 1 > maxEnemies
                  ? ` (${map?.name} holds ${maxEnemies})`
                  : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p id="difficulty-description">{rules.description}</p>
      <div className="tac-difficulty-details">
        <span>
          ₭{' '}
          {startingCredits({ difficulty: value, skirmish }).toLocaleString(
            'en-US',
          )}{' '}
          to start
        </span>
        {!rulesOf.ore && (
          <span>
            Derricks ₭ {rulesOf.derrickIncome} /{' '}
            {TECH_SITES.derrick.pulseSeconds} s
          </span>
        )}
        <span>First attack {rules.firstWaveMs / 60000} min</span>
        <span className="tac-detail-map">
          {map
            ? `${map.bounds.maxX - map.bounds.minX} × ${map.bounds.maxZ - map.bounds.minZ} m · `
            : ''}
          {enemyCount} {enemyCount === 1 ? 'enemy base' : 'enemy bases'}
          {map ? ` of ${maxEnemies}` : ''}
        </span>
      </div>
      <p className="tac-world-variation">
        {locked
          ? 'Join the current battlefield with its shared difficulty.'
          : rulesOf.ore
            ? `${troops} troops, ${HARVESTER_LIMIT} harvesters per refinery and ${STRUCTURE_LIMIT} structures per commander. Destroy every enemy building and unit to win.`
            : `${troops} troops and ${STRUCTURE_LIMIT} structures per commander. No refineries or harvesters: oil derricks are the only income. Destroy every enemy building and unit to win.`}
      </p>
    </section>
  );
}
