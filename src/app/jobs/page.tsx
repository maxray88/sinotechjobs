import { getAllJobs } from "@/lib/all-jobs";
import JobsClient from "./JobsClient";

export default async function JobsPage() {
  const allJobs = await getAllJobs();
  return <JobsClient allJobs={allJobs} />;
}
