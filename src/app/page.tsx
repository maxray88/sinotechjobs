import { getAllJobs } from "@/lib/all-jobs";
import HomeClient from "./HomeClient";

export default async function Home() {
  const allJobs = await getAllJobs();
  return <HomeClient allJobs={allJobs} />;
}
