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

const FIELD_TO_FOCUS: Record<JobField, FocusArea> = {
  ai: "ai_ml",
  cs: "cs",
  robotics: "robotics",
  drone: "drones_uav",
  remote: "remote",
};

const MATCH_BADGE_THRESHOLD = 70;

function buildDemoCandidate(field: JobField | undefined, subTags: string[]): CandidateProfile {
  return {
    id: "demo",
    full_name: "Demo Candidate",
    current_location: "Berlin",
    desired_location: ["Berlin"],
    visa_status: "eu_citizen",
    focus_area: field ? FIELD_TO_FOCUS[field] : "ai_ml",
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

/** Flexible overlap: exact, case-insensitive, or either side contains the other. */
function tagOverlaps(jobTags: string[], subTags: string[]): boolean {
  const lower = jobTags.map((t) => t.toLowerCase());
  return subTags.some((sub) => {
    const s = sub.toLowerCase();
    return lower.some((t) => t === s || t.includes(s) || s.includes(t));
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
        job.titleZh.includes(search) ||
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
    const candidate = buildDemoCandidate(filters.field, filters.subTags ?? []);
    const map = new Map<string, { score: number; reasons: string[] }>();
    for (const job of filteredJobs) {
      const criteria = adaptJob(job);
      if (!filters.field) {
        // No field filter: align candidate focus with the job so the hard
        // focus-area gate doesn't zero every score.
        candidate.focus_area = criteria.focus_area;
      }
      // Align desired location with the job location string so the demo
      // score reflects soft-signal fit rather than the hard location gate.
      candidate.desired_location = [criteria.location];
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
      <p style={{ color: "var(--muted-foreground)", marginBottom: "2rem", fontSize: "0.875rem" }}>
        {filteredJobs.length} {lang === "zh" ? "个职位" : lang === "de" ? "Jobs" : "jobs found"}
      </p>

      {/* Search */}
      <div style={{ marginBottom: "1.5rem" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.jobs.filters.search}
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
