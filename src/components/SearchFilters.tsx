"use client";

import { useState } from "react";
import type { CSSProperties } from "react";
import type {
  EmploymentType,
  JobField,
  JobLocation,
  Language,
  LanguageLevel,
} from "@/lib/types";
import {
  FOCUS_AREA_TAXONOMY,
  getFocusAreaLabel,
  getSubTagLabel,
  type FocusArea,
} from "@/lib/taxonomy";

export interface SearchFiltersState {
  field?: JobField;
  subTags?: string[];
  location?: JobLocation;
  languageLevel?: LanguageLevel;
  employmentType?: EmploymentType;
  visaSponsorship?: boolean;
  remoteFriendly?: boolean;
}

interface SearchFiltersProps {
  lang?: Language;
  initialFilters?: SearchFiltersState;
  onFiltersChange: (filters: SearchFiltersState) => void;
}

const UI_TEXT: Record<Language, Record<string, string>> = {
  en: {
    filters: "Filters",
    clearAll: "Clear all",
    focusArea: "Focus Area",
    subTag: "Sub-Specialization",
    location: "Location",
    language: "Chinese Requirement",
    employment: "Employment Type",
    visa: "Visa Sponsorship Only",
    remote: "Remote Friendly Only",
    all: "All",
  },
  zh: {
    filters: "筛选",
    clearAll: "清除全部",
    focusArea: "技术领域",
    subTag: "细分方向",
    location: "工作地点",
    language: "中文要求",
    employment: "雇佣类型",
    visa: "仅看提供签证担保",
    remote: "仅看支持远程",
    all: "全部",
  },
  de: {
    filters: "Filter",
    clearAll: "Alle zurücksetzen",
    focusArea: "Fachbereich",
    subTag: "Spezialisierung",
    location: "Standort",
    language: "Chinesisch-Anforderung",
    employment: "Beschäftigungsart",
    visa: "Nur mit Visum-Sponsoring",
    remote: "Nur remote-freundlich",
    all: "Alle",
  },
};

const LOCATION_OPTIONS: { value: JobLocation; label: Record<Language, string> }[] = [
  { value: "de", label: { en: "Germany", zh: "德国", de: "Deutschland" } },
  { value: "at", label: { en: "Austria", zh: "奥地利", de: "Österreich" } },
  { value: "ch", label: { en: "Switzerland", zh: "瑞士", de: "Schweiz" } },
  { value: "remote", label: { en: "Remote", zh: "远程", de: "Remote" } },
];

const LANGUAGE_OPTIONS: { value: LanguageLevel; label: Record<Language, string> }[] = [
  { value: "nice-to-have", label: { en: "Nice to have", zh: "加分项", de: "Von Vorteil" } },
  { value: "required", label: { en: "Required", zh: "必需", de: "Erforderlich" } },
  { value: "fluent", label: { en: "Fluent", zh: "流利", de: "Fließend" } },
];

const EMPLOYMENT_OPTIONS: { value: EmploymentType; label: Record<Language, string> }[] = [
  { value: "full-time", label: { en: "Full-time", zh: "全职", de: "Vollzeit" } },
  { value: "part-time", label: { en: "Part-time", zh: "兼职", de: "Teilzeit" } },
  { value: "internship", label: { en: "Internship", zh: "实习", de: "Praktikum" } },
  { value: "contract", label: { en: "Contract", zh: "合同制", de: "Vertrag" } },
];

const FOCUS_AREAS = Object.keys(FOCUS_AREA_TAXONOMY) as FocusArea[];

