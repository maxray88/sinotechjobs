import { NextRequest, NextResponse } from "next/server";
import { getAllJobs } from "@/lib/all-jobs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const fieldParam = searchParams.get("field");
  const locationParam = searchParams.get("location") ?? searchParams.get("locationCode");
  const languageLevelParam = searchParams.get("languageLevel");
  const employmentTypeParam = searchParams.get("employmentType");
  const remoteParam = searchParams.get("remote");
  const visaParam = searchParams.get("visa");
  const qParam = searchParams.get("q");
  const pageParam = searchParams.get("page");
  const pageSizeParam = searchParams.get("pageSize");

  const field = fieldParam && fieldParam !== "all" ? fieldParam : undefined;
  const locationCode = locationParam && locationParam !== "all" ? locationParam : undefined;
  const languageLevel = languageLevelParam && languageLevelParam !== "all" ? languageLevelParam : undefined;
  const employmentType = employmentTypeParam && employmentTypeParam !== "all" ? employmentTypeParam : undefined;

  const parseBool = (v: string | null): boolean | undefined => {
    if (v === null || v === "") return undefined;
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    return undefined;
  };

  const remote = parseBool(remoteParam);
  const visa = parseBool(visaParam);
  const q = qParam?.trim() || undefined;

  let page = parseInt(pageParam ?? "", 10);
  if (isNaN(page) || page < 1) page = 1;
  let pageSize = parseInt(pageSizeParam ?? "", 10);
  if (isNaN(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 1000) pageSize = 1000;

  const isSupabase = process.env.DATA_STORE === "supabase";

  if (isSupabase) {
    const { listJobs } = await import("@/lib/db/jobs-repo");
    const { items, total } = await listJobs({
      field,
      locationCode,
      languageLevel,
      employmentType,
      remote,
      visa,
      q,
      page,
      pageSize,
    });
    return NextResponse.json({
      items,
      total,
      page,
      pageSize,
      jobs: items,
    });
  }

  // JSON/file mode: filter in-memory and paginate manually
  const allJobs = await getAllJobs();

  let filtered = allJobs;

  if (field) {
    filtered = filtered.filter((j) => j.field === field);
  }
  if (locationCode) {
    filtered = filtered.filter((j) => j.locationCode === locationCode);
  }
  if (languageLevel) {
    filtered = filtered.filter((j) => j.languageLevel === languageLevel);
  }
  if (employmentType) {
    filtered = filtered.filter((j) => j.employmentType === employmentType);
  }
  if (remote !== undefined) {
    filtered = filtered.filter((j) => j.remoteFriendly === remote);
  }
  if (visa !== undefined) {
    filtered = filtered.filter((j) => j.visaSponsorship === visa);
  }
  if (q) {
    const qLower = q.toLowerCase();
    filtered = filtered.filter(
      (j) =>
        j.title.toLowerCase().includes(qLower) ||
        j.titleZh.includes(q) ||
        j.company.toLowerCase().includes(qLower) ||
        (j.companyZh && j.companyZh.includes(q)) ||
        j.description.toLowerCase().includes(qLower) ||
        j.descriptionZh.includes(q) ||
        j.tags.some((tag) => tag.toLowerCase().includes(qLower))
    );
  }

  const total = filtered.length;
  const from = (page - 1) * pageSize;
  const items = filtered.slice(from, from + pageSize);

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
    jobs: items,
  });
}
