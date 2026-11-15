import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("nodemailer", () => ({ default: { createTransport: vi.fn() } }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.error, warn: m.warn, info: vi.fn(), debug: vi.fn() } }));

import { mailConfig, sendMail } from "./mailer";
import { YOU_ARE_IN_SUBJECT, youAreInMail } from "./templates";

const ENV = { SMTP_HOST: "smtp.test", SMTP_PORT: "2525", EMAIL_FROM: "Plan Markup <no-reply@plan-markup.test>", APP_URL: "https://app.plan-markup.test/" };
const MAIL = { to: "pat@plan-markup.test", subject: "S", text: "t", html: "<p>t</p>" };

beforeEach(() => vi.clearAllMocks());

describe("mailConfig", () => {
  it("reads the settings and keeps only the origin of APP_URL", () => {
    expect(mailConfig(ENV)).toEqual({
      host: "smtp.test",
      port: 2525,
      user: undefined,
      pass: undefined,
      from: "Plan Markup <no-reply@plan-markup.test>",
      appUrl: "https://app.plan-markup.test",
    });
    expect(mailConfig({ ...ENV, SMTP_PORT: undefined, SMTP_USER: "u", SMTP_PASS: "p" })).toMatchObject({ port: 587, user: "u", pass: "p" });
  });

  it("is null when a required setting is missing or invalid", () => {
    expect(mailConfig({})).toBeNull();
    expect(mailConfig({ ...ENV, SMTP_HOST: "" })).toBeNull();
    expect(mailConfig({ ...ENV, EMAIL_FROM: undefined })).toBeNull();
    expect(mailConfig({ ...ENV, APP_URL: undefined })).toBeNull();
    expect(mailConfig({ ...ENV, APP_URL: "javascript:alert(1)" })).toBeNull();
    expect(mailConfig({ ...ENV, APP_URL: "not a url" })).toBeNull();
    expect(mailConfig({ ...ENV, SMTP_PORT: "0" })).toBeNull();
  });
});

describe("sendMail", () => {
  it("sends from the configured address", async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({}) };
    expect(await sendMail(MAIL, { config: mailConfig(ENV), transport })).toBe("sent");
    expect(transport.sendMail).toHaveBeenCalledWith({ from: "Plan Markup <no-reply@plan-markup.test>", ...MAIL });
  });

  it("sends nothing without settings", async () => {
    const transport = { sendMail: vi.fn() };
    expect(await sendMail(MAIL, { config: null, transport })).toBe("not_configured");
    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(m.warn).toHaveBeenCalledWith("mail.not_configured", { subject: "S" });
  });

  it("reports a failure without throwing, and logs neither the address nor the server's message", async () => {
    const failure = Object.assign(new Error("550 pat@plan-markup.test rejected"), { code: "EENVELOPE" });
    const transport = { sendMail: vi.fn().mockRejectedValue(failure) };
    expect(await sendMail(MAIL, { config: mailConfig(ENV), transport })).toBe("failed");
    const [event, fields] = m.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("mail.send_failed");
    expect(fields.code).toBe("EENVELOPE");
    expect(JSON.stringify(fields) + String((fields.error as Error).message)).not.toContain("pat@");
  });
});

describe("youAreInMail", () => {
  it("links to sign-in and greets by name", () => {
    const mail = youAreInMail({ name: " Pat ", appUrl: "https://app.plan-markup.test" });
    expect(mail.subject).toBe(YOU_ARE_IN_SUBJECT);
    expect(mail.text).toContain("Hello Pat,");
    expect(mail.text).toContain("https://app.plan-markup.test/sign-in");
    expect(mail.html).toContain('href="https://app.plan-markup.test/sign-in"');
  });

  it("escapes the name in the HTML part and copes with no name", () => {
    const mail = youAreInMail({ name: '<img src=x onerror="1">', appUrl: "https://app.plan-markup.test" });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;");
    expect(youAreInMail({ name: "", appUrl: "https://a.test" }).text.startsWith("Hello,")).toBe(true);
  });
});
