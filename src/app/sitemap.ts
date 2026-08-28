import type { MetadataRoute } from "next";
import { getAllJobs } from "@/lib/all-jobs";
import { getCompanies } from "@/lib/companies";
import { getAllPosts } from "@/lib/blog";

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
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const companies = await getCompanies();
  const companyEntries: MetadataRoute.Sitemap = companies.map((slug) => ({
    url: `${base}/companies/${slug}`,
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
