import { NextResponse } from "next/server";
import { getAllJobs } from "@/lib/all-jobs";
import { getCurrentUser } from "@/lib/auth";
import { saveMatchScores } from "@/lib/match-scores";
import {
  adaptJob,
  computeMatchScore,
  type CandidateProfile,
  type FocusArea,
  type VisaStatus,
} from "@/lib/matching";

const USAGE =
  "POST /api/match with { candidate: { focus_area, visa_status, languages, hsk_level, desired_location, salary_min, salary_max, sub_specializations }, jobIds?: string[] }";

export async function GET() {
  return NextResponse.json({ ok: true, usage: USAGE });
}

const FOCUS_AREA_ALIASES: Record<string, FocusArea> = {
  ai: "ai_ml",
  ai_ml: "ai_ml",
  cs: "cs",
  robotics: "robotics",
  drone: "drones_uav",
  drones_uav: "drones_uav",
  remote: "remote",
};

const VISA_STATUSES: VisaStatus[] = [
  "eu_citizen",
  "work_permit_unrestricted",
  "work_permit_restricted",
  "needs_sponsorship",
  "student_visa",
];

interface CandidateInput {
  id?: string;
  candidate_id?: string;
  focus_area?: string;
  visa_status?: string;
  languages?: Record<string, string>;
  hsk_level?: number | null;
  desired_location?: string | string[];
  salary_min?: number;
  salary_max?: number;
  sub_specializations?: string[];
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function resolveFocusArea(raw: string | undefined): FocusArea {
  const key = raw ?? "";
  // FIX: a bare `FOCUS_AREA_ALIASES[key]` reads through Object.prototype, so
  // "toString"/"constructor"/"__proto__" return non-nullish values that the
  // `?? "ai_ml"` fallback never catches. hasOwn restricts lookup to own keys.
  return Object.hasOwn(FOCUS_AREA_ALIASES, key)
    ? FOCUS_AREA_ALIASES[key]
    : "ai_ml";
}

function toLanguageMap(value: unknown): Record<string, string> {
  // FIX: a typeof "object" check alone lets arrays through, handing
  // computeMatchScore an array where a language map is expected. Reject
  // non-objects and arrays, and coerce every level with String().
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [language, level] of Object.entries(value)) {
    out[language] = String(level);
  }
  return out;
}

/**
 * Resolve the session user id used for persistence.
 * Returns null when Supabase is unconfigured or no user is signed in — the
 * caller then skips the write entirely rather than trusting a body-supplied id.
 */
async function resolveSessionUserId(): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    return user?.id ?? null;
  } catch {
    // No Supabase env / cookie store unavailable — treat as anonymous.
    return null;
  }
}

function buildCandidateProfile(input: CandidateInput): CandidateProfile {
  return {
    id: input.id ?? input.candidate_id ?? "anonymous",
    full_name: "",
    current_location: "",
    desired_location: toStringArray(input.desired_location),
    visa_status: VISA_STATUSES.includes(input.visa_status as VisaStatus)
      ? (input.visa_status as VisaStatus)
      : "needs_sponsorship",
    focus_area: resolveFocusArea(input.focus_area),
    sub_specializations: toStringArray(input.sub_specializations),
    years_of_experience: 5,
    current_role: "",
    bio: "",
    languages: toLanguageMap(input.languages),
    hsk_level:
      typeof input.hsk_level === "number" && Number.isFinite(input.hsk_level)
        ? input.hsk_level
        : null,
    salary_expectation_min:
      typeof input.salary_min === "number" && Number.isFinite(input.salary_min)
        ? input.salary_min
        : 0,
    salary_expectation_max:
      typeof input.salary_max === "number" && Number.isFinite(input.salary_max)
        ? input.salary_max
        : 0,
    chinese_university: null,
    hometown_province: null,
    profile_completeness: 0,
    last_active_at: null,
  };
}

export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // FIX: `as typeof body` asserted over any. A literal `null` body parses
  // fine, then `!body.candidate` threw a TypeError -> 500 instead of 400.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json(
      { error: "Invalid JSON body", usage: USAGE },
      { status: 400 },
    );
  }
  const body = parsed as { candidate?: CandidateInput; jobIds?: string[] };
  if (!body.candidate || typeof body.candidate !== "object") {
    return NextResponse.json(
      { error: "Missing candidate object", usage: USAGE },
      { status: 400 },
    );
  }

  const candidate = buildCandidateProfile(body.candidate);
  const jobIdSet =
    Array.isArray(body.jobIds) && body.jobIds.length > 0
      ? new Set(body.jobIds.map(String))
      : null;

  const allJobs = await getAllJobs();
  const jobs = jobIdSet ? allJobs.filter((j) => jobIdSet.has(j.id)) : allJobs;

  const results = jobs
    .map((job) => {
      const { score, reasons } = computeMatchScore(candidate, adaptJob(job));
      return { jobId: job.id, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  // Best-effort persist of strong matches (004 table may not exist yet).
  // The read/compute path above stays public by design, but the WRITE is gated
  // on an authenticated session: candidateId is derived from the session user
  // only, never from the body, so an anonymous caller cannot overwrite a real
  // candidate's stored scores.
  const sessionUserId = await resolveSessionUserId();
  if (sessionUserId) {
    try {
      await saveMatchScores(
        results
          .filter((r) => r.score >= 70)
          .map((r) => ({
            candidate_id: sessionUserId,
            job_id: r.jobId,
            score: r.score,
            reasons: r.reasons,
          })),
      );
    } catch (error) {
      // Degraded mode: matching results are still returned, but a failed write
      // must not be silent.
      console.warn("[POST /api/match] failed to persist match scores", error);
    }
  }

  return NextResponse.json(results);
}
