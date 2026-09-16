import type { CSSProperties } from "react";

interface MatchBadgeProps {
  score: number;
  reasons?: string[];
  size?: "sm" | "md" | "lg";
}

function getScoreColors(score: number): { background: string; color: string } {
  if (score >= 85) return { background: "#16a34a", color: "#ffffff" };
  if (score >= 70) return { background: "#2563eb", color: "#ffffff" };
  if (score >= 50) return { background: "#ca8a04", color: "#ffffff" };
  return { background: "#9ca3af", color: "#ffffff" };
}

const CIRCLE_SIZES: Record<NonNullable<MatchBadgeProps["size"]>, number> = {
  sm: 28,
  md: 32,
  lg: 40,
};

export default function MatchBadge({ score, reasons, size = "md" }: MatchBadgeProps) {
  const { background, color } = getScoreColors(score);
  const diameter = CIRCLE_SIZES[size];

  const wrapStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.375rem",
  };

  const circleStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: diameter,
    height: diameter,
    borderRadius: "9999px",
    fontSize: size === "lg" ? "0.875rem" : "0.75rem",
    fontWeight: 700,
    background,
    color,
    flexShrink: 0,
  };

  return (
    <div style={wrapStyle}>
      <span style={circleStyle} title={reasons?.join(" · ")}>
        {score}
      </span>
      {reasons && reasons.length > 0 && size !== "sm" && (
        <p
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontSize: "10px",
            lineHeight: 1.4,
            color: "var(--muted-foreground, #6b7280)",
            margin: 0,
            maxWidth: "12rem",
          }}
        >
          {reasons.slice(0, 3).join(" · ")}
        </p>
      )}
    </div>
  );
}
