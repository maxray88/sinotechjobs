/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- module mocks (route/lib boundary) -------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));

// The Stripe SDK is a default export used as a constructor by both routes, so
// the mock has to be constructible. The spies are hoisted so the factory below
// can close over them.
const stripeMock = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  sessionsCreate: vi.fn(),
  sessionsList: vi.fn(),
  paymentIntentsRetrieve: vi.fn(),
  chargesRetrieve: vi.fn(),
}));

vi.mock("stripe", () => {
  class StripeMock {
    webhooks = { constructEvent: stripeMock.constructEvent };
    checkout = {
      sessions: { create: stripeMock.sessionsCreate, list: stripeMock.sessionsList },
    };
    paymentIntents = { retrieve: stripeMock.paymentIntentsRetrieve };
    charges = { retrieve: stripeMock.chargesRetrieve };

    constructor(apiKey: string) {
      // The key value is irrelevant here; the constructor only has to exist
      // so `new Stripe(secret)` in the routes yields a controllable stub.
      void apiKey;
    }
  }
  return { default: StripeMock };
});

import { POST as webhookPOST } from "@/app/api/stripe/webhook/route";
import { POST as checkoutPOST } from "@/app/api/stripe/checkout/route";
import { getSupabaseAdmin } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";

const mockGetSupabaseAdmin = vi.mocked(getSupabaseAdmin);
const mockGetCurrentUser = vi.mocked(getCurrentUser);

// --- supabase admin mock (chainable-builder style, cf. tests/api-data-layer) ---
/** One `from()` call; `values` is set only when the call was a write. */
interface TableCall {
  table: string;
  values?: Record<string, unknown>;
}

function makeAdminMock(opts: { posting?: unknown; writeData?: unknown } = {}) {
  const calls: TableCall[] = [];

  const from = vi.fn((table: string) => {
    const rec: TableCall = { table };
    calls.push(rec);

    const builder: any = {};
    const chain = () => builder;
    let isWrite = false;

    for (const method of ["select", "eq", "or", "is", "in", "order", "limit", "range", "not"]) {
      builder[method] = vi.fn(() => chain());
    }
    builder.update = vi.fn((values: Record<string, unknown>) => {
      rec.values = values;
      isWrite = true;
      return chain();
    });
    builder.insert = vi.fn(() => chain());
    builder.upsert = vi.fn(() => chain());
    builder.single = vi.fn(() => Promise.resolve({ data: opts.posting ?? null, error: null }));
    builder.then = (onF: any, onR: any) => {
      const resolved = isWrite
        ? { data: opts.writeData ?? [{ id: POSTING_ID }], error: null }
        : { data: null, error: null };
      return Promise.resolve(resolved).then(onF, onR);
    };
    return builder;
  });

  return { admin: { from } as any, calls };
}

/** Every write issued through the admin client, oldest first. */
function writesOf(calls: TableCall[]): Record<string, unknown>[] {
  return calls.filter((c) => c.values !== undefined).map((c) => c.values as Record<string, unknown>);
}

// --- fixtures --------------------------------------------------------------
const POSTING_ID = 42;

/** A paid, single-item checkout session for POSTING_ID at the "featured" price. */
function paidCheckoutEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        mode: "payment",
        payment_status: "paid",
        amount_total: 9900,
        client_reference_id: String(POSTING_ID),
        metadata: { postingId: String(POSTING_ID), tier: "featured" },
        ...overrides,
      },
    },
  };
}

function refundedChargeEvent() {
  return {
    id: "evt_refund_1",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_1",
        payment_intent: "pi_test_1",
        // Lets the handler map the charge back to a posting without a
        // PaymentIntent/Session round trip.
        metadata: { postingId: String(POSTING_ID) },
      },
    },
  };
}

/** The posting row a paid checkout reads before it claims the entitlement. */
function unpaidPostingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: POSTING_ID,
    user_id: "user-1",
    tier: null,
    payment_status: null,
    stripe_session_id: null,
    ...overrides,
  };
}

