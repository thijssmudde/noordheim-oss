import type { Metadata, Viewport } from 'next';
import { Analytics } from '@/components/game/analytics';
import {
  ogImage,
  siteDescription as description,
  siteName,
  siteTitle as title,
  siteUrl,
} from '@/lib/site';
import './globals.css';
import '../components/game/entrance.css';
import '../components/game/command.css';
import '../components/game/northern-interface.css';
import '../components/game/sponsor-credit.css';
import '../components/game/map-select.css';
import '../components/game/photo-mode.css';
import '../components/game/superweapons.css';
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  applicationName: siteName,
  keywords: [
    'browser RTS',
    'free RTS game',
    'co-op strategy game',
    'Cold War RTS',
    'real-time strategy',
    'multiplayer browser game',
    'no download strategy game',
    'Red Alert style',
  ],
  category: 'games',
  alternates: { canonical: '/' },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title,
    description,
    url: '/',
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
export const viewport: Viewport = { themeColor: '#202e2c' };
const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: siteUrl,
      name: siteName,
      description,
      inLanguage: 'en',
    },
    {
      '@type': ['VideoGame', 'WebApplication'],
      '@id': `${siteUrl}/#game`,
      name: siteName,
      url: siteUrl,
      description,
      image: `${siteUrl}${ogImage.url}`,
      genre: ['Real-time strategy', 'Cooperative'],
      gamePlatform: 'Web browser',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Any',
      playMode: ['SinglePlayer', 'CoOp', 'MultiPlayer'],
      numberOfPlayers: {
        '@type': 'QuantitativeValue',
        minValue: 1,
        maxValue: 8,
      },
      inLanguage: 'en',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'EUR' },
    },
  ],
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {children}
        {process.env.NODE_ENV === 'production' &&
          gaMeasurementId &&
          /^G-[A-Z0-9]+$/.test(gaMeasurementId) && (
            <Analytics measurementId={gaMeasurementId} />
          )}
      </body>
    </html>
  );
}
