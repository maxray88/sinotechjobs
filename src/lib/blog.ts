import fs from "fs";
import path from "path";

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  author: string;
  content: string;
};

function getBlogDir(): string {
  return path.join(process.cwd(), "content", "blog");
}

function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  // Simple frontmatter parser: expects --- block at top
  const fmMatch = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    return { data: {}, content: raw };
  }
  const fmRaw = fmMatch[1];
  const content = fmMatch[2].trim();
  const data: Record<string, string> = {};
  for (const line of fmRaw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    // strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, content };
}

function toSlug(filename: string): string {
  return filename.replace(/\.md$/, "");
}

function readPostFile(filePath: string, slug: string): BlogPost | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);
    const title = data.title || slug;
    const excerpt = data.excerpt || content.slice(0, 160);
    const date = data.date || new Date().toISOString().slice(0, 10);
    const author = data.author || "SinotechJobs Editorial";
    return { slug, title, excerpt, date, author, content };
  } catch {
    return null;
  }
}

export function getAllPosts(): BlogPost[] {
  const dir = getBlogDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  const posts: BlogPost[] = [];
  for (const file of files) {
    const slug = toSlug(file);
    const fullPath = path.join(dir, file);
    const post = readPostFile(fullPath, slug);
    if (post) posts.push(post);
  }
  // sort by date desc (lexicographic ISO date works)
  posts.sort((a, b) => (a.date < b.date ? 1 : -1));
  return posts;
}

export function getPostBySlug(slug: string): BlogPost | null {
  const dir = getBlogDir();
  const filePath = path.join(dir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  return readPostFile(filePath, slug);
}
