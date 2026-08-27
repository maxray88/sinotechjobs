import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllPosts, getPostBySlug } from "@/lib/blog";

export async function generateStaticParams() {
  const posts = getAllPosts();
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post not found — SinotechJobs" };
  return {
    title: `${post.title} — SinotechJobs Blog`,
    description: post.excerpt,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(s: string): string {
  // escape first, then restore markdown inline elements
  let out = escapeHtml(s);
  // inline code `code`
  out = out.replace(/`([^`]+?)`/g, '<code style="background:var(--muted);padding:0.1rem 0.3rem;border-radius:0.25rem;font-size:0.85em;">$1</code>');
  // bold **text** and __text__
  out = out.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  // italic *text* and _text_ (avoid bold)
  out = out.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/(?<!_)_([^_\n]+?)_(?!_)/g, "<em>$1</em>");
  // links [text](url)
  out = out.replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:underline;">$1</a>');
  // autolink bare urls
  out = out.replace(/(?<!href=")(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--primary);text-decoration:underline;">$1</a>');
  return out;
}

function mdToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  let html = "";
  let inList = false;
  let listTag: "ul" | "ol" = "ul";
  let inTable = false;
  let tableHeaders: string[] = [];

  const closeList = () => {
    if (inList) {
      html += `</${listTag}>\n`;
      inList = false;
    }
  };
  const closeTable = () => {
    if (inTable) {
      html += "</tbody></table>\n";
      inTable = false;
      tableHeaders = [];
    }
  };

  const isTableSeparator = (line: string) => /^\s*\|?[\s-|:]+\|[\s-|:]*\|?\s*$/.test(line) && line.includes("|");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // blank line
    if (!trimmed) {
      closeList();
      // keep table open across blank? close it
      // don't close table on blank, but will on next non-table line
      if (!inTable) {
        html += "";
      }
      continue;
    }

    // table handling
    if (trimmed.includes("|") && trimmed.startsWith("|")) {
      // check if next line is separator -> header row
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (!inTable && isTableSeparator(nextLine)) {
        // header row
        closeList();
        const headers = trimmed
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        tableHeaders = headers;
        html +=
          '<table style="width:100%;border-collapse:collapse;margin:1.25rem 0;font-size:0.875rem;"><thead><tr>';
        for (const h of headers) {
          html += `<th style="text-align:left;border:1px solid var(--border);padding:0.5rem 0.75rem;background:var(--muted);font-weight:700;">${inlineMd(h)}</th>`;
        }
        html += "</tr></thead><tbody>\n";
        inTable = true;
        i++; // skip separator line
        continue;
      }
      if (inTable) {
        if (isTableSeparator(trimmed)) {
          continue;
        }
        const cells = trimmed
          .split("|")
          .map((c) => c.trim())
          .filter(Boolean);
        // pad to headers length
        html += "<tr>";
        for (let ci = 0; ci < tableHeaders.length; ci++) {
          const cell = cells[ci] ?? "";
          html += `<td style="border:1px solid var(--border);padding:0.5rem 0.75rem;">${inlineMd(cell)}</td>`;
        }
        html += "</tr>\n";
        // peek next line: if not a table row, close
        const peek = lines[i + 1]?.trim() ?? "";
        if (!peek.startsWith("|")) {
          closeTable();
        }
        continue;
      }
    }

    if (inTable) closeTable();

    // blockquote
    if (trimmed.startsWith(">")) {
      closeList();
      const content = trimmed.replace(/^>\s?/, "");
      html += `<blockquote style="border-left:3px solid var(--border);margin:1rem 0;padding:0.5rem 1rem;color:var(--muted-foreground);background:var(--muted);border-radius:0 0.5rem 0.5rem 0;">${inlineMd(content)}</blockquote>\n`;
      continue;
    }

    // headings
    if (trimmed.startsWith("### ")) {
      closeList();
      html += `<h3 style="font-size:1.125rem;font-weight:700;margin:1.75rem 0 0.75rem;line-height:1.35;">${inlineMd(trimmed.slice(4))}</h3>\n`;
      continue;
    }
    if (trimmed.startsWith("## ")) {
      closeList();
      html += `<h2 style="font-size:1.35rem;font-weight:800;margin:2rem 0 0.75rem;line-height:1.3;">${inlineMd(trimmed.slice(3))}</h2>\n`;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      closeList();
      html += `<h1 style="font-size:1.75rem;font-weight:800;margin:1.5rem 0 1rem;line-height:1.25;">${inlineMd(trimmed.slice(2))}</h1>\n`;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(trimmed)) {
      closeList();
      html += '<hr style="border:none;border-top:1px solid var(--border);margin:1.5rem 0;" />\n';
      continue;
    }

    // unordered list: - , * , •
    const ulMatch = trimmed.match(/^[-*•]\s+(.*)/);
    if (ulMatch) {
      if (!inList || listTag !== "ul") {
        closeList();
        html += '<ul style="margin:0.75rem 0 0.75rem 1.25rem;list-style:disc;display:grid;gap:0.35rem;">\n';
        inList = true;
        listTag = "ul";
      }
      html += `<li style="font-size:0.9375rem;line-height:1.65;">${inlineMd(ulMatch[1])}</li>\n`;
      // look ahead: if next line not list, close
      const next = lines[i + 1]?.trim() ?? "";
      if (!next.match(/^[-*•]\s+/) && !next.match(/^\d+\.\s+/)) {
        closeList();
      }
      continue;
    }

    // ordered list
    const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (olMatch) {
      if (!inList || listTag !== "ol") {
        closeList();
        html += '<ol style="margin:0.75rem 0 0.75rem 1.25rem;list-style:decimal;display:grid;gap:0.35rem;">\n';
        inList = true;
        listTag = "ol";
      }
      html += `<li style="font-size:0.9375rem;line-height:1.65;">${inlineMd(olMatch[2])}</li>\n`;
      const next = lines[i + 1]?.trim() ?? "";
      if (!next.match(/^\d+\.\s+/) && !next.match(/^[-*•]\s+/)) {
        closeList();
      }
      continue;
    }

    // paragraph (fallback)
    closeList();
    html += `<p style="font-size:0.9375rem;line-height:1.75;margin:0.75rem 0;color:var(--foreground);">${inlineMd(trimmed)}</p>\n`;
  }

  closeList();
  closeTable();
  return html;
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const html = mdToHtml(post.content);

  return (
    <div style={{ maxWidth: "780px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <Link
        href="/blog"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          color: "var(--muted-foreground)",
          textDecoration: "none",
          fontSize: "0.875rem",
          marginBottom: "1.5rem",
        }}
      >
        ← Back to Blog
      </Link>

      <article>
        <header style={{ marginBottom: "1.5rem" }}>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "var(--muted-foreground)",
              marginBottom: "0.75rem",
              display: "flex",
              gap: "0.75rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <time dateTime={post.date}>{post.date}</time>
            <span>·</span>
            <span>{post.author}</span>
          </div>
          <h1 style={{ fontSize: "2rem", fontWeight: 800, lineHeight: 1.25, marginBottom: "0.75rem" }}>
            {post.title}
          </h1>
          <p style={{ fontSize: "1rem", color: "var(--muted-foreground)", lineHeight: 1.6 }}>{post.excerpt}</p>
        </header>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: "1.5rem",
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>

      <div style={{ marginTop: "2.5rem", borderTop: "1px solid var(--border)", paddingTop: "1.25rem" }}>
        <Link
          href="/blog"
          style={{
            display: "inline-block",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "var(--primary)",
            textDecoration: "none",
          }}
        >
          ← All articles
        </Link>
      </div>
    </div>
  );
}
