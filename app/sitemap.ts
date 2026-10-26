import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      changeFrequency: 'weekly',
      priority: 1,
      images: [`${siteUrl}/og.jpg`],
    },
    { url: `${siteUrl}/sponsor`, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
