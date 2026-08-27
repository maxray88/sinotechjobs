"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLang } from "@/components/LanguageProvider";

type Props = {
  jobId: string;
  size?: "sm" | "md";
};

export default function SaveButton({ jobId, size = "md" }: Props) {
  const { t } = useLang();
  const router = useRouter();
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchSaved() {
      try {
        const res = await fetch("/api/saved-jobs", { method: "GET" });
        if (res.status === 401) {
          if (!cancelled) {
            setIsSaved(false);
            setInitialLoading(false);
          }
          return;
        }
        if (!res.ok) {
          if (!cancelled) setInitialLoading(false);
          return;
        }
        const data = await res.json() as { saved?: { job_id: string; jobId?: string }[] };
        const list = data.saved ?? [];
        const contains = list.some(
          (r) => r.job_id === jobId || r.jobId === jobId
        );
        if (!cancelled) {
          setIsSaved(contains);
          setInitialLoading(false);
        }
      } catch {
        if (!cancelled) setInitialLoading(false);
      }
    }
    fetchSaved();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading || initialLoading) return;

    // Check auth via optimistic? We'll try to detect 401 from prior fetch,
    // but if user is unauth, we need to redirect.
    // Perform a quick auth check: if not saved and we failed to fetch due to 401 earlier,
    // we still want to redirect. So we attempt POST and if 401 redirect.
    const nextIsSaved = !isSaved;
    setIsSaved(nextIsSaved);
    setLoading(true);
    try {
      if (nextIsSaved) {
        const res = await fetch("/api/saved-jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
        });
        if (res.status === 401) {
          setIsSaved(false);
          const next = `/jobs/${jobId}`;
          router.push(`/auth/login?next=${encodeURIComponent(next)}`);
          return;
        }
        if (!res.ok) {
          setIsSaved(!nextIsSaved);
        }
      } else {
        const res = await fetch(`/api/saved-jobs?jobId=${encodeURIComponent(jobId)}`, {
          method: "DELETE",
        });
        // fallback to body if needed (some environments)
        // fallback handled below
        // const wasOk = res.ok;
        if (res.status === 401) {
          setIsSaved(true);
          const next = `/jobs/${jobId}`;
          router.push(`/auth/login?next=${encodeURIComponent(next)}`);
          return;
        }
        if (!res.ok) {
          // try body method as fallback
          const res2 = await fetch("/api/saved-jobs", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
          if (res2.status === 401) {
            setIsSaved(true);
            const next = `/jobs/${jobId}`;
            router.push(`/auth/login?next=${encodeURIComponent(next)}`);
            return;
          }
          if (!res2.ok) {
            setIsSaved(!nextIsSaved);
          }
        }
      }
    } catch {
      setIsSaved(!nextIsSaved);
    } finally {
      setLoading(false);
    }
  };

  const padding = size === "sm" ? "0.25rem 0.5rem" : "0.375rem 0.75rem";
  const fontSize = size === "sm" ? "0.75rem" : "0.8125rem";

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.375rem",
    border: "1px solid var(--border)",
    borderRadius: "0.375rem",
    padding,
    fontSize,
    fontWeight: 600,
    cursor: loading ? "wait" : "pointer",
    opacity: loading ? 0.7 : 1,
    background: isSaved ? "var(--accent)" : "var(--background)",
    color: isSaved ? "white" : "var(--foreground)",
    transition: "all 0.15s",
  };

  // Use --accent fallback if not defined: use inline fallback
  if (isSaved) {
    baseStyle.background = "var(--accent, #111827)";
    baseStyle.borderColor = "var(--accent, #111827)";
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      aria-pressed={isSaved}
      aria-label={isSaved ? t.saved.saved : t.saved.save}
      style={baseStyle}
    >
      <span aria-hidden="true" style={{ lineHeight: 1, fontSize: "1rem" }}>
        {isSaved ? "★" : "☆"}
      </span>
      {isSaved ? t.saved.saved : t.saved.save}
    </button>
  );
}
