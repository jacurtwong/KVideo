import { useState, useEffect, useCallback, useMemo } from 'react';
import { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import type { Tag } from '../SortableTag';
import { settingsStore } from '@/lib/store/settings-store';
import type { SourceCategory, SourceLite } from '@/lib/api/source-classes';

const DEFAULT_TAG: Tag = { id: 'latest', label: '最近更新', value: '' };

const STORAGE_KEY = 'kvideo_custom_tags_all';

const tagIdForCategory = (name: string) => `cat_${name}`;

const ensureDefaultTag = (tags: Tag[]): Tag[] => {
    const rest = tags.filter((tag) => tag.id !== DEFAULT_TAG.id && tag.value !== DEFAULT_TAG.value);
    return [DEFAULT_TAG, ...rest];
};

/** Keep the order the user arranged, drop categories sources no longer publish, append new ones. */
const reconcileWithCategories = (saved: Tag[], categories: SourceCategory[]): Tag[] => {
    const available = new Map(categories.map((category) => [category.name, category]));
    const used = new Set<string>();
    const result: Tag[] = [];

    for (const tag of saved) {
        if (tag.id === DEFAULT_TAG.id) continue;

        if (tag.id.startsWith('custom_')) {
            result.push(tag);
            continue;
        }

        const category = available.get(tag.value);
        if (!category || used.has(category.name)) continue;

        used.add(category.name);
        result.push({ id: tagIdForCategory(category.name), label: category.name, value: category.name });
    }

    for (const category of categories) {
        if (used.has(category.name)) continue;
        used.add(category.name);
        result.push({ id: tagIdForCategory(category.name), label: category.name, value: category.name });
    }

    return ensureDefaultTag(result);
};

/**
 * Sources publish their own site-specific and adult categories. The filter bar
 * shows mainstream genres only; everything else stays reachable through search.
 */
const EXCLUDED_CATEGORY = /伦理|三级|福利|里番|无码|写真|成人|传媒|主播|萝莉|杏吧|性视界|海角|糖心|玩偶|兔子|91|麻豆|精东|大象|乌鸦|蜜桃|PsychoPorn|中文字幕|两性|自拍|偷拍|门事件|擦边|AV/i;

/**
 * Keep categories that several sources support. Single-source names are usually
 * that site's own labels and would bury the shared genres.
 */
const MIN_SOURCE_COVERAGE = 3;

export function useTagManager() {
    const [selectedTag, setSelectedTag] = useState(DEFAULT_TAG.id);
    const [tags, setTags] = useState<Tag[]>([DEFAULT_TAG]);
    const [categories, setCategories] = useState<SourceCategory[]>([]);
    const [isLoadingTags, setIsLoadingTags] = useState(false);
    const [newTagInput, setNewTagInput] = useState('');
    const [showTagManager, setShowTagManager] = useState(false);
    const [justAddedTag, setJustAddedTag] = useState(false);

    // The local store is read synchronously, so the enabled source list is stable for the session
    const enabledSources = useMemo<SourceLite[]>(() => {
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

    const loadCategories = useCallback(async (): Promise<SourceCategory[]> => {
        if (enabledSources.length === 0) return [];

        try {
            const response = await fetch('/api/sources/classes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sources: enabledSources }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            const all: SourceCategory[] = Array.isArray(data?.categories) ? data.categories : [];
            return all
                .filter((category) => category.sourceCount >= MIN_SOURCE_COVERAGE)
                .filter((category) => !EXCLUDED_CATEGORY.test(category.name));
        } catch (error) {
            console.error('Load source categories failed:', error);
            return [];
        }
    }, [enabledSources]);

    // Load source categories, then merge them with the user's saved order and custom tags
    useEffect(() => {
        let cancelled = false;

        const loadTags = async () => {
            setIsLoadingTags(true);
            try {
                const loaded = await loadCategories();
                if (cancelled) return;

                setCategories(loaded);

                let saved: Tag[] = [];
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) saved = parsed;
                    } catch (e) {
                        console.error('Failed to parse saved tags', e);
                    }
                }

                setTags(reconcileWithCategories(saved, loaded));
            } finally {
                if (!cancelled) setIsLoadingTags(false);
            }
        };

        loadTags();
        setSelectedTag(DEFAULT_TAG.id);

        return () => {
            cancelled = true;
        };
    }, [loadCategories]);

    const saveTags = (newTags: Tag[]) => {
        setTags(newTags);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newTags));
    };

    const handleAddTag = () => {
        if (!newTagInput.trim()) return;
        const newTag = {
            id: `custom_${Date.now()}`,
            label: newTagInput.trim(),
            value: newTagInput.trim(),
        };
        saveTags([...tags, newTag]);
        setNewTagInput('');
        setJustAddedTag(true);
    };

    const handleDeleteTag = (tagId: string) => {
        if (tagId === DEFAULT_TAG.id) return;

        saveTags(tags.filter(t => t.id !== tagId));
        if (selectedTag === tagId) {
            setSelectedTag(DEFAULT_TAG.id);
        }
    };

    const handleRestoreDefaults = async () => {
        localStorage.removeItem(STORAGE_KEY);
        setIsLoadingTags(true);
        try {
            const loaded = await loadCategories();
            setCategories(loaded);
            setTags(reconcileWithCategories([], loaded));
        } finally {
            setIsLoadingTags(false);
        }
        setSelectedTag(DEFAULT_TAG.id);
        setShowTagManager(false);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = tags.findIndex((tag) => tag.id === active.id);
            const newIndex = tags.findIndex((tag) => tag.id === over.id);
            saveTags(arrayMove(tags, oldIndex, newIndex));
        }
    };

    return {
        tags,
        categories,
        selectedTag,
        newTagInput,
        showTagManager,
        justAddedTag,
        isLoadingTags,
        setSelectedTag,
        setNewTagInput,
        setShowTagManager,
        setJustAddedTag,
        handleAddTag,
        handleDeleteTag,
        handleRestoreDefaults,
        handleDragEnd,
    };
}
