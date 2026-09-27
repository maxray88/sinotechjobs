import { getAllJobs } from "./all-jobs";
import type { Job } from "./types";

export type CompanyEntry = { slug: string; name: string };

/**
 * FNV-1a, 32-bit, rendered as base36 and truncated. Deterministic across
 * requests, processes and deployments — unlike Math.random, which would hand a
 * company a different slug on every render and 404 every inbound link.
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

export function slugifyCompany(name: string): string {
  const trimmed = name.trim();
  // A blank name has no usable slug at all; "" is the caller's signal to drop
  // the entry rather than emit a link to /companies/.
  if (!trimmed) return "";

  const slug = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  // Every character was non-latin or stripped as a separator ("北京科技",
  // "🙂", "!!!") -> the slug reduced to "". Hash the original name so the
  // company still gets its own stable, non-empty page.
  return slug || `c-${shortHash(trimmed)}`;
}

/**
 * Slug -> company name for a set of names, disambiguating collisions.
 *
 * "Müller" and "Muller" both reduce to "muller"; so do "Foo/Bar" and
 * "Foo Bar". Silently merging them puts two distinct employers on one page
 * and hands the wrong name to anyone resolving slug -> name, so the second
 * claimant of a slug gets a deterministic hash suffix.
 *
 * Exported so slug resolution happens through ONE function everywhere; a
 * caller that re-derives slugs with `slugifyCompany` alone will not see the
 * suffix and will fail to resolve it.
 */
export function resolveCompanyEntries(
  names: string[],
): CompanyEntry[] {
  const entries: CompanyEntry[] = [];
  // slug -> the exact company name that claimed it
  const claimedBy = new Map<string, string>();

  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;

    let slug = slugifyCompany(name);
    const owner = claimedBy.get(slug);
    if (owner !== undefined && owner !== name) {
      const base = `${slug}-${shortHash(name)}`;
      slug = base;
      // The hash suffix could itself land on a taken slug; walk deterministically.
      let n = 2;
      while (claimedBy.has(slug) && claimedBy.get(slug) !== name) {
        slug = `${base}-${n}`;
        n++;
      }
    }
    if (claimedBy.has(slug)) continue; // same name seen again

    claimedBy.set(slug, name);
    entries.push({ slug, name });
  }

  return entries;
}

/**
 * The company a slug belongs to, resolved through the same disambiguation pass
 * that minted the slug.
 *
 * The pass is order-dependent: with ["Muller", "Müller"] the first name keeps
 * the bare "muller" and the second gets "muller-<hash>". So `names` must be the
 * full list, in the same order, as when the slug was issued — resolving against
 * a subset can hand back the wrong name or nothing at all.
 */
export function resolveCompanyEntry(
  names: string[],
  slug: string,
): CompanyEntry | undefined {
  return resolveCompanyEntries(names).find((entry) => entry.slug === slug);
}

/**
 * The canonical slug -> name index for a given job list, warning about jobs
 * that cannot be linked.
 *
 * Every consumer should call this with the SAME job list it renders from. The
 * disambiguation pass is order-dependent, so resolving a slug against a
 * differently-ordered list (or a partial one) can assign a different company
 * to a slug than the page that slug links to.
 */
export function companyEntriesFromJobs(jobs: Job[]): CompanyEntry[] {
  const dropped = jobs.filter((job) => slugifyCompany(job.company) === "");

  // A /companies/ link with an empty slug is a 404, not a style bug. Report
  // the count so a source producing unnamed companies is visible in logs.
  if (dropped.length > 0) {
    console.warn(
      `[companies] dropped ${dropped.length} job(s) with an unusable company ` +
        `slug — they would otherwise link to /companies/ and 404`,
    );
  }

  return resolveCompanyEntries(jobs.map((job) => job.company));
}

/**
 * Disambiguated company slugs. Prefer `companyEntriesFromJobs` when the caller
 * already holds the job list, so the index is built from one consistent read.
 */
export async function getCompanies(): Promise<string[]> {
  const jobs = await getAllJobs();
  return companyEntriesFromJobs(jobs).map((entry) => entry.slug);
}
