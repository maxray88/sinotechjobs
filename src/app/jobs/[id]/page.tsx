import { getJobById } from "@/lib/all-jobs";
import { notFound } from "next/navigation";
import JobDetailClient from "./JobDetailClient";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = getJobById(id);

  if (!job) {
    notFound();
  }

  return <JobDetailClient job={job} />;
}
