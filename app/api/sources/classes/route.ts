/**
 * Category list API
 * Aggregates the `class` list every enabled source publishes, so the homepage
 * filter bar reflects what the sources can actually serve.
 */

import { NextRequest } from 'next/server';
import { loadSourceCategories, normalizeSourceList } from '@/lib/api/source-classes';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sources = normalizeSourceList(body?.sources);

    if (sources.length === 0) {
      return Response.json({ categories: [], failedSources: 0, totalSources: 0 });
    }

    const { categories, failedSources } = await loadSourceCategories(sources, request.signal);

    return Response.json({
      categories,
      failedSources,
      totalSources: sources.length,
    });
  } catch (error) {
    console.error('[sources/classes] failed:', error);
    return Response.json({ categories: [], failedSources: 0, totalSources: 0 }, { status: 500 });
  }
}
