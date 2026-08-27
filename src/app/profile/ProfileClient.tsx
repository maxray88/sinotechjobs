"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
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

type CvRow = {
  id: string | number;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_at?: string;
  user_id?: string;
};

const LANGUAGE_OPTIONS = ["en", "zh", "de"] as const;
const FIELD_OPTIONS = ["ai", "cs", "robotics", "drone", "remote"] as const;

export default function ProfileClient({ initialProfile, userEmail }: Props) {
  const { t } = useLang();

  // Fallback for t.profile if missing (should not happen after i18n patch)
  const profileT = (t as unknown as { profile?: typeof fallback }).profile ?? fallback;
  const p = profileT as {
    title: string;
    subtitle: string;
    fields: Record<string, string>;
    hints: Record<string, string>;
    save: string;
    saved: string;
    errors: Record<string, string>;
    cv: {
      title: string;
      upload: string;
      uploading: string;
      uploaded: string;
      invalidType: string;
      tooLarge: string;
      delete: string;
      deleted: string;
      empty: string;
      hint: string;
      maxSize: string;
    };
  };

  const fallbackCv = (fallback as unknown as { cv: typeof p.cv }).cv;
  const cvT = (p as unknown as { cv?: typeof fallbackCv }).cv ?? fallbackCv;

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

  // CV state
  const [cv, setCv] = useState<CvRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [cvLoading, setCvLoading] = useState(true);
  const [cvUploading, setCvUploading] = useState(false);
  const [cvDeleting, setCvDeleting] = useState(false);
  const [cvError, setCvError] = useState<string | null>(null);
  const [cvSuccess, setCvSuccess] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  async function fetchCv() {
    setCvLoading(true);
    setCvError(null);
    try {
      const res = await fetch("/api/cvs", { method: "GET" });
      const data = (await res.json().catch(() => ({}))) as { cv?: CvRow | null; signedUrl?: string; error?: string };
      if (!res.ok) {
        // 401 or 500 - show generic? keep silent unless error
        if (res.status !== 401) {
          console.error("[ProfileClient] fetch CV error", data);
        }
        setCv(null);
        setSignedUrl(null);
        return;
      }
      if (!data.cv) {
        setCv(null);
        setSignedUrl(null);
      } else {
        setCv(data.cv);
        setSignedUrl(data.signedUrl ?? null);
      }
    } catch (err) {
      console.error("[ProfileClient] fetch CV exception", err);
      setCvError(String(err));
    } finally {
      setCvLoading(false);
    }
  }

  useEffect(() => {
    void fetchCv();
  }, []);

  async function handleCvUpload() {
    setCvError(null);
    setCvSuccess(null);

    if (!selectedFile) {
      setCvError(cvT.invalidType);
      return;
    }

    if (selectedFile.type !== "application/pdf") {
      setCvError(cvT.invalidType);
      return;
    }

    if (selectedFile.size > 5 * 1024 * 1024) {
      setCvError(cvT.tooLarge);
      return;
    }

    if (selectedFile.size === 0) {
      setCvError(cvT.invalidType);
      return;
    }

    setCvUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("/api/cvs", {
        method: "POST",
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as { error?: string; max?: string; cv?: CvRow };

      if (!res.ok) {
        if (data.error === "invalid_type") {
          setCvError(cvT.invalidType);
        } else if (data.error === "too_large") {
          setCvError(cvT.tooLarge);
        } else if (res.status === 429) {
          setCvError(data.error || "Rate limited");
        } else {
          setCvError(data.error || `Upload failed (${res.status})`);
        }
        return;
      }

      setCvSuccess(cvT.uploaded);
      setSelectedFile(null);
      // reset file input value
      const el = document.getElementById("cv-file-input") as HTMLInputElement | null;
      if (el) el.value = "";
      await fetchCv();
      setTimeout(() => setCvSuccess(null), 3000);
    } catch (err) {
      console.error("[ProfileClient] upload error", err);
      setCvError(String(err));
    } finally {
      setCvUploading(false);
    }
  }

  async function handleCvDelete() {
    if (!cv) return;
    setCvDeleting(true);
    setCvError(null);
    setCvSuccess(null);
    try {
      const res = await fetch(`/api/cvs?id=${encodeURIComponent(String(cv.id))}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setCvError(data.error || `Delete failed (${res.status})`);
        return;
      }
      setCv(null);
      setSignedUrl(null);
      setCvSuccess(cvT.deleted);
      setTimeout(() => setCvSuccess(null), 3000);
    } catch (err) {
      console.error("[ProfileClient] delete error", err);
      setCvError(String(err));
    } finally {
      setCvDeleting(false);
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
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--foreground)", margin: 0 }}>{p.title}</h1>
        <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)", marginTop: "0.375rem" }}>{p.subtitle}</p>
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

      {/* CV upload section */}
      <div
        style={{
          marginTop: "2rem",
          paddingTop: "1.5rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <h3 style={{ fontSize: "1.125rem", fontWeight: 700, color: "var(--foreground)", margin: 0 }}>{cvT.title}</h3>
        <p style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>
          {cvT.hint} · {cvT.maxSize}
        </p>

        {cvLoading ? (
          <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)", marginTop: "0.75rem" }}>Loading...</p>
        ) : cv ? (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              background: "var(--muted)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <div style={{ fontSize: "0.875rem", color: "var(--foreground)" }}>
              <span style={{ fontWeight: 600 }}>{cv.file_name}</span>{" "}
              <span style={{ color: "var(--muted-foreground)" }}>({formatFileSize(cv.file_size)})</span>
            </div>
            {signedUrl && (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "0.875rem", color: "var(--accent)", textDecoration: "underline" }}
              >
                View / Download CV
              </a>
            )}
            <button
              type="button"
              onClick={handleCvDelete}
              disabled={cvDeleting}
              style={{
                alignSelf: "flex-start",
                padding: "0.375rem 0.75rem",
                borderRadius: "0.375rem",
                border: "1px solid #ef4444",
                background: cvDeleting ? "#fee2e2" : "transparent",
                color: "#ef4444",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: cvDeleting ? "not-allowed" : "pointer",
                opacity: cvDeleting ? 0.6 : 1,
              }}
            >
              {cvDeleting ? "Deleting..." : cvT.delete}
            </button>
          </div>
        ) : (
          <p style={{ fontSize: "0.875rem", color: "var(--muted-foreground)", marginTop: "0.75rem" }}>{cvT.empty}</p>
        )}

        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input
            id="cv-file-input"
            type="file"
            accept=".pdf"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setSelectedFile(f);
              setCvError(null);
              setCvSuccess(null);
            }}
            style={{ fontSize: "0.875rem" }}
          />
          <p style={hintStyle}>
            {cvT.hint} · {cvT.maxSize}
          </p>
          <button
            type="button"
            onClick={handleCvUpload}
            disabled={cvUploading || !selectedFile}
            style={{
              alignSelf: "flex-start",
              padding: "0.5rem 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: cvUploading || !selectedFile ? "var(--muted)" : "var(--accent)",
              color: cvUploading || !selectedFile ? "var(--muted-foreground)" : "white",
              fontSize: "0.875rem",
              fontWeight: 600,
              cursor: cvUploading || !selectedFile ? "not-allowed" : "pointer",
              opacity: cvUploading ? 0.6 : 1,
            }}
          >
            {cvUploading ? cvT.uploading : cvT.upload}
          </button>
          {cvError && <p style={{ color: "#ef4444", fontSize: "0.875rem", margin: 0 }}>{cvError}</p>}
          {cvSuccess && <p style={{ color: "#16a34a", fontSize: "0.875rem", margin: 0 }}>{cvSuccess}</p>}
        </div>
      </div>
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
  cv: {
    title: "CV / Resume",
    upload: "Upload CV",
    uploading: "Uploading...",
    uploaded: "CV uploaded successfully!",
    invalidType: "Only PDF files are allowed.",
    tooLarge: "File is too large. Maximum size is 5MB.",
    delete: "Delete CV",
    deleted: "CV deleted.",
    empty: "No CV uploaded yet.",
    hint: "PDF only, max 5MB",
    maxSize: "Maximum size: 5MB",
  },
} as const;