function isFutureDate(value: unknown): boolean {
  return typeof value === "string" && Date.parse(value) > Date.now();
}

// --- request helpers -------------------------------------------------------
function webhookRequest(
  event: unknown,
  headers: Record<string, string> = {}
): Parameters<typeof webhookPOST>[0] {
  return new Request("https://sinotechjobs.vercel.app/api/stripe/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(event),
  }) as unknown as Parameters<typeof webhookPOST>[0];
}

function checkoutRequest(
  body: unknown,
  headers: Record<string, string> = {}
): Parameters<typeof checkoutPOST>[0] {
  return new Request("https://sinotechjobs.vercel.app/api/stripe/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof checkoutPOST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  // The webhook must be able to reach the "no secret configured" branch, so
  // every Stripe variable is cleared explicitly rather than inherited.
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("ALLOW_UNVERIFIED_WEBHOOKS", "");
  vi.stubEnv("SITE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/stripe/webhook — fail-closed signature verification", () => {
  it("rejects a forged checkout.session.completed and writes nothing when no secret and no opt-in flag are set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.ALLOW_UNVERIFIED_WEBHOOKS;

    const { admin, calls } = makeAdminMock({ posting: unpaidPostingRow() });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    // The exact payload the old NODE_ENV bypass accepted: no signature and no
    // secret, yet a fully formed paid session asking for a 30-day entitlement.
    const res = await webhookPOST(webhookRequest(paidCheckoutEvent()));
    const data = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(data.error).toBe("webhook secret not configured");
    expect(data.granted).toBeUndefined();

    // No verification, no JSON.parse of the payload, no database round trip.
    expect(stripeMock.constructEvent).not.toHaveBeenCalled();
    expect(mockGetSupabaseAdmin).not.toHaveBeenCalled();
    expect(writesOf(calls)).toEqual([]);
  });

  it("takes the unverified path when ALLOW_UNVERIFIED_WEBHOOKS=true is an explicit opt-in", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.ALLOW_UNVERIFIED_WEBHOOKS = "true";

    const { admin, calls } = makeAdminMock({ posting: unpaidPostingRow() });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const res = await webhookPOST(webhookRequest(paidCheckoutEvent()));
    const data = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.granted).toBe(true);
    expect(data.tier).toBe("featured");

    // The bypass is reached because the flag says so, not because a secret
    // happens to be absent: signature verification is still never attempted.
    expect(stripeMock.constructEvent).not.toHaveBeenCalled();
    const writes = writesOf(calls);
    expect(writes).toHaveLength(1);
    expect(writes[0].payment_status).toBe("paid");
    expect(isFutureDate(writes[0].featured_until)).toBe(true);
  });

  it("rejects a bad stripe-signature header when a secret is configured and writes nothing", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_key";
    delete process.env.ALLOW_UNVERIFIED_WEBHOOKS;

    stripeMock.constructEvent.mockImplementationOnce(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });

    const { admin, calls } = makeAdminMock({ posting: unpaidPostingRow() });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const event = paidCheckoutEvent();
    const res = await webhookPOST(
      webhookRequest(event, { "stripe-signature": "t=1,v1=deadbeef" })
    );
    const data = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(data.error).toBe("signature verification failed");
    expect(data.granted).toBeUndefined();

    // The raw body, not a parsed object, is what gets handed to verification.
    expect(stripeMock.constructEvent).toHaveBeenCalledWith(
      JSON.stringify(event),
      "t=1,v1=deadbeef",
      "whsec_test_secret"
    );
    expect(mockGetSupabaseAdmin).not.toHaveBeenCalled();
    expect(writesOf(calls)).toEqual([]);
  });
});

