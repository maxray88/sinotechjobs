"use client";

import { useLang } from "./LanguageProvider";
import type { Language } from "@/lib/types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const languages: { code: Language; label: string; short: string }[] = [
  { code: "en", label: "English", short: "EN" },
  { code: "zh", label: "中文", short: "中" },
  { code: "de", label: "Deutsch", short: "DE" },
];

export default function Navbar() {
  const { lang, setLang, t } = useLang();
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: string } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (mounted) {
        setUser((data.user as unknown as { id: string } | null) ?? null);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser((session?.user as unknown as { id: string } | null) ?? null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const dashboardLabel = lang === "zh" ? "控制台" : "Dashboard";
  const loginLabel = lang === "zh" ? "登录" : lang === "de" ? "Anmelden" : "Login";
  const logoutLabel = lang === "zh" ? "退出" : lang === "de" ? "Abmelden" : "Logout";

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "var(--background)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <nav
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "0.75rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
          <span
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              color: "var(--primary)",
              letterSpacing: "-0.025em",
            }}
          >
            {t.siteName}
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem" }}>
            <Link
              href="/"
              className="nav-link"
              style={{ fontWeight: pathname === "/" ? 700 : 500 }}
            >
              {t.nav.home}
            </Link>
            <Link
              href="/jobs"
              className="nav-link"
              style={{ fontWeight: pathname?.startsWith("/jobs") ? 700 : 500 }}
            >
              {t.nav.jobs}
            </Link>
            <Link
              href="/post"
              className="nav-link"
              style={{ fontWeight: pathname === "/post" ? 700 : 500 }}
            >
              {t.nav.post}
            </Link>
            <Link
              href="/admin"
              className="nav-link"
              style={{ fontWeight: pathname === "/admin" ? 700 : 500, fontSize: "0.8125rem", opacity: 0.7 }}
            >
              Admin
            </Link>
            {user ? (
              <>
                <Link
                  href="/employer/dashboard"
                  className="nav-link"
                  style={{ fontWeight: pathname?.startsWith("/employer/dashboard") ? 700 : 500 }}
                >
                  {dashboardLabel}
                </Link>
                <form action="/auth/logout" method="POST" style={{ display: "inline" }}>
                  <button
                    type="submit"
                    className="nav-link"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      fontWeight: 500,
                      fontSize: "0.875rem",
                      color: "var(--foreground)",
                    }}
                  >
                    {logoutLabel}
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/auth/login"
                className="nav-link"
                style={{ fontWeight: pathname?.startsWith("/auth/login") ? 700 : 500 }}
              >
                {loginLabel}
              </Link>
            )}
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.25rem",
              padding: "0.125rem",
              borderRadius: "0.375rem",
              background: "var(--muted)",
            }}
          >
            {languages.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={lang === l.code ? "lang-active" : ""}
                style={{
                  padding: "0.25rem 0.5rem",
                  borderRadius: "0.25rem",
                  border: "none",
                  background: lang === l.code ? "var(--primary)" : "transparent",
                  color: lang === l.code ? "white" : "var(--muted-foreground)",
                  cursor: "pointer",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                }}
                title={l.label}
              >
                {l.short}
              </button>
            ))}
          </div>
        </div>
      </nav>
    </header>
  );
}
