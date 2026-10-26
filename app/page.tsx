import { mapIds, type MapId } from '@/lib/battlefields';
import { isSkirmishMode, type SkirmishMode } from '@/lib/skirmish-modes';
import Image from 'next/image';
import Game from '@/components/game/game';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV !== 'production' &&
    (await searchParams).artReview === '1'
  ) {
    const { default: ArtReview } = await import('@/components/dev/art-review');
    const seed = Number((await searchParams).seed ?? 947) >>> 0;
    const requestedMap = String((await searchParams).map ?? 'fjordmouth');
    const mapId = mapIds.includes(requestedMap as MapId)
      ? (requestedMap as MapId)
      : 'fjordmouth';
    return (
      <ArtReview
        key={`${mapId}:${seed}:${String((await searchParams).skirmish)}`}
        seed={seed}
        mapId={mapId}
        demoSponsors={(await searchParams).sponsors === 'demo'}
        skirmish={
          isSkirmishMode((await searchParams).skirmish)
            ? ((await searchParams).skirmish as SkirmishMode)
            : undefined
        }
      />
    );
  }
  const params = await searchParams;
  if (process.env.NODE_ENV !== 'production' && params.uiReview === 'posters') {
    const { default: PosterSheet } =
      await import('@/components/dev/poster-sheet');
    return <PosterSheet />;
  }
  if (process.env.NODE_ENV !== 'production' && params.uiReview === 'solo') {
    const { default: SoloReview } =
      await import('@/components/dev/solo-review');
    const requestedMap = String(params.map ?? 'fjordmouth');
    return (
      <SoloReview
        mode={isSkirmishMode(params.mode) ? params.mode : undefined}
        mapId={
          mapIds.includes(requestedMap as MapId)
            ? (requestedMap as MapId)
            : 'fjordmouth'
        }
      />
    );
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    ['hud', 'lobby', 'over'].includes(String(params.uiReview))
  ) {
    const { default: InterfaceReview } =
      await import('@/components/dev/interface-review');
    return (
      <InterfaceReview
        initial={
          params.uiReview === 'lobby' || params.uiReview === 'over'
            ? params.uiReview
            : 'hud'
        }
        demoSponsors={params.sponsors === 'demo'}
        raid={params.raid === '1'}
        lobbyGuest={params.as === 'guest'}
        won={params.won === '1'}
        superweapons={
          params.sw || params.strike || params.ally
            ? {
                sw: params.sw ? String(params.sw) : undefined,
                swState: params.swState ? String(params.swState) : undefined,
                strike: params.strike ? String(params.strike) : undefined,
                ally: params.ally === '1',
                warn: params.warn ? String(params.warn) : undefined,
                warnAt: params.warnAt ? Number(params.warnAt) : undefined,
              }
            : undefined
        }
        sites={
          params.sites === undefined
            ? undefined
            : mapIds.includes(params.sites as MapId)
              ? (params.sites as MapId)
              : 'ironpass'
        }
      />
    );
  }
  return (
    <>
      <Game />
      {/* Ownership proof for verifieddr.com: its crawler reads this link from
          the server HTML. The badge card clashes with the HUD, so it stays
          off-screen. */}
      <a
        className="verifieddr-badge"
        href="https://verifieddr.com/website/noordheim-com"
        target="_blank"
        rel="noopener"
        tabIndex={-1}
        aria-hidden
      >
        <Image
          src="https://verifieddr.com/badge/noordheim-com-dark.svg"
          alt="Verified DR - Noordheim"
          width={250}
          height={68}
          unoptimized
        />
      </a>
    </>
  );
}
