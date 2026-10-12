import { useEffect, useRef } from "react";
import { zenIndexAfterSwipe, zenSwipeBlockedBySelection } from "./zenMode";

/** Identity of the live text selection, or null when there is none. */
interface SelectionSignature {
  anchor: Node;
  anchorOffset: number;
  focus: Node;
  focusOffset: number;
}

function liveSelectionSignature(): SelectionSignature | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  if (anchor == null || focus == null) return null;
  return {
    anchor,
    anchorOffset: selection.anchorOffset,
    focus,
    focusOffset: selection.focusOffset,
  };
}

function sameSelection(
  a: SelectionSignature | null,
  b: SelectionSignature | null,
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.anchor === b.anchor &&
    a.anchorOffset === b.anchorOffset &&
    a.focus === b.focus &&
    a.focusOffset === b.focusOffset
  );
}

type UseZenSwipeArgs = {
  enabled: boolean;
  index: number;
  total: number;
  onIndexChange: (index: number) => void;
};

/**
 * Vertical swipe anywhere on the page steps the Zen paragraph index.
 * Listens on `document` so empty chrome and margins count, not only the
 * text pane. Does not use pointer capture, so taps on buttons still work.
 * Short moves stay as taps, and a long-press that is selecting text is not
 * a swipe.
 */
export function useZenSwipe(args: UseZenSwipeArgs): void {
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    if (!args.enabled) return;

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let tracking = false;
    let suppressClick = false;
    let pointerType = "";
    let downSelection: SelectionSignature | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      tracking = true;
      suppressClick = false;
      pointerType = event.pointerType;
      downSelection = liveSelectionSignature();
      startX = lastX = event.clientX;
      startY = lastY = event.clientY;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking) return;
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const finish = (endX: number, endY: number) => {
      if (!tracking) return;
      tracking = false;
      const endSelection = liveSelectionSignature();
      if (
        zenSwipeBlockedBySelection({
          pointerType,
          selectionActive: endSelection !== null,
          selectionChanged: !sameSelection(downSelection, endSelection),
        })
      ) {
        return;
      }
      const { index, total, onIndexChange } = argsRef.current;
      const next = zenIndexAfterSwipe({
        startX,
        startY,
        endX,
        endY,
        index,
        total,
      });
      if (next !== index) {
        suppressClick = true;
        onIndexChange(next);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      finish(event.clientX, event.clientY);
    };

    const onPointerCancel = () => {
      // iOS often cancels when the browser starts scrolling; use last point.
      finish(lastX, lastY);
    };

    const onClickCapture = (event: Event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [args.enabled]);
}
