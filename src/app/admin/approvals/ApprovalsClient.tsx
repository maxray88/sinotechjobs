"use client";

import { useState } from "react";
import { useLang } from "@/components/LanguageProvider";

type Posting = {
  id: number;
  job_title: string;
  job_title_zh?: string | null;
  company: string;
  location?: string | null;
  field?: string | null;
  language_level?: string | null;
  employment_type?: string | null;
  salary_range?: string | null;
  description?: string | null;
  description_zh?: string | null;
  requirements?: string | null;
  application_url?: string | null;
  remote_friendly?: boolean | null;
  visa_sponsorship?: boolean | null;
  tier?: string | null;
  status: string;
  rejection_reason?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  user_id?: string | null;
};

type Props = {
  pending: Posting[];
  recent: Posting[];
};

function formatDate(value: string | null | undefined, locale: string): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString(locale);
  } catch {
    return value;
  }
}

function tierLabel(tier: string | null | undefined, dict: Record<string, string>): string {
  const key = (tier ?? "free").toLowerCase();
  return dict[key] ?? tier ?? "free";
}

export default function ApprovalsClient({ pending: initialPending, recent }: Props) {
  const { t, lang } = useLang();
  const approvals = (t as unknown as { admin?: { approvals?: Record<string, string> } }).admin?.approvals ?? {
    title: "Approvals Queue",
    pendingTitle: "Pending Review",
    recentTitle: "Recent Decisions",
    emptyPending: "No pending postings.",
    approve: "Approve",
    reject: "Reject",
    reasonPlaceholder: "Reason for rejection (5-500 chars)",
    reasonRequired: "Please provide a reason (5-500 characters).",
    published: "Published to job board",
    rejected: "Rejected",
    error: "Something went wrong. Please try again.",
  };

  // Use employer dashboard tier labels as fallback for tier badges
  const tierDict: Record<string, string> =
    (t as unknown as { employer?: { dashboard?: { tier?: Record<string, string> } } }).employer?.dashboard?.tier ??
    { free: "Free", featured: "Featured", pinned: "Pinned", enterprise: "Enterprise" };

  const [pending, setPending] = useState<Posting[]>(initialPending ?? []);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [reason, setReason] = useState<string>("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  function showToast(type: "success" | "error", message: string) {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleApprove(id: number) {
    setLoadingId(id);
    setReasonError(null);
    try {
      const res = await fetch("/api/admin/postings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "approve" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json?.error as string) || approvals.error;
        showToast("error", typeof msg === "string" ? msg : approvals.error);
        // handle specific codes
        if (res.status === 409) {
          setPending((prev) => prev.filter((p) => p.id !== id));
          showToast("error", "Already reviewed (409)");
        }
        return;
      }
      setPending((prev) => prev.filter((p) => p.id !== id));
      showToast("success", approvals.published);
    } catch {
      showToast("error", approvals.error);
    } finally {
      setLoadingId(null);
    }
  }

  async function handleRejectConfirm(id: number) {
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 500) {
      setReasonError(approvals.reasonRequired);
      return;
    }
    setLoadingId(id);
    setReasonError(null);
    try {
      const res = await fetch("/api/admin/postings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "reject", reason: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json?.error as string) || approvals.error;
        showToast("error", typeof msg === "string" ? msg : approvals.error);
        if (res.status === 409) {
          setPending((prev) => prev.filter((p) => p.id !== id));
        }
        return;
      }
      setPending((prev) => prev.filter((p) => p.id !== id));
      setRejectId(null);
      setReason("");
      showToast("success", approvals.rejected);
    } catch {
      showToast("error", approvals.error);
    } finally {
      setLoadingId(null);
    }
  }

  const locale = lang === "zh" ? "zh-CN" : lang === "de" ? "de-DE" : "en-US";

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>{approvals.title}</h1>

      {toast && (
        <div
          role="status"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            background: toast.type === "success" ? "#d1fae5" : "#fee2e2",
            color: toast.type === "success" ? "#065f46" : "#991b1b",
            border: `1px solid ${toast.type === "success" ? "#6ee7b7" : "#fecaca"}`,
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Pending Section */}
      <section style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
          {approvals.pendingTitle} ({pending.length})
        </h2>

        {pending.length === 0 ? (
          <div
            className="card"
            style={{
              textAlign: "center",
              padding: "2rem",
              color: "var(--muted-foreground)",
              fontSize: "0.9375rem",
            }}
          >
            {approvals.emptyPending}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {pending.map((item) => {
              const isLoading = loadingId === item.id;
              const isRejecting = rejectId === item.id;
              const tier = tierLabel(item.tier, tierDict);
              const tierIsFeatured = (item.tier ?? "free") !== "free";

              return (
                <div
                  key={String(item.id)}
                  className="card"
                  style={{ padding: "1.5rem", border: "1px solid var(--border)" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <div style={{ flex: "1 1 280px", minWidth: 0 }}>
                      <h3
                        style={{
                          fontSize: "1.0625rem",
                          fontWeight: 700,
                          lineHeight: 1.4,
                          marginBottom: "0.25rem",
                        }}
                      >
                        {item.job_title}
                        {item.job_title_zh ? ` / ${item.job_title_zh}` : ""}
                      </h3>
                      <p
                        style={{
                          fontSize: "0.875rem",
                          color: "var(--muted-foreground)",
                        }}
                      >
                        {item.company}
                        {item.location ? ` · ${item.location}` : ""}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                      {item.field && (
                        <span
                          style={{
                            padding: "0.25rem 0.625rem",
                            borderRadius: "9999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            textTransform: "capitalize",
                            background: "var(--muted)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {item.field}
                        </span>
                      )}
                      <span
                        style={{
                          padding: "0.25rem 0.625rem",
                          borderRadius: "9999px",
                          fontSize: "0.75rem",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.025em",
                          background: tierIsFeatured ? "#fef3c7" : "var(--muted)",
                          color: tierIsFeatured ? "#92400e" : "var(--muted-foreground)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {tier}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                      gap: "0.5rem 1rem",
                      fontSize: "0.8125rem",
                      color: "var(--muted-foreground)",
                      marginBottom: "0.75rem",
                    }}
                  >
                    <span>Language: {item.language_level ?? "—"}</span>
                    <span>Type: {item.employment_type ?? "—"}</span>
                    <span>Salary: {item.salary_range || "—"}</span>
                    <span>Remote: {item.remote_friendly ? "Yes" : "No"}</span>
                    <span>Visa: {item.visa_sponsorship ? "Yes" : "No"}</span>
                    <span>Submitted: {formatDate(item.submitted_at, locale)}</span>
                  </div>

                  {item.description && (
                    <p
                      style={{
                        fontSize: "0.875rem",
                        lineHeight: 1.6,
                        marginBottom: "0.5rem",
                        whiteSpace: "pre-wrap",
                        color: "var(--foreground)",
                      }}
                    >
                      {item.description}
                    </p>
                  )}
                  {item.description_zh && (
                    <p
                      style={{
                        fontSize: "0.875rem",
                        lineHeight: 1.6,
                        marginBottom: "0.5rem",
                        whiteSpace: "pre-wrap",
                        color: "var(--muted-foreground)",
                      }}
                    >
                      {item.description_zh}
                    </p>
                  )}
                  {item.requirements && (
                    <p
                      style={{
                        fontSize: "0.8125rem",
                        lineHeight: 1.6,
                        marginBottom: "0.5rem",
                        whiteSpace: "pre-wrap",
                        background: "var(--muted)",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "0.375rem",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Requirements:</span> {item.requirements}
                    </p>
                  )}
                  {item.application_url && (
                    <a
                      href={item.application_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        fontSize: "0.8125rem",
                        color: "var(--primary)",
                        wordBreak: "break-all",
                        marginBottom: "0.875rem",
                      }}
                    >
                      {item.application_url}
                    </a>
                  )}

                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" }}>
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={isLoading}
                      style={{
                        padding: "0.5rem 1rem",
                        borderRadius: "0.5rem",
                        border: "none",
                        background: isLoading ? "#a7f3d0" : "#10b981",
                        color: "white",
                        fontWeight: 700,
                        fontSize: "0.875rem",
                        cursor: isLoading ? "not-allowed" : "pointer",
                        opacity: isLoading ? 0.7 : 1,
                      }}
                    >
                      {isLoading && !isRejecting ? "…" : approvals.approve}
                    </button>

                    {!isRejecting ? (
                      <button
                        onClick={() => {
                          setRejectId(item.id);
                          setReason("");
                          setReasonError(null);
                        }}
                        disabled={isLoading}
                        style={{
                          padding: "0.5rem 1rem",
                          borderRadius: "0.5rem",
                          border: "1px solid #fecaca",
                          background: "white",
                          color: "#dc2626",
                          fontWeight: 700,
                          fontSize: "0.875rem",
                          cursor: isLoading ? "not-allowed" : "pointer",
                        }}
                      >
                        {approvals.reject}
                      </button>
                    ) : (
                      <div
                        style={{
                          flex: "1 1 100%",
                          marginTop: "0.5rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.5rem",
                          background: "#fef2f2",
                          border: "1px solid #fecaca",
                          borderRadius: "0.5rem",
                          padding: "0.75rem",
                        }}
                      >
                        <textarea
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          placeholder={approvals.reasonPlaceholder}
                          rows={3}
                          style={{
                            width: "100%",
                            padding: "0.5rem 0.75rem",
                            borderRadius: "0.375rem",
                            border: `1px solid ${reasonError ? "#ef4444" : "var(--border)"}`,
                            fontSize: "0.875rem",
                            resize: "vertical",
                            outline: "none",
                          }}
                        />
                        {reasonError && (
                          <span style={{ fontSize: "0.75rem", color: "#ef4444" }}>{reasonError}</span>
                        )}
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button
                            onClick={() => handleRejectConfirm(item.id)}
                            disabled={isLoading}
                            style={{
                              padding: "0.5rem 1rem",
                              borderRadius: "0.5rem",
                              border: "none",
                              background: "#dc2626",
                              color: "white",
                              fontWeight: 700,
                              fontSize: "0.8125rem",
                              cursor: isLoading ? "not-allowed" : "pointer",
                              opacity: isLoading ? 0.7 : 1,
                            }}
                          >
                            {isLoading ? "…" : approvals.reject}
                          </button>
                          <button
                            onClick={() => {
                              setRejectId(null);
                              setReason("");
                              setReasonError(null);
                            }}
                            disabled={isLoading}
                            style={{
                              padding: "0.5rem 1rem",
                              borderRadius: "0.5rem",
                              border: "1px solid var(--border)",
                              background: "white",
                              color: "var(--foreground)",
                              fontWeight: 600,
                              fontSize: "0.8125rem",
                              cursor: isLoading ? "not-allowed" : "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Section - collapsed by default */}
      <section>
        <button
          onClick={() => setShowRecent((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: "0.5rem",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: "pointer",
            color: "var(--foreground)",
          }}
          aria-expanded={showRecent}
        >
          <span style={{ transform: showRecent ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>
            ▶
          </span>
          {approvals.recentTitle} ({recent.length})
        </button>

        {showRecent && (
          <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {recent.length === 0 ? (
              <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)" }}>—</p>
            ) : (
              recent.map((item) => {
                const isApproved = item.status === "approved";
                return (
                  <div
                    key={String(item.id)}
                    className="card"
                    style={{
                      padding: "1rem",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "1rem",
                      flexWrap: "wrap",
                      alignItems: "flex-start",
                      opacity: 0.92,
                    }}
                  >
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "0.9375rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={item.job_title}>
                        {item.job_title} <span style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>· {item.company}</span>
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>
                        Reviewed: {formatDate(item.reviewed_at, locale)} · Submitted: {formatDate(item.submitted_at, locale)}
                      </div>
                      {!isApproved && item.rejection_reason && (
                        <p style={{ fontSize: "0.8125rem", color: "#991b1b", marginTop: "0.375rem", marginBottom: 0 }}>
                          {item.rejection_reason}
                        </p>
                      )}
                    </div>
                    <span
                      style={{
                        padding: "0.25rem 0.625rem",
                        borderRadius: "9999px",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        background: isApproved ? "#d1fae5" : "#fee2e2",
                        color: isApproved ? "#065f46" : "#991b1b",
                        border: "1px solid transparent",
                        alignSelf: "flex-start",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isApproved ? approvals.published : approvals.rejected}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </section>
    </div>
  );
}
