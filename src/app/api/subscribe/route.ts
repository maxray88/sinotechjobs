import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { subscribeEmail } from "@/lib/db/email-repo";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  // TODO: add rate limiting (e.g., Upstash Redis) to prevent abuse
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const parsed = (body ?? {}) as { email?: unknown; language?: unknown };
    const rawEmail = parsed.email;

    if (typeof rawEmail !== "string") {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const normalized = rawEmail.trim().toLowerCase();

    if (!normalized || !EMAIL_REGEX.test(normalized)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const language =
      typeof parsed.language === "string" && parsed.language.trim()
        ? parsed.language.trim().toLowerCase().slice(0, 10)
        : "en";

    const result = await subscribeEmail(normalized, language);

    return NextResponse.json(
      { ok: true, email: result.email, duplicate: !result.created },
      { status: 200 }
    );
  } catch (err) {
    console.error("[subscribe] error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
