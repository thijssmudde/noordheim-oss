import Image from 'next/image';
import { commanderFor } from '@/lib/commanders';

export function CommanderPortrait({
  culture,
  className,
}: {
  culture?: string;
  className?: string;
}) {
  const commander = commanderFor(culture);
  return (
    <Image
      className={className}
      src={commander.portrait}
      alt={commander.name}
      width={256}
      height={256}
      unoptimized
      draggable={false}
    />
  );
}