export default function SearchFilters({
  lang = "en",
  initialFilters,
  onFiltersChange,
}: SearchFiltersProps) {
  const [filters, setFilters] = useState<SearchFiltersState>(initialFilters ?? {});
  const [showFilters, setShowFilters] = useState(true);
  const t = UI_TEXT[lang];

  function update(next: SearchFiltersState) {
    setFilters(next);
    onFiltersChange(next);
  }

  function toggleField(area: JobField) {
    update({
      ...filters,
      field: filters.field === area ? undefined : area,
      subTags: filters.field === area ? [] : filters.subTags,
    });
  }

  function toggleSubTag(tag: string) {
    const current = filters.subTags ?? [];
    update({
      ...filters,
      subTags: current.includes(tag)
        ? current.filter((s) => s !== tag)
        : [...current, tag],
    });
  }

  function clearFilters() {
    update({});
  }

  const hasActiveFilters = Object.values(filters).some(
    (v) => v !== undefined && v !== "" && (!Array.isArray(v) || v.length > 0) && v !== false
  );

  const chipStyle = (active: boolean): CSSProperties => ({
    borderRadius: "9999px",
    padding: "0.25rem 0.75rem",
    fontSize: "0.75rem",
    border: "1px solid var(--border)",
    cursor: "pointer",
    background: active ? "var(--foreground)" : "var(--background)",
    color: active ? "var(--background)" : "var(--foreground)",
  });

  const selectStyle: CSSProperties = {
    padding: "0.5rem 0.75rem",
    borderRadius: "0.5rem",
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: "0.875rem",
    outline: "none",
    cursor: "pointer",
    width: "100%",
  };

  const labelStyle: CSSProperties = {
    fontSize: "0.75rem",
    fontWeight: 500,
    color: "var(--muted-foreground, #6b7280)",
    display: "block",
    marginBottom: "0.5rem",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--foreground)",
          }}
        >
          <span aria-hidden>🔍</span> {t.filters} {showFilters ? "▾" : "▸"}
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
              fontSize: "0.75rem",
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted-foreground, #6b7280)",
            }}
          >
            ✕ {t.clearAll}
          </button>
        )}
      </div>

      {showFilters && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={labelStyle}>{t.focusArea}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button onClick={() => update({ ...filters, field: undefined, subTags: [] })} style={chipStyle(!filters.field)}>
                {t.all}
              </button>
              {FOCUS_AREAS.map((area) => (
                <button key={area} onClick={() => toggleField(area)} style={chipStyle(filters.field === area)}>
                  {getFocusAreaLabel(area, lang)}
                </button>
              ))}
            </div>
          </div>

          {filters.field && (
            <div>
              <label style={labelStyle}>{t.subTag}</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {FOCUS_AREA_TAXONOMY[filters.field].map((sub) => (
                  <button
                    key={sub}
                    onClick={() => toggleSubTag(sub)}
                    style={{
                      ...chipStyle(filters.subTags?.includes(sub) ?? false),
                      fontSize: "11px",
                      padding: "0.125rem 0.625rem",
                    }}
                  >
                    {getSubTagLabel(sub, lang)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(10rem, 1fr))", gap: "0.75rem" }}>
            <div>
              <label style={labelStyle}>{t.location}</label>
              <select
                value={filters.location ?? ""}
                onChange={(e) =>
                  update({ ...filters, location: (e.target.value || undefined) as JobLocation | undefined })
                }
                style={selectStyle}
              >
                <option value="">{t.all}</option>
                {LOCATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label[lang]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t.language}</label>
              <select
                value={filters.languageLevel ?? ""}
                onChange={(e) =>
                  update({ ...filters, languageLevel: (e.target.value || undefined) as LanguageLevel | undefined })
                }
                style={selectStyle}
              >
                <option value="">{t.all}</option>
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label[lang]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t.employment}</label>
              <select
                value={filters.employmentType ?? ""}
                onChange={(e) =>
                  update({ ...filters, employmentType: (e.target.value || undefined) as EmploymentType | undefined })
                }
                style={selectStyle}
              >
                <option value="">{t.all}</option>
                {EMPLOYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label[lang]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={filters.visaSponsorship ?? false}
                onChange={() => update({ ...filters, visaSponsorship: !filters.visaSponsorship })}
              />
              {t.visa}
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={filters.remoteFriendly ?? false}
                onChange={() => update({ ...filters, remoteFriendly: !filters.remoteFriendly })}
              />
              {t.remote}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
