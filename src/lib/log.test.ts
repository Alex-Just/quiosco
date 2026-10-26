// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOG_MAX_BYTES,
  LOG_MAX_EVENTS,
  createLogController,
  formatLogExport,
  scrubLogData,
} from "./log";

describe("scrubLogData", () => {
  it("redacts token-like keys and keeps other fields", () => {
    expect(
      scrubLogData({
        provider: "edge",
        appToken: "secret",
        Authorization: "Bearer x",
        nested: { apiKey: "k", ok: 1 },
      }),
    ).toEqual({
      provider: "edge",
      appToken: "[redacted]",
      Authorization: "[redacted]",
      nested: { apiKey: "[redacted]", ok: 1 },
    });
  });
});

describe("formatLogExport", () => {
  it("formats readable lines", () => {
    const text = formatLogExport([
      {
        id: 1,
        ts: Date.parse("2026-10-26T12:00:00.000Z"),
        level: "info",
        category: "tts",
        message: "picked voice",
        data: { provider: "edge" },
      },
    ]);
    expect(text).toContain("2026-10-26T12:00:00.000Z info tts picked voice");
    expect(text).toContain('"provider":"edge"');
  });
});

describe("createLogController", () => {
  beforeEach(() => {
    vi.stubEnv("MODE", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("trims the oldest events when over the event cap", async () => {
    const controller = createLogController({
      dbName: `logs-count-${Math.random()}`,
      maxEvents: 3,
      maxBytes: LOG_MAX_BYTES,
    });
    controller.info("tts", "a");
    controller.info("tts", "b");
    controller.info("tts", "c");
    controller.info("tts", "d");
    await controller.flush();
    const text = await controller.exportLogText();
    const lines = text.split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(text).not.toMatch(/\ba$/m);
    expect(text).toMatch(/\bd$/m);
    await controller.close();
  });

  it("trims when serialized size exceeds the byte cap", async () => {
    const controller = createLogController({
      dbName: `logs-bytes-${Math.random()}`,
      maxEvents: LOG_MAX_EVENTS,
      maxBytes: 200,
    });
    const fat = "x".repeat(80);
    controller.info("tts", fat, { n: 1 });
    controller.info("tts", fat, { n: 2 });
    controller.info("tts", fat, { n: 3 });
    await controller.flush();
    const status = await controller.getLogStatus();
    expect(status.count).toBeLessThan(3);
    expect(status.count).toBeGreaterThan(0);
    await controller.close();
  });

  it("clears memory and storage", async () => {
    const controller = createLogController({
      dbName: `logs-clear-${Math.random()}`,
    });
    controller.warn("tts", "gone");
    await controller.flush();
    await controller.clearLogs();
    expect(await controller.exportLogText()).toBe("");
    expect(await controller.getLogStatus()).toEqual({
      count: 0,
      oldestTs: null,
    });
    await controller.close();
  });

  it("forwards error events to an injected sink", async () => {
    const sink = {
      onBreadcrumb: vi.fn(),
      onError: vi.fn(),
    };
    const controller = createLogController({
      dbName: `logs-sink-${Math.random()}`,
      sink,
    });
    const err = new Error("boom");
    controller.error("tts", "cloud fetch failed", { provider: "edge" }, err);
    await controller.flush();
    expect(sink.onError).toHaveBeenCalled();
    expect(sink.onBreadcrumb).not.toHaveBeenCalled();
    await controller.close();
  });
});
