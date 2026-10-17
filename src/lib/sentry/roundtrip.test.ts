// SDK round-trip: a real @sentry/nextjs client with our options and a capturing
// transport. Proves the scrubber runs on what the SDK actually sends.
import * as Sentry from "@sentry/nextjs";
import { afterAll, describe, expect, it } from "vitest";
import { buildSentryOptions } from "./options";

const FORBIDDEN = [
  "a@b.co",
  "a%40b.co",
  "Level 2 Fire.pdf",
  "L2.pdf",
  "Riser note",
  "AbCtoken123",
  "eyJ",
  "1.2.3.4",
  "email=",
  "select=",
];

describe("Sentry SDK round-trip", () => {
  const sent: string[] = [];

  afterAll(async () => {
    await Sentry.close(1000);
  });

  it("sends no forbidden string in the serialised envelope", async () => {
    const options = buildSentryOptions({
      dsn: "https://public@o0.ingest.sentry.io/0",
      environment: "test",
      runtime: "nodejs",
    })!;
    Sentry.init({
      ...options,
      defaultIntegrations: false,
      transport: (transportOptions: Parameters<typeof Sentry.createTransport>[0]) =>
        Sentry.createTransport(transportOptions, async (request) => {
          sent.push(typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body));
          return { statusCode: 200 };
        }),
    } as Parameters<typeof Sentry.init>[0]);

    Sentry.setTag("file_name", "L2.pdf");
    Sentry.setTag("drawing_id", "11111111-2222-4333-8444-555555555555");
    Sentry.setExtra("markupText", "Riser note");
    Sentry.setUser({ id: "00000000-0000-4000-8000-000000000001", email: "a@b.co", ip_address: "1.2.3.4" });
    Sentry.addBreadcrumb({ category: "console", message: "Riser note" });
    Sentry.addBreadcrumb({ category: "ui.click", message: '[aria-label="Riser note"]' });
    Sentry.addBreadcrumb({
      category: "fetch",
      data: { method: "GET", url: "http://127.0.0.1:56321/rest/v1/profiles?select=*&email=eq.a%40b.co" },
    });
    Sentry.addBreadcrumb({ category: "navigation", data: { from: "/", to: "/d/AbCtoken123?x=1" } });
    Sentry.getCurrentScope().setContext("drawing", { title: "Riser note" });

    Sentry.captureException(
      new Error(
        "duplicate key Key (name)=(Level 2 Fire.pdf) already exists for user a@b.co at https://app.example/d/AbCtoken123?email=a@b.co token eyJhbGciOi",
      ),
    );
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    const envelope = sent.join("\n");
    for (const s of FORBIDDEN) expect(envelope, s).not.toContain(s);
    expect(envelope).toContain("11111111-2222-4333-8444-555555555555");
    expect(envelope).toContain("/rest/v1/profiles");
    expect(envelope).toContain('"type":"Error"');
  });
});