describe("POST /api/stripe/webhook — entitlement state machine", () => {
  it("grants nothing for an unpaid checkout.session.completed but still acks with 2xx for async payment methods", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_key";
    stripeMock.constructEvent.mockImplementationOnce(() =>
      paidCheckoutEvent({ payment_status: "unpaid" })
    );

    const { admin, calls } = makeAdminMock({ posting: unpaidPostingRow() });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const res = await webhookPOST(
      webhookRequest(paidCheckoutEvent({ payment_status: "unpaid" }), {
        "stripe-signature": "t=1,v1=good",
      })
    );
    const data = (await res.json()) as Record<string, unknown>;

    // 2xx on purpose: a 4xx here would burn Stripe's retries for bank debits
    // and vouchers, which complete the session before the money settles.
    expect(res.status).toBe(200);
    expect(data.granted).toBe(false);
    expect(data.status).toBe("awaiting_payment");

    expect(mockGetSupabaseAdmin).not.toHaveBeenCalled();
    expect(writesOf(calls)).toEqual([]);
  });

  it("clears featured_until and resets payment_status on charge.refunded", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
    process.env.STRIPE_SECRET_KEY = "sk_test_key";
    stripeMock.constructEvent.mockImplementationOnce(() => refundedChargeEvent());

    const { admin, calls } = makeAdminMock({ posting: unpaidPostingRow() });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const res = await webhookPOST(
      webhookRequest(refundedChargeEvent(), { "stripe-signature": "t=1,v1=good" })
    );
    const data = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(data.retracted).toBe(true);

    const writes = writesOf(calls);
    expect(writes).toHaveLength(1);
    // Both halves: the paid flag is cleared and the paid window is nulled out,
    // so a refunded posting can never stay featured into the future.
    expect(writes[0].featured_until).toBeNull();
    expect(isFutureDate(writes[0].featured_until)).toBe(false);
    expect(writes[0].payment_status).toBe("refunded");
  });
});

describe("POST /api/stripe/checkout — redirect origin is server-controlled", () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = "sk_test_key";
    mockGetCurrentUser.mockResolvedValue({ id: "user-1" } as any);
    stripeMock.sessionsCreate.mockResolvedValue({
      id: "cs_test_created",
      url: "https://checkout.stripe.com/c/pay/cs_test_created",
    });
  });

  it("never puts a forged Origin header into the Checkout Session URLs", async () => {
    process.env.SITE_URL = "https://sinotechjobs.vercel.app";

    const { admin } = makeAdminMock({
      posting: unpaidPostingRow({ tier: "featured", user_id: "user-1" }),
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const res = await checkoutPOST(
      checkoutRequest(
        { postingId: POSTING_ID, tier: "featured" },
        {
          origin: "https://evil.com",
          "x-forwarded-host": "evil.com",
          "x-forwarded-proto": "https",
        }
      )
    );

    expect(res.status).toBe(200);
    expect(stripeMock.sessionsCreate).toHaveBeenCalledTimes(1);

    const [params] = stripeMock.sessionsCreate.mock.calls[0] as [Record<string, any>, any];
    expect(params.success_url).toBe("https://sinotechjobs.vercel.app/employer/dashboard?paid=1");
    expect(params.cancel_url).toBe(
      "https://sinotechjobs.vercel.app/employer/dashboard?canceled=1"
    );
    expect(String(params.success_url)).not.toContain("evil.com");
    expect(String(params.cancel_url)).not.toContain("evil.com");
  });

  it("falls back to the request URL, still not the Origin header, when SITE_URL is unset", async () => {
    delete process.env.SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const { admin } = makeAdminMock({
      posting: unpaidPostingRow({ tier: "pinned", user_id: "user-1" }),
    });
    mockGetSupabaseAdmin.mockReturnValue(admin);

    const res = await checkoutPOST(
      checkoutRequest({ postingId: POSTING_ID, tier: "pinned" }, { origin: "https://evil.com" })
    );

    expect(res.status).toBe(200);
    const [params] = stripeMock.sessionsCreate.mock.calls[0] as [Record<string, any>, any];
    expect(String(params.success_url)).toBe(
      "https://sinotechjobs.vercel.app/employer/dashboard?paid=1"
    );
    expect(String(params.cancel_url)).toBe(
      "https://sinotechjobs.vercel.app/employer/dashboard?canceled=1"
    );
  });
});
