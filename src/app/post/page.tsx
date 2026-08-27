"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useLang } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";
import { postingSchema } from "@/lib/validations/posting";

type FormState = {
  job_title: string;
  job_title_zh: string;
  company: string;
  location: string;
  field: "ai" | "cs" | "robotics" | "drone" | "remote";
  language_level: "nice-to-have" | "required" | "fluent";
  employment_type: "full-time" | "part-time" | "internship" | "contract";
  salary_range: string;
  description: string;
  description_zh: string;
  requirements: string;
  application_url: string;
  remote_friendly: boolean;
  visa_sponsorship: boolean;
  tier: "free" | "featured" | "pinned" | "enterprise";
};

const initialForm: FormState = {
  job_title: "",
  job_title_zh: "",
  company: "",
  location: "",
  field: "ai",
  language_level: "nice-to-have",
  employment_type: "full-time",
  salary_range: "",
  description: "",
  description_zh: "",
  requirements: "",
  application_url: "",
  remote_friendly: false,
  visa_sponsorship: false,
  tier: "free",
};

export default function PostJobPage() {
  const { t } = useLang();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialForm);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!cancelled) {
          if (!user) {
            router.push("/auth/login?next=/post");
          } else {
            setCheckingAuth(false);
          }
        }
      } catch {
        if (!cancelled) {
          router.push("/auth/login?next=/post");
        }
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tierParam = params.get("tier");
      if (tierParam && ["free", "featured", "pinned", "enterprise"].includes(tierParam)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm((prev) => ({ ...prev, tier: tierParam as FormState["tier"] }));
      }
    }
  }, []);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.625rem 0.75rem",
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: "0.875rem",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8125rem",
    fontWeight: 600,
    marginBottom: "0.375rem",
    color: "var(--foreground)",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
  };

  const errorStyle: React.CSSProperties = {
    color: "#ef4444",
    fontSize: "0.75rem",
    marginTop: "0.25rem",
  };

  function translateFieldError(path: string, code?: string): string {
    const e = t.post.errors as Record<string, string>;
    switch (path) {
      case "job_title":
        if (code === "too_big") return e.jobTitleTooLong;
        return e.jobTitleRequired;
      case "job_title_zh":
        return e.jobTitleZhTooLong;
      case "company":
        if (code === "too_big") return e.companyTooLong;
        return e.companyRequired;
      case "location":
        if (code === "too_big") return e.locationTooLong;
        return e.locationRequired;
      case "field":
        return e.fieldInvalid;
      case "language_level":
        return e.languageLevelInvalid;
      case "employment_type":
        return e.employmentTypeInvalid;
      case "salary_range":
        return e.salaryTooLong;
      case "description":
        if (code === "too_big") return e.descriptionTooLong;
        return e.descriptionTooShort;
      case "description_zh":
        return e.descriptionZhTooLong;
      case "requirements":
        return e.requirementsTooLong;
      case "application_url":
        return e.urlInvalid;
      case "tier":
        return e.tierInvalid;
      default:
        return e.generic;
    }
  }

  const handleChange =
    (key: keyof FormState) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => {
      const target = e.target as HTMLInputElement;
      const value =
        target.type === "checkbox" ? target.checked : target.value;
      setForm((prev) => ({ ...prev, [key]: value }));
      // clear field error on change
      if (errors[key]) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    // Client-side zod validation for immediate feedback
    const parsed = postingSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "generic";
        if (!nextErrors[path]) {
          nextErrors[path] = translateFieldError(path, issue.code);
        }
      }
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/postings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });

      if (res.status === 401) {
        router.push("/auth/login?next=/post");
        return;
      }

      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        const details: Array<{ path: string; message: string; code?: string }> =
          data.details ?? [];
        const nextErrors: Record<string, string> = {};
        for (const d of details) {
          const path = d.path || "generic";
          if (!nextErrors[path]) {
            nextErrors[path] = translateFieldError(path, d.code) || d.message;
          }
        }
        if (Object.keys(nextErrors).length === 0) {
          setSubmitError(t.post.errors.generic);
        } else {
          setErrors(nextErrors);
        }
        return;
      }

      if (res.status === 201) {
        setSubmitted(true);
        return;
      }

      const data = await res.json().catch(() => ({}));
      setSubmitError(data.error || t.post.errors.generic);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.post.errors.generic;
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (checkingAuth) {
    return (
      <div style={{ maxWidth: "700px", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.875rem" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>{t.post.title}</h1>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
        {t.post.subtitle}
      </p>
      <p
        style={{
          color: "var(--muted-foreground)",
          marginBottom: "2rem",
          fontSize: "0.8125rem",
          background: "var(--muted)",
          padding: "0.5rem 0.75rem",
          borderRadius: "0.5rem",
        }}
      >
        ✓ {t.post.free}
      </p>

      {submitted ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✓</div>
          <p style={{ fontSize: "1.125rem", fontWeight: 600 }}>{t.post.success}</p>
          <Link
            href="/employer/dashboard"
            className="btn-accent"
            style={{
              display: "inline-block",
              marginTop: "1.5rem",
              textDecoration: "none",
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
            }}
          >
            Go to dashboard
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }} noValidate>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.jobTitle}</label>
              <input
                type="text"
                value={form.job_title}
                onChange={handleChange("job_title")}
                style={inputStyle}
              />
              {errors.job_title && <p style={errorStyle}>{errors.job_title}</p>}
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.jobTitleZh}</label>
              <input
                type="text"
                value={form.job_title_zh}
                onChange={handleChange("job_title_zh")}
                style={inputStyle}
              />
              {errors.job_title_zh && <p style={errorStyle}>{errors.job_title_zh}</p>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.company}</label>
              <input
                type="text"
                value={form.company}
                onChange={handleChange("company")}
                style={inputStyle}
              />
              {errors.company && <p style={errorStyle}>{errors.company}</p>}
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.location}</label>
              <input
                type="text"
                value={form.location}
                onChange={handleChange("location")}
                placeholder="e.g. Munich, Germany"
                style={inputStyle}
              />
              {errors.location && <p style={errorStyle}>{errors.location}</p>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.field}</label>
              <select value={form.field} onChange={handleChange("field")} style={selectStyle}>
                <option value="ai">AI / Machine Learning</option>
                <option value="cs">Computer Science</option>
                <option value="robotics">Robotics</option>
                <option value="drone">Drones / UAV</option>
                <option value="remote">Remote</option>
              </select>
              {errors.field && <p style={errorStyle}>{errors.field}</p>}
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.languageLevel}</label>
              <select value={form.language_level} onChange={handleChange("language_level")} style={selectStyle}>
                <option value="nice-to-have">Nice to Have</option>
                <option value="required">Required</option>
                <option value="fluent">Fluent</option>
              </select>
              {errors.language_level && <p style={errorStyle}>{errors.language_level}</p>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.employmentType}</label>
              <select
                value={form.employment_type}
                onChange={handleChange("employment_type")}
                style={selectStyle}
              >
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="internship">Internship</option>
                <option value="contract">Contract</option>
              </select>
              {errors.employment_type && <p style={errorStyle}>{errors.employment_type}</p>}
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.salary}</label>
              <input
                type="text"
                value={form.salary_range}
                onChange={handleChange("salary_range")}
                placeholder="e.g. €70,000 - €90,000"
                style={inputStyle}
              />
              {errors.salary_range && <p style={errorStyle}>{errors.salary_range}</p>}
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.description}</label>
            <textarea
              value={form.description}
              onChange={handleChange("description")}
              rows={4}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            {errors.description && <p style={errorStyle}>{errors.description}</p>}
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.descriptionZh}</label>
            <textarea
              value={form.description_zh}
              onChange={handleChange("description_zh")}
              rows={4}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            {errors.description_zh && <p style={errorStyle}>{errors.description_zh}</p>}
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.requirements}</label>
            <textarea
              value={form.requirements}
              onChange={handleChange("requirements")}
              rows={5}
              placeholder="One requirement per line"
              style={{ ...inputStyle, resize: "vertical" }}
            />
            {errors.requirements && <p style={errorStyle}>{errors.requirements}</p>}
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.applicationUrl}</label>
            <input
              type="url"
              value={form.application_url}
              onChange={handleChange("application_url")}
              placeholder="https://..."
              style={inputStyle}
            />
            {errors.application_url && <p style={errorStyle}>{errors.application_url}</p>}
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.tier}</label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: "0.75rem",
              }}
            >
              {(
                [
                  { value: "free" as const, label: t.pricing.free.name, price: t.pricing.free.price, per: t.pricing.free.per },
                  { value: "featured" as const, label: t.pricing.featured.name, price: t.pricing.featured.price, per: t.pricing.featured.per },
                  { value: "pinned" as const, label: t.pricing.pinned.name, price: t.pricing.pinned.price, per: t.pricing.pinned.per },
                  { value: "enterprise" as const, label: t.pricing.enterprise.name, price: t.pricing.enterprise.price, per: t.pricing.enterprise.per },
                ] as const
              ).map((opt) => {
                const selected = form.tier === opt.value;
                const isFeatured = opt.value === "featured";
                return (
                  <label
                    key={opt.value}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      padding: "0.75rem 0.85rem",
                      borderRadius: "0.6rem",
                      border: `1px solid ${selected ? (isFeatured ? "var(--accent)" : "var(--primary)") : "var(--border)"}`,
                      background: selected ? "var(--muted)" : "var(--background)",
                      cursor: "pointer",
                      fontSize: "0.875rem",
                      fontWeight: selected ? 600 : 500,
                    }}
                  >
                    <input
                      type="radio"
                      name="tier"
                      value={opt.value}
                      checked={selected}
                      onChange={handleChange("tier")}
                      style={{ accentColor: "var(--primary)" }}
                    />
                    <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                      <span>{opt.label}</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", fontWeight: 400 }}>
                        {opt.price} {opt.per ? `· ${opt.per}` : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginTop: "0.375rem" }}>
              {t.post.tierHint}
            </p>
            {errors.tier && <p style={errorStyle}>{errors.tier}</p>}
          </div>

          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              <input
                type="checkbox"
                checked={form.remote_friendly}
                onChange={handleChange("remote_friendly")}
              />
              {t.post.fields.remoteFriendly}
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              <input
                type="checkbox"
                checked={form.visa_sponsorship}
                onChange={handleChange("visa_sponsorship")}
              />
              {t.post.fields.visaSponsorship}
            </label>
          </div>

          {submitError && <p style={{ ...errorStyle, fontSize: "0.875rem" }}>{submitError}</p>}
          {errors.generic && <p style={{ ...errorStyle, fontSize: "0.875rem" }}>{errors.generic}</p>}

          <button
            type="submit"
            className="btn-accent"
            disabled={submitting}
            style={{ alignSelf: "flex-start", marginTop: "0.5rem", opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? "Submitting..." : t.post.submit}
          </button>
        </form>
      )}
    </div>
  );
}
