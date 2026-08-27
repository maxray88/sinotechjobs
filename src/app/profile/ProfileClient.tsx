"use client";

import { useState } from "react";
import { useLang } from "@/components/LanguageProvider";

type Profile = {
  user_id?: string;
  display_name?: string | null;
  headline?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  languages?: string[] | null;
  preferred_locations?: string[] | null;
  preferred_fields?: string[] | null;
  visible?: boolean | null;
} | null;

type Props = {
  initialProfile: Profile;
  userEmail: string;
};

const LANGUAGE_OPTIONS = ["en", "zh", "de"] as const;
const FIELD_OPTIONS = ["ai", "cs", "robotics", "drone", "remote"] as const;

export default function ProfileClient({ initialProfile, userEmail }: Props) {
  const { t } = useLang();

  // Fallback for t.profile if missing (should not happen after i18n patch)
  const profileT = (t as unknown as { profile?: typeof fallback }).profile ?? fallback;
  // we need fallback defined below after component? define before use? We'll inline fallback object.
  const p = profileT as {
    title: string;
    subtitle: string;
    fields: Record<string, string>;
    hints: Record<string, string>;
    save: string;
    saved: string;
    errors: Record<string, string>;
  };

  const [displayName, setDisplayName] = useState(initialProfile?.display_name ?? "");
  const [headline, setHeadline] = useState(initialProfile?.headline ?? "");
  const [bio, setBio] = useState(initialProfile?.bio ?? "");
  const [skillsInput, setSkillsInput] = useState(
    Array.isArray(initialProfile?.skills) ? (initialProfile?.skills as string[]).join(", ") : ""
  );
  const [languages, setLanguages] = useState<string[]>(
    Array.isArray(initialProfile?.languages) ? (initialProfile?.languages as string[]) : []
  );
  const [preferredLocationsInput, setPreferredLocationsInput] = useState(
    Array.isArray(initialProfile?.preferred_locations)
      ? (initialProfile?.preferred_locations as string[]).join(", ")
      : ""
  );
  const [preferredFields, setPreferredFields] = useState<string[]>(
    Array.isArray(initialProfile?.preferred_fields) ? (initialProfile?.preferred_fields as string[]) : []
  );
  const [visible, setVisible] = useState(Boolean(initialProfile?.visible));

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const hintStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    color: "var(--muted-foreground)",
    marginTop: "0.25rem",
  };

  function toggleArray(value: string, arr: string[], setter: (v: string[]) => void) {
    if (arr.includes(value)) {
      setter(arr.filter((x) => x !== value));
    } else {
      setter([...arr, value]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const skills = skillsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const preferred_locations = preferredLocationsInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      display_name: displayName.trim(),
      headline: headline.trim(),
      bio: bio.trim(),
      skills,
      languages,
      preferred_locations,
      preferred_fields: preferredFields,
      visible,
    };

    try {
      const res = await fetch("/api/candidate/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown; profile?: unknown };
      if (!res.ok) {
        const details = data.details ? JSON.stringify(data.details) : data.error || `Save failed (${res.status})`;
        setError(details);
        // try map generic
        if (res.status === 400 && Array.isArray(data.details)) {
          const first = (data.details as { message?: string }[])[0];
          if (first?.message) setError(first.message);
        }
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("[ProfileClient] save error", err);
      setError(p.errors?.generic ?? "Please check your input.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "2rem 1rem" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--foreground)", margin: 0 }}>
          {p.title}
        </h1>
        <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)", marginTop: "0.375rem", marginBottom: 0 }}>
          {p.subtitle}
        </p>
        {userEmail && (
          <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>{userEmail}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={labelStyle}>{p.fields.displayName}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={p.fields.displayName}
            style={inputStyle}
            maxLength={40}
          />
        </div>

        <div>
          <label style={labelStyle}>{p.fields.headline}</label>
          <input
            type="text"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder={p.fields.headline}
            style={inputStyle}
            maxLength={80}
          />
        </div>

        <div>
          <label style={labelStyle}>{p.fields.bio}</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={p.fields.bio}
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
            maxLength={2000}
          />
        </div>

        <div>
          <label style={labelStyle}>{p.fields.skills}</label>
          <input
            type="text"
            value={skillsInput}
            onChange={(e) => setSkillsInput(e.target.value)}
            placeholder="Python, ROS, PyTorch"
            style={inputStyle}
          />
          <p style={hintStyle}>{p.hints.skills}</p>
        </div>

        <div>
          <label style={labelStyle}>{p.fields.languages}</label>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {LANGUAGE_OPTIONS.map((lang) => (
              <label
                key={lang}
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.875rem" }}
              >
                <input
                  type="checkbox"
                  checked={languages.includes(lang)}
                  onChange={() => toggleArray(lang, languages, setLanguages)}
                />
                {lang}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label style={labelStyle}>{p.fields.preferredLocations}</label>
          <input
            type="text"
            value={preferredLocationsInput}
            onChange={(e) => setPreferredLocationsInput(e.target.value)}
            placeholder="Berlin, Munich, Remote"
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{p.fields.preferredFields}</label>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {FIELD_OPTIONS.map((field) => (
              <label
                key={field}
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.875rem" }}
              >
                <input
                  type="checkbox"
                  checked={preferredFields.includes(field)}
                  onChange={() => toggleArray(field, preferredFields, setPreferredFields)}
                />
                {field}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
            {p.fields.visible}
          </label>
          <p style={hintStyle}>{p.hints.visible}</p>
        </div>

        {error && <p style={{ color: "#ef4444", fontSize: "0.875rem", margin: 0 }}>{error}</p>}
        {saved && <p style={{ color: "#16a34a", fontSize: "0.875rem", margin: 0 }}>{p.saved}</p>}

        <button
          type="submit"
          disabled={saving}
          className="btn-accent"
          style={{ alignSelf: "flex-start", opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : p.save}
        </button>
      </form>
    </div>
  );
}

const fallback = {
  title: "Candidate Profile",
  subtitle: "Manage your profile and visibility to employers",
  fields: {
    displayName: "Display Name",
    headline: "Headline",
    bio: "Bio",
    skills: "Skills",
    languages: "Languages",
    preferredLocations: "Preferred Locations",
    preferredFields: "Preferred Fields",
    visible: "Visible to employers",
  },
  hints: {
    skills: "Comma-separated, e.g. Python, ROS, PyTorch",
    visible: "When enabled, employers can discover your profile",
  },
  save: "Save Profile",
  saved: "Profile saved!",
  errors: {
    tooLong: "Value is too long",
    generic: "Please check your input.",
  },
} as const;
