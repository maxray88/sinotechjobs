"use client";

import { useState } from "react";
import { useLang } from "./LanguageProvider";

export default function EmailCapture() {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
      setEmail("");
    }
  };

  return (
    <div
      style={{
        background: "var(--primary)",
        borderRadius: "1rem",
        padding: "3rem 2rem",
        textAlign: "center",
        color: "white",
      }}
    >
      <h2 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        {t.emailCapture.title}
      </h2>
      <p style={{ fontSize: "0.95rem", opacity: 0.8, marginBottom: "2rem" }}>
        {t.emailCapture.subtitle}
      </p>
      {submitted ? (
        <p style={{ fontSize: "1rem", fontWeight: 600, padding: "0.75rem", background: "rgba(255,255,255,0.15)", borderRadius: "0.5rem", display: "inline-block" }}>
          ✓ {t.emailCapture.success}
        </p>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            gap: "0.5rem",
            maxWidth: "500px",
            margin: "0 auto",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.emailCapture.placeholder}
            required
            style={{
              flex: "1",
              minWidth: "200px",
              padding: "0.625rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              fontSize: "0.875rem",
              outline: "none",
            }}
          />
          <button
            type="submit"
            style={{
              background: "var(--accent)",
              color: "white",
              padding: "0.625rem 1.5rem",
              borderRadius: "0.5rem",
              border: "none",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            {t.emailCapture.button}
          </button>
        </form>
      )}
    </div>
  );
}
