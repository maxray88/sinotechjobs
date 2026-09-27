"use client";

import { useState, useMemo } from "react";
import { useLang } from "@/components/LanguageProvider";
import type { Job, JobField } from "@/lib/types";
import Link from "next/link";
import SaveButton from "@/components/SaveButton";
import JobCard from "@/components/JobCard";
import SearchFilters, { type SearchFiltersState } from "@/components/SearchFilters";
import {
  adaptJob,
  computeMatchScore,
  type CandidateProfile,
  type FocusArea,
} from "@/lib/matching";
import { FOCUS_AREA_TAXONOMY } from "@/lib/taxonomy";

const FIELD_TO_FOCUS: Record<JobField, FocusArea> = {
  ai: "ai_ml",
  cs: "cs",
  robotics: "robotics",
  drone: "drones_uav",
  remote: "remote",
};

const MATCH_BADGE_THRESHOLD = 70;

/** Picked once at module load: the first focus area declared in the taxonomy. */
const DEFAULT_FOCUS_FIELD = Object.keys(FOCUS_AREA_TAXONOMY)[0] as JobField;

/** Most frequent location across a job list, so the demo profile can target it. */
function mostCommonLocation(jobs: Job[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  let bestCount = 0;
  for (const job of jobs) {
    const next = (counts.get(job.location) ?? 0) + 1;
    counts.set(job.location, next);
    if (next > bestCount) {
      bestCount = next;
      best = job.location;
    }
  }
  return best;
}

function buildDemoCandidate(
  field: JobField | undefined,
  subTags: string[],
  desiredLocation: string,
): CandidateProfile {
  return {
    id: "demo",
    full_name: "Demo Candidate",
    current_location: "Berlin",
    desired_location: [desiredLocation],
    visa_status: "eu_citizen",
    focus_area: FIELD_TO_FOCUS[field ?? DEFAULT_FOCUS_FIELD],
    sub_specializations: subTags,
    years_of_experience: 5,
    current_role: "Engineer",
    bio: "",
    languages: {},
    hsk_level: 5,
    salary_expectation_min: 60000,
    salary_expectation_max: 80000,
    chinese_university: "Tsinghua University",
    hometown_province: null,
    profile_completeness: 90,
    last_active_at: new Date().toISOString(),
  };
}

/** Exact match always wins; substring only when the shorter tag is 4+ chars at a word boundary. */
export function tagOverlaps(jobTags: string[], subTags: string[]): boolean {
  const lower = jobTags.map((t) => t.toLowerCase());
  return subTags.some((sub) => {
    const s = sub.toLowerCase();
    return lower.some((t) => {
      if (t === s) return true;
      const shorter = t.length < s.length ? t : s;
      const longer = shorter === t ? s : t;
      if (shorter.length < 4) return false;
      let from = 0;
      for (;;) {
        const idx = longer.indexOf(shorter, from);
        if (idx === -1) return false;
        const before = idx === 0 ? "" : longer[idx - 1];
        const after = longer[idx + shorter.length] ?? "";
        const atBoundary = !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
        if (atBoundary) return true;
        from = idx + 1;
      }
    });
  });
}

export default function JobsClient({ allJobs }: { allJobs: Job[] }) {
  const { t, lang } = useLang();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<SearchFiltersState>({});

  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        job.title.toLowerCase().includes(searchLower) ||
        (job.titleZh ?? "").toLowerCase().includes(searchLower) ||
        job.company.toLowerCase().includes(searchLower) ||
        job.tags.some((tag) => tag.toLowerCase().includes(searchLower));

      const matchesField = !filters.field || job.field === filters.field;
      const matchesLocation = !filters.location || job.locationCode === filters.location;
      const matchesLanguage = !filters.languageLevel || job.languageLevel === filters.languageLevel;
      const matchesEmployment = !filters.employmentType || job.employmentType === filters.employmentType;
      const matchesVisa = !filters.visaSponsorship || job.visaSponsorship;
      const matchesRemote = !filters.remoteFriendly || job.remoteFriendly;
      const matchesSubTags =
        !filters.subTags ||
        filters.subTags.length === 0 ||
        tagOverlaps(job.tags, filters.subTags);

      return (
        matchesSearch &&
        matchesField &&
        matchesLocation &&
        matchesLanguage &&
        matchesEmployment &&
        matchesVisa &&
        matchesRemote &&
        matchesSubTags
      );
    });
  }, [allJobs, search, filters]);

  const matchByJobId = useMemo(() => {
    // One immutable profile for every card, so scores stay comparable across
    // jobs. The focus area and desired location are resolved once here, never
    // retro-fitted to whichever job is being scored.
    const candidate = buildDemoCandidate(
      filters.field,
      filters.subTags ?? [],
      mostCommonLocation(filteredJobs) ?? "Berlin",
    );
    const map = new Map<string, { score: number; reasons: string[] }>();
    for (const job of filteredJobs) {
      const criteria = adaptJob(job);
      const result = computeMatchScore(candidate, criteria);
      if (result.hardFilterPass && result.score >= MATCH_BADGE_THRESHOLD) {
        map.set(job.id, { score: result.score, reasons: result.reasons });
      }
    }
    return map;
  }, [filteredJobs, filters.field, filters.subTags]);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>
        {t.jobs.title}
      </h1>
      <p
        role="status"
        style={{ color: "var(--muted-foreground)", marginBottom: "2rem", fontSize: "0.875rem" }}
      >
        {filteredJobs.length} {lang === "zh" ? "个职位" : lang === "de" ? "Jobs" : "jobs found"}
      </p>

      {/* Search */}
      <div style={{ marginBottom: "1.5rem" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.jobs.filters.search}
          aria-label={t.jobs.filters.search}
          style={{
            width: "100%",
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: "0.875rem",
            outline: "none",
          }}
        />
      </div>

      {/* Filters */}
      <SearchFilters lang={lang} initialFilters={filters} onFiltersChange={setFilters} />

      {/* Job List */}
      {filteredJobs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>{t.jobs.emptyLiveCTA.title}</p>
          <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)", marginBottom: "1.5rem" }}>{t.jobs.noResults}</p>
          <Link href="/post" className="btn-primary" style={{ display: "inline-block", textDecoration: "none" }}>
            {t.jobs.emptyLiveCTA.cta}
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem" }}>
          {filteredJobs.map((job: Job) => {
            const match = matchByJobId.get(job.id);
            return (
              <div key={job.id} style={{ position: "relative" }}>
                <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 1 }}>
                  <SaveButton jobId={job.id} size="sm" />
                </div>
                <JobCard
                  job={job}
                  lang={lang}
                  matchScore={match?.score}
                  matchReasons={match?.reasons}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
