import Link from "next/link";
import { getAllJobs } from "@/lib/all-jobs";
import { getCompanies, slugifyCompany } from "@/lib/companies";

export default async function CompaniesPage() {
  const jobs = await getAllJobs();
  // Use helper to satisfy spec (derived via getCompanies)
  const slugs = await getCompanies();

  const map = new Map<string, { name: string; count: number }>();
  for (const job of jobs) {
    const slug = slugifyCompany(job.company);
    const existing = map.get(slug);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(slug, { name: job.company, count: 1 });
    }
  }

  const companies = slugs
    .map((slug) => {
      const entry = map.get(slug);
      if (!entry) return null;
      return { slug, name: entry.name, count: entry.count };
    })
    .filter((c): c is { slug: string; name: string; count: number } => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>Companies</h1>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "2rem", fontSize: "0.875rem" }}>
        {companies.length} compan{companies.length === 1 ? "y" : "ies"} hiring Chinese-speaking talent in DACH
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: "1rem",
        }}
      >
        {companies.map((c) => (
          <Link key={c.slug} href={`/companies/${c.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card" style={{ border: "1px solid var(--border)" }}>
              <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.25rem", lineHeight: 1.4 }}>{c.name}</h2>
              <p style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)" }}>
                {c.count} {c.count === 1 ? "open position" : "open positions"}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
