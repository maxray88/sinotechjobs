"use client";

import { useLang } from "@/components/LanguageProvider";
import EmailCapture from "@/components/EmailCapture";
import Link from "next/link";
import type { Job } from "@/lib/types";

export default function HomeClient({ allJobs }: { allJobs: Job[] }) {
  const { t, lang } = useLang();
  const jobCount = allJobs.length;
  const companyCount = new Set(allJobs.map((j) => j.company)).size;
  const locationCount = new Set(allJobs.map((j) => j.locationCode)).size;

  return (
    <div>
      {/* Hero Section */}
      <section
        style={{
          background: "linear-gradient(135deg, var(--primary) 0%, #0f172a 100%)",
          color: "white",
          padding: "5rem 1.5rem 4rem",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: "800px", margin: "0 auto" }}>
          <h1 style={{ fontSize: "2.5rem", fontWeight: 800, lineHeight: 1.2, marginBottom: "1rem", letterSpacing: "-0.025em" }}>
            {t.hero.title}
          </h1>
          <p style={{ fontSize: "1.125rem", opacity: 0.85, marginBottom: "2rem", lineHeight: 1.6, maxWidth: "640px", margin: "0 auto 2rem" }}>
            {t.hero.subtitle}
          </p>
          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/jobs" className="btn-accent">
              {t.hero.cta}
            </Link>
            <Link href="/post" className="btn-primary" style={{ background: "rgba(255,255,255,0.15)" }}>
              {t.hero.secondaryCta}
            </Link>
          </div>

          {/* Stats */}
          <div
            style={{
              display: "flex",
              gap: "3rem",
              justifyContent: "center",
              marginTop: "3rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{jobCount}+</div>
              <div style={{ fontSize: "0.875rem", opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t.hero.stats.jobs}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{companyCount}+</div>
              <div style={{ fontSize: "0.875rem", opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t.hero.stats.companies}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "2.5rem", fontWeight: 800 }}>{locationCount}+</div>
              <div style={{ fontSize: "0.875rem", opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {t.hero.stats.locations}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section style={{ maxWidth: "1200px", margin: "0 auto", padding: "4rem 1.5rem" }}>
        <h2 style={{ fontSize: "1.75rem", fontWeight: 700, textAlign: "center", marginBottom: "3rem" }}>
          {t.valueProps.title}
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
            gap: "2rem",
          }}
        >
          {t.valueProps.items.map((item, i) => (
            <div key={i} className="card">
              <div
                style={{
                  width: "3rem",
                  height: "3rem",
                  borderRadius: "0.75rem",
                  background: "var(--primary)",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  marginBottom: "1rem",
                }}
              >
                {i + 1}
              </div>
              <h3 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.5rem" }}>
                {item.title}
              </h3>
              <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)", lineHeight: 1.6 }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured Jobs Preview */}
      <section style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 1.5rem 4rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2rem", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700 }}>
              {lang === "zh" ? "推荐职位" : lang === "de" ? "Empfohlene Jobs" : "Featured Jobs"}
            </h2>
            <p style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginTop: "0.25rem", maxWidth: "520px", lineHeight: 1.5 }}>{t.jobs.sampleBanner.subtitle}</p>
          </div>
          <Link href="/jobs" className="btn-outline">
            {lang === "zh" ? "查看全部 →" : lang === "de" ? "Alle ansehen →" : "View All →"}
          </Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>
          {allJobs
            .filter((j) => j.featured)
            .slice(0, 3)
            .map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                  {job.featured && <span className="badge-featured">{t.jobs.featured}</span>}
                  {job.remoteFriendly && <span className="badge-remote">Remote</span>}
                  {job.visaSponsorship && <span className="badge-visa">Visa</span>}
                </div>
                <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.25rem", lineHeight: 1.4 }}>
                  {lang === "zh" ? job.titleZh : job.title}
                </h3>
                <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginBottom: "0.5rem" }}>
                  {job.company} · {job.location}
                </p>
                <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
                  {job.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="tag">{tag}</span>
                  ))}
                </div>
              </Link>
            ))}
        </div>
      </section>

      {/* Email Capture */}
      <section style={{ maxWidth: "900px", margin: "0 auto", padding: "0 1.5rem 4rem" }}>
        <EmailCapture />
      </section>
    </div>
  );
}
