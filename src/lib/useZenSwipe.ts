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
 * Short moves stay as taps so sentence buttons still work.
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
    let tracking = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      tracking = true;
      startX = event.clientX;
      startY = event.clientY;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const { index, total, onIndexChange } = argsRef.current;
      const next = zenIndexAfterSwipe({
        startX,
        startY,
        endX: event.clientX,
        endY: event.clientY,
        index,
        total,
      });
      if (next !== index) onIndexChange(next);
    };
    const onPointerCancel = () => {
      tracking = false;
    };

    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
    return () => {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [surface, args.enabled]);
}
