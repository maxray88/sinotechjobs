"use client";

import { useState } from "react";
import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import type { Job, JobField } from "@/lib/types";

type Props = {
  items: Job[];
};

export default function SavedClient({ items: initialItems }: Props) {
  const { t, lang } = useLang();
  const [items, setItems] = useState<Job[]>(initialItems);

  const fieldColors: Record<JobField, string> = {
    ai: "#8b5cf6",
    cs: "#3b82f6",
    robotics: "#f59e0b",
    drone: "#10b981",
    remote: "#6366f1",
  };

  const handleUnsave = async (jobId: string) => {
    // optimistic removal
    const prev = items;
    setItems((cur) => cur.filter((j) => j.id !== jobId));
    try {
      const res = await fetch(`/api/saved-jobs?jobId=${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        // try body fallback
        const res2 = await fetch("/api/saved-jobs", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        if (!res2.ok) throw new Error("delete failed");
      }
    } catch {
      setItems(prev);
    }
  };

  if (items.length === 0) {
    return (
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, marginBottom: "0.5rem" }}>{t.saved.title}</h1>
        <p style={{ color: "var(--muted-foreground)", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
          {t.saved.subtitle}
        </p>
        <div
          className="card"
          style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}
        >
          <p style={{ fontSize: "1rem", marginBottom: "1rem", color: "var(--muted-foreground)" }}>
            {t.saved.empty}
          </p>
          <Link href="/jobs" className="btn-accent" style={{ display: "inline-block" }}>
            {t.saved.emptyCta}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 800, marginBottom: "0.5rem" }}>{t.saved.title}</h1>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
        {t.saved.subtitle}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {items.map((job) => (
          <div
            key={job.id}
            className="card"
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "220px" }}>
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
                </div>
                <h3 style={{ fontSize: "1.0625rem", fontWeight: 700, marginBottom: "0.25rem", lineHeight: 1.4 }}>
                  {lang === "zh" ? job.titleZh : job.title}
                </h3>
                <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginBottom: "0.25rem" }}>
                  {job.company} · {job.location}
                </p>
                <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                  {job.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem", flexShrink: 0 }}>
                <span
                  style={{
                    display: "inline-block",
                    background: "#fef3c7",
                    color: "#92400e",
                    padding: "0.125rem 0.5rem",
                    borderRadius: "9999px",
                    fontSize: "0.6875rem",
                    fontWeight: 700,
                  }}
                >
                  {(t.jobs.languageLevels as Record<string, string>)[job.languageLevel] ?? job.languageLevel}
                </span>
                {job.salaryRange && (
                  <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>{job.salaryRange}</span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
              <Link
                href={`/jobs/${job.id}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid var(--border)",
                  borderRadius: "0.375rem",
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  color: "var(--foreground)",
                }}
              >
                {t.jobs.back} →
              </Link>
              <button
                type="button"
                onClick={() => handleUnsave(job.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  border: "1px solid var(--border)",
                  borderRadius: "0.375rem",
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  background: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                ☆ {t.saved.unsave}
              </button>
              <Link
                href="/saved"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px solid transparent",
                  borderRadius: "0.375rem",
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  textDecoration: "none",
                  color: "var(--muted-foreground)",
                }}
              >
                {t.saved.viewTracker}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
