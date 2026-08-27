import "server-only";

import { Resend } from "resend";

export type EmailLocale = "en" | "zh" | "de";
export type EmailTemplate = "posting_submitted" | "posting_approved" | "posting_rejected";

export async function sendEmail(opts: {
  to: string;
  locale: EmailLocale;
  template: EmailTemplate;
  data: { jobTitle?: string; company?: string; reason?: string; jobId?: string };
}): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY missing, skipping");
    return;
  }

  const from = process.env.RESEND_FROM || "SinotechJobs <noreply@sinotechjobs.com>";
  const resend = new Resend(process.env.RESEND_API_KEY);

  const jobTitle = opts.data.jobTitle ?? "your posting";
  const company = opts.data.company ?? "";
  const reason = opts.data.reason ?? "";
  const jobId = opts.data.jobId ?? "";

  let subject: string;
  let html: string;

  // Escape helper for simple interpolation (prevent breaking HTML, minimal)
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const safeTitle = esc(jobTitle);
  const safeCompany = esc(company);
  const safeReason = esc(reason);
  const safeJobId = esc(jobId);

  const jobLink = safeJobId ? `https://sinotechjobs.vercel.app/jobs/${safeJobId}` : "https://sinotechjobs.vercel.app/jobs";

  if (opts.template === "posting_submitted") {
    if (opts.locale === "zh") {
      subject = `我们已收到您的职位发布：${jobTitle}`;
      html = `<p>您好，</p><p>我们已收到您在 <strong>${safeCompany}</strong> 发布的职位 <strong>${safeTitle}</strong>。</p><p>状态：待审核。我们会在审核完成后通知您。</p><p>— SinotechJobs 团队</p>`;
    } else if (opts.locale === "de") {
      subject = `Wir haben Ihre Anzeige erhalten: ${jobTitle}`;
      html = `<p>Hallo,</p><p>Wir haben Ihre Anzeige <strong>${safeTitle}</strong> bei <strong>${safeCompany}</strong> erhalten.</p><p>Status: ausstehende Prüfung. Wir benachrichtigen Sie nach der Freigabe.</p><p>— Ihr SinotechJobs Team</p>`;
    } else {
      subject = `We received your posting: ${jobTitle}`;
      html = `<p>Hi,</p><p>We received your posting <strong>${safeTitle}</strong> at <strong>${safeCompany}</strong>.</p><p>Status: pending review. We&apos;ll notify you once it&apos;s approved.</p><p>— SinotechJobs Team</p>`;
    }
  } else if (opts.template === "posting_approved") {
    if (opts.locale === "zh") {
      subject = `您的职位已上线：${jobTitle}`;
      html = `<p>您好，</p><p>好消息！您在 <strong>${safeCompany}</strong> 发布的职位 <strong>${safeTitle}</strong> 已上线。</p><p><a href="${jobLink}">查看职位详情</a></p><p>— SinotechJobs 团队</p>`;
    } else if (opts.locale === "de") {
      subject = `Ihre Anzeige ist jetzt live: ${jobTitle}`;
      html = `<p>Hallo,</p><p>Gute Nachrichten! Ihre Anzeige <strong>${safeTitle}</strong> bei <strong>${safeCompany}</strong> ist jetzt live.</p><p><a href="${jobLink}">Anzeige ansehen</a></p><p>— Ihr SinotechJobs Team</p>`;
    } else {
      subject = `Your posting is live: ${jobTitle}`;
      html = `<p>Hi,</p><p>Great news! Your posting <strong>${safeTitle}</strong> at <strong>${safeCompany}</strong> is now live.</p><p><a href="${jobLink}">View your job posting</a></p><p>— SinotechJobs Team</p>`;
    }
  } else {
    // posting_rejected
    if (opts.locale === "zh") {
      subject = `您的职位发布需要修改：${jobTitle}`;
      html = `<p>您好，</p><p>您在 <strong>${safeCompany}</strong> 发布的职位 <strong>${safeTitle}</strong> 需要修改后再提交。</p>${safeReason ? `<p>原因：${safeReason}</p>` : ""}<p>请根据反馈更新后重新提交。</p><p>— SinotechJobs 团队</p>`;
    } else if (opts.locale === "de") {
      subject = `Ihre Anzeige benötigt Überarbeitung: ${jobTitle}`;
      html = `<p>Hallo,</p><p>Ihre Anzeige <strong>${safeTitle}</strong> bei <strong>${safeCompany}</strong> benötigt Überarbeitung.</p>${safeReason ? `<p>Grund: ${safeReason}</p>` : ""}<p>Bitte überarbeiten Sie die Anzeige und reichen Sie sie erneut ein.</p><p>— Ihr SinotechJobs Team</p>`;
    } else {
      subject = `Your posting needs revision: ${jobTitle}`;
      html = `<p>Hi,</p><p>Your posting <strong>${safeTitle}</strong> at <strong>${safeCompany}</strong> needs revision.</p>${safeReason ? `<p>Reason: ${safeReason}</p>` : ""}<p>Please update and resubmit.</p><p>— SinotechJobs Team</p>`;
    }
  }

  try {
    await resend.emails.send({ from, to: [opts.to], subject, html });
  } catch (err) {
    console.error("[email] failed to send", err);
  }
}
