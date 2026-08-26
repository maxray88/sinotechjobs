import type { Job, JobField, JobLocation, LanguageLevel, EmploymentType } from "../types";

export interface ScraperSource {
  id: string;
  name: string;
  nameZh: string;
  type: "rss" | "html" | "api" | "json-api";
  url: string;
  enabled: boolean;
  jsRendered?: boolean;
  puppeteerOptions?: {
    waitForSelector?: string;
    waitTimeout?: number;
    scrollDelay?: number;
    extraWaitMs?: number;
  };
  selectors?: {
    jobCard?: string;
    title?: string;
    company?: string;
    location?: string;
    link?: string;
    description?: string;
    date?: string;
  };
  requestOptions?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  keywords: string[];
  defaultField?: JobField;
  defaultLocationCode?: JobLocation;
}

export interface ScrapedJobRaw {
  title: string;
  company: string;
  location: string;
  url: string;
  description?: string;
  postedDate?: string;
  sourceId: string;
  sourceName: string;
}

export interface ScrapeResult {
  source: ScraperSource;
  jobsFound: number;
  jobsFiltered: number;
  jobs: ScrapedJobRaw[];
  errors: string[];
  duration: number;
}

export interface ScrapeReport {
  timestamp: string;
  totalSources: number;
  successfulSources: number;
  totalJobsFound: number;
  totalJobsFiltered: number;
  newJobsAdded: number;
  results: ScrapeResult[];
}

export interface KeywordMatch {
  keyword: string;
  context: string;
  field: JobField | null;
}

export function rawToJob(raw: ScrapedJobRaw, id: string): Job {
  const text = `${raw.title} ${raw.description ?? ""}`.toLowerCase();
  const field = detectField(text);
  const languageLevel = detectLanguageLevel(text);
  const locationCode = detectLocation(raw.location);
  const employmentType = detectEmploymentType(text);

  return {
    id,
    title: raw.title,
    titleZh: raw.title,
    company: raw.company,
    field,
    location: raw.location,
    locationCode,
    languageLevel,
    employmentType,
    description: raw.description ?? "",
    descriptionZh: raw.description ?? "",
    requirements: [],
    requirementsZh: [],
    tags: extractTags(raw.title + " " + (raw.description ?? "")),
    applicationUrl: raw.url,
    postedDate: raw.postedDate ?? new Date().toISOString().split("T")[0],
    remoteFriendly: /remote|remote work|home.?office|work from home/i.test(raw.location + " " + (raw.description ?? "")),
    visaSponsorship: /visa|sponsorship|relocation|arbeitserlaubnis|niederlassungserlaubnis/i.test(raw.description ?? ""),
    featured: false,
  };
}

function detectField(text: string): JobField {
  if (/drone|uav|unmanned aerial|flight control|drohne/i.test(text)) return "drone";
  if (/robot|robotics|ros|slam|autonomous robot|cobot|mechatronic/i.test(text)) return "robotics";
  if (/machine learning|deep learning|ai|artificial intelligence|nlp|computer vision|neural|llm|transformer|ki|künstliche intelligenz/i.test(text)) return "ai";
  if (/remote|home.?office|work from home|distributed team/i.test(text)) return "remote";
  return "cs";
}

function detectLanguageLevel(text: string): LanguageLevel {
  if (/fluent chinese|native chinese|business fluent chinese|verhandlungssicher chinesisch|muttersprachlich chinesisch|流利中文|中文母语/i.test(text)) {
    return "fluent";
  }
  if (/chinese required|chinesisch erforderlich|chinese mandatory|中文必备/i.test(text)) {
    return "required";
  }
  return "nice-to-have";
}

function detectLocation(location: string): JobLocation {
  const loc = location.toLowerCase();
  if (/remote|home.?office|distributed/i.test(loc)) return "remote";
  if (/österreich|austria|wien|vienna|graz|linz|salzburg|innsbruck/i.test(loc)) return "at";
  if (/schweiz|switzerland|zürich|zurich|bern|basel|genf|geneva|lausanne/i.test(loc)) return "ch";
  return "de";
}

function detectEmploymentType(text: string): EmploymentType {
  if (/internship|praktikum|intern/i.test(text)) return "internship";
  if (/part.?time|teilzeit/i.test(text)) return "part-time";
  if (/contract|freelance|werkvertrag|contractor/i.test(text)) return "contract";
  return "full-time";
}

function extractTags(text: string): string[] {
  const tagPatterns: Record<string, RegExp> = {
    Python: /python/i,
    "C++": /c\+\+/i,
    Java: /\bjava\b/i,
    Kotlin: /kotlin/i,
    React: /react/i,
    "Vue.js": /vue\.?js/i,
    "Node.js": /node\.?js/i,
    Go: /\bgo\b/i,
    Rust: /rust/i,
    TensorFlow: /tensorflow/i,
    PyTorch: /pytorch/i,
    Kubernetes: /kubernetes|k8s/i,
    Docker: /docker/i,
    AWS: /aws|amazon web services/i,
    "Azure": /azure/i,
    GCP: /gcp|google cloud/i,
    ROS: /\bros\b/i,
    "ROS2": /ros2|ros 2/i,
    SLAM: /slam/i,
    "Computer Vision": /computer vision/i,
    NLP: /\bnlp\b|natural language/i,
    "Machine Learning": /machine learning|\bml\b/i,
    "Deep Learning": /deep learning/i,
    "Autonomous Driving": /autonomous driving|autonom/i,
    "Sensor Fusion": /sensor fusion/i,
    LiDAR: /lidar/i,
    "Embedded": /embedded/i,
    "Real-time": /real.?time|realtime/i,
    PLC: /\bplc\b/i,
    Microservices: /microservice/i,
    "Edge AI": /edge ai|edge computing/i,
    UAV: /\buav\b/i,
    GIS: /\bgis\b/i,
    WeChat: /wechat|weixin/i,
    i18n: /i18n|l10n|localization|localisation/i,
  };

  return Object.entries(tagPatterns)
    .filter(([, regex]) => regex.test(text))
    .map(([tag]) => tag)
    .slice(0, 8);
}
