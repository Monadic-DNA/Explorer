import { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://explorer.monadicdna.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL,                      lastModified: new Date(), changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/explore`,         lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
    { url: `${SITE_URL}/dna-chat`,        lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/overview-report`, lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.8 },
    { url: `${SITE_URL}/subscribe`,       lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.7 },
  ];
}
