import { describe, it, expect, vi } from "vitest";
import { rawToJob, type ScrapedJobRaw } from "@/lib/scraper/types";

function makeRaw(overrides: Partial<ScrapedJobRaw> = {}): ScrapedJobRaw {
  return {
    title: "Software Engineer",
    company: "Test Company",
    location: "Berlin, Germany",
    url: "https://example.com/job/1",
    description: "General software engineering role",
    postedDate: "2026-08-20",
    sourceId: "test-source",
    sourceName: "Test Source",
    ...overrides,
  };
}

describe("auto-detection via rawToJob", () => {
  it("detects field 'ai' for Machine Learning / Deep Learning titles", () => {
    const job = rawToJob(
      makeRaw({
        title: "Machine Learning Engineer — Deep Learning & NLP",
        description: "Work on neural networks, LLMs and computer vision",
      }),
      "id-ai-1"
    );
    expect(job.field).toBe("ai");
  });

  it("detects field 'robotics' for Robotics ROS / SLAM", () => {
    const job = rawToJob(
      makeRaw({
        title: "Robotics Engineer — ROS & SLAM",
        description: "Develop autonomous robot systems with ROS, SLAM, mechatronic integration",
      }),
      "id-robotics-1"
    );
    expect(job.field).toBe("robotics");
  });

  it("detects field 'drone' for Drone UAV keywords (priority over robotics/ai)", () => {
    const job = rawToJob(
      makeRaw({
        title: "Drone UAV Flight Control Engineer",
        description: "UAV, unmanned aerial systems, flight control and drohne development",
      }),
      "id-drone-1"
    );
    expect(job.field).toBe("drone");
  });

  it("defaults to 'cs' when no drone/robotics/ai/remote keyword present", () => {
    const job = rawToJob(
      makeRaw({
        title: "Backend Software Engineer — Java & Kubernetes",
        description: "Develop backend systems with Java and Spring — cloud deployment",
      }),
      "id-cs-1"
    );
    expect(job.field).toBe("cs");
  });

  it("detects field 'remote' when text contains remote indicators and no higher-priority field", () => {
    const job = rawToJob(
      makeRaw({
        title: "Support Engineer - Remote Work",
        description: "Work from home in a distributed team, home office friendly",
        location: "Remote, Germany",
      }),
      "id-remote-1"
    );
    expect(job.field).toBe("remote");
    // remoteFriendly should also be true via location/description regex
    expect(job.remoteFriendly).toBe(true);
  });

  it("prioritizes drone over robotics and ai when multiple keywords present", () => {
    const job = rawToJob(
      makeRaw({
        title: "AI Robotics Drone Engineer",
        description: "Machine learning for drone robotics with ROS — UAV flight control",
      }),
      "id-prio-1"
    );
    expect(job.field).toBe("drone");
  });

  it("detectLocation: 'Berlin München' maps to 'de', 'Wien' to 'at', 'Zürich' to 'ch', 'Remote' to 'remote'", () => {
    const berlin = rawToJob(makeRaw({ location: "Berlin München" }), "loc-de");
    expect(berlin.locationCode).toBe("de");
    expect(berlin.location).toBe("Berlin München");

    const wien = rawToJob(makeRaw({ location: "Wien, Österreich" }), "loc-at");
    expect(wien.locationCode).toBe("at");

    const zurich = rawToJob(makeRaw({ location: "Zürich, Schweiz" }), "loc-ch");
    expect(zurich.locationCode).toBe("ch");

    const remote = rawToJob(makeRaw({ location: "Remote — Home Office" }), "loc-remote");
    expect(remote.locationCode).toBe("remote");
  });

  it("detectLanguageLevel: fluent, required, and default nice-to-have", () => {
    const fluent = rawToJob(
      makeRaw({ description: "We need a fluent chinese / native chinese speaker, muttersprachlich chinesisch" }),
      "lang-fluent"
    );
    expect(fluent.languageLevel).toBe("fluent");

    const required = rawToJob(
      makeRaw({ description: "Chinese required — chinesisch erforderlich for this role" }),
      "lang-required"
    );
    expect(required.languageLevel).toBe("required");

    const nice = rawToJob(
      makeRaw({ description: "Chinese is a plus, nice to have" }),
      "lang-nice"
    );
    expect(nice.languageLevel).toBe("nice-to-have");
  });

  it("extractTags: Python, PyTorch, ROS, C++ are detected from title+description", () => {
    const job = rawToJob(
      makeRaw({
        title: "Robotics Engineer — Python & ROS",
        description: "Work with C++, PyTorch, ROS2, SLAM and sensor fusion",
      }),
      "tags-1"
    );
    expect(job.tags).toContain("Python");
    expect(job.tags).toContain("PyTorch");
    expect(job.tags).toContain("ROS");
    expect(job.tags).toContain("C++");
    // should cap at 8 tags max
    expect(job.tags.length).toBeLessThanOrEqual(8);
  });

  it("employmentType detection: part-time, internship, contract, default full-time", () => {
    const partTime = rawToJob(makeRaw({ description: "Teilzeit / part-time position" }), "emp-part");
    expect(partTime.employmentType).toBe("part-time");

    const internship = rawToJob(makeRaw({ description: "Praktikum internship for students" }), "emp-intern");
    expect(internship.employmentType).toBe("internship");

    const contract = rawToJob(makeRaw({ description: "Freelance contract role — Werkvertrag" }), "emp-contract");
    expect(contract.employmentType).toBe("contract");

    const full = rawToJob(makeRaw({ description: "Permanent full-time position" }), "emp-full");
    expect(full.employmentType).toBe("full-time");
  });

  it("visaSponsorship and remoteFriendly flags inferred from description and location", () => {
    const visa = rawToJob(
      makeRaw({ description: "We offer visa sponsorship and relocation support — Arbeitserlaubnis" }),
      "flags-visa"
    );
    expect(visa.visaSponsorship).toBe(true);

    const noVisa = rawToJob(makeRaw({ description: "No additional benefits mentioned" }), "flags-no-visa");
    expect(noVisa.visaSponsorship).toBe(false);

    const remoteFriendly = rawToJob(
      makeRaw({ location: "Berlin", description: "Remote work possible, home office 2 days/week" }),
      "flags-remote"
    );
    expect(remoteFriendly.remoteFriendly).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Edge cases: missing/undefined fields, word boundaries, false positives
  // -------------------------------------------------------------------------

  it("handles undefined/empty description and location without throwing — applies defaults", () => {
    // Pass raw with minimal fields and undefined description to exercise default branches
    const minimal: ScrapedJobRaw = {
      title: "Junior Engineer",
      company: "MinimalCo",
      location: "",
      url: "https://example.com/job/minimal",
      sourceId: "test-source",
      sourceName: "Test Source",
      // description intentionally omitted (undefined)
      // postedDate intentionally omitted to test default date fallback
    };
    expect(() => rawToJob(minimal, "id-minimal")).not.toThrow();
    const job = rawToJob(minimal, "id-minimal");
    expect(job.description).toBe("");
    expect(job.descriptionZh).toBe("");
    expect(job.location).toBe("");
    expect(job.locationCode).toBe("de"); // empty location defaults to 'de'
    expect(job.field).toBe("cs"); // no keywords -> default cs
    expect(job.languageLevel).toBe("nice-to-have");
    expect(job.employmentType).toBe("full-time");
    expect(job.tags).toEqual([]);
    expect(job.visaSponsorship).toBe(false);
    expect(job.remoteFriendly).toBe(false);
    // postedDate should fall back to today in YYYY-MM-DD format (at least valid)
    expect(job.postedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Also test with explicit undefined description and location string "   "
    const withUndef = rawToJob(
      makeRaw({ description: undefined as unknown as string, location: "   " }),
      "id-undef"
    );
    expect(withUndef.description).toBe("");
    // whitespace-only location should still default to de (no remote/at/ch match)
    expect(withUndef.locationCode).toBe("de");
  });

  it("Date.now mock produces deterministic id prefix for generated jobs (baseId determinism)", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(1234567890000);
    const baseId = Date.now();
    const generatedId = `scraped-${baseId}-0`;
    expect(generatedId).toBe("scraped-1234567890000-0");
    // Verify rawToJob preserves the id we pass (storage uses this pattern)
    const job = rawToJob(makeRaw({ title: "Deterministic Job" }), generatedId);
    expect(job.id).toBe("scraped-1234567890000-0");
    expect(job.id.startsWith("scraped-1234567890000-")).toBe(true);
    spy.mockRestore();
    // After restore, Date.now should not be the mocked value anymore
    expect(Date.now()).not.toBe(1234567890000);
  });

  it("known limitation: 'international' currently matches 'intern' employmentType via substring (false positive)", () => {
    // If employmentType detection required word boundaries, "international" should NOT
    // be classified as internship. Current regex /intern/i matches substring, so it DOES.
    // This test documents actual behavior; a future fix using /\bintern(ship)?\b/ would
    // change this assertion to expect "full-time".
    const job = rawToJob(
      makeRaw({ description: "Work in an international team, global collaboration" }),
      "emp-international"
    );
    // known limitation: substring match causes false positive
    expect(job.employmentType).toBe("internship");
  });

  it("Go/Java word boundaries: 'gopher' does not match Go, 'javascript' does not match Java", () => {
    // extractTags uses /\bgo\b/i and /\bjava\b/i with word boundaries — correct behavior
    const gopherJob = rawToJob(
      makeRaw({ title: "Gopher enthusiast", description: "Love gopher tortoises" }),
      "tags-gopher"
    );
    expect(gopherJob.tags).not.toContain("Go");

    const jsJob = rawToJob(
      makeRaw({ title: "JavaScript Engineer", description: "Build with javascript and typescript" }),
      "tags-js"
    );
    expect(jsJob.tags).not.toContain("Java");
    // But explicit "Go" and "Java" as standalone words should match
    const goJob = rawToJob(makeRaw({ description: "We use Go and Python" }), "tags-go-true");
    expect(goJob.tags).toContain("Go");
    const javaJob = rawToJob(makeRaw({ description: "We use Java and Spring Boot" }), "tags-java-true");
    expect(javaJob.tags).toContain("Java");
  });

  it("C++ and ROS tags require correct boundaries: 'gross' does not match ROS via word boundary", () => {
    const grossJob = rawToJob(makeRaw({ description: "Gross salary, cross-functional team" }), "tags-gross");
    expect(grossJob.tags).not.toContain("ROS");
    const rosJob = rawToJob(makeRaw({ description: "Work with ROS and ROS2" }), "tags-ros-true");
    expect(rosJob.tags).toContain("ROS");
  });
});
