'use client';

import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableTag, Tag } from './SortableTag';
import { useEffect, useState } from 'react';
import { Icons } from '@/components/ui/Icon';

interface RecommendTagConfig {
    label: string;
    isSelected: boolean;
    onSelect: () => void;
}

interface TagListProps {
    tags: Tag[];
    selectedTag: string;
    showTagManager: boolean;
    justAddedTag: boolean;
    onTagSelect: (tagId: string) => void;
    onTagDelete: (tagId: string) => void;
    onDragEnd: (event: DragEndEvent) => void;
    onJustAddedTagHandled: () => void;
    recommendTag?: RecommendTagConfig;
}

export function TagList({
    tags,
    selectedTag,
    showTagManager,
    justAddedTag,
    onTagSelect,
    onTagDelete,
    onDragEnd,
    onJustAddedTagHandled,
    recommendTag,
}: TagListProps) {
    const [activeId, setActiveId] = useState<string | null>(null);
    const [expanded, setExpanded] = useState(false);

    // Roughly three to four wrapped rows on a desktop width; the rest sits behind one click.
    const COLLAPSED_LIMIT = 32;
    const sortedTags = showTagManager || expanded ? tags : tags.slice(0, COLLAPSED_LIMIT);
    const hiddenCount = tags.length - sortedTags.length;

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };    const handleDragEnd = (event: DragEndEvent) => {
        setActiveId(null);
        onDragEnd(event);
    };

    const activeTag = tags.find((t) => t.id === activeId);

    // Reset the "just added" flag once the new chip has rendered; wrapping needs no scrolling
    useEffect(() => {
        if (justAddedTag) onJustAddedTagHandled();
    }, [justAddedTag, onJustAddedTagHandled]);

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            {/* Categories wrap instead of scrolling sideways so every source category stays visible */}
            <div className="mb-8 flex flex-wrap items-center gap-3 pb-3 pt-2 px-1">
                {/* Recommendation Tag — non-draggable, rendered before sortable tags */}
                {recommendTag && (
                    <div className="relative flex-shrink-0">
                        <button
                            type="button"
                            onClick={recommendTag.onSelect}
                            className={`
                                px-6 py-2.5 text-sm font-semibold transition-all whitespace-nowrap rounded-[var(--radius-full)] cursor-pointer select-none flex items-center gap-1.5
                                ${recommendTag.isSelected
                                    ? 'bg-[var(--accent-color)] text-white shadow-md scale-105'
                                    : 'bg-[var(--glass-bg)] backdrop-blur-xl text-[var(--text-color)] border border-[var(--glass-border)] hover:border-[var(--accent-color)] hover:scale-105'
                                }
                            `}
                        >
                            <Icons.Sparkles size={14} />
                            {recommendTag.label}
                        </button>
                    </div>
                )}
                <SortableContext
                    items={sortedTags.map((t) => t.id)}
                    strategy={rectSortingStrategy}
                >
                    {sortedTags.map((tag) => (
                        <SortableTag
                            key={tag.id}
                            tag={tag}
                            selectedTag={selectedTag}
                            showTagManager={showTagManager}
                            onTagSelect={onTagSelect}
                            onTagDelete={onTagDelete}
                        />
                    ))}
                </SortableContext>

                {!showTagManager && (hiddenCount > 0 || expanded) && (
                    <button
                        type="button"
                        onClick={() => setExpanded((value) => !value)}
                        className="flex-shrink-0 px-5 py-2.5 text-sm font-semibold whitespace-nowrap rounded-[var(--radius-full)] cursor-pointer select-none transition-all bg-transparent text-[var(--text-color-secondary)] border border-dashed border-[var(--glass-border)] hover:border-[var(--accent-color)] hover:text-[var(--accent-color)]"
                    >
                        {expanded ? '收起' : `展开全部 ${tags.length} 个`}
                    </button>
                )}
            </div>

            <DragOverlay>
                {activeId && activeTag ? (
                    <div className="relative flex-shrink-0 animate-jiggle">
                        <button className="px-6 py-2.5 text-sm font-semibold whitespace-nowrap rounded-[var(--radius-full)] bg-[var(--accent-color)] text-white shadow-xl scale-110 cursor-grabbing border border-transparent">
                            {activeTag.label}
                        </button>
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
