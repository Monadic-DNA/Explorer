import { MetadataRoute } from 'next';
import { executeQuerySingle, executeQuery } from '@/lib/db';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://explorer.monadicdna.com';
const BATCH_SIZE = 10_000;

// generateSitemaps splits the study pages across multiple sitemap files,
// each with up to BATCH_SIZE URLs, staying within the 50K-per-file limit.
export async function generateSitemaps() {
  try {
    const row = await executeQuerySingle<{ max_id: number }>(
      'SELECT MAX(id) AS max_id FROM gwas_catalog',
      []
    );
    const maxId = row?.max_id ?? 1000;
    const count = Math.ceil(maxId / BATCH_SIZE);
    // id 0 is reserved for static pages; ids 1..n are study batches
    return Array.from({ length: count + 1 }, (_, i) => ({ id: i }));
  } catch {
    return [{ id: 0 }];
  }
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  // id === 0: static pages only
  if (id === 0) {
    return [
      { url: SITE_URL,                         lastModified: new Date(), changeFrequency: 'weekly',  priority: 1.0 },
      { url: `${SITE_URL}/explore`,            lastModified: new Date(), changeFrequency: 'daily',   priority: 0.9 },
      { url: `${SITE_URL}/dna-chat`,           lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.8 },
      { url: `${SITE_URL}/overview-report`,    lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.8 },
      { url: `${SITE_URL}/subscribe`,          lastModified: new Date(), changeFrequency: 'weekly',  priority: 0.7 },
    ];
  }

  // ids 1..n: study pages in BATCH_SIZE chunks
  const batchIndex = id - 1;
  const minId = batchIndex * BATCH_SIZE + 1;
  const maxId = (batchIndex + 1) * BATCH_SIZE;

  try {
    const rows = await executeQuery<{ id: number }>(
      'SELECT id FROM gwas_catalog WHERE id BETWEEN $1 AND $2 ORDER BY id',
      [minId, maxId]
    );
    return rows.map(row => ({
      url: `${SITE_URL}/study/${row.id}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    }));
  } catch {
    return [];
  }
}
