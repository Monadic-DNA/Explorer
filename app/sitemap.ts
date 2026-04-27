import { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://monadicdna.com';

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/explore`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/dna-chat`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/overview-report`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // Dynamic study pages - we'll include a sample of studies
  // In production, you might want to:
  // 1. Query your database for all study IDs
  // 2. Generate sitemap index files for large datasets (50K+ URLs)
  // 3. Use dynamic sitemap generation or sitemap index

  // For now, we'll include the first 1000 studies as an example
  // This keeps the sitemap under 50K URLs limit
  const studyPages: MetadataRoute.Sitemap = [];

  // Generate URLs for first 1000 studies (you can adjust this)
  for (let i = 1; i <= 1000; i++) {
    studyPages.push({
      url: `${baseUrl}/study/${i}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  // Combine all pages
  return [...staticPages, ...studyPages];
}
