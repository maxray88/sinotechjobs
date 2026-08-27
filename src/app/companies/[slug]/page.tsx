import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllJobs } from "@/lib/all-jobs";
import { slugifyCompany } from "@/lib/companies";
import type { JobField } from "@/lib/types";

export async function generateStaticParams() {
  const jobs = await getAllJobs();
  const seen = new Set<string>();
  for (const job of jobs) {
    seen.add(slugifyCompany(job.company));
  }
  return Array.from(seen).map((slug) => ({ slug }));
}

const fieldColors: Record<JobField, string> = {
  ai: "#8b5cf6",
  cs: "#3b82f6",
  robotics: "#f59e0b",
  drone: "#10b981",
  remote: "#6366f1",
};

const fieldLabels: Record<JobField, string> = {
  ai: "AI / ML",
  cs: "Computer Science",
  robotics: "Robotics",
  drone: "Drone / UAV",
  remote: "Remote",
};

export default async function CompanyDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const jobs = await getAllJobs();
  const companyJobs = jobs.filter((job) => slugifyCompany(job.company) === slug);

  if (companyJobs.length === 0) {
    notFound();
  }

  const companyName = companyJobs[0].company;

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Link
        href="/companies"
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
        ← Back to Companies
      </Link>

      <div className="card" style={{ border: "1px solid var(--border)", marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 800, marginBottom: "0.25rem", lineHeight: 1.3 }}>{companyName}</h1>
        <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)" }}>
          {companyJobs.length} {companyJobs.length === 1 ? "open position" : "open positions"}
        </p>
      </div>

      <div style={{ display: "grid", gap: "1rem" }}>
        {companyJobs.map((job) => (
          <Link key={job.id} href={`/jobs/${job.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card" style={{ border: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.5rem", flexWrap: "wrap" }}>
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
                    letterSpacing: "0.025em",
                  }}
                >
                  {fieldLabels[job.field]}
                </span>
                {job.remoteFriendly && (
                  <span
                    style={{
                      display: "inline-block",
                      background: "#d1fae5",
                      color: "#065f46",
                      padding: "0.125rem 0.5rem",
                      borderRadius: "9999px",
                      fontSize: "0.6875rem",
                      fontWeight: 700,
                    }}
                  >
                    Remote
                  </span>
                )}
              </div>

              <h2 style={{ fontSize: "1.0625rem", fontWeight: 700, marginBottom: "0.25rem", lineHeight: 1.4 }}>{job.title}</h2>
              <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)" }}>{job.location}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
