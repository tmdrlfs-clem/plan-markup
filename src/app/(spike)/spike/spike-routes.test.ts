// The Story 2.3 spike routes must 404 in production unless the local flag is set
// and the request comes from a loopback host.
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const nav = vi.hoisted(() => ({
  host: "localhost:3020" as string | null,
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: nav.notFound }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(nav.host ? { host: nav.host } : {}),
}));
vi.mock("./render/viewer", () => ({ SpikeRenderViewer: () => null }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  nav.host = "localhost:3020";
  nav.notFound.mockClear();
});

function ctx<T>(params: T) {
  return { params: Promise.resolve(params) } as never;
}

describe("/spike/fixture/[name]", () => {
  it("404s in production without the flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAN_MARKUP_LOCAL_SPIKE", "");
    const { GET } = await import("./fixture/[name]/route");
    const res = await GET(new NextRequest("http://localhost:3020/spike/fixture/l17"), ctx({ name: "l17" }));
    expect(res.status).toBe(404);
  });

  it("404s in production with the flag on a public host", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAN_MARKUP_LOCAL_SPIKE", "1");
    const { GET } = await import("./fixture/[name]/route");
    const res = await GET(new NextRequest("https://plan.example.com/spike/fixture/l17"), ctx({ name: "l17" }));
    expect(res.status).toBe(404);
  });

  it("404s for names outside the whitelist even where the gate is open", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { GET } = await import("./fixture/[name]/route");
    for (const name of ["../package.json", "constructor", "__proto__", "L17"]) {
      const res = await GET(new NextRequest("http://localhost:3020/spike/fixture/x"), ctx({ name }));
      expect(res.status).toBe(404);
    }
  });
});

describe("/spike/pdfjs/[...path]", () => {
  it("404s in production without the flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { GET } = await import("./pdfjs/[...path]/route");
    const res = await GET(new NextRequest("http://localhost:3020/spike/pdfjs/wasm/openjpeg.wasm"), ctx({ path: ["wasm", "openjpeg.wasm"] }));
    expect(res.status).toBe(404);
  });

  it("serves a whitelisted pdf.js asset in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { GET } = await import("./pdfjs/[...path]/route");
    const res = await GET(new NextRequest("http://localhost:3020/spike/pdfjs/wasm/openjpeg.wasm"), ctx({ path: ["wasm", "openjpeg.wasm"] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/wasm");
    await res.body?.cancel();
  });

  it.each([[["..", "package.json"]], [["wasm", "..", "x"]], [["build", "pdf.mjs"]], [["src", "x.js"]], [["wasm"]]])(
    "404s for %j",
    async (path) => {
      vi.stubEnv("NODE_ENV", "development");
      const { GET } = await import("./pdfjs/[...path]/route");
      const res = await GET(new NextRequest("http://localhost:3020/spike/pdfjs/x"), ctx({ path }));
      expect(res.status).toBe(404);
    },
  );
});

describe("/spike/render page", () => {
  // NODE_ENV stays "test" (not "development", so gated like production): stubbing
  // it would load React's production JSX runtime into the shared module cache.
  it("calls notFound() outside development without the flag", async () => {
    const { default: Page } = await import("./render/page");
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(nav.notFound).toHaveBeenCalledOnce();
  });

  it("calls notFound() with the flag on a public host", async () => {
    vi.stubEnv("PLAN_MARKUP_LOCAL_SPIKE", "1");
    nav.host = "plan.example.com";
    const { default: Page } = await import("./render/page");
    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders where the gate is open (flag on localhost)", async () => {
    vi.stubEnv("PLAN_MARKUP_LOCAL_SPIKE", "1");
    const { default: Page } = await import("./render/page");
    await expect(Page()).resolves.toBeTruthy();
    expect(nav.notFound).not.toHaveBeenCalled();
  });
});
