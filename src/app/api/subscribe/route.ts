import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { subscribeEmail } from "@/lib/db/email-repo";
import { checkRateLimit, getClientIp } from "@/lib/ratelimit";

// RFC 5322 dot-atom, kept deliberately conservative:
//   local  = atom ("." atom)*  -> no leading/trailing/consecutive dots
//   domain = label ("." label)+ TLD   -> no bare host, no bare 1-char TLD
// `atext` allows plus-addressing, hyphens and underscores. \p{L}/\p{N} keep
// unicode local parts (the zh placeholder is "你的邮箱@email.com") working.
const ATEXT = "[A-Za-z0-9!#$%&*+/=?^_`{|}~\\p{L}\\p{N}-]";
const LABEL = "[A-Za-z0-9\\p{L}\\p{N}](?:[A-Za-z0-9\\p{L}\\p{N}-]*[A-Za-z0-9\\p{L}\\p{N}])?";
const EMAIL_REGEX = new RegExp(
  `^${ATEXT}+(?:\\.${ATEXT}+)*@(${LABEL}\\.)+[A-Za-z\\p{L}]{2,}$`,
  "u"
);

// RFC 5321 maximums. Checked before the regex so an oversized value is never
// scanned, let alone persisted.
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_LENGTH = 64;

// This route only carries an email + a short language code.
const MAX_BODY_BYTES = 1024;

const UNIQUE_VIOLATION_CODE = "23505";
const UNIQUE_VIOLATION_MESSAGE = /duplicate key value|unique constraint|23505/i;

function isUniqueViolation(err: unknown): boolean {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (!candidate || typeof candidate !== "object") continue;
    const { code, message } = candidate as { code?: unknown; message?: unknown };
    if (typeof code === "string" && code === UNIQUE_VIOLATION_CODE) return true;
    if (typeof message === "string" && UNIQUE_VIOLATION_MESSAGE.test(message)) {
      return true;
    }
  }
  return false;
}

function okResponse(email: string, duplicate: boolean) {
  return NextResponse.json({ ok: true, email, duplicate }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = checkRateLimit(ip, 10, 60_000);
  if (!allowed) {
    const retryAfter = Math.ceil((retryAfterMs ?? 0) / 1000);
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  try {
    // Reject oversized bodies before they are buffered. App Router handlers
    // impose no default body cap, so an absent Content-Length (chunked) is
    // caught by the length check on the buffered text below instead.
    const declaredLength = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    let body: unknown;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413 });
      }
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const parsed = (body ?? {}) as {
      email?: unknown;
      language?: unknown;
      website?: unknown;
    };
    const rawEmail = parsed.email;

    // Honeypot: real users never see or fill the off-screen `website` field.
    // Answer exactly like a success so a bot learns nothing, but skip the DB
    // write and the mail entirely.
    if (typeof parsed.website === "string" && parsed.website.trim() !== "") {
      return okResponse(
        typeof rawEmail === "string" ? rawEmail.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH) : "",
        false
      );
    }

    if (typeof rawEmail !== "string") {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const normalized = rawEmail.trim().toLowerCase();

    const [localPart] = normalized.split("@");

    if (
      !normalized ||
      normalized.length > MAX_EMAIL_LENGTH ||
      localPart.length > MAX_LOCAL_LENGTH ||
      !EMAIL_REGEX.test(normalized)
    ) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const language =
      typeof parsed.language === "string" && parsed.language.trim()
        ? parsed.language.trim().toLowerCase().slice(0, 10)
        : "en";

    let result: { email: string; created: boolean };
    try {
      result = await subscribeEmail(normalized, language);
    } catch (err) {
      // Two concurrent submits of the same address race on the unique index.
      // That is a duplicate, not a server error. Unrelated DB errors rethrow.
      if (isUniqueViolation(err)) {
        return okResponse(normalized, true);
      }
      throw err;
    }

    return okResponse(result.email, !result.created);
  } catch (err) {
    console.error("[subscribe] error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
