import { describe, expect, it, vi } from "vitest";
import { applySseEvent } from "./apiStream";

describe("applySseEvent", () => {
  it("ignores reasoning_content and accumulates content deltas (glm-style)", () => {
    const onDelta = vi.fn();
    const state = { text: "", completed: false };

    applySseEvent(
      'data: {"choices":[{"delta":{"reasoning_content":"The user asked"}}]}',
      state,
      onDelta,
    );
    applySseEvent(
      'data: {"choices":[{"delta":{"content":"Hola"}}]}',
      state,
      onDelta,
    );
    applySseEvent(
      'data: {"choices":[{"delta":{"content":" mundo"}}]}',
      state,
      onDelta,
    );
    applySseEvent("data: [DONE]", state, onDelta);

    expect(state.text).toBe("Hola mundo");
    expect(state.completed).toBe(true);
    expect(onDelta.mock.calls.map((call) => call[0])).toEqual([
      "Hola",
      "Hola mundo",
    ]);
  });
});
