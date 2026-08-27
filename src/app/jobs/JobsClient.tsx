"use client";

import { useState, useMemo } from "react";
import { useLang } from "@/components/LanguageProvider";
import type { JobField, JobLocation, LanguageLevel, EmploymentType, Job } from "@/lib/types";
import Link from "next/link";
import SaveButton from "@/components/SaveButton";

export default function JobsClient({ allJobs }: { allJobs: Job[] }) {
  const { t, lang } = useLang();
  const [search, setSearch] = useState("");
  const [fieldFilter, setFieldFilter] = useState<JobField | "all">("all");
  const [locationFilter, setLocationFilter] = useState<JobLocation | "all">("all");
  const [languageFilter, setLanguageFilter] = useState<LanguageLevel | "all">("all");
  const [employmentFilter, setEmploymentFilter] = useState<EmploymentType | "all">("all");
  const [visaOnly, setVisaOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);

  const filteredJobs = useMemo(() => {
    return allJobs.filter((job) => {
      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        job.title.toLowerCase().includes(searchLower) ||
        job.titleZh.includes(search) ||
        job.company.toLowerCase().includes(searchLower) ||
        job.tags.some((tag) => tag.toLowerCase().includes(searchLower));

      const matchesField = fieldFilter === "all" || job.field === fieldFilter;
      const matchesLocation = locationFilter === "all" || job.locationCode === locationFilter;
      const matchesLanguage = languageFilter === "all" || job.languageLevel === languageFilter;
      const matchesEmployment = employmentFilter === "all" || job.employmentType === employmentFilter;
      const matchesVisa = !visaOnly || job.visaSponsorship;
      const matchesRemote = !remoteOnly || job.remoteFriendly;

      return matchesSearch && matchesField && matchesLocation && matchesLanguage && matchesEmployment && matchesVisa && matchesRemote;
    });
  }, [allJobs, search, fieldFilter, locationFilter, languageFilter, employmentFilter, visaOnly, remoteOnly]);

  const clearFilters = () => {
    setSearch("");
    setFieldFilter("all");
    setLocationFilter("all");
    setLanguageFilter("all");
    setEmploymentFilter("all");
    setVisaOnly(false);
    setRemoteOnly(false);
  };

  const selectStyle: React.CSSProperties = {
    padding: "0.5rem 0.75rem",
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: "0.875rem",
    outline: "none",
    cursor: "pointer",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    fontWeight: 600,
    color: "var(--muted-foreground)",
    marginBottom: "0.375rem",
    display: "block",
    textTransform: "uppercase",
    letterSpacing: "0.025em",
  };

  const fieldColors: Record<JobField, string> = {
    ai: "#8b5cf6",
    cs: "#3b82f6",
    robotics: "#f59e0b",
    drone: "#10b981",
    remote: "#6366f1",
  };

  const languageLevelBadge: Record<LanguageLevel, { bg: string; color: string }> = {
    "nice-to-have": { bg: "#fef3c7", color: "#92400e" },
    required: { bg: "#fed7aa", color: "#9a3412" },
    fluent: { bg: "#fecaca", color: "#991b1b" },
  };

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
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div>
          <label style={labelStyle}>{t.jobs.filters.field}</label>
          <select
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value as JobField | "all")}
            style={selectStyle}
          >
            <option value="all">{t.jobs.fields.all}</option>
            <option value="ai">{t.jobs.fields.ai}</option>
            <option value="cs">{t.jobs.fields.cs}</option>
            <option value="robotics">{t.jobs.fields.robotics}</option>
            <option value="drone">{t.jobs.fields.drone}</option>
            <option value="remote">{t.jobs.fields.remote}</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t.jobs.filters.location}</label>
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value as JobLocation | "all")}
            style={selectStyle}
          >
            <option value="all">{t.jobs.locations.all}</option>
            <option value="de">{t.jobs.locations.de}</option>
            <option value="at">{t.jobs.locations.at}</option>
            <option value="ch">{t.jobs.locations.ch}</option>
            <option value="remote">{t.jobs.locations.remote}</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t.jobs.filters.languageLevel}</label>
          <select
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value as LanguageLevel | "all")}
            style={selectStyle}
          >
            <option value="all">{t.jobs.languageLevels.all}</option>
            <option value="nice-to-have">{t.jobs.languageLevels["nice-to-have"]}</option>
            <option value="required">{t.jobs.languageLevels["required"]}</option>
            <option value="fluent">{t.jobs.languageLevels["fluent"]}</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t.jobs.filters.employmentType}</label>
          <select
            value={employmentFilter}
            onChange={(e) => setEmploymentFilter(e.target.value as EmploymentType | "all")}
            style={selectStyle}
          >
            <option value="all">{t.jobs.employmentTypes.all}</option>
            <option value="full-time">{t.jobs.employmentTypes["full-time"]}</option>
            <option value="part-time">{t.jobs.employmentTypes["part-time"]}</option>
            <option value="internship">{t.jobs.employmentTypes["internship"]}</option>
            <option value="contract">{t.jobs.employmentTypes["contract"]}</option>
          </select>
        </div>
      </div>

      {/* Toggle filters */}
      <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
          <input type="checkbox" checked={visaOnly} onChange={(e) => setVisaOnly(e.target.checked)} />
          {t.jobs.visaOnly}
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
          <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
          {t.jobs.remoteOnly}
        </label>
        <button onClick={clearFilters} className="btn-outline" style={{ fontSize: "0.75rem", padding: "0.25rem 0.75rem" }}>
          {t.jobs.filters.clear}
        </button>
      </div>

      {/* Job List */}
      {filteredJobs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--muted-foreground)" }}>
          <p style={{ fontSize: "1.125rem" }}>{t.jobs.noResults}</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1.5rem" }}>
          {filteredJobs.map((job: Job) => (
            <div key={job.id} className="card" style={{ position: "relative" }}>
              <div style={{ position: "absolute", top: "0.75rem", right: "0.75rem", zIndex: 1 }}>
                <SaveButton jobId={job.id} size="sm" />
              </div>
              <Link href={`/jobs/${job.id}`} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
                <div style={{ flex: "1", minWidth: "250px" }}>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                    <span
                      style={{
                        display: "inline-block",
                        background: fieldColors[job.field],
                        color: "white",
                        padding: "0.125rem 0.5rem",
                        borderRadius: "9999px",
                        fontSize: "0.6875rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {t.jobs.fields[job.field]}
                    </span>
                    {job.featured && <span className="badge-featured">{t.jobs.featured}</span>}
                    {job.remoteFriendly && <span className="badge-remote">Remote</span>}
                    {job.visaSponsorship && <span className="badge-visa">Visa</span>}
                    {job.id.startsWith("scraped") && (
                      <span style={{ background: "#e0e7ff", color: "#3730a3", padding: "0.125rem 0.5rem", borderRadius: "9999px", fontSize: "0.6875rem", fontWeight: 700 }}>
                        Scraped
                      </span>
                    )}
                  </div>
                  <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, marginBottom: "0.25rem", lineHeight: 1.4 }}>
                    {lang === "zh" ? job.titleZh : job.title}
                  </h3>
                  <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginBottom: "0.5rem" }}>
                    {job.company} · {job.location}
                  </p>
                  <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                    {job.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="tag">{tag}</span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    style={{
                      display: "inline-block",
                      background: languageLevelBadge[job.languageLevel].bg,
                      color: languageLevelBadge[job.languageLevel].color,
                      padding: "0.125rem 0.5rem",
                      borderRadius: "9999px",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                      marginBottom: "0.25rem",
                    }}
                  >
                    {lang === "zh" ? "中文" : "Chinese"}: {t.jobs.languageLevels[job.languageLevel]}
                  </div>
                  {job.salaryRange && (
                    <p style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>
                      {job.salaryRange}
                    </p>
                  )}
                </div>
              </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
