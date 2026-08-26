import { NextResponse } from "next/server";
import { getAllJobs } from "@/lib/all-jobs";

export async function GET() {
  const jobs = getAllJobs();
  return NextResponse.json({
    total: jobs.length,
    jobs,
  });
}
