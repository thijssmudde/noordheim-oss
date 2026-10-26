'use client';

import Image from 'next/image';
import { useId, type CSSProperties } from 'react';
import { Check, Mountain } from 'lucide-react';
import {
  BATTLEFIELDS,
  capacityLabel,
  mapIds,
  type MapId,
} from '@/lib/battlefields';

/** The same selection drives the entrance, solo operations and host-owned lobbies. */
export function MapSelect({
  value,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: MapId;
  onChange: (map: MapId) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const selected = BATTLEFIELDS[value];
  return (
    <fieldset
      className={`map-select ${compact ? 'is-compact' : ''}`}
      disabled={disabled}
      style={{ '--map-accent': selected.accent } as CSSProperties}
    >
      <legend>
        <Mountain size={15} aria-hidden="true" /> Choose your battlefield
      </legend>
      {!compact && (
        <figure className="map-select-feature">
          <picture>
            <Image
              unoptimized
              key={value}
              src={selected.image}
              alt={selected.alt}
              width={1920}
              height={1080}
              fetchPriority="high"
            />
          </picture>
          <figcaption>
            <span>{selected.biome}</span>
            <h2>{selected.name}</h2>
            <p>{selected.description}</p>
          </figcaption>
        </figure>
      )}
      <div className="map-select-options">
        {mapIds.map((map) => {
          const info = BATTLEFIELDS[map];
          return (
            <label
              key={map}
              className={`map-select-option ${value === map ? 'is-selected' : ''}`}
            >
              <input
                type="radio"
                name={id}
                value={map}
                checked={value === map}
                onChange={() => onChange(map)}
              />
              <Image
                unoptimized
                src={info.thumbnail}
                alt=""
                width={640}
                height={360}
                loading="lazy"
              />
              <span>
                <strong>{info.name}</strong>
                <small>{info.biome}</small>
                <small className="map-select-capacity">
                  {capacityLabel(map)}
                </small>
              </span>
              {value === map && (
                <Check
                  size={15}
                  className="map-select-check"
                  aria-hidden="true"
                />
              )}
            </label>
          );
        })}
      </div>
      <p className="map-select-detail" aria-live="polite">
        {compact
          ? `${selected.name} · ${capacityLabel(value)} · ${selected.description}`
          : `${capacityLabel(value)} · ${selected.features.join(' · ')}`}
      </p>
    </fieldset>
  );
}
