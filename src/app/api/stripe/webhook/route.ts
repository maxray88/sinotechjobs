import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db/client";

import Stripe from "stripe";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || request.headers.get("Stripe-Signature") || "";

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecret = process.env.STRIPE_SECRET_KEY;

  let event: { type: string; data: { object: Record<string, unknown> } };

  if (!webhookSecret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "webhook secret not configured" }, { status: 400 });
    }
    // Dev mode: skip verification, parse JSON directly
    try {
      event = JSON.parse(body) as typeof event;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
  } else {
    if (!stripeSecret) {
      // Need stripe secret to construct Stripe instance for verification
      return NextResponse.json({ error: "stripe not configured" }, { status: 503 });
    }
    const stripe = new Stripe(stripeSecret, { apiVersion: "2024-06-20" } as unknown as never);
    try {
      const constructed = stripe.webhooks.constructEvent(body, sigHeader, webhookSecret) as unknown as {
        type: string;
        data: { object: Record<string, unknown> };
      };
      event = constructed;
    } catch (err) {
      console.error("[stripe webhook] signature verify failed", err);
      return NextResponse.json({ error: "signature verification failed" }, { status: 400 });
    }
  }

  // Handle checkout.session.completed
  if (event.type === "checkout.session.completed") {
    const obj = event.data.object as Record<string, unknown>;
    const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
    // Extract postingId from metadata or client_reference_id
    let postingIdRaw: unknown = metadata.postingId;
    if (!postingIdRaw && typeof obj.client_reference_id === "string") {
      postingIdRaw = obj.client_reference_id;
    }
    if (!postingIdRaw && typeof (obj as Record<string, unknown>).client_reference_id === "string") {
      postingIdRaw = (obj as Record<string, unknown>).client_reference_id;
    }

    const postingId = Number(postingIdRaw);
    if (!postingIdRaw || !Number.isFinite(postingId) || !Number.isInteger(postingId)) {
      // No valid postingId, ack but ignore
      console.warn("[stripe webhook] checkout.session.completed without valid postingId", metadata);
      return NextResponse.json({ received: true, ignored: true }, { status: 200 });
    }

    try {
      const supabase = getSupabaseAdmin();
      const { data: posting, error } = await supabase
        .from("employer_postings")
        .select("*")
        .eq("id", postingId)
        .single();

      if (error || !posting) {
        console.warn("[stripe webhook] posting not found", postingId);
        // Return 200 to ack Stripe (avoid retry), but spec says 404 but return 200 to ack
        return NextResponse.json({ received: true }, { status: 200 });
      }

      // Idempotency: if already paid
      if (posting.payment_status === "paid") {
        return NextResponse.json({ received: true, idempotent: true }, { status: 200 });
      }

      const featuredUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { error: updateError } = await supabase
        .from("employer_postings")
        .update({
          payment_status: "paid",
          featured_until: featuredUntil,
        })
        .eq("id", postingId);

      if (updateError) {
        console.error("[stripe webhook] update failed", updateError);
        return NextResponse.json({ error: "update failed" }, { status: 500 });
      }

      return NextResponse.json({ received: true }, { status: 200 });
    } catch (err) {
      console.error("[stripe webhook] unexpected error", err);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true, ignored: true }, { status: 200 });
}
