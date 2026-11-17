/**
 * Source category utilities
 * Fetches the category (`class`) list each CMS source publishes and aggregates it,
 * then browses a single category across every source that offers it.
 */

import { fetchWithTimeout } from './http-utils';
import type { HomeMovie } from '@/lib/types';

export interface SourceLite {
  id: string;
  name: string;
  baseUrl: string;
  headers?: Record<string, string>;
}

export interface SourceClassRef {
  sourceId: string;
  typeId: string;
}

/** Accept only http(s) sources with an id and a base url; the request body is untrusted. */
export function normalizeSourceList(input: unknown, max = 80): SourceLite[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const sources: SourceLite[] = [];

  for (const item of input.slice(0, max)) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const baseUrl = typeof candidate.baseUrl === 'string' ? candidate.baseUrl : '';
    if (!id || !baseUrl || seen.has(id)) continue;
    if (!/^https?:\/\//i.test(baseUrl)) continue;

    seen.add(id);
    sources.push({
      id,
      name: typeof candidate.name === 'string' ? candidate.name : id,
      baseUrl,
      headers:
        candidate.headers && typeof candidate.headers === 'object'
          ? (candidate.headers as Record<string, string>)
          : undefined,
    });
  }

  return sources;
}

export type CategoryBucket = 'movie' | 'tv' | 'other';

export interface SourceCategory {
  name: string;
  bucket: CategoryBucket;
  sourceCount: number;
  refs: SourceClassRef[];
}

interface RawClass {
  type_id: string | number;
  type_name: string;
}

const CLASS_TTL_MS = 10 * 60 * 1000;
const CLASS_TIMEOUT_MS = 6000;
const PAGE_TIMEOUT_MS = 10000;
const MAX_CONCURRENCY = 10;
const MAX_ITEMS_PER_SOURCE = 60;
/** A page merges every source, so bound what one grid render receives. */
const MAX_ITEMS_PER_PAGE = 60;

/** Categories are re-read at most once per TTL so opening the homepage is not 34 requests every time. */
const classCache = new Map<string, { at: number; classes: RawClass[] }>();

/**
 * Sources spell the same category differently (电影/电影片, 电视剧/连续剧, 韩剧/韩国剧).
 * Merge them under one display name so the filter bar shows each category once.
 */
const CATEGORY_ALIASES: Record<string, string> = {
  电影: '电影',
  电影片: '电影',
  电视剧: '电视剧',
  连续剧: '电视剧',
  剧集: '电视剧',
  动漫: '动漫',
  动漫片: '动漫',
  动画片: '动漫',
  动画: '动漫',
  中国动漫: '国产动漫',
  综艺: '综艺',
  综艺片: '综艺',
  韩剧: '韩剧',
  韩国剧: '韩剧',
  日剧: '日剧',
  日本剧: '日剧',
  泰剧: '泰剧',
  泰国剧: '泰剧',
  港台剧: '港台剧',
  香港剧: '港台剧',
  港澳剧: '港台剧',
  港剧: '港台剧',
  大陆剧: '大陆剧',
  内地剧: '大陆剧',
  记录片: '纪录片',
  纪录片: '纪录片',
  体育: '体育',
  体育赛事: '体育',
};

export function canonicalCategoryName(raw: string): string {
  const name = raw.trim();
  if (!name) return name;

  const direct = CATEGORY_ALIASES[name];
  if (direct) return direct;

  // Genre names carry an optional 片 suffix: 动作片/动作, 喜剧片/喜剧
  if (name.endsWith('片') && name.length > 2) {
    const stem = name.slice(0, -1);
    const alias = CATEGORY_ALIASES[stem];
    if (alias) return alias;
    if (stem.endsWith('剧')) return `${stem}`;
    return stem;
  }

  return name;
}

const TV_PATTERN = /剧|综艺|动漫|动画|体育|足球|篮球|网球|斯诺克/;
const MOVIE_PATTERN = /电影|动作|喜剧|爱情|科幻|恐怖|剧情|战争|伦理|预告|解说|纪录|记录/;

/**
 * Split a category name into the group the movie/television toggle switches between.
 * Names come from third-party sources, so this is a naming heuristic rather than an id range:
 * ids differ per source while the Chinese suffixes are stable.
 */
