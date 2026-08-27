"use client";

import { useLang } from "@/components/LanguageProvider";
import Link from "next/link";

type Posting = {
  id: number | string;
  job_title: string;
  job_title_zh?: string | null;
  company: string;
  location?: string | null;
  field?: string | null;
  tier?: string | null;
  status: string;
  submitted_at: string;
  rejection_reason?: string | null;
  application_url?: string | null;
};

function statusStyle(status: string): React.CSSProperties {
  if (status === "approved") {
    return { background: "#d1fae5", color: "#065f46" };
  }
  if (status === "rejected") {
    return { background: "#fee2e2", color: "#991b1b" };
  }
  // pending - amber
  return { background: "#fef3c7", color: "#92400e" };
}

export default function EmployerDashboardClient({ items }: { items: Posting[] }) {
  const { t, lang } = useLang();
  // Fallback to English if employer missing (should not happen after i18n extension)
  const dash: {
    title: string;
    subtitle: string;
    empty: string;
    emptyCta: string;
    status: Record<string, string>;
    tier: Record<string, string>;
    fields: Record<string, string>;
    publishedNote: string;
    viewApplication: string;
  } = (t as unknown as { employer?: { dashboard?: typeof dash } }).employer?.dashboard ?? {
    title: "Employer Dashboard",
    subtitle: "Manage your postings and track review status",
    empty: "You haven't posted any jobs yet.",
    emptyCta: "Post a Job",
    status: { pending: "Pending", approved: "Approved", rejected: "Rejected" },
    tier: { free: "Free", featured: "Featured", pinned: "Pinned", enterprise: "Enterprise" },
    fields: { submittedAt: "Submitted", reason: "Reason" },
    publishedNote: "Published to job board",
    viewApplication: "View application link",
  };

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>{dash.title}</h1>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "2rem", fontSize: "0.875rem" }}>
        {dash.subtitle}
      </p>

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2.5rem" }}>
          <p style={{ color: "var(--muted-foreground)", marginBottom: "1rem", fontSize: "0.9375rem" }}>
            {dash.empty}
          </p>
          <Link
            href="/post"
            className="btn-primary"
            style={{
              display: "inline-block",
              textDecoration: "none",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
            }}
          >
            {dash.emptyCta}
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {items.map((item) => {
            const tierKey = (item.tier ?? "free") as string;
            const statusKey = item.status as string;
            const tierLabel = dash.tier[tierKey] ?? tierKey;
            const statusLabel = dash.status[statusKey] ?? statusKey;
            const submittedLabel = dash.fields?.submittedAt ?? "Submitted";
            const reasonLabel = dash.fields?.reason ?? "Reason";
            const publishedNote = dash.publishedNote ?? "Published to job board";
            const locale = lang === "zh" ? "zh-CN" : lang === "de" ? "de-DE" : "en-US";
            const formatted = item.submitted_at
              ? new Date(item.submitted_at).toLocaleDateString(locale, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "";
            const titleDisplay = item.job_title_zh ? `${item.job_title} / ${item.job_title_zh}` : item.job_title;

            return (
              <div key={String(item.id)} className="card" style={{ padding: "1.25rem" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <h2
                      style={{
                        fontSize: "1.0625rem",
                        fontWeight: 700,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={titleDisplay}
                    >
                      {titleDisplay}
                    </h2>
                    <p
                      style={{
                        fontSize: "0.875rem",
                        color: "var(--muted-foreground)",
                        marginTop: "0.25rem",
                      }}
                    >
                      {item.company}
                      {item.location ? ` · ${item.location}` : ""}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    {item.field && (
                      <span
                        className="tag"
                        style={{
                          textTransform: "capitalize",
                          background: "var(--muted)",
                          border: "1px solid var(--border)",
                        }}
                      >
                        {item.field}
                      </span>
                    )}
                    <span
                      className="tag"
                      style={{
                        background: "var(--muted)",
                        border: "1px solid var(--border)",
                        textTransform: "capitalize",
                      }}
                    >
                      {tierLabel}
                    </span>
                    <span
                      style={{
                        ...statusStyle(statusKey),
                        padding: "0.25rem 0.625rem",
                        borderRadius: "9999px",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.025em",
                        border: "1px solid transparent",
                      }}
                    >
                      {statusLabel}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "0.875rem",
                    fontSize: "0.8125rem",
                    color: "var(--muted-foreground)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <span>
                    {submittedLabel}: {formatted}
                  </span>

                  {item.application_url && (
                    <a
                      href={item.application_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--primary)",
                        wordBreak: "break-all",
                        fontSize: "0.8125rem",
                      }}
                    >
                      {item.application_url}
                    </a>
                  )}

                  {statusKey === "approved" && (
                    <span
                      style={{
                        display: "inline-block",
                        background: "#d1fae5",
                        color: "#065f46",
                        padding: "0.375rem 0.625rem",
                        borderRadius: "0.5rem",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        alignSelf: "flex-start",
                      }}
                    >
                      ✓ {publishedNote}
                    </span>
                  )}

                  {statusKey === "rejected" && item.rejection_reason && (
                    <p style={{ fontSize: "0.8125rem", color: "#991b1b", margin: 0 }}>
                      <span style={{ fontWeight: 600 }}>{reasonLabel}: </span>
                      {item.rejection_reason}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
