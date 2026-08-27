import { z } from "zod";

export const candidateProfileSchema = z.object({
  display_name: z.string().min(1).max(40).optional().or(z.literal("")),
  headline: z.string().max(80).optional().or(z.literal("")),
  bio: z.string().max(2000).optional().or(z.literal("")),
  skills: z.array(z.string().min(1).max(30)).max(20).default([]),
  languages: z.array(z.enum(["en", "zh", "de"])).max(3).default([]),
  preferred_locations: z.array(z.string().max(40)).max(10).default([]),
  preferred_fields: z.array(z.enum(["ai", "cs", "robotics", "drone", "remote"])).max(5).default([]),
  visible: z.boolean().default(false),
});

export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
