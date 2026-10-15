import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "./api";
import {
  PARTIAL_THREAD_WARNING,
  runAddPagePreprocess,
} from "./runAddPagePreprocess";

vi.mock("./settings", () => ({ loadSettings: () => ({ appToken: "t" }) }));

const apply = () => ({
  setText: vi.fn(),
  setTitle: vi.fn(),
  setFetchedVia: vi.fn(),
  setCleanup: vi.fn(),
  setError: vi.fn(),
  setPreprocessing: vi.fn(),
  setFetchDetail: vi.fn(),
  setFetchWarning: vi.fn(),
});

const threadApi = (partial: boolean) =>
  ({
    fetchThread: vi.fn(async () => ({
      title: "",
      author: "",
      text: "texto",
      tweetCount: 1,
      partial,
      source: "syndication",
    })),
  }) as unknown as ApiClient;

describe("runAddPagePreprocess thread warnings", () => {
  const url = "https://x.com/u/status/2110631479294431539";

  it("warns when the thread came back partial", async () => {
    const state = apply();
    await runAddPagePreprocess({
      targetUrl: url,
      sharedTitle: "",
      edited: { current: false },
      apply: state,
      api: threadApi(true),
    });
    expect(state.setFetchWarning).toHaveBeenLastCalledWith(
      PARTIAL_THREAD_WARNING,
    );
  });

  it("clears the warning for a complete thread", async () => {
    const state = apply();
    await runAddPagePreprocess({
      targetUrl: url,
      sharedTitle: "",
      edited: { current: false },
      apply: state,
      api: threadApi(false),
    });
    expect(state.setFetchWarning).toHaveBeenLastCalledWith(null);
  });

  it("clears the warning at the start even when the fetch fails", async () => {
    const state = apply();
    const api = {
      fetchThread: vi.fn(async () => {
        throw new Error("nope");
      }),
    } as unknown as ApiClient;
    await runAddPagePreprocess({
      targetUrl: url,
      sharedTitle: "",
      edited: { current: false },
      apply: state,
      api,
    });
    expect(state.setFetchWarning).toHaveBeenLastCalledWith(null);
    expect(state.setError).toHaveBeenCalled();
  });
});
