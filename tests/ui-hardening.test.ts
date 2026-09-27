import { describe, it, expect } from "vitest";

// Imported from the real client component (not copied) so these tests pin
// shipping code, not a re-implementation of it.
import { tagOverlaps } from "@/app/jobs/JobsClient";
import { FOCUS_AREA_TAXONOMY, ALL_SUB_TAGS } from "@/lib/taxonomy";
import { safeExternalUrl } from "@/lib/safe-url";

describe("safeExternalUrl — XSS guard on externally-ingested hrefs", () => {
  it("rejects javascript: URLs regardless of case or leading whitespace", () => {
    expect(safeExternalUrl("javascript:alert(document.cookie)")).toBeNull();
    expect(safeExternalUrl("JavaScript:alert(1)")).toBeNull();
    expect(safeExternalUrl(" javascript:alert(1)")).toBeNull();
  });

  it("rejects other executable and local-file schemes", () => {
    expect(safeExternalUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(safeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects empty and non-string input", () => {
    expect(safeExternalUrl("")).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  it("allows http and https apply links", () => {
    expect(safeExternalUrl("https://example.com/apply")).toBe("https://example.com/apply");
    expect(safeExternalUrl("http://example.com/apply")).toBe("http://example.com/apply");
  });

  it("allows an uppercase scheme and trims surrounding whitespace", () => {
    expect(safeExternalUrl("HTTPS://EXAMPLE.COM/apply")).toBe("HTTPS://EXAMPLE.COM/apply");
    expect(safeExternalUrl("  https://example.com/apply  ")).toBe("https://example.com/apply");
    expect(safeExternalUrl("\n https://example.com/apply \t")).toBe("https://example.com/apply");
  });
});

describe("tagOverlaps — job tags vs. focus-area sub-tags", () => {
  it("does not match a 1-char tag against Computer Vision or a bare 'c'", () => {
    expect(tagOverlaps(["C"], ["Computer Vision"])).toBe(false);
    expect(tagOverlaps(["c"], FOCUS_AREA_TAXONOMY.ai)).toBe(false);
  });

  it("does not match a 1-char tag against 'robotics' or 'go' style substrings", () => {
    expect(tagOverlaps(["g"], ["Robotics"])).toBe(false);
    expect(tagOverlaps(["o"], ["Robotics", "Motion Planning / Control", "DevOps / SRE"])).toBe(false);
    expect(tagOverlaps(["C"], ALL_SUB_TAGS)).toBe(false);
  });

  it("still matches on exact case-insensitive equality", () => {
    expect(tagOverlaps(["python"], ["Python"])).toBe(true);
    expect(tagOverlaps(["PYTHON"], ["python"])).toBe(true);
    expect(tagOverlaps(["Computer Vision"], FOCUS_AREA_TAXONOMY.ai)).toBe(true);
  });

  it("matches a 4+ char tag on a word boundary against real taxonomy values", () => {
    expect(tagOverlaps(["vision"], ["Computer Vision"])).toBe(true);
    expect(tagOverlaps(["engineering"], FOCUS_AREA_TAXONOMY.cs)).toBe(true);
    expect(tagOverlaps(["vision"], ["Computer Vision Payload"])).toBe(true);
  });

  it("requires a word boundary even when the tag is long enough", () => {
    // "lear" is 4 chars and a substring of "Learning", but sits mid-word.
    expect(tagOverlaps(["lear"], ["Reinforcement Learning"])).toBe(false);
  });

  it("returns false for empty tag or sub-tag lists", () => {
    expect(tagOverlaps([], ["Computer Vision"])).toBe(false);
    expect(tagOverlaps(["python"], [])).toBe(false);
    expect(tagOverlaps([], [])).toBe(false);
  });
});
