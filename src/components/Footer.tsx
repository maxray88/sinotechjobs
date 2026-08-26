"use client";

import { useLang } from "./LanguageProvider";
import Link from "next/link";

export default function Footer() {
  const { t } = useLang();
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        background: "var(--primary)",
        color: "white",
        padding: "3rem 1.5rem 2rem",
        marginTop: "4rem",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: "2rem",
        }}
      >
        <div style={{ maxWidth: "300px" }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.5rem" }}>
            {t.siteName}
          </div>
          <p style={{ fontSize: "0.875rem", opacity: 0.8, lineHeight: 1.6 }}>
            {t.footer.mission}
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7 }}>
            {t.footer.links}
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <Link href="/" style={{ color: "white", textDecoration: "none", fontSize: "0.875rem", opacity: 0.8 }}>
              {t.nav.home}
            </Link>
            <Link href="/jobs" style={{ color: "white", textDecoration: "none", fontSize: "0.875rem", opacity: 0.8 }}>
              {t.nav.jobs}
            </Link>
            <Link href="/post" style={{ color: "white", textDecoration: "none", fontSize: "0.875rem", opacity: 0.8 }}>
              {t.nav.post}
            </Link>
          </div>
        </div>

        <div>
          <h4 style={{ fontSize: "0.875rem", fontWeight: 700, marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7 }}>
            {t.footer.contact}
          </h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <a href="mailto:contact@sinotechjobs.com" style={{ color: "white", textDecoration: "none", fontSize: "0.875rem", opacity: 0.8 }}>
              contact@sinotechjobs.com
            </a>
            <span style={{ fontSize: "0.875rem", opacity: 0.6 }}>
              WeChat: SinotechJobs
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          maxWidth: "1200px",
          margin: "2rem auto 0",
          paddingTop: "1.5rem",
          borderTop: "1px solid rgba(255,255,255,0.15)",
          fontSize: "0.8125rem",
          opacity: 0.6,
          textAlign: "center",
        }}
      >
        © {year} {t.siteName}. {t.footer.rights}
      </div>
    </footer>
  );
}
