import { describe, it, expect } from "vitest";
import { translations } from "@/lib/i18n";

type Locale = keyof typeof translations;
const LOCALES: Locale[] = ["en", "zh", "de"];

/**
 * Deep-walk any value, collecting leaf string paths.
 * - strings are leaves -> emit prefix
 * - arrays are expanded as `prefix[0]`, `prefix[1]`, …
 * - plain objects are expanded as `prefix.key`
 * Example: "nav.jobs", "hero.stats.jobs", "valueProps.items[0].title"
 */
function collectLeafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    return prefix ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, idx) => {
      const next = prefix ? `${prefix}[${idx}]` : `[${idx}]`;
      return collectLeafPaths(item, next);
    });
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    // empty object -> no leaves
    if (entries.length === 0) return prefix ? [prefix] : [];
    return entries.flatMap(([k, v]) => {
      const next = prefix ? `${prefix}.${k}` : k;
      return collectLeafPaths(v, next);
    });
  }
  // numbers / booleans / null etc. treat as leaf if prefix exists (should not happen in i18n)
  return prefix ? [prefix] : [];
}

/**
 * Resolve a dot+bracket path like `valueProps.items[0].title` against a root object.
 */
function getValueAtPath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = path.split(".");
  let cur: unknown = root;
  for (const rawPart of parts) {
    if (cur === null || cur === undefined) return undefined;
    // handle keys with bracket suffixes, e.g. "items[0][1]"
    const m = rawPart.match(/^([^\[]+)((?:\[\d+\])*)$/);
    if (!m) {
      cur = (cur as Record<string, unknown>)[rawPart];
      continue;
    }
    const [, key, brackets] = m;
    cur = (cur as Record<string, unknown>)[key];
    if (brackets) {
      const indices = [...brackets.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
      for (const idx of indices) {
        if (cur === null || cur === undefined) break;
        cur = (cur as unknown[])[idx];
      }
    }
  }
  return cur;
}

function sorted(arr: string[]): string[] {
  return [...arr].sort();
}

describe("i18n parity — locales EN/ZH/DE", () => {
  const pathsByLocale: Record<Locale, string[]> = {
    en: sorted(collectLeafPaths(translations.en)),
    zh: sorted(collectLeafPaths(translations.zh)),
    de: sorted(collectLeafPaths(translations.de)),
  };

  const setsByLocale: Record<Locale, Set<string>> = {
    en: new Set(pathsByLocale.en),
    zh: new Set(pathsByLocale.zh),
    de: new Set(pathsByLocale.de),
  };

  // Union of all keys for exhaustive per-key checks
  const allUnion = sorted([...new Set([...pathsByLocale.en, ...pathsByLocale.zh, ...pathsByLocale.de])]);

  it("EN, ZH, DE have identical key sets (no missing or extra keys)", () => {
    const enSet = setsByLocale.en;
    const zhSet = setsByLocale.zh;
    const deSet = setsByLocale.de;

    const missingInZh = pathsByLocale.en.filter((k) => !zhSet.has(k));
    const missingInDe = pathsByLocale.en.filter((k) => !deSet.has(k));
    const missingInEnFromZh = pathsByLocale.zh.filter((k) => !enSet.has(k));
    const missingInEnFromDe = pathsByLocale.de.filter((k) => !enSet.has(k));

    // Also detect any divergence between ZH and DE
    const missingInDeFromZh = pathsByLocale.zh.filter((k) => !deSet.has(k));
    const missingInZhFromDe = pathsByLocale.de.filter((k) => !zhSet.has(k));

    const parts: string[] = [];
    if (missingInZh.length) parts.push(`Missing in ZH (present in EN): ${missingInZh.join(", ")}`);
    if (missingInDe.length) parts.push(`Missing in DE (present in EN): ${missingInDe.join(", ")}`);
    if (missingInEnFromZh.length) parts.push(`Missing in EN (present in ZH): ${missingInEnFromZh.join(", ")}`);
    if (missingInEnFromDe.length) parts.push(`Missing in EN (present in DE): ${missingInEnFromDe.join(", ")}`);
    if (missingInDeFromZh.length) parts.push(`Missing in DE (present in ZH): ${missingInDeFromZh.join(", ")}`);
    if (missingInZhFromDe.length) parts.push(`Missing in ZH (present in DE): ${missingInZhFromDe.join(", ")}`);

    // Print union size for debugging
    // eslint-disable-next-line no-console
    if (parts.length) console.error(parts.join("\n"));

    expect(parts, parts.join("\n")).toEqual([]);
    // Hard parity: sets must be exactly equal
    expect(pathsByLocale.en).toEqual(pathsByLocale.zh);
    expect(pathsByLocale.en).toEqual(pathsByLocale.de);
    // sanity: we actually collected keys
    expect(pathsByLocale.en.length).toBeGreaterThan(0);
    expect(allUnion.length).toBe(pathsByLocale.en.length);
  });

  it("all keys have non-empty string values in every locale (no empty strings)", () => {
    const emptyPerLocale: Record<Locale, string[]> = { en: [], zh: [], de: [] };

    for (const locale of LOCALES) {
      for (const p of pathsByLocale[locale]) {
        const v = getValueAtPath(translations[locale], p);
        if (typeof v !== "string" || v.trim().length === 0) {
          emptyPerLocale[locale].push(p);
        }
      }
    }

    const errs: string[] = [];
    for (const locale of LOCALES) {
      if (emptyPerLocale[locale].length) {
        errs.push(`Empty in ${locale.toUpperCase()}: ${emptyPerLocale[locale].join(", ")}`);
      }
    }
    expect(errs, errs.join("\n")).toEqual([]);
  });

  it("hero and jobs namespaces have no empty strings in any locale", () => {
    const namespaces = ["hero", "jobs"];
    const failures: string[] = [];

    for (const locale of LOCALES) {
      const relevant = pathsByLocale[locale].filter((p) => namespaces.some((ns) => p === ns || p.startsWith(ns + ".")));
      expect(relevant.length).toBeGreaterThan(0);
      for (const p of relevant) {
        const v = getValueAtPath(translations[locale], p);
        if (typeof v !== "string" || v.trim().length === 0) {
          failures.push(`${locale}:${p}`);
        }
      }
    }

    expect(failures, `Empty in hero/jobs: ${failures.join(", ")}`).toEqual([]);
  });

  it("footer, nav, post, emailCapture, valueProps namespaces are also fully translated (no extra/missing)", () => {
    const namespaces = ["nav", "footer", "post", "emailCapture", "valueProps"];
    for (const ns of namespaces) {
      const enKeys = pathsByLocale.en.filter((p) => p === ns || p.startsWith(ns + "."));
      const zhKeys = pathsByLocale.zh.filter((p) => p === ns || p.startsWith(ns + "."));
      const deKeys = pathsByLocale.de.filter((p) => p === ns || p.startsWith(ns + "."));
      expect(enKeys.length, `EN ${ns} should have keys`).toBeGreaterThan(0);
      expect(zhKeys, `ZH ${ns} mismatch vs EN`).toEqual(enKeys);
      expect(deKeys, `DE ${ns} mismatch vs EN`).toEqual(enKeys);
    }
  });

  // ------------------------------------------------------------------
  // Per-key parity: one test per key path (generates 80+ tests -> satisfies 40+ requirement)
  // ------------------------------------------------------------------
  describe("per-key parity — each EN key exists in ZH and DE", () => {
    for (const key of pathsByLocale.en) {
      it(`key "${key}" exists in ZH and DE`, () => {
        expect(setsByLocale.zh.has(key), `Missing in ZH: ${key}`).toBe(true);
        expect(setsByLocale.de.has(key), `Missing in DE: ${key}`).toBe(true);
      });
    }
  });

  describe("per-key non-empty — ZH", () => {
    for (const key of pathsByLocale.zh) {
      it(`ZH "${key}" is a non-empty string`, () => {
        const v = getValueAtPath(translations.zh, key);
        expect(typeof v).toBe("string");
        expect((v as string).trim().length, `Empty ZH:${key}`).toBeGreaterThan(0);
      });
    }
  });

  describe("per-key non-empty — DE", () => {
    for (const key of pathsByLocale.de) {
      it(`DE "${key}" is a non-empty string`, () => {
        const v = getValueAtPath(translations.de, key);
        expect(typeof v).toBe("string");
        expect((v as string).trim().length, `Empty DE:${key}`).toBeGreaterThan(0);
      });
    }
  });

  describe("per-key non-empty — EN", () => {
    for (const key of pathsByLocale.en) {
      it(`EN "${key}" is a non-empty string`, () => {
        const v = getValueAtPath(translations.en, key);
        expect(typeof v).toBe("string");
        expect((v as string).trim().length, `Empty EN:${key}`).toBeGreaterThan(0);
      });
    }
  });

  // Symmetry: also ensure ZH/DE have no extra keys beyond EN (implicitly covered above, but explicit)
  describe("no extra keys in ZH/DE beyond EN", () => {
    for (const key of pathsByLocale.zh) {
      it(`ZH key "${key}" exists in EN`, () => {
        expect(setsByLocale.en.has(key), `Extra in ZH not in EN: ${key}`).toBe(true);
      });
    }
    for (const key of pathsByLocale.de) {
      it(`DE key "${key}" exists in EN`, () => {
        expect(setsByLocale.en.has(key), `Extra in DE not in EN: ${key}`).toBe(true);
      });
    }
  });
});
