export type JobField = "ai" | "cs" | "robotics" | "drone" | "remote";
export type JobLocation = "de" | "at" | "ch" | "remote";
export type LanguageLevel = "nice-to-have" | "required" | "fluent";
export type EmploymentType = "full-time" | "part-time" | "internship" | "contract";

export interface Job {
  id: string;
  title: string;
  titleZh: string;
  company: string;
  companyZh?: string;
  field: JobField;
  location: string;
  locationCode: JobLocation;
  languageLevel: LanguageLevel;
  employmentType: EmploymentType;
  salaryRange?: string;
  description: string;
  descriptionZh: string;
  requirements: string[];
  requirementsZh: string[];
  tags: string[];
  applicationUrl: string;
  postedDate: string;
  remoteFriendly: boolean;
  visaSponsorship: boolean;
  featured?: boolean;
}

export type Language = "en" | "zh" | "de";
