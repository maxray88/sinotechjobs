"use client";

import { useLang } from "@/components/LanguageProvider";
import Link from "next/link";
import SaveButton from "@/components/SaveButton";
import type { Job, JobField, EmploymentType } from "@/lib/types";

export default function JobDetailClient({ job }: { job: Job }) {
  const { t, lang } = useLang();

  const fieldColors: Record<JobField, string> = {
    ai: "#8b5cf6",
    cs: "#3b82f6",
    robotics: "#f59e0b",
    drone: "#10b981",
    remote: "#6366f1",
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (lang === "zh") return `${date.getMonth() + 1}月${date.getDate()}日`;
    if (lang === "de") return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  const description = lang === "zh" ? job.descriptionZh : job.description;
  const requirements = lang === "zh" ? job.requirementsZh : job.requirements;
  const title = lang === "zh" ? job.titleZh : job.title;
  const companyName = lang === "zh" && job.companyZh ? job.companyZh : job.company;

  return (
    <div style={{ maxWidth: "850px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Link
        href="/jobs"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          color: "var(--muted-foreground)",
          textDecoration: "none",
          fontSize: "0.875rem",
          marginBottom: "1.5rem",
        }}
      >
        ← {t.jobs.back}
      </Link>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
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
          {job.visaSponsorship && <span className="badge-visa">Visa Sponsorship</span>}
        </div>

        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, marginBottom: "0.5rem", lineHeight: 1.3 }}>
          {title}
        </h1>
        <p style={{ fontSize: "1rem", color: "var(--muted-foreground)", marginBottom: "1rem" }}>
          {companyName} · {job.location}
        </p>

        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.875rem", color: "var(--muted-foreground)" }}>
          <span>
            <strong style={{ color: "var(--foreground)" }}>{t.jobs.posted}:</strong> {formatDate(job.postedDate)}
          </span>
          <span>
            <strong style={{ color: "var(--foreground)" }}>{t.jobs.filters.employmentType}:</strong>{" "}
            {t.jobs.employmentTypes[job.employmentType as EmploymentType]}
          </span>
          {job.salaryRange && (
            <span>
              <strong style={{ color: "var(--foreground)" }}>{t.jobs.salary}:</strong> {job.salaryRange}
            </span>
          )}
        </div>

        <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <a
            href={job.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-accent"
            style={{ display: "inline-block" }}
          >
            {t.jobs.applyNow} →
          </a>
          <SaveButton jobId={job.id} size="md" />
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          {t.jobs.description}
        </h2>
        <p style={{ fontSize: "0.875rem", lineHeight: 1.7, color: "var(--foreground)" }}>
          {description}
        </p>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          {t.jobs.requirements}
        </h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {requirements.map((req, i) => (
            <li
              key={i}
              style={{
                fontSize: "0.875rem",
                lineHeight: 1.7,
                color: "var(--foreground)",
                padding: "0.375rem 0",
                paddingLeft: "1.5rem",
                position: "relative",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: "0.375rem",
                  color: "var(--accent)",
                  fontWeight: 700,
                }}
              >
                ✓
              </span>
              {req}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          {t.jobs.tags}
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {job.tags.map((tag) => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
