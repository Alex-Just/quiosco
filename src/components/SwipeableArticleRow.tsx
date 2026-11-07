import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { listSource } from "../lib/articleDisplayHelpers";
import { formatDate } from "../lib/format";
import {
  clampSwipeOffset,
  isHorizontalDrag,
  SWIPE_ACTION_WIDTH,
  swipeShouldOpen,
} from "../lib/listSwipe";
import type { Article } from "../lib/types";

type SwipeableArticleRowProps = {
  article: Article;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  horizontal: boolean;
};

/**
 * Article row whose left swipe reveals a Delete quick action. Vertical
 * movement stays with the browser so the list still scrolls normally.
 */
export function SwipeableArticleRow({
  article,
  open,
  onOpenChange,
  onDelete,
}: SwipeableArticleRowProps) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);

  const offset = dragOffset ?? (open ? -SWIPE_ACTION_WIDTH : 0);

  const onPointerDown = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    suppressClick.current = false;
    // Capture now so releasing outside the row cannot leave drag work pending.
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: open ? -SWIPE_ACTION_WIDTH : 0,
      horizontal: false,
    };
  };

  const cancelDrag = () => {
    drag.current = null;
    setDragOffset(null);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      cancelDrag();
      return;
    }
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.horizontal) {
      if (!isHorizontalDrag(dx, dy)) return;
      // A rightward drag cannot reveal anything on a closed row.
      if (state.startOffset === 0 && dx > 0) return;
      state.horizontal = true;
    }
    setDragOffset(clampSwipeOffset(state.startOffset + dx));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLAnchorElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!state.horizontal) {
      setDragOffset(null);
      return;
    }
    const releasedAt = clampSwipeOffset(
      state.startOffset + (event.clientX - state.startX),
    );
    // A drag that never moved the row should still count as a tap.
    suppressClick.current = releasedAt !== state.startOffset;
    setDragOffset(null);
    onOpenChange(swipeShouldOpen(releasedAt));
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!suppressClick.current) {
      // A tap on an open row closes it instead of following the link.
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
      return;
    }
    suppressClick.current = false;
    // Keyboard activation reports detail 0 and must never be swallowed.
    if (event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <li className="article-swipe">
      <div
        className={
          dragOffset === null
            ? "article-swipe-content"
            : "article-swipe-content dragging"
        }
        style={{ transform: `translateX(${offset}px)` }}
      >
        <Link
          className="article-row"
          to={`/article/${article.id}`}
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          onClickCapture={onClickCapture}
          onDragStart={(event) => event.preventDefault()}
        >
          <span className="article-title">{article.title}</span>
          <span className="article-meta">
            {listSource(article)} · {formatDate(article.createdAt)}
            {article.translationStatus === "error"
              ? " · translation failed"
              : ""}
          </span>
        </Link>
      </div>
      <div className="article-swipe-actions" inert={!open}>
        <button
          type="button"
          className="article-swipe-delete"
          aria-label={`Delete ${article.title}`}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
