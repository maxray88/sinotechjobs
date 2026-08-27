import { describe, it, expect } from "vitest";
import { buildJobPostingJsonLd } from "@/lib/seo";
import type { Job } from "@/lib/types";

function makeJob(overrides: Partial<Job & Record<string, unknown>> = {}): Job & Record<string, unknown> {
  return {
    id: "test-123",
    title: "AI Engineer",
    titleZh: "AI工程师",
    company: "Test GmbH",
    companyZh: "测试公司",
    field: "ai",
    location: "Berlin, Germany",
    locationCode: "de",
    languageLevel: "required",
    employmentType: "full-time",
    salaryRange: "€60,000 - €80,000",
    description: "<p>We are hiring an <b>AI Engineer</b> for robotics.</p>",
    descriptionZh: "招聘AI工程师",
    requirements: ["Python", "ML"],
    requirementsZh: ["Python", "机器学习"],
    tags: ["AI"],
    applicationUrl: "https://example.com/apply",
    postedDate: "2026-01-15",
    remoteFriendly: false,
    visaSponsorship: true,
    featured: false,
    ...overrides,
  } as Job & Record<string, unknown>;
}

describe("buildJobPostingJsonLd", () => {
  it("returns @type JobPosting with correct title and hiringOrganization", () => {
    const job = makeJob();
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    expect(jsonLd["@type"]).toBe("JobPosting");
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["title"]).toBe(job.title);
    const org = jsonLd["hiringOrganization"] as Record<string, unknown>;
    expect(org["@type"]).toBe("Organization");
    expect(org["name"]).toBe(job.company);
    expect(org["sameAs"]).toBe(job.applicationUrl);
  });

  it("strips HTML from description and caps at 5000", () => {
    const job = makeJob({ description: "<p>Hello <b>world</b></p>" });
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    expect(jsonLd["description"]).toBe("Hello world");
  });

  it("description sliced to 5000 chars", () => {
    const long = "<p>" + "a".repeat(6000) + "</p>";
    const job = makeJob({ description: long });
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    expect((jsonLd["description"] as string).length).toBe(5000);
  });

  it("jobLocation present for non-remote with locality and country", () => {
    const job = makeJob({ remoteFriendly: false, location: "Munich, Germany", locationCode: "de" });
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    const loc = jsonLd["jobLocation"] as Record<string, unknown>;
    expect(loc).toBeDefined();
    expect(loc["@type"]).toBe("Place");
    const addr = (loc["address"] as Record<string, unknown>);
    expect(addr["addressLocality"]).toBe("Munich, Germany");
    expect(addr["addressCountry"]).toBe("DE");
    expect(jsonLd["applicantLocationRequirements"]).toBeUndefined();
  });

  it("jobLocation for remote uses Remote region and adds applicantLocationRequirements", () => {
    const job = makeJob({ remoteFriendly: true });
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    const loc = jsonLd["jobLocation"] as Record<string, unknown>;
    const addr = loc["address"] as Record<string, unknown>;
    expect(addr["addressCountry"]).toBe("DE");
    expect(addr["addressRegion"]).toBe("Remote");
    expect(jsonLd["applicantLocationRequirements"]).toEqual({
      "@type": "Country",
      name: "Germany",
    });
  });

  it("location_code uppercase fallback and remote_friendly snake_case", () => {
    const job = makeJob({ locationCode: undefined, remoteFriendly: undefined } as unknown as Partial<Job>) as Record<string, unknown>;
    // inject snake_case variants
    (job as Record<string, unknown>)["location_code"] = "at";
    (job as Record<string, unknown>)["remote_friendly"] = false;
    (job as Record<string, unknown>)["location"] = "Vienna, Austria";
    const jsonLd = buildJobPostingJsonLd(job as Job & Record<string, unknown>) as Record<string, unknown>;
    const loc = jsonLd["jobLocation"] as Record<string, unknown>;
    const addr = loc["address"] as Record<string, unknown>;
    expect(addr["addressCountry"]).toBe("AT");
  });

  it("includes baseSalary when salary_range present, omits when absent", () => {
    const withSalary = makeJob({ salaryRange: "€70k" });
    const jsonWith = buildJobPostingJsonLd(withSalary) as Record<string, unknown>;
    const baseSalary = jsonWith["baseSalary"] as Record<string, unknown>;
    expect(baseSalary).toBeDefined();
    expect(baseSalary["@type"]).toBe("MonetaryAmount");
    expect(baseSalary["currency"]).toBe("EUR");
    const value = baseSalary["value"] as Record<string, unknown>;
    expect(value["value"]).toBe("€70k");

    const withoutSalary: Job & Record<string, unknown> = makeJob();
    delete (withoutSalary as Record<string, unknown>)["salaryRange"];
    delete (withoutSalary as Record<string, unknown>)["salary_range"];
    const jsonWithout = buildJobPostingJsonLd(withoutSalary) as Record<string, unknown>;
    expect(jsonWithout["baseSalary"]).toBeUndefined();
  });

  it("salary_range snake_case variant", () => {
    const job = makeJob();
    delete (job as Record<string, unknown>)["salaryRange"];
    (job as Record<string, unknown>)["salary_range"] = "€90,000";
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    const base = jsonLd["baseSalary"] as Record<string, unknown>;
    expect(base).toBeDefined();
    expect((base["value"] as Record<string, unknown>)["value"]).toBe("€90,000");
  });

  it("validThrough present when featured_until set, omitted otherwise", () => {
    const withFeatured = makeJob({ featured_until: "2026-12-31" } as unknown as Partial<Job & Record<string, unknown>>);
    const jsonWith = buildJobPostingJsonLd(withFeatured) as Record<string, unknown>;
    expect(jsonWith["validThrough"]).toBe("2026-12-31");

    const withCamel = makeJob({ featuredUntil: "2027-01-01" } as unknown as Partial<Job & Record<string, unknown>>);
    const jsonCamel = buildJobPostingJsonLd(withCamel) as Record<string, unknown>;
    expect(jsonCamel["validThrough"]).toBe("2027-01-01");

    const without = makeJob();
    const jsonWithout = buildJobPostingJsonLd(without) as Record<string, unknown>;
    expect(jsonWithout["validThrough"]).toBeUndefined();
  });

  it("maps employmentType correctly", () => {
    const cases: Array<[Job["employmentType"], string]> = [
      ["full-time", "FULL_TIME"],
      ["part-time", "PART_TIME"],
      ["internship", "INTERN"],
      ["contract", "CONTRACTOR"],
    ];
    for (const [input, expected] of cases) {
      const job = makeJob({ employmentType: input });
      const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
      expect(jsonLd["employmentType"]).toBe(expected);
    }
  });

  it("employment_type snake_case variant", () => {
    const job = makeJob({ employmentType: undefined } as unknown as Partial<Job>) as Record<string, unknown>;
    (job as Record<string, unknown>)["employment_type"] = "part-time";
    const jsonLd = buildJobPostingJsonLd(job as Job & Record<string, unknown>) as Record<string, unknown>;
    expect(jsonLd["employmentType"]).toBe("PART_TIME");
  });

  it("datePosted uses posted_date / postedDate / created_at fallback and defaults to today", () => {
    const jobPosted = makeJob({ postedDate: "2026-02-20" });
    expect((buildJobPostingJsonLd(jobPosted) as Record<string, unknown>)["datePosted"]).toBe("2026-02-20");

    const snake = makeJob({ postedDate: undefined } as unknown as Partial<Job>) as Record<string, unknown>;
    delete (snake as Record<string, unknown>)["postedDate"];
    (snake as Record<string, unknown>)["posted_date"] = "2026-03-10";
    expect((buildJobPostingJsonLd(snake as Job & Record<string, unknown>) as Record<string, unknown>)["datePosted"]).toBe("2026-03-10");

    const created = makeJob({ postedDate: undefined } as unknown as Partial<Job>) as Record<string, unknown>;
    delete (created as Record<string, unknown>)["postedDate"];
    delete (created as Record<string, unknown>)["posted_date"];
    (created as Record<string, unknown>)["created_at"] = "2026-04-01";
    expect((buildJobPostingJsonLd(created as Job & Record<string, unknown>) as Record<string, unknown>)["datePosted"]).toBe("2026-04-01");

    const fallback = makeJob({ postedDate: undefined } as unknown as Partial<Job>) as Record<string, unknown>;
    delete (fallback as Record<string, unknown>)["postedDate"];
    delete (fallback as Record<string, unknown>)["posted_date"];
    delete (fallback as Record<string, unknown>)["created_at"];
    const today = new Date().toISOString().split("T")[0];
    expect((buildJobPostingJsonLd(fallback as Job & Record<string, unknown>) as Record<string, unknown>)["datePosted"]).toBe(today);
  });

  it("directApply true and url correct", () => {
    const job = makeJob({ id: "abc-123" });
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    expect(jsonLd["directApply"]).toBe(true);
    expect(jsonLd["url"]).toBe("https://sinotechjobs.vercel.app/jobs/abc-123");
  });

  it("omits undefined fields (JSON.stringify omit check)", () => {
    const job = makeJob();
    delete (job as Record<string, unknown>)["salaryRange"];
    delete (job as Record<string, unknown>)["featured_until"];
    delete (job as Record<string, unknown>)["featuredUntil"];
    (job as Record<string, unknown>)["remoteFriendly"] = false;
    const jsonLd = buildJobPostingJsonLd(job) as Record<string, unknown>;
    expect("validThrough" in jsonLd).toBe(false);
    expect("baseSalary" in jsonLd).toBe(false);
    expect("applicantLocationRequirements" in jsonLd).toBe(false);
    // Ensure stringify doesn't include undefined
    const str = JSON.stringify(jsonLd);
    expect(str).not.toContain("validThrough");
    expect(str).not.toContain("baseSalary");
  });
});
