"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import type { Job, JobField } from "@/lib/types";

type Props = {
  items: Job[];
};

const STATUSES = ["saved", "applied", "screening", "interview", "offer", "rejected"] as const;
type Status = (typeof STATUSES)[number];

export default function SavedClient({ items: initialItems }: Props) {
  const { t, lang } = useLang();
  const [items, setItems] = useState<Job[]>(initialItems);
  const [statusMap, setStatusMap] = useState<Record<string, Status>>({});
  const [toast, setToast] = useState<string | null>(null);

  const fieldColors: Record<JobField, string> = {
    ai: "#8b5cf6",
    cs: "#3b82f6",
    robotics: "#f59e0b",
    drone: "#10b981",
    remote: "#6366f1",
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/applications");
        if (!res.ok) return;
        const data = await res.json() as { items?: Array<{ job_id: string; status: Status }> };
        if (cancelled) return;
        const map: Record<string, Status> = {};
        for (const a of data.items ?? []) {
          if (a.job_id && a.status) {
            map[a.job_id] = a.status;
          }
        }
        setStatusMap(map);
      } catch {
        // ignore
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const handleStatusChange = async (jobId: string, newStatus: Status) => {
    const prevStatus = statusMap[jobId];
    // optimistic update
    setStatusMap((cur) => ({ ...cur, [jobId]: newStatus }));
    try {
      const res = await fetch("/api/applications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: newStatus }),
      });
      if (!res.ok) throw new Error("update failed");
      const tr = (t as unknown as { applications?: { updateSuccess?: string } }).applications;
      setToast(tr?.updateSuccess ?? "Status updated");
      setTimeout(() => setToast(null), 2000);
    } catch {
      // revert
      setStatusMap((cur) => {
        const next = { ...cur };
        if (prevStatus) {
          next[jobId] = prevStatus;
        } else {
          // if no previous, fallback to saved
          next[jobId] = "saved";
        }
        return next;
      });
      const tr = (t as unknown as { applications?: { updateError?: string } }).applications;
      setToast(tr?.updateError ?? "Failed to update status");
      setTimeout(() => setToast(null), 2000);
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

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "1rem",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--foreground)",
            color: "var(--background)",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            fontWeight: 600,
            zIndex: 50,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          }}
        >
          {toast}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {items.map((job) => {
          const currentStatus: Status = statusMap[job.id] ?? "saved";
          const applicationsT = (t as unknown as { applications?: { status?: Record<string, string> } }).applications;
          return (
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

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem", alignItems: "center" }}>
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
              <select
                value={currentStatus}
                onChange={(e) => handleStatusChange(job.id, e.target.value as Status)}
                aria-label="application status"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0.375rem",
                  padding: "0.25rem 0.5rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  background: "var(--background)",
                  color: "var(--foreground)",
                }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {applicationsT?.status?.[s] ?? s}
                  </option>
                ))}
              </select>
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
        );
        })}
      </div>
    </div>
  );
}
