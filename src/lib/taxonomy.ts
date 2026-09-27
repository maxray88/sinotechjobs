import type { JobField, Language } from "./types";

/** Focus areas reuse the working JobField keys so components plug into JobsClient directly. */
export type FocusArea = JobField;

// Canonical (EN) sub-specialization tags: 5 focus areas x 4-6 subs = 28 tags.
// `as const` is what makes SubTag below a real literal union rather than
// `string`. That union is the point: it lets SUB_TAG_LABELS require an entry
// for every tag. FOCUS_AREA_TAXONOMY then widens back to `SubTag[]`, which is
// still assignable to the plain `string[]` that consumers expect.
const SUB_TAG_GROUPS = {
  cs: [
    "Backend Systems",
    "Frontend Engineering",
    "Distributed Systems",
    "Security / Cryptography",
    "Database Engineering",
  ],
  ai: [
    "NLP / LLMs",
    "Computer Vision",
    "MLOps / Infrastructure",
    "Reinforcement Learning",
    "Edge AI",
    "AI Safety / Alignment",
  ],
  robotics: [
    "SLAM / Perception",
    "Motion Planning / Control",
    "Manipulation / Grasping",
    "Human-Robot Interaction",
    "Simulation / Digital Twin",
    "Embedded Systems",
  ],
  drone: [
    "Flight Control Systems",
    "Swarm Intelligence",
    "Computer Vision Payload",
    "BVLOS Operations",
    "UTM / Air Traffic Management",
    "Counter-Drone Systems",
  ],
  remote: [
    "Full-Stack Development",
    "DevOps / SRE",
    "Data Engineering",
    "Product Management",
    "Technical Writing",
  ],
} as const;

export type SubTag = (typeof SUB_TAG_GROUPS)[FocusArea][number];

export const FOCUS_AREA_TAXONOMY: Record<FocusArea, SubTag[]> = {
  cs: [...SUB_TAG_GROUPS.cs],
  ai: [...SUB_TAG_GROUPS.ai],
  robotics: [...SUB_TAG_GROUPS.robotics],
  drone: [...SUB_TAG_GROUPS.drone],
  remote: [...SUB_TAG_GROUPS.remote],
};

export const FOCUS_AREA_LABELS: Record<FocusArea, Record<Language, string>> = {
  cs: { en: "Computer Science", zh: "计算机科学", de: "Informatik" },
  ai: { en: "AI / ML", zh: "人工智能/机器学习", de: "KI / ML" },
  robotics: { en: "Robotics", zh: "机器人", de: "Robotik" },
  drone: { en: "Drones / UAV", zh: "无人机", de: "Drohnen / UAV" },
  remote: { en: "Remote", zh: "远程", de: "Remote" },
};

// Trilingual labels for all 28 sub-specialization tags, keyed by canonical EN
// tag. Keying on `SubTag` rather than `string` is what makes this exhaustive:
// add a tag to SUB_TAG_GROUPS and the compiler fails here until it is labelled,
// instead of the label going missing and getSubTagLabel's `?? tag` fallback
// silently absorbing it.
export const SUB_TAG_LABELS: Record<SubTag, Record<Language, string>> = {
  "Backend Systems": { en: "Backend Systems", zh: "后端系统", de: "Backend-Systeme" },
  "Frontend Engineering": { en: "Frontend Engineering", zh: "前端工程", de: "Frontend-Entwicklung" },
  "Distributed Systems": { en: "Distributed Systems", zh: "分布式系统", de: "Verteilte Systeme" },
  "Security / Cryptography": { en: "Security / Cryptography", zh: "安全与密码学", de: "Sicherheit / Kryptographie" },
  "Database Engineering": { en: "Database Engineering", zh: "数据库工程", de: "Datenbankentwicklung" },
  "NLP / LLMs": { en: "NLP / LLMs", zh: "自然语言处理/大模型", de: "NLP / LLMs" },
  "Computer Vision": { en: "Computer Vision", zh: "计算机视觉", de: "Computer Vision" },
  "MLOps / Infrastructure": { en: "MLOps / Infrastructure", zh: "MLOps与基础设施", de: "MLOps / Infrastruktur" },
  "Reinforcement Learning": { en: "Reinforcement Learning", zh: "强化学习", de: "Reinforcement Learning" },
  "Edge AI": { en: "Edge AI", zh: "端侧智能", de: "Edge-KI" },
  "AI Safety / Alignment": { en: "AI Safety / Alignment", zh: "AI安全与对齐", de: "KI-Sicherheit / Alignment" },
  "SLAM / Perception": { en: "SLAM / Perception", zh: "SLAM与感知", de: "SLAM / Perzeption" },
  "Motion Planning / Control": { en: "Motion Planning / Control", zh: "运动规划与控制", de: "Bewegungsplanung / Regelung" },
  "Manipulation / Grasping": { en: "Manipulation / Grasping", zh: "抓取与操作", de: "Manipulation / Greifen" },
  "Human-Robot Interaction": { en: "Human-Robot Interaction", zh: "人机交互", de: "Mensch-Roboter-Interaktion" },
  "Simulation / Digital Twin": { en: "Simulation / Digital Twin", zh: "仿真与数字孪生", de: "Simulation / Digitaler Zwilling" },
  "Embedded Systems": { en: "Embedded Systems", zh: "嵌入式系统", de: "Eingebettete Systeme" },
  "Flight Control Systems": { en: "Flight Control Systems", zh: "飞控系统", de: "Flugsteuerungssysteme" },
  "Swarm Intelligence": { en: "Swarm Intelligence", zh: "群体智能", de: "Schwarmintelligenz" },
  "Computer Vision Payload": { en: "Computer Vision Payload", zh: "视觉载荷", de: "Bildverarbeitungs-Nutzlast" },
  "BVLOS Operations": { en: "BVLOS Operations", zh: "超视距运行", de: "BVLOS-Betrieb" },
  "UTM / Air Traffic Management": { en: "UTM / Air Traffic Management", zh: "无人机交通管理", de: "UTM / Luftraummanagement" },
  "Counter-Drone Systems": { en: "Counter-Drone Systems", zh: "反无人机系统", de: "Drohnenabwehrsysteme" },
  "Full-Stack Development": { en: "Full-Stack Development", zh: "全栈开发", de: "Full-Stack-Entwicklung" },
  "DevOps / SRE": { en: "DevOps / SRE", zh: "运维与可靠性", de: "DevOps / SRE" },
  "Data Engineering": { en: "Data Engineering", zh: "数据工程", de: "Data Engineering" },
  "Product Management": { en: "Product Management", zh: "产品管理", de: "Produktmanagement" },
  "Technical Writing": { en: "Technical Writing", zh: "技术写作", de: "Technisches Schreiben" },
};

export function getSubTagLabel(tag: string, lang: Language): string {
  // `tag` is a plain string here because it comes from job.tags, which is
  // free-form scraped data and may be a tag we have no label for. Narrow once.
  const labels = SUB_TAG_LABELS as Partial<Record<SubTag, Record<Language, string>>>;
  return labels[tag as SubTag]?.[lang] ?? tag;
}

export function getFocusAreaLabel(area: FocusArea, lang: Language): string {
  return FOCUS_AREA_LABELS[area]?.[lang] ?? area;
}

/** All 28 canonical sub-tags flattened (useful for search matching). */
export const ALL_SUB_TAGS: SubTag[] = (Object.keys(FOCUS_AREA_TAXONOMY) as FocusArea[]).flatMap(
  (area) => FOCUS_AREA_TAXONOMY[area],
);
