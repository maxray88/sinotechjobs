"use client";

import { useState } from "react";
import { useLang } from "./LanguageProvider";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Status = "idle" | "loading" | "success" | "error";

export default function EmailCapture() {
  const { lang, t } = useLang();
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email: trimmed, language: lang }),
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
