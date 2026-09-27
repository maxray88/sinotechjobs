import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock server-only to prevent throw in node/test env
vi.mock("server-only", () => ({}));

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

import { isValidRecipient, sendEmail } from "@/lib/email";

describe("isValidRecipient", () => {
  it("accepts a valid single address", () => {
    expect(isValidRecipient("founder@example.com")).toBe(true);
    expect(isValidRecipient("hr.jobs+cn@mail.corp.co.uk")).toBe(true);
  });

  it("rejects a domain with no dot (a@b)", () => {
    expect(isValidRecipient("a@b")).toBe(false);
  });

  it("rejects CRLF header injection", () => {
    expect(isValidRecipient("a@b.c\r\nBcc: x@y.z")).toBe(false);
    expect(isValidRecipient("a@b.c\nBcc: x@y.z")).toBe(false);
  });

  it("rejects a comma-separated recipient list", () => {
    expect(isValidRecipient("a@b.c,x@y.z")).toBe(false);
  });

  it("rejects an address with surrounding whitespace", () => {
    expect(isValidRecipient(" a@b.c ")).toBe(false);
    expect(isValidRecipient("a b@c.d")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidRecipient(null)).toBe(false);
    expect(isValidRecipient(undefined)).toBe(false);
    expect(isValidRecipient(42)).toBe(false);
    expect(isValidRecipient({ email: "a@b.c" })).toBe(false);
    expect(isValidRecipient(["a@b.c"])).toBe(false);
  });
});

describe("sendEmail recipient guard", () => {
  const OLD_KEY = process.env.RESEND_API_KEY;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "1" } });
    process.env.RESEND_API_KEY = "test-key";
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (OLD_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = OLD_KEY;
  });

  it("throws and does not send when the recipient is invalid", async () => {
    await expect(
      sendEmail({
        to: "a@b.c\r\nBcc: victim@x.y",
        locale: "en",
        template: "posting_approved",
        data: { jobTitle: "Engineer", company: "ACME" },
      })
    ).rejects.toThrow("Invalid email recipient");

    expect(sendMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("sends normally for a valid recipient", async () => {
    await sendEmail({
      to: "applicant@example.com",
      locale: "en",
      template: "posting_approved",
      data: { jobTitle: "Engineer", company: "ACME" },
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].to).toEqual(["applicant@example.com"]);
  });
});
