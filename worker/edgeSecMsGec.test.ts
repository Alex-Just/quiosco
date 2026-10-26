import { describe, expect, it } from "vitest";
import { generateSecMsGecV2, SEC_MS_GEC_VERSION_V2 } from "./edgeSecMsGec";

/** Fixed Unix second used to pin the CS64-SHA256 digest against node-edge-tts. */
const REFERENCE_UNIX_SECONDS = 1_761_490_000;
const REFERENCE_TOKEN =
  "D03C83810E2DC054-314FA467C329F280FF3410E34E507E777C7A5A3CFB12EA43554FD082B06570B7";

describe("generateSecMsGecV2", () => {
  it("matches the node-edge-tts v2 token for a fixed timestamp", async () => {
    expect(SEC_MS_GEC_VERSION_V2).toBe("2-143.0.3650.75");
    await expect(generateSecMsGecV2(REFERENCE_UNIX_SECONDS)).resolves.toBe(
      REFERENCE_TOKEN,
    );
  });
});
