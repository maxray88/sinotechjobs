"use client";

import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";

type TierId = "free" | "featured" | "pinned" | "enterprise";

export default function PricingPage() {
  const { t } = useLang();

  const tiers: Array<{
    id: TierId;
    data: { name: string; price: string; per: string; features: readonly string[]; cta: string };
    highlight?: boolean;
  }> = [
    { id: "free", data: t.pricing.free },
    { id: "featured", data: t.pricing.featured, highlight: true },
    { id: "pinned", data: t.pricing.pinned },
    { id: "enterprise", data: t.pricing.enterprise },
  ];

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "3rem 1rem 4rem" }}>
      <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.75rem" }}>{t.pricing.title}</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: "1rem", maxWidth: 640, margin: "0 auto", lineHeight: 1.6 }}>
          {t.pricing.subtitle}
        </p>
      </div>

      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        style={{ display: "grid" }}
      >
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className="card"
            style={{
              display: "flex",
              flexDirection: "column",
              borderColor: tier.highlight ? "var(--accent)" : "var(--border)",
              borderWidth: tier.highlight ? 2 : 1,
              position: "relative",
              background: "var(--background)",
            }}
          >
            {tier.highlight && (
              <span
                style={{
                  position: "absolute",
                  top: -12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "var(--accent)",
                  color: "white",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  padding: "0.2rem 0.6rem",
                  borderRadius: 9999,
                  whiteSpace: "nowrap",
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                }}
              >
                Popular
              </span>
            )}
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.35rem" }}>{tier.data.name}</h3>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.35rem", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "1.75rem", fontWeight: 800 }}>{tier.data.price}</span>
            </div>
            <p style={{ fontSize: "0.78rem", color: "var(--muted-foreground)", marginBottom: "1rem", minHeight: "2.2em" }}>
              {tier.data.per}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1 }}>
              {tier.data.features.map((f, i) => (
                <li key={i} style={{ display: "flex", gap: "0.5rem", fontSize: "0.84rem", lineHeight: 1.5 }}>
                  <span style={{ color: tier.highlight ? "var(--accent)" : "var(--muted-foreground)", flexShrink: 0 }}>✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={`/post?tier=${tier.id}`}
              className={tier.highlight ? "btn-accent" : "btn-outline"}
              style={{
                display: "block",
                textAlign: "center",
                width: "100%",
                ...(tier.highlight
                  ? {}
                  : {
                      border: "1px solid var(--border)",
                      background: "var(--background)",
                    }),
              }}
            >
              {tier.data.cta}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
