// Story 3.1: open a local PDF (file chooser, drop), no upload, inline file
// errors, the image-only HintBar, wasm image decoders under the pdf.js worker
// CSP, and the retired /spike routes. CI runs this against the production build.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContextOptions, type Page, type Request } from "@playwright/test";
import { signIn } from "./helpers";

// Not user@ (auth.spec.ts rate-limit bucket) and not shared with parallel specs' flows.
const ADMIN = "admin@plan-markup.test";
const FIXTURES = path.join(__dirname, "..", "fixtures", "pdf");
const CSP_VIOLATION = /Content Security Policy|Refused to (load|execute|compile|apply)/i;

test.describe.configure({ mode: "serial" });

let storageState: BrowserContextOptions["storageState"];

type Session = { page: Page; requests: Request[]; consoleErrors: string[] };

async function workspace(browser: Browser): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, storageState });
  const requests: Request[] = [];
  const consoleErrors: string[] = [];
  context.on("request", (r) => requests.push(r));
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  if (!storageState) {
    await page.goto("/sign-in");
    await signIn(page, ADMIN);
    await expect(page).toHaveURL("/workspace");
    storageState = await context.storageState();
  } else {
    await page.goto("/workspace");
  }
  await expect(page.getByTestId("drop-zone")).toBeVisible();
  return { page, requests, consoleErrors };
}

const fixture = (name: string) => readFileSync(path.join(FIXTURES, name));

async function chooseFile(page: Page, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer: fixture(name) });
}

async function dropFile(page: Page, testId: string, name: string) {
  const data = Array.from(fixture(name));
  const dataTransfer = await page.evaluateHandle(
    ({ name, data }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(data)], name, { type: "application/pdf" }));
      return dt;
    },
    { name, data },
  );
  await page.getByTestId(testId).dispatchEvent("dragover", { dataTransfer });
  await page.getByTestId(testId).dispatchEvent("drop", { dataTransfer });
}

/** Pixels on the tile canvas that are neither the backdrop nor white paper. */
async function inkPixels(page: Page, region?: { x0: number; y0: number; x1: number; y1: number }): Promise<{ ink: number; colour: number }> {
  return page.getByTestId("tiles-canvas").evaluate((el, region) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const r = region ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
    const x = Math.floor(r.x0 * canvas.width);
    const y = Math.floor(r.y0 * canvas.height);
    const w = Math.max(1, Math.floor((r.x1 - r.x0) * canvas.width));
    const h = Math.max(1, Math.floor((r.y1 - r.y0) * canvas.height));
    const d = ctx.getImageData(x, y, w, h).data;
    let ink = 0;
    let colour = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
      const backdrop = R === 0xe5 && G === 0xe7 && B === 0xeb;
      if (!backdrop && R + G + B < 600) ink++;
      if (B > 120 && B - R > 60) colour++; // the JPX image's blue disc
    }
    return { ink, colour };
  }, region);
}

const canvas = (page: Page) => page.getByTestId("drawing-canvas");

