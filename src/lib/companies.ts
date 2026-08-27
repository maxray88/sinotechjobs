import { getAllJobs } from "./all-jobs";

export function slugifyCompany(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export async function getCompanies(): Promise<string[]> {
  const jobs = await getAllJobs();
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const job of jobs) {
    const slug = slugifyCompany(job.company);
    if (!seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
}
