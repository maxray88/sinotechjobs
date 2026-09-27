import { z } from "zod";
import { safeExternalUrl } from "@/lib/safe-url";

/**
 * Every C0 control plus DEL, for values that must stay on a single line.
 * `job_title` in particular is interpolated into a mail `Subject`
 * (`src/lib/email.ts`), so a newline or a bare CR reaching the database is a
 * header-injection primitive, and NUL breaks Postgres text handling.
 */
const CONTROL_CHARS_SINGLE_LINE = /[\u0000-\u001F\u007F]/;

/**
 * The same rejection with TAB (0x09) and LF (0x0A) exempt, for the genuinely
 * multi-line fields. `description` / `description_zh` / `requirements` are
 * rendered as `whiteSpace: pre-wrap` text and `requirements` is a per-line
 * textarea in the posting form, so a newline there is legitimate content
 * while NUL and a bare CR are not.
 */
const CONTROL_CHARS_MULTI_LINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/**
 * Attach the control-character check to a string field. A refinement (rather
 * than a mutation) is deliberate: the value is rejected outright, not silently
 * rewritten, so a caller can never store something the employer did not type.
 */
function noControlChars<T extends z.ZodTypeAny>(schema: T, multiLine = false) {
  const pattern = multiLine ? CONTROL_CHARS_MULTI_LINE : CONTROL_CHARS_SINGLE_LINE;
  return schema.refine((value) => typeof value !== "string" || !pattern.test(value), {
    message: "Control characters are not allowed in this field",
  });
}

export const postingSchema = z.object({
  job_title: noControlChars(z.string().min(5).max(120)),
  job_title_zh: noControlChars(z.string().max(120).optional().or(z.literal(""))),
  company: noControlChars(z.string().min(2).max(80)),
  location: noControlChars(z.string().min(2).max(80)),
  field: z.enum(["ai", "cs", "robotics", "drone", "remote"]),
  language_level: z.enum(["nice-to-have", "required", "fluent"]),
  employment_type: z.enum(["full-time", "part-time", "internship", "contract"]),
  salary_range: noControlChars(z.string().max(60).optional().or(z.literal(""))),
  description: z.string().min(50).max(8000),
  description_zh: z.string().max(8000).optional().or(z.literal("")),
  requirements: noControlChars(z.string().max(4000).optional().or(z.literal("")), true),
  // `z.string().url()` only asserts that `new URL(value)` parses, and
  // `javascript:alert(1)` parses fine — it is a syntactically valid URL with an
  // unusual scheme. The stored value is rendered as a raw `href`, so the scheme
  // is an XSS sink and presence of a scheme is not sufficient. `safeExternalUrl`
  // is the repo's single allowlist for externally-ingested hrefs; reusing it
  // keeps the check identical to the render-side guard instead of introducing
  // a second, subtly different scheme test. `.url()` stays in the chain so a
  // malformed URL still fails exactly as it did before.
  application_url: z
    .string()
    .url()
    .refine((value) => safeExternalUrl(value) !== null, {
      message: "Application URL must start with http:// or https://",
    }),
  remote_friendly: z.boolean().default(false),
  visa_sponsorship: z.boolean().default(false),
  tier: z.enum(["free", "featured", "pinned", "enterprise"]).default("free"),
});

export type PostingInput = z.infer<typeof postingSchema>;
