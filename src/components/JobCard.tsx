import Link from "next/link";
import type { CSSProperties } from "react";
import type { Job, Language } from "@/lib/types";
import { FOCUS_AREA_LABELS } from "@/lib/taxonomy";
import MatchBadge from "./MatchBadge";

interface JobCardProps {
  job: Job;
  lang?: Language;
  matchScore?: number;
  matchReasons?: string[];
}

const FIELD_LABEL_FALLBACK: Record<Job["field"], string> = {
  ai: "AI / ML",
  cs: "Computer Science",
  robotics: "Robotics",
  drone: "Drones / UAV",
  remote: "Remote",
};

export default function JobCard({ job, lang = "en", matchScore, matchReasons }: JobCardProps) {
  const title = lang === "zh" && job.titleZh ? job.titleZh : job.title;
  const company =
    lang === "zh" && job.companyZh ? job.companyZh : job.company;
  const focusLabel =
    FOCUS_AREA_LABELS[job.field]?.[lang] ?? FIELD_LABEL_FALLBACK[job.field] ?? job.field;

  const cardStyle: CSSProperties = {
    display: "block",
    borderRadius: "0.75rem",
    border: "1px solid var(--border)",
    background: "var(--card, var(--background))",
    color: "var(--foreground)",
    padding: "1.25rem",
    textDecoration: "none",
    transition: "box-shadow 0.15s ease",
  };

  const pillStyle: CSSProperties = {
    display: "inline-block",
    borderRadius: "9999px",
    padding: "0.125rem 0.625rem",
    fontSize: "0.75rem",
    fontWeight: 500,
    background: "var(--secondary, #f3f4f6)",
    color: "var(--secondary-foreground, #374151)",
  };

  const tagStyle: CSSProperties = {
    display: "inline-block",
    borderRadius: "0.375rem",
    padding: "0.125rem 0.375rem",
    fontSize: "10px",
    background: "var(--muted, #f3f4f6)",
    color: "var(--muted-foreground, #6b7280)",
  };

  const metaStyle: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.75rem",
    marginTop: "0.75rem",
    fontSize: "0.75rem",
    color: "var(--muted-foreground, #6b7280)",
  };

  return (
    <Link href={`/jobs/${job.id}`} style={cardStyle}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.3, margin: 0 }}>
            {title}
            {job.featured && (
              <span
                style={{
                  ...pillStyle,
                  marginLeft: "0.5rem",
                  background: "#fef3c7",
                  color: "#92400e",
                  verticalAlign: "middle",
                }}
              >
                ⭐ {lang === "zh" ? "推荐" : lang === "de" ? "Empfohlen" : "Featured"}
              </span>
            )}
          </h3>
          {company && (
            <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground, #6b7280)", margin: "0.25rem 0 0" }}>
              {company}
            </p>
          )}
        </div>
        {matchScore !== undefined && matchScore > 0 && (
          <MatchBadge score={matchScore} reasons={matchReasons} />
        )}
      </div>

      <div style={metaStyle}>
        <span>{job.remoteFriendly ? `💼 ${lang === "zh" ? "远程" : "Remote"}` : `📍 ${job.location}`}</span>
        <span style={pillStyle}>{focusLabel}</span>
        {job.visaSponsorship && (
          <span style={{ color: "#16a34a" }}>
            ✓ {lang === "zh" ? "签证担保" : lang === "de" ? "Visum-Sponsoring" : "Visa Sponsorship"}
          </span>
        )}
        {job.salaryRange && (
          <span style={{ fontWeight: 500, color: "var(--foreground)" }}>{job.salaryRange}</span>
        )}
      </div>

      {job.tags && job.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.5rem" }}>
          {job.tags.slice(0, 3).map((tag) => (
            <span key={tag} style={tagStyle}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
