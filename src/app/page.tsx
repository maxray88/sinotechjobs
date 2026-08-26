import { getAllJobs } from "@/lib/all-jobs";
import HomeClient from "./HomeClient";

export default function Home() {
  const allJobs = getAllJobs();
  return <HomeClient allJobs={allJobs} />;
}
