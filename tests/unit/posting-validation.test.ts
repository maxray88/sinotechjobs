import { describe, it, expect } from "vitest";
import { postingSchema } from "@/lib/validations/posting";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    job_title: "Senior AI Engineer for China Market",
    job_title_zh: "高级AI工程师",
    company: "Bosch GmbH",
    location: "Stuttgart, Germany",
    field: "ai" as const,
    language_level: "required" as const,
    employment_type: "full-time" as const,
    salary_range: "€70,000 - €90,000",
    description:
      "We are looking for a senior AI engineer with experience in machine learning, Python, and Mandarin language skills to support our China operations and develop cutting-edge solutions.",
    description_zh: "我们正在寻找高级AI工程师",
    requirements: "Python\nPyTorch\nMandarin fluent",
    application_url: "https://example.com/apply",
    remote_friendly: false,
    visa_sponsorship: true,
    tier: "free" as const,
    ...overrides,
  };
}

describe("postingSchema", () => {
  it("valid payload passes", () => {
    const result = postingSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.job_title).toBe(validPayload().job_title);
      expect(result.data.tier).toBe("free");
    }
  });

  it("defaults optional booleans and tier", () => {
    const payload = validPayload({
      remote_friendly: undefined,
      visa_sponsorship: undefined,
      tier: undefined,
    });
    // remove explicit undefined keys so defaults apply
    delete (payload as Record<string, unknown>).remote_friendly;
    delete (payload as Record<string, unknown>).visa_sponsorship;
    delete (payload as Record<string, unknown>).tier;
    const result = postingSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.remote_friendly).toBe(false);
      expect(result.data.visa_sponsorship).toBe(false);
      expect(result.data.tier).toBe("free");
    }
  });

  it("allows empty string for optional fields", () => {
    const result = postingSchema.safeParse(
      validPayload({
        job_title_zh: "",
        salary_range: "",
        description_zh: "",
        requirements: "",
      })
    );
    expect(result.success).toBe(true);
  });

  it("fails when job_title too short", () => {
    const result = postingSchema.safeParse(validPayload({ job_title: "AI" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "job_title");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("too_small");
    }
  });

  it("fails when missing company", () => {
    const payload = validPayload();
    // @ts-expect-error test missing
    delete payload.company;
    const result = postingSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "company");
      expect(issue).toBeDefined();
    }
  });

  it("fails when company too short", () => {
    const result = postingSchema.safeParse(validPayload({ company: "A" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "company")).toBe(true);
    }
  });

  it("fails when description <50", () => {
    const result = postingSchema.safeParse(validPayload({ description: "Too short" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "description");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("too_small");
    }
  });

  it("fails when bad URL", () => {
    const result = postingSchema.safeParse(validPayload({ application_url: "not-a-url" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "application_url");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("invalid_string");
    }
  });

  it("fails when bad enum for field", () => {
    const result = postingSchema.safeParse(validPayload({ field: "invalid" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "field");
      expect(issue).toBeDefined();
      expect(issue?.code).toBe("invalid_enum_value");
    }
  });

  it("fails when bad enum for language_level", () => {
    const result = postingSchema.safeParse(validPayload({ language_level: "basic" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "language_level")).toBe(true);
    }
  });

  it("fails when bad enum for employment_type", () => {
    const result = postingSchema.safeParse(validPayload({ employment_type: "freelance" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "employment_type")).toBe(true);
    }
  });

  it("fails when bad enum for tier", () => {
    const result = postingSchema.safeParse(validPayload({ tier: "gold" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "tier")).toBe(true);
    }
  });

  it("fails when location too short", () => {
    const result = postingSchema.safeParse(validPayload({ location: "A" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "location")).toBe(true);
    }
  });
});
