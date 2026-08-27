import { getJobById } from "@/lib/all-jobs";
import { notFound } from "next/navigation";
import JobDetailClient from "./JobDetailClient";
import { buildJobPostingJsonLd } from "@/lib/seo";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getJobById(id);

  if (!job) {
    notFound();
  }

  const jsonLd = buildJobPostingJsonLd(job);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <JobDetailClient job={job} />
    </>
  );
}
