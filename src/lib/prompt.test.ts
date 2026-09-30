import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./prompt";

describe("buildSystemPrompt", () => {
  it("includes the target language and rules", () => {
    const prompt = buildSystemPrompt({
      targetLanguage: "Ukrainian",
      rules: "Keep legal terms.",
    });
    expect(prompt).toContain("Ukrainian");
    expect(prompt).toContain("Keep legal terms.");
    expect(prompt).toContain("Output only the translation, no commentary.");
  });

  it("substitutes defaults for empty inputs", () => {
    const prompt = buildSystemPrompt({ targetLanguage: "", rules: "" });
    expect(prompt).toContain("English");
    expect(prompt).toContain("Rules: None.");
  });
});
