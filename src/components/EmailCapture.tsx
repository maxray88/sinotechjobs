"use client";

import { useState } from "react";
import { useLang } from "./LanguageProvider";

// Mirrors the dot-atom pattern in src/app/api/subscribe/route.ts — keep in sync.
const ATEXT = "[A-Za-z0-9!#$%&*+/=?^_`{|}~\\p{L}\\p{N}-]";
const LABEL = "[A-Za-z0-9\\p{L}\\p{N}](?:[A-Za-z0-9\\p{L}\\p{N}-]*[A-Za-z0-9\\p{L}\\p{N}])?";
const EMAIL_REGEX = new RegExp(
  `^${ATEXT}+(?:\\.${ATEXT}+)*@(${LABEL}\\.)+[A-Za-z\\p{L}]{2,}$`,
  "u"
);

// Off-screen rather than display:none — bots skip display:none fields, and a
// hidden-but-rendered input is what a naive form-filling bot will fill in.
const HONEYPOT_STYLE: React.CSSProperties = {
  position: "absolute",
  left: "-9999px",
  top: "-9999px",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  opacity: 0,
  pointerEvents: "none",
};

type Status = "idle" | "loading" | "success" | "error";

export default function EmailCapture() {
  const { lang, t } = useLang();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();

    if (!EMAIL_REGEX.test(trimmed)) {
      setStatus("error");
      setMessage("Invalid email");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, language: lang, website }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        duplicate?: boolean;
      };

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Invalid email");
        return;
      }

      setStatus("success");
      setMessage(t.emailCapture.success);
      setEmail("");
      setWebsite("");
    } catch {
      setStatus("error");
      setMessage("Internal error");
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
      {status === "success" ? (
        <p
          style={{
            fontSize: "1rem",
            fontWeight: 600,
            padding: "0.75rem",
            background: "rgba(255,255,255,0.15)",
            borderRadius: "0.5rem",
            display: "inline-block",
          }}
        >
          ✓ {message || t.emailCapture.success}
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
            disabled={status === "loading"}
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
          <div aria-hidden="true" style={HONEYPOT_STYLE}>
            <label htmlFor="subscribe-website">Website</label>
            <input
              id="subscribe-website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>
          <button
            type="submit"
            disabled={status === "loading"}
            style={{
              background: "var(--accent)",
              color: "white",
              padding: "0.625rem 1.5rem",
              borderRadius: "0.5rem",
              border: "none",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: status === "loading" ? "not-allowed" : "pointer",
              opacity: status === "loading" ? 0.7 : 1,
            }}
          >
            {status === "loading" ? "..." : t.emailCapture.button}
          </button>
        </form>
      )}
      {status === "error" && message && (
        <p
          role="alert"
          style={{
            marginTop: "1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            color: "#fecaca",
          }}
        >
          {message}
        </p>
      )}
      {status === "loading" && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", opacity: 0.8 }}>
          Loading...
        </p>
      )}
    </div>
  );
}
