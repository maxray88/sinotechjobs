import Link from "next/link";
import { getAllJobs } from "@/lib/all-jobs";
import { companyEntriesFromJobs } from "@/lib/companies";

export default async function CompaniesPage() {
  const jobs = await getAllJobs();
  // One pass owns slug -> name for every consumer. Keying this map by
  // slugifyCompany() would drop the "<slug>-<hash>" entries, so a disambiguated
  // company would 404 from the index even though it has a page.
  const entries = companyEntriesFromJobs(jobs);

  // Count per canonical (trimmed) name, so both jobs land on the same entry.
  const countsByName = new Map<string, number>();
  for (const job of jobs) {
    const name = job.company.trim();
    countsByName.set(name, (countsByName.get(name) ?? 0) + 1);
  }

  const companies = entries
    .map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      count: countsByName.get(entry.name) ?? 0,
    }))
    .filter((c) => c.count > 0)
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
