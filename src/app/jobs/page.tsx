import { sampleJobs } from "@/lib/jobs";
import { loadScrapedJobs } from "@/lib/scraper/storage";
import JobsClient from "./JobsClient";

export default function JobsPage() {
  const scraped = loadScrapedJobs();
  const allJobs = [...sampleJobs, ...scraped];
  return <JobsClient allJobs={allJobs} />;
}
