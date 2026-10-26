'use client';

import Image from 'next/image';
import { useState, type CSSProperties } from 'react';

/**
 * A sponsor's logo, sized to the text beside it (1.15em unless `size` says
 * otherwise). Decorative: the sponsor's name always sits next to it. When
 * there is no logo, or a paid sponsor's favicon fails to load, the
 * billboards' mountain stands in instead of a broken image.
 */
export function SponsorLogo({
  src,
  size,
  className = '',
}: {
  src?: string;
  size?: number | string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const style = {
    '--sponsor-logo': typeof size === 'number' ? `${size}px` : size,
  } as CSSProperties;
  if (!src || failed === src)
    return (
      <svg
        className={`sponsor-logo is-emblem ${className}`}
        style={style}
        viewBox="-1.3 -1.3 2.6 2.6"
        aria-hidden="true"
      >
        <path d="M-1 0.6 L-0.25 -0.45 L0.1 0.05 L0.45 -0.25 L1 0.6 Z" />
      </svg>
    );
  return (
    <Image
      // An error before hydration fires no onError; a broken image is complete with no width.
      ref={(img) => {
        if (img?.complete && !img.naturalWidth) setFailed(src);
      }}
      className={`sponsor-logo ${className}`}
      style={style}
      src={src}
      alt=""
      width={64}
      height={64}
      unoptimized
      onError={() => setFailed(src)}
    />
  );
}

/** A sponsor's name with its logo beside it; long names ellipsize where the parent clips. */
export function SponsorName({
  name,
  src,
  size,
  className = '',
}: {
  name: string;
  src?: string;
  size?: number | string;
  className?: string;
}) {
  return (
    <span className={`sponsor-name ${className}`}>
      <SponsorLogo src={src} size={size} />
      <span>{name}</span>
    </span>
  );
}
