import { describe, expect, it } from "vitest";
import { buildSsml } from "./edgeTtsClient";

describe("buildSsml", () => {
  it("keeps the default prosody at a normal rate", () => {
    const ssml = buildSsml("Hola.", "es-ES-ElviraNeural", 1);
    expect(ssml).toContain('<voice name="es-ES-ElviraNeural">');
    expect(ssml).toContain(
      '<prosody rate="default" pitch="default" volume="default">Hola.</prosody>',
    );
  });

  it("encodes other rates as signed whole percentages", () => {
    expect(buildSsml("Hola.", "es-ES-ElviraNeural", 1.5)).toContain(
      'rate="+50%"',
    );
    expect(buildSsml("Hola.", "es-ES-ElviraNeural", 0.8)).toContain(
      'rate="-20%"',
    );
    expect(buildSsml("Hola.", "es-ES-ElviraNeural", 1.25)).toContain(
      'rate="+25%"',
    );
  });

  it("escapes the text and drops control characters", () => {
    const ssml = buildSsml("A & B <c>\u0007", "es-ES-ElviraNeural", 1);
    expect(ssml).toContain("A &amp; B &lt;c&gt; ");
    expect(ssml).not.toContain("\u0007");
  });
});
