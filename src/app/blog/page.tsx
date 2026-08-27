import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export const metadata = {
  title: "Blog — SinotechJobs",
  description: "Guides for Chinese-speaking tech talent in DACH — visa, salary benchmarks, relocation and career tips.",
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 800, marginBottom: "0.5rem" }}>Blog</h1>
      <p style={{ color: "var(--muted-foreground)", marginBottom: "2rem", fontSize: "0.875rem" }}>
        Guides for Chinese-speaking engineers building careers in DACH.
      </p>

      {posts.length === 0 ? (
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.875rem" }}>No posts yet.</p>
      ) : (
        <div style={{ display: "grid", gap: "1.25rem" }}>
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <article
                className="card"
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "0.75rem",
                  padding: "1.25rem 1.5rem",
                  background: "var(--background)",
                  transition: "border-color 0.15s",
                }}
              >
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--muted-foreground)",
                    marginBottom: "0.5rem",
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "center",
                  }}
                >
                  <time dateTime={post.date}>{post.date}</time>
                  <span>·</span>
                  <span>{post.author}</span>
                </div>
                <h2
                  style={{
                    fontSize: "1.125rem",
                    fontWeight: 700,
                    lineHeight: 1.35,
                    marginBottom: "0.5rem",
                    color: "var(--foreground)",
                  }}
                >
                  {post.title}
                </h2>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--muted-foreground)",
                    lineHeight: 1.6,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {post.excerpt}
                </p>
                <span
                  style={{
                    display: "inline-block",
                    marginTop: "0.75rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "var(--primary)",
                  }}
                >
                  Read article →
                </span>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
