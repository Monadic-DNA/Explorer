import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://monadicdna.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',           // Don't crawl API routes
          '/payment/',       // Don't crawl payment pages
          '/_next/',         // Don't crawl Next.js internals
        ],
      },
      {
        userAgent: 'GPTBot',  // OpenAI's crawler
        disallow: '/',        // Block AI training crawlers (privacy-focused)
      },
      {
        userAgent: 'CCBot',   // Common Crawl bot
        disallow: '/',        // Block AI training crawlers
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
