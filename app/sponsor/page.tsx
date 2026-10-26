import type { Metadata } from 'next';
import { BuildHopWidget } from '@/components/game/buildhop-widget';
import { SponsorCheckout } from '@/components/game/sponsor-checkout';
import { ogImage, siteName } from '@/lib/site';

const title = 'Sponsor Noordheim: your brand on the battlefield from $10';
const description =
  'Claim an ad slot on Noordheim’s billboards, home screen, lobby and debrief credits for $10, or outbid the holder for $1 more. Held until someone outbids you.';
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/sponsor' },
  openGraph: {
    title,
    description,
    url: '/sponsor',
    siteName,
    type: 'website',
    locale: 'en_GB',
    images: [ogImage],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [ogImage.url],
  },
};

export default async function SponsorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <>
      <SponsorCheckout
        sessionId={
          typeof params.session_id === 'string' ? params.session_id : undefined
        }
        cancelled={params.cancelled === '1'}
        slot={typeof params.slot === 'string' ? Number(params.slot) : undefined}
      />
      <BuildHopWidget />
    </>
  );
}
