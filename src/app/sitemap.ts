import type { MetadataRoute } from "next";
import { getAllJobs } from "@/lib/all-jobs";
import { companyEntriesFromJobs } from "@/lib/companies";
import { getAllPosts } from "@/lib/blog";
import type { Job } from "@/lib/types";

// A job's real last-modified date, instead of `now` for every URL.
//
// Reporting `now` on every job told crawlers that every job page changed on
// every crawl, which is a signal they discount — and it was simply untrue, so
// it also made crawl scheduling useless. postedDate is the content's own
// timestamp; expiresAt is a fallback for rows that never got a postedDate.
// expiresAt is normally in the *future* (a scheduled change, not a past
// modification), so a future value is never reported as lastModified.
function jobLastModified(job: Job, now: Date): Date {
  let best: Date | null = null;
  for (const value of [job.postedDate, job.expiresAt]) {
    if (!value) continue;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) continue; // unparseable -> ignore
    if (parsed.getTime() > now.getTime()) continue; // never report the future
    if (!best || parsed.getTime() > best.getTime()) best = parsed;
  }
  return best ?? now;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://sinotechjobs.vercel.app";
  const now = new Date();

  const statics: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/jobs`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/blog`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${base}/companies`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
  ];

  const jobs = await getAllJobs();
  const jobEntries: MetadataRoute.Sitemap = jobs.map((job) => ({
    url: `${base}/jobs/${job.id}`,
    lastModified: jobLastModified(job, now),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  // Built from the same `jobs` read as the job URLs above: the disambiguation
  // pass is order-dependent, so a second read could hand these slugs to a
  // different company than the pages they point at.
  const companyEntries: MetadataRoute.Sitemap = companyEntriesFromJobs(jobs).map((entry) => ({
    url: `${base}/companies/${entry.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  const blogEntries: MetadataRoute.Sitemap = getAllPosts().map((post) => ({
    url: `${base}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...statics, ...jobEntries, ...companyEntries, ...blogEntries];
}
