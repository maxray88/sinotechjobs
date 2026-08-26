"use client";

import { useState } from "react";
import { useLang } from "@/components/LanguageProvider";

export default function PostJobPage() {
  const { t } = useLang();
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

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

  return (
    <div style={{ maxWidth: "700px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>
        {t.post.title}
      </h1>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "0.5rem", fontSize: "0.875rem" }}>
        {t.post.subtitle}
      </p>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "2rem", fontSize: "0.8125rem", background: "var(--muted)", padding: "0.5rem 0.75rem", borderRadius: "0.5rem" }}>
        ✓ {t.post.free}
      </p>

      {submitted ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>✓</div>
          <p style={{ fontSize: "1.125rem", fontWeight: 600 }}>{t.post.success}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.jobTitle}</label>
              <input type="text" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.jobTitleZh}</label>
              <input type="text" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.company}</label>
              <input type="text" required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.location}</label>
              <input type="text" required placeholder="e.g. Munich, Germany" style={inputStyle} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.field}</label>
              <select required style={selectStyle}>
                <option value="ai">AI / Machine Learning</option>
                <option value="cs">Computer Science</option>
                <option value="robotics">Robotics</option>
                <option value="drone">Drones / UAV</option>
                <option value="remote">Remote</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.languageLevel}</label>
              <select required style={selectStyle}>
                <option value="nice-to-have">Nice to Have</option>
                <option value="required">Required</option>
                <option value="fluent">Fluent</option>
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>{t.post.fields.employmentType}</label>
              <select required style={selectStyle}>
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="internship">Internship</option>
                <option value="contract">Contract</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t.post.fields.salary}</label>
              <input type="text" placeholder="e.g. €70,000 - €90,000" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.description}</label>
            <textarea required rows={4} style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.descriptionZh}</label>
            <textarea rows={4} style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.requirements}</label>
            <textarea required rows={5} placeholder="One requirement per line" style={{ ...inputStyle, resize: "vertical" }} />
          </div>

          <div>
            <label style={labelStyle}>{t.post.fields.applicationUrl}</label>
            <input type="url" required placeholder="https://..." style={inputStyle} />
          </div>

          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
              <input type="checkbox" />
              {t.post.fields.remoteFriendly}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
              <input type="checkbox" />
              {t.post.fields.visaSponsorship}
            </label>
          </div>

          <button type="submit" className="btn-accent" style={{ alignSelf: "flex-start", marginTop: "0.5rem" }}>
            {t.post.submit}
          </button>
        </form>
      )}
    </div>
  );
}
