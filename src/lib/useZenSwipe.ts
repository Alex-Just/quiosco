import { useEffect, useRef } from "react";
import { zenIndexAfterSwipe } from "./zenMode";

type UseZenSwipeArgs = {
  enabled: boolean;
  index: number;
  total: number;
  onIndexChange: (index: number) => void;
};

/**
 * Vertical swipe on the Zen surface steps the paragraph index.
 * Uses pointer capture so a drag that starts on a sentence button still counts.
 * Short moves stay as taps.
 */
export function useZenSwipe(
  surface: HTMLElement | null,
  args: UseZenSwipeArgs,
): void {
  const argsRef = useRef(args);
  argsRef.current = args;

  useEffect(() => {
    if (!surface || !args.enabled) return;

    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let tracking = false;
    let suppressClick = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      tracking = true;
      suppressClick = false;
      startX = lastX = event.clientX;
      startY = lastY = event.clientY;
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // Some hosts reject capture; pointerup on the surface still works.
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!tracking) return;
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const finish = (endX: number, endY: number) => {
      if (!tracking) return;
      tracking = false;
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

    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
    surface.addEventListener("click", onClickCapture, true);
    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerCancel);
      surface.removeEventListener("click", onClickCapture, true);
    };
  }, [surface, args.enabled]);
}
