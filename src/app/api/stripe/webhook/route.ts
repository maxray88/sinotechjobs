import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/db/client";

import Stripe from "stripe";

export const dynamic = "force-dynamic";

const ALLOWED_TIERS = ["featured", "pinned", "enterprise"] as const;
type AllowedTier = (typeof ALLOWED_TIERS)[number];

/** Amount charged per tier in EUR cents. Must stay in sync with PRICE_MAP in ../checkout/route.ts. */
const PRICE_MAP: Record<AllowedTier, number> = {
  featured: 9900,
  pinned: 19900,
  enterprise: 49900,
};

/**
 * Length of the paid entitlement per tier, in days.
 * The products sold at checkout are named "<Tier> Posting 30d" (see NAME_MAP in
 * ../checkout/route.ts), i.e. all three tiers currently differ only in price, not
 * in duration. The table is explicit so that giving a tier a different duration
 * later is a one-line change here instead of a new flat constant.
 */
const TIER_DURATION_DAYS: Record<AllowedTier, number> = {
  featured: 30,
  pinned: 30,
  enterprise: 30,
};

function isAllowedTier(value: unknown): value is AllowedTier {
  return typeof value === "string" && (ALLOWED_TIERS as readonly string[]).includes(value);
}

/** Parses a posting id from an untrusted string/number; returns null when unusable. */
function toPostingId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sigHeader = request.headers.get("stripe-signature") || request.headers.get("Stripe-Signature") || "";

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  // Fail closed. Signature verification is mandatory. The only way to run without
  // it is a dedicated, explicit opt-in flag — never the absence of an env var and
  // never NODE_ENV, since a Vercel preview deployment, a staging box or any
  // container that is not NODE_ENV=production is reachable by the public internet
  // and would otherwise accept fully forged events that grant paid entitlements.
  const allowUnverified = process.env.ALLOW_UNVERIFIED_WEBHOOKS === "true";

  let event: Stripe.Event;
  // Only populated when we have a verified path / a key for lookups.
  let stripe: Stripe | null = null;

  if (!webhookSecret) {
    if (!allowUnverified) {
      console.error(
        "[stripe webhook] STRIPE_WEBHOOK_SECRET is not configured — refusing the event. Set the secret, or set ALLOW_UNVERIFIED_WEBHOOKS=true to accept unverified payloads in local testing only."
      );
      return NextResponse.json({ error: "webhook secret not configured" }, { status: 400 });
    }

    console.warn(
      "[stripe webhook] WARNING: signature verification is DISABLED (ALLOW_UNVERIFIED_WEBHOOKS=true). The payload is UNTRUSTED — anyone who can reach this endpoint can grant themselves a paid entitlement. Never set this on a deployed environment."
    );
    try {
      // Trust boundary: the payload is arbitrary JSON, so the assertion is required.
      event = JSON.parse(body) as Stripe.Event;
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 });
    }
  } else {
    if (!stripeSecret) {
      // Need stripe secret to construct Stripe instance for verification
      return NextResponse.json({ error: "stripe not configured" }, { status: 503 });
    }
    // No apiVersion: the SDK pins the apiVersion it was generated against, so we
    // stay on a version whose response shapes match the installed typings.
    stripe = new Stripe(stripeSecret);
    try {
      event = stripe.webhooks.constructEvent(body, sigHeader, webhookSecret);
    } catch (err) {
      console.error("[stripe webhook] signature verify failed", err);
      return NextResponse.json({ error: "signature verification failed" }, { status: 400 });
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        // Stripe.Event.Data.Object is an empty interface in the SDK, so the
        // per-event-type assertion below is unavoidable — but it is scoped to
        // this one branch instead of degrading every field to Record<string, unknown>.
        return await handleCheckoutCompleted(
          event.data.object as unknown as Stripe.Checkout.Session,
          event.id
        );
      case "charge.refunded":
        return await handleChargeRefunded(
          event.data.object as unknown as Stripe.Charge,
          event.id,
          stripe
        );
      case "charge.dispute.created":
        return await handleChargeDisputed(
          event.data.object as unknown as Stripe.Dispute,
          event.id,
          stripe
        );
      default:
        return NextResponse.json({ received: true, ignored: true, type: event.type }, { status: 200 });
    }
  } catch (err) {
    console.error("[stripe webhook] unexpected error", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/**
 * Grants the paid entitlement after a completed Checkout Session.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session, eventId: string) {
  const metadata = session.metadata ?? {};
  const postingId = toPostingId(metadata.postingId) ?? toPostingId(session.client_reference_id);

  if (postingId === null) {
    console.warn("[stripe webhook] checkout.session.completed without valid postingId", {
      eventId,
      sessionId: session.id,
      metadata,
    });
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  // Only a settled session grants an entitlement. Async payment methods
  // (bank debits, vouchers) complete the session before the money lands, and
  // a 0-value session is not a sale. Ack with 200 and do NOT error: Stripe
  // redelivers asynchronously and a 4xx here would only burn retries.
  if (session.payment_status !== "paid") {
    console.warn("[stripe webhook] checkout.session.completed not paid yet — no entitlement granted", {
      eventId,
      sessionId: session.id,
      postingId,
      paymentStatus: session.payment_status,
    });
    return NextResponse.json(
      { received: true, granted: false, status: "awaiting_payment" },
      { status: 200 }
    );
  }

  if (session.mode !== "payment") {
    console.error("[stripe webhook] unexpected session mode — no entitlement granted", {
      eventId,
      sessionId: session.id,
      postingId,
      mode: session.mode,
    });
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  // Identify what was actually bought. The three prices are distinct, so the
  // charged amount alone is unambiguous; metadata.tier is the primary source and
  // the amount is a cross-check (and a fallback for sessions created before the
  // tier was written to metadata).
  const tierFromAmount = ALLOWED_TIERS.find((tier) => PRICE_MAP[tier] === session.amount_total) ?? null;
  const tierFromMetadata = isAllowedTier(metadata.tier) ? metadata.tier : null;

  if (tierFromMetadata && tierFromAmount && tierFromMetadata !== tierFromAmount) {
    console.error("[stripe webhook] tier/amount mismatch — no entitlement granted", {
      eventId,
      sessionId: session.id,
      postingId,
      tierFromMetadata,
      tierFromAmount,
      amountTotal: session.amount_total,
    });
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  const purchasedTier = tierFromMetadata ?? tierFromAmount;
  if (!purchasedTier) {
    console.error("[stripe webhook] cannot determine purchased tier — no entitlement granted", {
      eventId,
      sessionId: session.id,
      postingId,
      metadataTier: metadata.tier,
      amountTotal: session.amount_total,
    });
    return NextResponse.json({ received: true, ignored: true }, { status: 200 });
  }

  const supabase = getSupabaseAdmin();
  const { data: posting, error } = await supabase
    .from("employer_postings")
    .select("*")
    .eq("id", postingId)
    .single();

  if (error || !posting) {
    // Deliberate non-2xx: the customer was charged but there is nothing to grant.
    // Returning 200 would make the event disappear, so Stripe would never retry
    // and the money would be gone with no record. A non-2xx keeps the event
    // visible for manual reconciliation (see the log line for the posting id).
    console.error(
      `[stripe webhook] checkout.session.completed: posting ${postingId} not found (event ${eventId}, session ${session.id}, tier ${purchasedTier}) — payment captured but entitlement NOT delivered. Reconcile manually and refund if the posting is gone.`
    );
    return NextResponse.json({ error: "posting not found" }, { status: 404 });
  }

  // Cheap fast path; the authoritative guard is the conditional UPDATE below.
  if (posting.payment_status === "paid") {
    return NextResponse.json({ received: true, idempotent: true }, { status: 200 });
  }

  const featuredUntil = new Date(
    Date.now() + TIER_DURATION_DAYS[purchasedTier] * 24 * 60 * 60 * 1000
  ).toISOString();

  // The not-paid guard lives in the UPDATE's WHERE clause rather than in the
  // read above, so the grant is a single atomic statement. Two concurrent
  // redeliveries of the same event can both read payment_status !== "paid", but
  // only the first UPDATE finds a row to claim; the second matches zero rows and
  // is skipped. payment_status.is.null is required because the column is
  // nullable and PostgREST's neq never matches NULL.
  const { data: claimed, error: updateError } = await supabase
    .from("employer_postings")
    .update({
      payment_status: "paid",
      featured_until: featuredUntil,
      tier: purchasedTier,
    })
    .eq("id", postingId)
    .or("payment_status.is.null,payment_status.neq.paid")
    .select("id");

  if (updateError) {
    console.error("[stripe webhook] update failed", updateError);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  if (!Array.isArray(claimed) || claimed.length === 0) {
    console.warn("[stripe webhook] entitlement already granted (concurrent redelivery)", {
      eventId,
      sessionId: session.id,
      postingId,
    });
    return NextResponse.json({ received: true, idempotent: true }, { status: 200 });
  }

  return NextResponse.json(
    { received: true, granted: true, tier: purchasedTier, featuredUntil },
    { status: 200 }
  );
}

/**
 * Retracts the entitlement after a refund so a refunded posting cannot stay
 * featured until the end of its paid window.
 */
async function handleChargeRefunded(charge: Stripe.Charge, eventId: string, stripe: Stripe | null) {
  const postingId = await resolvePostingIdFromCharge(charge, stripe, eventId);
  if (postingId === null) {
    // A retry cannot invent the metadata that is missing, so ack and leave a
    // loud trail rather than looping Stripe's retries forever.
    console.error(
      `[stripe webhook] charge.refunded but the charge could not be mapped back to a posting (event ${eventId}, charge ${charge.id}, payment_intent ${describePaymentIntent(charge)}) — entitlement NOT retracted. Reconcile/refund manually.`
    );
    return NextResponse.json({ received: true, ignored: true, reason: "unresolved_posting" }, { status: 200 });
  }

  return retractEntitlement(postingId, "refunded", eventId, charge.id);
}

/**
 * Retracts the entitlement when a cardholder opens a dispute.
 */
async function handleChargeDisputed(dispute: Stripe.Dispute, eventId: string, stripe: Stripe | null) {
  let charge: Stripe.Charge | null = null;
  if (typeof dispute.charge === "string") {
    if (!stripe) {
      console.error(
        `[stripe webhook] charge.dispute.created without a Stripe client — cannot resolve charge ${dispute.charge} (event ${eventId})`
      );
      return NextResponse.json({ error: "stripe not configured" }, { status: 503 });
    }
    // Throwing here (via the shared catch) returns 500 so Stripe retries: a
    // transient API failure must not permanently skip the retraction.
    charge = await stripe.charges.retrieve(dispute.charge);
  } else {
    charge = dispute.charge;
  }

  const postingId = await resolvePostingIdFromCharge(charge, stripe, eventId);
  if (postingId === null) {
    console.error(
      `[stripe webhook] charge.dispute.created but the charge could not be mapped back to a posting (event ${eventId}, dispute ${dispute.id}, charge ${charge.id}, payment_intent ${describePaymentIntent(charge)}) — entitlement NOT retracted. Reconcile manually.`
    );
    return NextResponse.json({ received: true, ignored: true, reason: "unresolved_posting" }, { status: 200 });
  }

  return retractEntitlement(postingId, "disputed", eventId, charge.id);
}

/**
 * Maps a Charge back to the posting that paid for it.
 *
 * A charge carries its own metadata, a reference to the PaymentIntent, and
 * nothing that directly names a Checkout Session — so the lookup walks:
 * charge.metadata -> PaymentIntent.metadata -> Checkout Session metadata
 * (resolved from the PaymentIntent). The last hop also covers Sessions created
 * before the tier/posting metadata was mirrored onto the PaymentIntent.
 */
async function resolvePostingIdFromCharge(
  charge: Stripe.Charge,
  stripe: Stripe | null,
  eventId: string
): Promise<number | null> {
  const fromCharge = toPostingId(charge.metadata?.postingId);
  if (fromCharge !== null) return fromCharge;

  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!stripe || !paymentIntentId) return null;

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  const fromPaymentIntent = toPostingId(paymentIntent.metadata?.postingId);
  if (fromPaymentIntent !== null) return fromPaymentIntent;

  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
  for (const session of sessions.data) {
    const fromSession =
      toPostingId(session.metadata?.postingId) ?? toPostingId(session.client_reference_id);
    if (fromSession !== null) return fromSession;
  }

  console.warn(
    `[stripe webhook] no posting id in charge/payment intent/session metadata (event ${eventId}, charge ${charge.id})`
  );
  return null;
}

function describePaymentIntent(charge: Stripe.Charge): string {
  if (typeof charge.payment_intent === "string") return charge.payment_intent;
  return charge.payment_intent?.id ?? "none";
}

/**
 * Puts a posting back into a non-paid state and clears the paid window.
 * The guard is conditional on the row still being "paid" so redelivery is a
 * no-op, and a missing posting is reported rather than silently ignored.
 */
async function retractEntitlement(postingId: number, reason: string, eventId: string, chargeId: string) {
  const supabase = getSupabaseAdmin();
  const { data: retracted, error } = await supabase
    .from("employer_postings")
    .update({ payment_status: reason, featured_until: null })
    .eq("id", postingId)
    .eq("payment_status", "paid")
    .select("id");

  if (error) {
    console.error(`[stripe webhook] failed to retract entitlement for posting ${postingId}`, error);
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }

  if (!Array.isArray(retracted) || retracted.length === 0) {
    console.warn(
      `[stripe webhook] posting ${postingId} not retracted (event ${eventId}, charge ${chargeId}, reason ${reason}) — it was not in the paid state`
    );
    return NextResponse.json({ received: true, retracted: false }, { status: 200 });
  }

  console.warn(
    `[stripe webhook] entitlement retracted for posting ${postingId} (event ${eventId}, charge ${chargeId}, reason ${reason})`
  );
  return NextResponse.json({ received: true, retracted: true }, { status: 200 });
}
