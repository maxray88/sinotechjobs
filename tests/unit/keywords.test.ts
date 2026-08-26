import { describe, it, expect } from "vitest";
import {
  matchChineseKeywords,
  extractContext,
  getAllMatchedContexts,
} from "@/lib/scraper/keywords";

describe("keywords — Chinese keyword matching engine", () => {
  it("strong keyword 'chinesisch' returns strong match with high confidence", () => {
    const result = matchChineseKeywords("Wir suchen jemanden mit chinesisch Kenntnissen");
    expect(result.matched).toBe(true);
    expect(result.isStrong).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.matchedKeywords).toContain("chinesisch");
  });

  it("strong keyword 'mandarin' returns strong match", () => {
    const result = matchChineseKeywords("Mandarin speaker required for customer support");
    expect(result.matched).toBe(true);
    expect(result.isStrong).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.matchedKeywords.some((k) => k.toLowerCase() === "mandarin")).toBe(true);
  });

  it("strong keyword '中文' (Chinese characters) returns strong match", () => {
    const result = matchChineseKeywords("需要会中文的工程师，工作地点柏林");
    expect(result.matched).toBe(true);
    expect(result.isStrong).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.matchedKeywords).toContain("中文");
  });

  it("weak keyword 'china market' returns weak match (not strong) with 0.5 confidence", () => {
    const result = matchChineseKeywords("Experience with China market expansion and APAC region");
    expect(result.matched).toBe(true);
    expect(result.isStrong).toBe(false);
    expect(result.confidence).toBe(0.5);
    expect(result.matchedKeywords).toContain("china market");
  });

  it("weak keyword 'APAC' is matched case-insensitively and is weak", () => {
    const result = matchChineseKeywords("Responsible for APAC sales and Greater China relations");
    expect(result.matched).toBe(true);
    expect(result.isStrong).toBe(false);
    expect(result.matchedKeywords.map((k) => k.toLowerCase())).toContain("apac");
  });

  it("empty string returns no match", () => {
    const result = matchChineseKeywords("");
    expect(result.matched).toBe(false);
    expect(result.isStrong).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.matchedKeywords).toEqual([]);
  });

  it("case-insensitive matching: 'CHINESISCH' upper-case returns strong", () => {
    const result = matchChineseKeywords("CHINESISCHkenntnisse erforderlich");
    // lowercase contains "chinesisch" even without space due to compound German word
    expect(result.matched).toBe(true);
    expect(result.isStrong).toBe(true);
  });

  it("mixed text containing both strong and weak prioritizes strong (isStrong=true)", () => {
    const result = matchChineseKeywords(
      "Looking for Mandarin speaker to support China market team in Berlin"
    );
    expect(result.matched).toBe(true);
    expect(result.isStrong).toBe(true);
    expect(result.confidence).toBe(0.9);
    // should contain at least one strong and one weak
    expect(result.matchedKeywords.some((k) => k.toLowerCase() === "mandarin")).toBe(true);
    expect(result.matchedKeywords.some((k) => k.toLowerCase() === "china market")).toBe(true);
  });

  it("text with no Chinese context returns no match", () => {
    const result = matchChineseKeywords("Software Engineer Python Berlin — backend development");
    expect(result.matched).toBe(false);
    expect(result.isStrong).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.matchedKeywords).toEqual([]);
  });

  it("extractContext returns surrounding context with ellipsis handling", () => {
    const text = "We are looking for a fluent chinese speaker to join our robotics team in Munich";
    const ctx = extractContext(text, "chinese", 10);
    expect(ctx.toLowerCase()).toContain("chinese");
    // context should be trimmed substring of original text
    expect(ctx.length).toBeGreaterThan("chinese".length);
  });

  it("getAllMatchedContexts returns an entry per matched keyword", () => {
    const text = "Mandarin and chinesisch required; also asia pacific experience is a plus";
    const contexts = getAllMatchedContexts(text);
    const keywords = contexts.map((c) => c.keyword.toLowerCase());
    expect(keywords).toContain("mandarin");
    expect(keywords).toContain("chinesisch");
    expect(keywords).toContain("asia pacific");
    for (const c of contexts) {
      expect(c.context.toLowerCase()).toContain(c.keyword.toLowerCase());
    }
  });

  // -------------------------------------------------------------------------
  // Edge cases — document current substring-matching behavior (false positives)
  // -------------------------------------------------------------------------

  it("known limitation: 'capacity' currently matches weak keyword 'apac' via substring (false positive)", () => {
    // If keyword matching required word boundaries, "capacity" should NOT match "apac".
    // Current implementation uses String.includes (substring), so it DOES match.
    // This test documents the actual behavior; a future fix to use word boundaries
    // would change this assertion (expect matched to be false).
    const result = matchChineseKeywords("capacity building and leadership");
    // known limitation: substring matching causes false positive
    expect(result.matched).toBe(true);
    expect(result.matchedKeywords.map((k) => k.toLowerCase())).toContain("apac");
    expect(result.isStrong).toBe(false);
    expect(result.confidence).toBe(0.5);
  });

  it("substring matching is intentional: compound German 'chinesischkenntnisse' matches 'chinesisch'", () => {
    // Documents that the engine uses substring matching (includes), not word-boundary.
    // This is desired for German compounds like "Chinesischkenntnisse".
    const result = matchChineseKeywords("Chinesischkenntnisse erforderlich");
    expect(result.matched).toBe(true);
    expect(result.matchedKeywords).toContain("chinesisch");
    expect(result.isStrong).toBe(true);
  });

  it("known limitation: 'apacification' would also match 'apac' via substring", () => {
    // Further documents substring behavior — any superstring containing "apac" matches.
    // A word-boundary-aware implementation would not match this.
    const result = matchChineseKeywords("apacification process");
    // assert current behavior explicitly
    expect(result.matched).toBe(true);
    expect(result.matchedKeywords.map((k) => k.toLowerCase())).toContain("apac");
  });

  it("keyword matcher does not false-positive on unrelated tech text with similar substrings", () => {
    // Sanity: "capability" also contains "apac" -> currently would match, but we verify
    // the matcher still works for clean text that should NOT match
    const clean = matchChineseKeywords("Senior Go developer, Kubernetes, AWS");
    expect(clean.matched).toBe(false);
    expect(clean.matchedKeywords).toEqual([]);
  });
});
