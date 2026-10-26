import type { PaidSponsor } from '@/lib/sponsorship';

/** Paid sponsors for review pages: a short name, a long two-line name, a real favicon. */
export const SPONSOR_FIXTURE: PaidSponsor[] = [
  { id: 'fixture-1', name: 'Fjordbrew Coffee', website: 'https://fjordbrew.example', slot: 1, amountCents: 1200 },
  { id: 'fixture-2', name: 'Northwind Cloud Hosting Co.', website: 'https://www.northwind.example', slot: 2, amountCents: 100 },
  { id: 'fixture-3', name: 'VerifiedDR', website: 'https://verifieddr.com', slot: 3, amountCents: 4200 },
];
