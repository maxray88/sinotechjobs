/**
 * Seed sample jobs into Supabase — idempotent.
 * Uses sampleJobs from src/lib/jobs.ts as source and upserts into `jobs` table.
 * Idempotent: running twice reports 0 added the second time (dedup by id).
 *
 * Usage:
 *   npx tsx scripts/seed.ts
 *   npm run seed
 */
import { sampleJobs } from "@/lib/jobs";
import { jobToRow } from "@/lib/db/mappers";
import { createClient } from "@supabase/supabase-js";
import type { JobRow } from "@/lib/db/types";

async function main(): Promise<void> {
  const total = sampleJobs.length;
  console.log(`Seeding ${total} sample jobs...`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("[seed] Failed to create Supabase admin client: Missing Supabase URL or secret key");
    console.error("Ensure SUPABASE env vars are set: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL and SUPABASE_SECRET_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const ids = sampleJobs.map((j) => j.id);

    // Fetch existing ids to achieve idempotency reporting (added 0 on second run)
    const { data: existingRows, error: fetchError } = await supabase
      .from("jobs")
      .select("id")
      .in("id", ids);

    if (fetchError) {
      // If table does not exist yet, throw with helpful message
      throw fetchError;
    }

    const existingSet = new Set<string>(
      ((existingRows ?? []) as Array<{ id: string }>).map((r) => r.id)
    );

    const toInsertJobs = sampleJobs.filter((j) => !existingSet.has(j.id));
    const skipped = total - toInsertJobs.length;

    if (toInsertJobs.length === 0) {
      console.log(`Seeded ${total} jobs, 0 added, ${skipped} skipped (already existed)`);
      return;
    }

    // Map Job -> JobRow using shared mapper, then override source fields for idempotency & uniqueness.
    // source_url must be UNIQUE in DB; duplicate applicationUrl across sample jobs would violate constraint,
    // so we make it id-based to guarantee uniqueness while keeping original URL traceable.
    const rows: JobRow[] = toInsertJobs.map((job) => {
      const base = jobToRow(job);
      const uniqueSourceUrl = job.applicationUrl
        ? `${job.applicationUrl}#sample-${job.id}`
        : `sample:${job.id}`;
      return {
        ...base,
        source: "sample",
        source_url: uniqueSourceUrl,
      };
    });

    const { data, error, count } = await (supabase as unknown as {
      from: (table: string) => {
        upsert: (
          rows: unknown,
          opts: unknown
        ) => { select: () => Promise<{ data: unknown; error: unknown; count: number | null }> };
      };
    })
      .from("jobs")
      .upsert(rows as unknown as Record<string, unknown>[], {
        onConflict: "id",
        count: "exact",
      } as never)
      .select();

    if (error) {
      const code = (error as { code?: string }).code;
      const msg = (error as { message?: string }).message ?? String(error);
      // Unique violation on concurrent run — treat as already existed
      if (code === "23505" || /duplicate|unique/i.test(msg)) {
        console.warn(`[seed] Unique violation (concurrent insert), treating as skipped: ${msg}`);
        console.log(`Seeded ${total} jobs, 0 added, ${total} skipped (already existed)`);
        return;
      }
      throw error;
    }

    // Prefer count from Supabase, fallback to data length or rows length
    let added: number;
    if (typeof count === "number") {
      added = count;
    } else if (Array.isArray(data)) {
      added = data.length;
    } else {
      added = toInsertJobs.length;
    }

    // In case Supabase reports added as upserted+updated, but we already filtered existing,
    // added should equal toInsertJobs.length. If count mismatches, trust filtered length when count includes updates.
    // However our pre-filter ensures added = toInsertJobs.length on first run and 0 on second.
    const finalSkipped = total - added;
    console.log(`Seeded ${total} jobs, ${added} added, ${finalSkipped} skipped (already existed)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const details = err && typeof err === "object" && "code" in err ? ` (code: ${(err as { code: unknown }).code})` : "";
    console.error(`[seed] Failed: ${message}${details}`);
    // Helpful hint if migration not applied
    if (/relation.*does not exist|table.*not found|42P01/i.test(message)) {
      console.error("[seed] Hint: jobs table does not exist — apply db/migrations/001_init.sql in Supabase first.");
    }
    process.exit(1);
  }
}

main()
  .then(() => {
    // success — exit 0
    process.exit(0);
  })
  .catch((err) => {
    console.error("[seed] Unhandled error:", err);
    process.exit(1);
  });
