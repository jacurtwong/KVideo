import { useState, useEffect, useCallback, useMemo } from 'react';
import { useInfiniteScroll } from '@/lib/hooks/useInfiniteScroll';
import { settingsStore } from '@/lib/store/settings-store';
import type { HomeMovie } from '@/lib/types';
import type { SourceCategory, SourceLite, SourceClassRef } from '@/lib/api/source-classes';
import type { Tag } from '../SortableTag';

interface CategoryQuery {
    kind: 'latest' | 'category' | 'keyword';
    refs?: SourceClassRef[];
    keyword?: string;
}

/**
 * Loads the homepage grid from the video sources instead of Douban.
 * The selected tag maps to a source category when one matches, otherwise the tag
 * text is used as a keyword search so custom tags keep working.
 */
export function usePopularMovies(
    selectedTag: string,
    tags: Tag[],
    categories: SourceCategory[],
    contentType: 'movie' | 'tv' = 'movie'
) {
    const [movies, setMovies] = useState<HomeMovie[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(0);

    // The local store is read synchronously, so the enabled source list is stable for the session
    const sources = useMemo<SourceLite[]>(() => {
        const settings = settingsStore.getSettings();
        return (settings.sources || [])
            .filter((source) => source.enabled !== false)
            .map((source) => ({
                id: source.id,
                name: source.name,
                baseUrl: source.baseUrl,
                headers: source.headers,
            }));
    }, []);

    const query = useMemo<CategoryQuery>(() => {
        const tag = tags.find((item) => item.id === selectedTag);
        const value = (tag?.value ?? '').trim();
        if (!value) return { kind: 'latest' };

        const category = categories.find((item) => item.name === value);
        if (category && category.refs.length > 0) {
            return { kind: 'category', refs: category.refs };
        }

        return { kind: 'keyword', keyword: value };
    }, [selectedTag, tags, categories]);

    const queryKey = useMemo(() => {
        if (query.kind === 'category') {
            return `category:${(query.refs ?? [])
                .map((ref) => `${ref.sourceId}/${ref.typeId}`)
                .sort()
                .join('|')}`;
        }
        if (query.kind === 'keyword') return `keyword:${query.keyword}`;
        return 'latest';
    }, [query]);

    const loadMovies = useCallback(
        async (pageIndex: number, append = false) => {
            if (sources.length === 0) {
                setMovies([]);
                setHasMore(false);
                return;
            }

            setLoading(true);
            try {
                const response = await fetch('/api/sources/category', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sources,
                        kind: query.kind,
                        refs: query.refs,
                        keyword: query.keyword,
                        page: pageIndex + 1,
                    }),
                });

                if (!response.ok) throw new Error('Failed to fetch');

                const data = await response.json();
                const incoming: HomeMovie[] = Array.isArray(data?.items) ? data.items : [];

                setMovies((prev) => {
                    if (!append) return incoming;
                    const seen = new Set(prev.map((movie) => movie.title));
                    return [...prev, ...incoming.filter((movie) => !seen.has(movie.title))];
                });
                setHasMore(Boolean(data?.hasMore));
            } catch (error) {
                console.error('Failed to load movies:', error);
                if (!append) setMovies([]);
                setHasMore(false);
            } finally {
                setLoading(false);
            }
        },
        // queryKey stands in for query so a category list refresh does not refetch unchanged content
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [sources, queryKey]
    );

    useEffect(() => {
        setPage(0);
        setMovies([]);
        setHasMore(true);
        loadMovies(0, false);
    }, [selectedTag, contentType, queryKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const { prefetchRef, loadMoreRef } = useInfiniteScroll({
        hasMore,
        loading,
        page,
        onLoadMore: (nextPage) => {
            setPage(nextPage);
            loadMovies(nextPage, true);
        },
    });

    return {
        movies,
        loading,
        hasMore,
        prefetchRef,
        loadMoreRef,
    };
}
