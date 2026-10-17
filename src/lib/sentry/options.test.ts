import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSentryOptions, DATA_COLLECTION, DENIED_INTEGRATIONS } from "./options";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

const DSN = "https://public@o0.ingest.sentry.io/0";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildSentryOptions", () => {
  it.each([undefined, ""])("returns null without a DSN (%j)", (dsn) => {
    expect(buildSentryOptions({ dsn, environment: undefined, runtime: "browser" })).toBeNull();
    expect(buildSentryOptions({ dsn, environment: undefined, runtime: "nodejs" })).toBeNull();
  });

  it("is errors only, with no PII, tracing or local variables", () => {
    const options = buildSentryOptions({ dsn: DSN, environment: "preview", runtime: "nodejs" })! as Record<
      string,
      unknown
    >;
    expect(options.dsn).toBe(DSN);
    expect(options.environment).toBe("preview");
    expect(options).not.toHaveProperty("sendDefaultPii"); // removed in @sentry 11
    expect(options.dataCollection).toBe(DATA_COLLECTION);
    expect(options.includeLocalVariables).toBe(false);
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("tracesSampler");
    expect(options).not.toHaveProperty("replaysSessionSampleRate");
    expect(options).not.toHaveProperty("replaysOnErrorSampleRate");
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb).toBe(scrubBreadcrumb);
    expect(options.maxBreadcrumbs).toBe(50);
    expect(options.initialScope).toEqual({ tags: { runtime: "nodejs" } });
  });

  it("omits includeLocalVariables in the browser", () => {
    const options = buildSentryOptions({ dsn: DSN, environment: undefined, runtime: "browser" })!;
    expect(options).not.toHaveProperty("includeLocalVariables");
    expect(options.dataCollection).toBe(DATA_COLLECTION);
  });

  it("switches off every SDK data collection category", () => {
    expect(DATA_COLLECTION).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    });
  });

  it("filters Replay, Feedback and tracing integrations out of the defaults", () => {
    const options = buildSentryOptions({ dsn: DSN, environment: undefined, runtime: "browser" })!;
    const defaults = ["Dedupe", "Replay", "ReplayCanvas", "Feedback", "BrowserTracing", "LinkedErrors"].map((name) => ({
      name,
      setupOnce: () => {},
    }));
    const integrations = options.integrations as (d: typeof defaults) => typeof defaults;
    expect(integrations(defaults).map((i) => i.name)).toEqual(["Dedupe", "LinkedErrors"]);
    expect([...DENIED_INTEGRATIONS].sort()).toEqual(["BrowserTracing", "Feedback", "Replay", "ReplayCanvas"]);
  });

  it("defaults the environment from NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(buildSentryOptions({ dsn: DSN, environment: undefined, runtime: "nodejs" })!.environment).toBe("production");
    vi.stubEnv("NODE_ENV", "development");
    expect(buildSentryOptions({ dsn: DSN, environment: undefined, runtime: "nodejs" })!.environment).toBe(
      "development",
    );
  });
});