export function bucketOf(name: string): CategoryBucket {
  if (MOVIE_PATTERN.test(name)) return 'movie';
  if (TV_PATTERN.test(name)) return 'tv';
  return 'other';
}

function buildUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });

  await Promise.all(runners);
  return results;
}

async function fetchClasses(
  source: SourceLite,
  signal?: AbortSignal
): Promise<RawClass[]> {
  const cached = classCache.get(source.baseUrl);
  if (cached && Date.now() - cached.at < CLASS_TTL_MS) {
    return cached.classes;
  }

  const response = await fetchWithTimeout(
    buildUrl(source.baseUrl, { ac: 'list' }),
    {
      headers: { 'User-Agent': 'Mozilla/5.0', ...source.headers },
      signal,
    },
    CLASS_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const classes: RawClass[] = Array.isArray(data?.class) ? data.class : [];

  if (classes.length > 0) {
    classCache.set(source.baseUrl, { at: Date.now(), classes });
  }

  return classes;
}

/**
 * Aggregate every source's categories into one list, keeping for each name the
 * sources (and their per-source type ids) that can return content for it.
 */
/**
 * Curated display order. Coverage alone buries the categories people actually open.
 * Entries listed here come first in this order; everything else follows by coverage.
 * Spellings are canonicalised, so 动作片/动作 and 韩国剧/韩剧 share one position.
 */
const CATEGORY_PRIORITY_ORDER = [
  '国产动漫',
  '中国动漫',
  '动漫',
  '国产剧',
  '大陆剧',
  '内地剧',
  '香港剧',
  '港澳剧',
  '港台剧',
  '港剧',
  '台湾剧',
  '韩剧',
  '韩国剧',
  '日剧',
  '日本剧',
  '欧美剧',
  'Netflix自制剧',
  'Netflix电影',
  '4K电影',
  '邵氏电影',
  '网络电影',
  '动作片',
  '动作',
  '喜剧片',
  '喜剧',
  '科幻片',
  '科幻',
  '奇幻片',
  '奇幻',
  '冒险',
  '恐怖片',
  '恐怖',
  '惊悚片',
  '惊悚',
  '灾难片',
  '灾难',
  '悬疑片',
  '悬疑',
  '战争片',
  '战争',
  '古装片',
  '犯罪片',
];

const CATEGORY_PRIORITY = (() => {
  const table = new Map<string, number>();
  CATEGORY_PRIORITY_ORDER.forEach((raw, index) => {
    const name = canonicalCategoryName(raw);
    if (!name || table.has(name)) return;
    table.set(name, index);
  });
  return table;
})();

const UNRANKED_PRIORITY = 1000;

function priorityOf(name: string): number {
  return CATEGORY_PRIORITY.get(name) ?? UNRANKED_PRIORITY;
}

function compareCategories(a: SourceCategory, b: SourceCategory): number {
  const byPriority = priorityOf(a.name) - priorityOf(b.name);
  if (byPriority !== 0) return byPriority;
  return b.sourceCount - a.sourceCount || a.name.localeCompare(b.name, 'zh-CN');
}

export async function loadSourceCategories(
  sources: SourceLite[],
  signal?: AbortSignal,
  options: { minSources?: number } = {}
): Promise<{ categories: SourceCategory[]; failedSources: number }> {
  // Keep single-source categories: a user with one enabled source still needs a filter bar.
  // Prominence is handled by sorting on coverage and by the display cap.
  const minSources = options.minSources ?? 1;
  const lists = await mapWithConcurrency(sources, MAX_CONCURRENCY, async (source) => {
    try {
      return { source, classes: await fetchClasses(source, signal) };
    } catch {
      return { source, classes: [] as RawClass[] };
    }
  });

  const merged = new Map<string, SourceCategory>();
  let failedSources = 0;

  for (const { source, classes } of lists) {
    if (classes.length === 0) {
      failedSources++;
      continue;
    }

    for (const entry of classes) {
      const name = canonicalCategoryName(String(entry.type_name ?? ''));
      const typeId = String(entry.type_id ?? '').trim();
      if (!name || !typeId) continue;

      const existing = merged.get(name);
      if (existing) {
        if (!existing.refs.some((ref) => ref.sourceId === source.id)) {
          existing.refs.push({ sourceId: source.id, typeId });
          existing.sourceCount = existing.refs.length;
        }
        continue;
      }

      merged.set(name, {
        name,
        bucket: bucketOf(name),
        sourceCount: 1,
        refs: [{ sourceId: source.id, typeId }],
      });
    }
  }

  const categories = Array.from(merged.values())
    .filter((category) => category.sourceCount >= minSources)
    .sort(compareCategories);

  return { categories, failedSources };
}

interface RawVodItem {
  vod_id?: string | number;
  vod_name?: string;
  vod_pic?: string;
  vod_remarks?: string;
  vod_score?: string | number;
  vod_year?: string;
  type_name?: string;
}

interface RawVodList {
  code?: number;
  list?: RawVodItem[];
  page?: number;
  pagecount?: number;
}

function toHomeMovie(item: RawVodItem, source: SourceLite): HomeMovie | null {
  const title = String(item.vod_name ?? '').trim();
  if (!title) return null;

  const id = String(item.vod_id ?? title);
  const score = String(item.vod_score ?? '').trim();
  const hasScore = score !== '' && Number(score) > 0;

  let cover = String(item.vod_pic ?? '').trim();
  if (cover.startsWith('//')) cover = `https:${cover}`;

  return {
    id: `${source.id}:${id}`,
    title,
    cover,
    rate: hasScore ? score : '',
    url: '',
    remarks: String(item.vod_remarks ?? '').trim() || undefined,
    sourceName: source.name,
  };
}

export interface CategoryQuery {
  sources: SourceLite[];
  /** `latest` ignores the category and asks each source for its newest items. */
  kind: 'latest' | 'category' | 'keyword';
  refs?: SourceClassRef[];
  keyword?: string;
  page: number;
}

/**
 * Fetch one page for the selected category from every source that publishes it,
 * then merge the pages into a single list for the homepage grid.
 */
export async function loadCategoryPage(
  query: CategoryQuery,
  signal?: AbortSignal
): Promise<{ items: HomeMovie[]; hasMore: boolean }> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const refsBySource = new Map<string, string>();
  for (const ref of query.refs ?? []) {
    if (!refsBySource.has(ref.sourceId)) {
      refsBySource.set(ref.sourceId, ref.typeId);
    }
  }

  const targets =
    query.kind === 'category'
      ? query.sources.filter((source) => refsBySource.has(source.id))
      : query.sources;

  if (targets.length === 0) {
    return { items: [], hasMore: false };
  }

  const keyword = (query.keyword ?? '').trim();

  const pages = await mapWithConcurrency(targets, MAX_CONCURRENCY, async (source) => {
    const params: Record<string, string> = { pg: String(page) };

    if (query.kind === 'category') {
      params.ac = 'videolist';
      params.t = refsBySource.get(source.id) as string;
    } else if (query.kind === 'keyword') {
      params.ac = 'detail';
      params.wd = keyword;
    } else {
      params.ac = 'videolist';
    }

    try {
      const response = await fetchWithTimeout(
        buildUrl(source.baseUrl, params),
        {
          headers: { 'User-Agent': 'Mozilla/5.0', ...source.headers },
          signal,
        },
        PAGE_TIMEOUT_MS
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data: RawVodList = await response.json();
      const list = Array.isArray(data?.list) ? data.list : [];
      const encoded = list
        .slice(0, MAX_ITEMS_PER_SOURCE)
        .map((item) => toHomeMovie(item, source))
        .filter((movie): movie is HomeMovie => movie !== null);

      const pageCount = Number(data?.pagecount ?? 1);
      return { encoded, hasMore: Number.isFinite(pageCount) ? page < pageCount : encoded.length > 0 };
    } catch {
      return { encoded: [] as HomeMovie[], hasMore: false };
    }
  });

  const seen = new Set<string>();
  const items: HomeMovie[] = [];
  let hasMore = false;

  for (const result of pages) {
    hasMore = hasMore || result.hasMore;
    for (const movie of result.encoded) {
      if (seen.has(movie.title)) continue;
      seen.add(movie.title);
      items.push(movie);
      if (items.length >= MAX_ITEMS_PER_PAGE) {
        return { items, hasMore: true };
      }
    }
  }

  return { items, hasMore };
}
