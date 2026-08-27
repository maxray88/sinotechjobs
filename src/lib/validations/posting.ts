import { z } from "zod";

export const postingSchema = z.object({
  job_title: z.string().min(5).max(120),
  job_title_zh: z.string().max(120).optional().or(z.literal("")),
  company: z.string().min(2).max(80),
  location: z.string().min(2).max(80),
  field: z.enum(["ai", "cs", "robotics", "drone", "remote"]),
  language_level: z.enum(["nice-to-have", "required", "fluent"]),
  employment_type: z.enum(["full-time", "part-time", "internship", "contract"]),
  salary_range: z.string().max(60).optional().or(z.literal("")),
  description: z.string().min(50).max(8000),
  description_zh: z.string().max(8000).optional().or(z.literal("")),
  requirements: z.string().max(4000).optional().or(z.literal("")),
  application_url: z.string().url(),
  remote_friendly: z.boolean().default(false),
  visa_sponsorship: z.boolean().default(false),
  tier: z.enum(["free", "featured", "pinned", "enterprise"]).default("free"),
});

export type PostingInput = z.infer<typeof postingSchema>;
