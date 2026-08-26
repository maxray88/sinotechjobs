const CHINESE_KEYWORDS = [
  "chinese",
  "chinesisch",
  "mandarin",
  "中文",
  "汉语",
  "中国",
  "china market",
  "china team",
  "chinesischem",
  "chinesischer",
  "chinesisches",
  "muttersprache chinesisch",
  "chinese native",
  "native chinese",
  "fluent chinese",
  "business chinese",
  "technical chinese",
  "chinese language",
  "chinesische sprachkenntnisse",
  "sprache chinesisch",
  "chinese (mandarin)",
  "chinesisch (mandarin)",
  "kenntnisse chinesisch",
  "china-erfahrung",
  "china experience",
  "asia pacific",
  "apac",
  "greater china",
] as const;

const STRONG_KEYWORDS = [
  "chinese",
  "chinesisch",
  "mandarin",
  "中文",
  "汉语",
  "native chinese",
  "fluent chinese",
  "chinese language",
  "chinesische sprachkenntnisse",
  "muttersprache chinesisch",
] as const;

const WEAK_KEYWORDS = [
  "china market",
  "china team",
  "china experience",
  "china-erfahrung",
  "asia pacific",
  "apac",
  "greater china",
] as const;

export interface KeywordMatchResult {
  matched: boolean;
  isStrong: boolean;
  matchedKeywords: string[];
  confidence: number;
}

export function matchChineseKeywords(text: string): KeywordMatchResult {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  let isStrong = false;

  for (const kw of CHINESE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      matched.push(kw);
      if (STRONG_KEYWORDS.some((s) => s.toLowerCase() === kw.toLowerCase())) {
        isStrong = true;
      }
    }
  }

  const confidence = isStrong ? 0.9 : matched.length > 0 ? 0.5 : 0;

  return {
    matched: matched.length > 0,
    isStrong,
    matchedKeywords: [...new Set(matched)],
    confidence,
  };
}

export function extractContext(text: string, keyword: string, contextChars = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx === -1) return "";

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + keyword.length + contextChars);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";

  return prefix + text.substring(start, end).trim() + suffix;
}

export function getAllMatchedContexts(text: string): { keyword: string; context: string }[] {
  const result = matchChineseKeywords(text);
  return result.matchedKeywords.map((kw) => ({
    keyword: kw,
    context: extractContext(text, kw),
  }));
}

export { CHINESE_KEYWORDS, STRONG_KEYWORDS, WEAK_KEYWORDS };
