// Story 3.5, optional local-only check (never in CI: the L17/L21 drawings are
// private and git-ignored). Run: PERF_L17=1 npx playwright test perf-tabs
// (with the production build: E2E_PROD=1 after `npm run build`).
//
// Opens L17 and L21 in two tabs, zooms L17 in, then switches back and forth
// with Ctrl+PageDown. Reports how long a switch takes until the canvas shows
// the other tab's view, the longest main-thread task (Long Tasks API) while
// switching, and the JS heap of every worker (CDP), to size "one render worker
// per tab". Saves a screenshot with the two tabs to fixtures/private/traces/.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const PRIVATE = path.join(__dirname, "..", "fixtures", "private");
const L17 = path.join(PRIVATE, "pdf", "A1721-LEVEL-17-REFLECTED-CEILING-PLAN-Rev.2.pdf");
const L21 = path.join(PRIVATE, "pdf", "A2121-LEVEL-21-REFLECTED-CEILING-PLAN-Rev.2.pdf");

test.skip(process.env.PERF_L17 !== "1" || !existsSync(L17) || !existsSync(L21), "local check: set PERF_L17=1 (needs the private L17/L21 drawings)");

const canvas = (page: Page) => page.getByTestId("drawing-canvas");

async function openFile(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("toolbar", { name: "Document" }).getByRole("button", { name: "Open…" }).click();
  await (await chooser).setFiles({ name: path.basename(file), mimeType: "application/pdf", buffer: readFileSync(file) });
  await expect(canvas(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

/** JS heap (MB) of every worker target, via a fresh CDP session's auto-attach (nested workers included). */
async function workerHeaps(context: BrowserContext, page: Page): Promise<number[]> {
  const cdp = await context.newCDPSession(page);
  const sessions: string[] = [];
  let id = 0;
  const replies = new Map<number, (r: unknown) => void>();
  const send = (sessionId: string, method: string, params: object = {}) =>
    new Promise<unknown>((resolve) => {
      const msgId = ++id;
      replies.set(msgId, resolve);
      void cdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: msgId, method, params }) }).catch(() => resolve(null));
      setTimeout(() => resolve(null), 3000);
    });
  cdp.on("Target.attachedToTarget", (e) => {
    if (e.targetInfo.type === "worker") sessions.push(e.sessionId);
  });
  cdp.on("Target.receivedMessageFromTarget", (e) => {
    const msg = JSON.parse(e.message) as { id?: number; result?: unknown; method?: string; params?: { sessionId: string; targetInfo: { type: string } } };
    if (msg.id !== undefined) replies.get(msg.id)?.(msg.result);
    // Nested workers (pdf.js inside a render worker) attach through their parent's session.
    if (msg.method === "Target.attachedToTarget" && msg.params?.targetInfo.type === "worker") sessions.push(msg.params.sessionId);
  });
  await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
  await new Promise((r) => setTimeout(r, 500));
  for (const s of [...sessions]) await send(s, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
  await new Promise((r) => setTimeout(r, 500));
  const heaps: number[] = [];
  for (const s of sessions) {
    const r = (await send(s, "Runtime.getHeapUsage")) as { usedSize?: number } | null;
    if (r?.usedSize !== undefined) heaps.push(Math.round((r.usedSize / 1024 / 1024) * 10) / 10);
  }
  await cdp.detach();
  return heaps;
}

test("L17 + L21 in tabs: switching restores each view at once, no main-thread task over 50 ms", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signIn(page, "admin@plan-markup.test");
  await expect(page).toHaveURL("/workspace");

  await openFile(page, L17);
  await page.waitForTimeout(1500);
  const heapOne = await workerHeaps(context, page);
  // A detail of L17: zoomed in twice.
  await canvas(page).focus();
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.waitForTimeout(2000);
  const viewL17 = await canvas(page).getAttribute("data-view");

  await openFile(page, L21);
  await page.waitForTimeout(2000);
  const viewL21 = await canvas(page).getAttribute("data-view");
  const strip = page.getByRole("tablist", { name: "Open drawings" });
  await expect(strip.getByRole("tab")).toHaveText(["A1721", "A2121"]);
  const heapTwo = await workerHeaps(context, page);

  // Switch timing: from the key press until the canvas publishes the other tab's view.
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver; __switches: number[]; __t0: number | null };
    w.__longTasks = [];
    w.__switches = [];
    w.__t0 = null;
    w.__observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__longTasks.push(e.duration)));
    w.__observer.observe({ type: "longtask" });
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "PageDown" && e.ctrlKey) w.__t0 = performance.now();
      },
      { capture: true },
    );
    const target = document.querySelector("[data-testid='drawing-canvas']")!;
    new MutationObserver(() => {
      if (w.__t0 === null) return;
      w.__switches.push(performance.now() - w.__t0);
      w.__t0 = null;
    }).observe(target, { attributes: true, attributeFilter: ["data-view"] });
  });
  await canvas(page).focus();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Control+PageDown");
    const expected = i % 2 === 0 ? viewL17 : viewL21;
    await expect(canvas(page)).toHaveAttribute("data-view", expected!);
    await expect(canvas(page)).toHaveAttribute("data-state", "ready");
    await page.waitForTimeout(700);
  }
  const { longest, switches } = await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver; __switches: number[] };
    w.__observer.disconnect();
    return { longest: Math.max(0, ...w.__longTasks), switches: w.__switches };
  });
  process.stdout.write(
    `tabs: switch to restored view (ms) ${JSON.stringify(switches.map((ms) => Math.round(ms * 10) / 10))}; longest main-thread task ${longest} ms; ` +
      `worker heaps (MB) one tab ${JSON.stringify(heapOne)}, two tabs ${JSON.stringify(heapTwo)}\n`,
  );
  expect(longest).toBeLessThan(50);
  expect(switches.length).toBe(6);

  // Back on L17 (zoomed) with both tabs.
  await page.keyboard.press("Control+PageDown");
  await expect(canvas(page)).toHaveAttribute("data-view", viewL17!);
  await page.waitForTimeout(2000);
  mkdirSync(path.join(PRIVATE, "traces"), { recursive: true });
  await page.screenshot({ path: path.join(PRIVATE, "traces", "3-5-tabs.png") });
  await context.close();
});
