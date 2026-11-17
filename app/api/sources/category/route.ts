/**
 * Category browse API
 * Returns one page of videos for the selected category, gathered from every
 * source that publishes it. `kind: latest` ignores the category filter.
 */

import { NextRequest } from 'next/server';
import { loadCategoryPage, normalizeSourceList, type SourceClassRef } from '@/lib/api/source-classes';

export const runtime = 'edge';

function normalizeRefs(input: unknown): SourceClassRef[] {
  if (!Array.isArray(input)) return [];

  const refs: SourceClassRef[] = [];
  for (const item of input.slice(0, 200)) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const sourceId = typeof candidate.sourceId === 'string' ? candidate.sourceId : '';
    const typeId =
      typeof candidate.typeId === 'string'
        ? candidate.typeId
        : typeof candidate.typeId === 'number'
          ? String(candidate.typeId)
          : '';
    if (!sourceId || !typeId) continue;
    refs.push({ sourceId, typeId });
  }

  return refs;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sources = normalizeSourceList(body?.sources);
    const kind = body?.kind === 'category' || body?.kind === 'keyword' ? body.kind : 'latest';
    const page = Number(body?.page ?? 1);

    if (sources.length === 0) {
      return Response.json({ items: [], hasMore: false, page: 1 });
    }

    const { items, hasMore } = await loadCategoryPage(
      {
        sources,
        kind,
        refs: normalizeRefs(body?.refs),
        keyword: typeof body?.keyword === 'string' ? body.keyword : '',
        page: Number.isFinite(page) ? page : 1,
      },
      request.signal
    );

    return Response.json({ items, hasMore, page });
  } catch (error) {
    console.error('[sources/category] failed:', error);
    return Response.json({ items: [], hasMore: false, page: 1 }, { status: 500 });
  }
}
