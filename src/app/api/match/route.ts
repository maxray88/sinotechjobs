import { NextResponse } from "next/server";
import { getAllJobs } from "@/lib/all-jobs";
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

function buildCandidateProfile(input: CandidateInput): CandidateProfile {
  return {
    id: input.id ?? input.candidate_id ?? "anonymous",
    full_name: "",
    current_location: "",
    desired_location: toStringArray(input.desired_location),
    visa_status: VISA_STATUSES.includes(input.visa_status as VisaStatus)
      ? (input.visa_status as VisaStatus)
      : "needs_sponsorship",
    focus_area: FOCUS_AREA_ALIASES[input.focus_area ?? ""] ?? "ai_ml",
    sub_specializations: toStringArray(input.sub_specializations),
    years_of_experience: 5,
    current_role: "",
    bio: "",
    languages:
      input.languages && typeof input.languages === "object" ? input.languages : {},
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
  let body: { candidate?: CandidateInput; jobIds?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
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
  // Skipped entirely for anonymous callers; DB errors are swallowed.
  const candidateId = body.candidate.id ?? body.candidate.candidate_id;
  if (candidateId) {
    try {
      await saveMatchScores(
        results
          .filter((r) => r.score >= 70)
          .map((r) => ({
            candidate_id: candidateId,
            job_id: r.jobId,
            score: r.score,
            reasons: r.reasons,
          })),
      );
    } catch {
      // Degraded mode: matching results are still returned.
    }
  }

  return NextResponse.json(results);
}
