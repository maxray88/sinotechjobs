"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { scraperSources } from "@/lib/scraper/sources";
import type { ScrapeReport } from "@/lib/scraper/types";
import type { HealthEntry } from "@/lib/scraper/health";

interface SourceInfo {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  url: string;
  jsRendered?: boolean;
}

interface ScrapeResponse {
  sources: SourceInfo[];
  stats: {
    totalScrapedJobs: number;
    lastUpdated: string | null;
    reportCount: number;
    dataStore?: "json" | "supabase";
    error?: string;
  };
  reports?: ScrapeReport[];
  health?: HealthEntry[];
}

interface ScrapeReportResponse {
  success: boolean;
  report?: {
    timestamp: string;
    totalSources: number;
    successfulSources: number;
    totalJobsFound: number;
    totalJobsFiltered: number;
    newJobsAdded: number;
    duplicates: number;
    totalJobsInDb: number;
    sources: {
      id: string;
      name: string;
      jobsFound: number;
      jobsFiltered: number;
      errors: string[];
      duration: number;
    }[];
  };
  error?: string;
}

export default function AdminPage() {
  const [data, setData] = useState<ScrapeResponse | null>(null);
  const [scraping, setScraping] = useState(false);
  const [result, setResult] = useState<ScrapeReportResponse["report"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ScrapeReport[]>([]);
  const initialized = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/scrape");
      const json = await res.json();
      setData(json);
      if (json.reports) setReports(json.reports);
    } catch {
      setError("Failed to load data");
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    fetchData();
  }, [fetchData]);

  const handleScrapeAll = async () => {
    setScraping(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scrape-all" }),
      });
      const json: ScrapeReportResponse = await res.json();
      if (json.success && json.report) {
        setResult(json.report);
      } else {
        setError(json.error || "Scraping failed");
      }
      fetchData();
    } catch {
      setError("Network error during scraping");
    }
    setScraping(false);
  };

  const handleScrapeOne = async (sourceId: string) => {
    setScraping(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scrape-one", sourceId }),
      });
      const json: ScrapeReportResponse = await res.json();
      if (json.success && json.report) {
        setResult(json.report);
      } else {
        setError(json.error || "Scraping failed");
      }
      fetchData();
    } catch {
      setError("Network error during scraping");
    }
    setScraping(false);
  };

  const handleClear = async () => {
    if (!confirm("Delete all scraped jobs? This cannot be undone.")) return;
    try {
      await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      fetchData();
    } catch {
      setError("Failed to clear");
    }
  };

  const stats = data?.stats;

  return (
    <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>
        Scraper Admin Dashboard
      </h1>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "1rem", fontSize: "0.875rem" }}>
        Manage job scraping sources and trigger scraping runs
      </p>
      {stats && stats.dataStore && (
        <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-block",
              fontSize: "0.7rem",
              fontWeight: 700,
              padding: "0.25rem 0.6rem",
              borderRadius: "9999px",
              background: stats.dataStore === "supabase" ? "#e0f2fe" : "#f3f4f6",
              color: stats.dataStore === "supabase" ? "#0369a1" : "#374151",
              border: "1px solid var(--border)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Data Store: {stats.dataStore}
          </span>
          {stats.error && (
            <span style={{ fontSize: "0.75rem", color: "#dc2626" }} title={stats.error}>
              ({stats.error})
            </span>
          )}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--primary)" }}>{stats.totalScrapedJobs}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", textTransform: "uppercase" }}>Scraped Jobs</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: "var(--primary)" }}>{stats.reportCount}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", textTransform: "uppercase" }}>Scrape Reports</div>
          </div>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--primary)" }}>
              {stats.lastUpdated ? new Date(stats.lastUpdated).toLocaleDateString() : "—"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", textTransform: "uppercase" }}>Last Updated</div>
          </div>
        </div>
      )}

      {/* Crawler Health Matrix */}
      {data?.health && data.health.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
            Crawler Health Matrix
          </h2>
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: "0.5rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
              <thead>
                <tr style={{ background: "var(--muted)", textAlign: "left", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>Source</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>Type</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>Last</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>Found/Filtered</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>Success 5-run</th>
                  <th style={{ padding: "0.6rem 0.75rem", fontWeight: 700, whiteSpace: "nowrap" }}>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.health.map((h) => {
                  const statusColor =
                    h.lastStatus === "success" ? "#16a34a" : h.lastStatus === "error" ? "#dc2626" : "#9ca3af";
                  const statusBg =
                    h.lastStatus === "success" ? "#dcfce7" : h.lastStatus === "error" ? "#fee2e2" : "#f3f4f6";
                  return (
                    <tr key={h.sourceId} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.6rem 0.75rem", fontWeight: 600, maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h.sourceName}>
                        {h.sourceName}
                        {!h.enabled && (
                          <span style={{ marginLeft: "0.35rem", fontSize: "0.65rem", padding: "0.1rem 0.35rem", borderRadius: "9999px", background: "#f3f4f6", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}>
                            disabled
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.6rem 0.75rem", color: "var(--muted-foreground)" }}>{h.type}</td>
                      <td style={{ padding: "0.6rem 0.75rem" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "9999px",
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            color: statusColor,
                            background: statusBg,
                            border: `1px solid ${statusColor}30`,
                          }}
                        >
                          {h.lastStatus}
                        </span>
                        {h.lastRunAt && (
                          <span style={{ display: "block", fontSize: "0.65rem", color: "var(--muted-foreground)", marginTop: "0.2rem" }}>
                            {new Date(h.lastRunAt).toLocaleString()}
                          </span>
                        )}
                        {h.avgDurationMs !== null && (
                          <span style={{ display: "block", fontSize: "0.65rem", color: "var(--muted-foreground)" }}>
                            avg {(h.avgDurationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "0.6rem 0.75rem", whiteSpace: "nowrap" }}>
                        {h.lastStatus === "never" ? "—" : `${h.lastJobsFound} / ${h.lastJobsFiltered}`}
                      </td>
                      <td style={{ padding: "0.6rem 0.75rem", whiteSpace: "nowrap" }}>
                        <span
                          style={{
                            fontWeight: 700,
                            color: h.successRate === 100 ? "#16a34a" : h.successRate >= 50 ? "#ca8a04" : h.successRate === 0 && h.lastStatus === "never" ? "var(--muted-foreground)" : "#dc2626",
                          }}
                        >
                          {h.successRate}%
                        </span>
                      </td>
                      <td style={{ padding: "0.6rem 0.75rem", maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: h.lastError ? "#dc2626" : "var(--muted-foreground)", fontSize: "0.75rem" }} title={h.lastError ?? ""}>
                        {h.lastError ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", flexWrap: "wrap" }}>
        <button onClick={handleScrapeAll} disabled={scraping} className="btn-accent" style={{ opacity: scraping ? 0.6 : 1 }}>
          {scraping ? "Scraping..." : "Scrape All Enabled Sources"}
        </button>
        <button onClick={handleClear} className="btn-outline">
          Clear All Scraped Jobs
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "0.75rem 1rem", borderRadius: "0.5rem", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Last Result */}
      {result && (
        <div className="card" style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
            Last Scrape Result — {new Date(result.timestamp).toLocaleString()}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{result.totalSources}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Sources</div>
            </div>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "green" }}>{result.successfulSources}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Successful</div>
            </div>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{result.totalJobsFound}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Jobs Found</div>
            </div>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--primary)" }}>{result.totalJobsFiltered}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Chinese-Related</div>
            </div>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "green" }}>{result.newJobsAdded}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>New Jobs Added</div>
            </div>
            <div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--muted-foreground)" }}>{result.duplicates}</div>
              <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>Duplicates</div>
            </div>
          </div>

          {/* Per-source results */}
          <h3 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }}>
            Per-Source Results
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {result.sources.map((src) => (
              <div key={src.id} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.75rem", fontSize: "0.8125rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                  <div style={{ fontWeight: 600 }}>{src.name}</div>
                  <div style={{ display: "flex", gap: "1rem", color: "var(--muted-foreground)" }}>
                    <span>Found: <strong>{src.jobsFound}</strong></span>
                    <span>Filtered: <strong>{src.jobsFiltered}</strong></span>
                    <span>{(src.duration / 1000).toFixed(1)}s</span>
                  </div>
                </div>
                {src.errors.length > 0 && (
                  <div style={{ color: "#dc2626", marginTop: "0.5rem", fontSize: "0.75rem" }}>
                    {src.errors.map((e, i) => (
                      <div key={i}>• {e}</div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sources */}
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "1rem" }}>
        Configured Sources ({data?.sources.length ?? scraperSources.length})
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {data?.sources.map((source) => (
          <div key={source.id} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
              <div style={{ flex: "1", minWidth: "200px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "0.5rem",
                      height: "0.5rem",
                      borderRadius: "50%",
                      background: source.enabled ? "green" : "var(--muted-foreground)",
                    }}
                  />
                  <strong style={{ fontSize: "0.875rem" }}>{source.name}</strong>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginBottom: "0.25rem" }}>
                  Type: {source.type}{source.jsRendered ? " + Puppeteer" : ""} | {source.url}
                </div>
              </div>
              <button
                onClick={() => handleScrapeOne(source.id)}
                disabled={scraping}
                className="btn-outline"
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.75rem", opacity: scraping ? 0.6 : 1 }}
              >
                Scrape
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Reports */}
      {reports.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginTop: "2.5rem", marginBottom: "1rem" }}>
            Recent Scrape History
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {reports.slice(0, 10).map((report, i) => (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "0.5rem", padding: "0.75rem", fontSize: "0.8125rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                  <span>{new Date(report.timestamp).toLocaleString()}</span>
                  <span style={{ color: "var(--muted-foreground)" }}>
                    Sources: {report.successfulSources}/{report.totalSources} | Found: {report.totalJobsFound} | Filtered: {report.totalJobsFiltered} | Added: {report.newJobsAdded}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
