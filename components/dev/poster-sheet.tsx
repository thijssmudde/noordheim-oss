'use client';
import { SponsorPoster } from '../game/sponsor-wall';
import { billboardSponsors } from '@/lib/sponsorship';
import { SPONSOR_FIXTURE } from './sponsor-fixture';

const posters = billboardSponsors(SPONSOR_FIXTURE);

/**
 * Every poster variant in every billboard style (`/?uiReview=posters`): the
 * visual test sheet for the painter in sponsor-billboard.ts.
 */
export default function PosterSheet() {
  return (
    <main style={{ minHeight: '100vh', background: '#111823', color: '#eef3f8', padding: 24, font: '13px system-ui' }}>
      <h1 style={{ margin: '0 0 16px', font: '700 18px system-ui' }}>Sponsor posters · {posters.length} variants</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, alignItems: 'start' }}>
        {posters.map((poster) => (
          <section key={poster.id} data-poster={poster.kind} style={{ display: 'grid', gap: 10 }}>
            <b>
              {poster.kind} · {poster.name}
            </b>
            <SponsorPoster sponsor={poster} style="hoarding" className="poster-sheet-item" />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, alignItems: 'start' }}>
              <SponsorPoster sponsor={poster} style="tower" className="poster-sheet-item" />
              <SponsorPoster sponsor={poster} style="banner" className="poster-sheet-item" />
            </div>
          </section>
        ))}
      </div>
      <style>{'.poster-sheet-item{width:100%;height:auto;display:block}'}</style>
    </main>
  );
}
