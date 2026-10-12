import { describe, expect, it } from "vitest";
import {
  buildBookSystemPrompt,
  buildBookUserMessage,
  buildSystemPrompt,
} from "./prompt";

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

describe("buildBookSystemPrompt", () => {
  it("includes the title, author, source language, target language, and rules", () => {
    const prompt = buildBookSystemPrompt({
      title: "Solaris",
      author: "Stanisław Lem",
      sourceLanguage: "Polish",
      targetLanguage: "Ukrainian",
      rules: "Keep the scientific tone.",
    });
    expect(prompt).toContain(
      'You translate the book "Solaris" by Stanisław Lem (original language: Polish) into Ukrainian.',
    );
    expect(prompt).toContain("Rules: Keep the scientific tone.");
    expect(prompt).toContain(
      "The user message contains three tagged blocks: <before> (already read, context only), <translate> (the sentences to translate, numbered), <after> (upcoming, context only).",
    );
    expect(prompt).toContain(
      'Reply with exactly one numbered block per sentence in <translate>, in the same order: "1. <translation>", "2. <translation>", and nothing else.',
    );
  });

  it("omits the author and source language clauses when they are missing", () => {
    const prompt = buildBookSystemPrompt({
      title: "Solaris",
      targetLanguage: "Ukrainian",
      rules: "Keep the scientific tone.",
    });
    expect(prompt).toContain(
      'You translate the book "Solaris" into Ukrainian.',
    );
    expect(prompt).not.toContain(" by ");
    expect(prompt).not.toContain("original language");
  });

  it("treats a null author and source language as missing", () => {
    const prompt = buildBookSystemPrompt({
      title: "Solaris",
      author: null,
      sourceLanguage: null,
      targetLanguage: "Ukrainian",
      rules: "",
    });
    expect(prompt).toContain(
      'You translate the book "Solaris" into Ukrainian.',
    );
    expect(prompt).not.toContain(" by ");
    expect(prompt).not.toContain("(original language");
    expect(prompt).toContain("Rules: None.");
  });

  it("falls back to English and None rules for blank inputs", () => {
    const prompt = buildBookSystemPrompt({
      title: "Solaris",
      targetLanguage: "   ",
      rules: "   ",
    });
    expect(prompt).toContain('You translate the book "Solaris" into English.');
    expect(prompt).toContain("Rules: None.");
  });
});

describe("buildBookUserMessage", () => {
  it("numbers the sentences from 1 and wraps the three tagged blocks", () => {
    const message = buildBookUserMessage({
      before: ["Earlier one.", "Earlier two."],
      sentences: ["First.", "Second.", "Third."],
      after: ["Later one."],
    });
    expect(message).toBe(
      "<before>Earlier one.\nEarlier two.</before>\n<translate>\n1. First.\n2. Second.\n3. Third.\n</translate>\n<after>\nLater one.</after>",
    );
  });

  it("keeps the tags when the context arrays are empty", () => {
    const message = buildBookUserMessage({
      before: [],
      sentences: ["Only."],
      after: [],
    });
    expect(message).toContain("<before></before>");
    expect(message).toContain("<translate>\n1. Only.\n</translate>");
    expect(message).toContain("<after>\n</after>");
  });
});