/** No request body carries the PDF's first 1 KB and nothing touches Storage (AC 3, NFR26). */
function expectNoUpload(requests: Request[], pdf: Buffer) {
  const head = pdf.subarray(0, 1024);
  for (const r of requests) {
    expect(r.url(), "no Storage call").not.toMatch(/\/storage\/v1\//);
    const body = r.postDataBuffer();
    if (body) expect(body.includes(head), `request body of ${r.method()} ${r.url()}`).toBe(false);
  }
}

test("Open… reads the PDF locally and renders it at fit page with no upload", async ({ browser }) => {
  const { page, requests, consoleErrors } = await workspace(browser);
  await chooseFile(page, "vector-a3.pdf");
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await expect(canvas(page)).toHaveAttribute("aria-label", "Drawing canvas, page 1 of 1");
  await expect(page.getByRole("contentinfo")).toContainText("vector-a3.pdf");
  await expect(page).toHaveTitle("vector-a3.pdf — Plan Markup");
  // The loading bar (in the document tab) is gone once the drawing is shown.
  await expect(page.getByTestId("tab-progress")).toHaveCount(0);
  expect((await inkPixels(page)).ink).toBeGreaterThan(500);
  await canvas(page).focus();
  await expect(canvas(page)).toBeFocused();
  expectNoUpload(requests, fixture("vector-a3.pdf"));
  expect(consoleErrors.filter((t) => CSP_VIOLATION.test(t))).toEqual([]);
  await page.context().close();
});

test("a dropped image-only PDF shows the HintBar notice; a drop on the canvas replaces the drawing", async ({ browser }) => {
  const { page, requests } = await workspace(browser);
  await dropFile(page, "drop-zone", "image-only.pdf");
  await expect(canvas(page)).toHaveAttribute("data-state", "image-only");
  const hint = page.getByTestId("hint-bar");
  await expect(hint).toHaveText(
    "This page is an image — snapping and scale detection are unavailable; calibrate manually",
  );
  // In the header flow, above the canvas: it never covers it.
  const hintBox = (await hint.boundingBox())!;
  const canvasBox = (await canvas(page).boundingBox())!;
  expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(canvasBox.y + 0.5);
  await hint.getByRole("button", { name: "Dismiss" }).click();
  await expect(hint).toHaveCount(0);

  await dropFile(page, "canvas-viewport", "vector-a3.pdf");
  await expect(page).toHaveTitle("vector-a3.pdf — Plan Markup");
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  expectNoUpload(requests, fixture("image-only.pdf"));
  expectNoUpload(requests, fixture("vector-a3.pdf"));
  await page.context().close();
});

test("a corrupt file and a password-protected file show inline errors; the workspace stays usable", async ({ browser }) => {
  const { page } = await workspace(browser);
  await chooseFile(page, "corrupt.pdf");
  await expect(page.getByTestId("viewer-error")).toHaveText(/This file is not a valid PDF\./);
  await expect(page.getByRole("contentinfo")).toContainText("No drawing open");

  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("viewer-error").getByRole("button", { name: "Open another file" }).click();
  await (await chooser).setFiles({ name: "password.pdf", mimeType: "application/pdf", buffer: fixture("password.pdf") });
  await expect(page.getByTestId("viewer-error")).toHaveText(
    /This PDF is password-protected\. Remove the password in another app and open it again\./,
  );
  await expect(page.getByRole("textbox")).toHaveCount(0); // no password prompt in MVP

  // Still usable: a good file opens.
  await chooseFile(page, "vector-a3.pdf");
  await expect(canvas(page)).toHaveAttribute("data-state", "ready");
  await page.context().close();
});

test("JPX and CCITT images decode in the pdf.js worker under its CSP", async ({ browser }) => {
  const { page, consoleErrors, requests } = await workspace(browser);
  await chooseFile(page, "wasm-images.pdf");
  await expect(canvas(page)).toHaveAttribute("data-state", "image-only");
  // The JPX image (blue disc) sits in the upper part of the page, the CCITT bars below it.
  const { colour, ink } = await inkPixels(page);
  expect(colour, "JPX pixels").toBeGreaterThan(200);
  expect(ink, "CCITT pixels").toBeGreaterThan(colour + 200);
  // The wasm decoders ran: without 'wasm-unsafe-eval' pdf.js loads the JS fallbacks instead.
  const pdfjs = requests.map((r) => r.url()).filter((u) => u.includes("/pdfjs/"));
  expect(pdfjs.some((u) => u.endsWith("/wasm/openjpeg.wasm"))).toBe(true);
  expect(pdfjs.some((u) => u.endsWith("/wasm/jbig2.wasm"))).toBe(true);
  expect(pdfjs.filter((u) => u.includes("nowasm_fallback"))).toEqual([]);
  expect(consoleErrors.filter((t) => CSP_VIOLATION.test(t))).toEqual([]);
  await page.context().close();
});

test("the retired /spike routes are unreachable", async ({ browser, request }) => {
  const anonymous = await request.get("/spike/render", { maxRedirects: 0 });
  expect(anonymous.status()).toBe(307);
  const { page } = await workspace(browser);
  for (const url of ["/spike/render", "/spike/fixture/l17", "/spike/pdfjs/build/pdf.worker.min.mjs"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(404);
  }
  await page.context().close();
});
