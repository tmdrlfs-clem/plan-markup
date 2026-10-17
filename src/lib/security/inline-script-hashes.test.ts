import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashInlineScripts } from "./inline-script-hashes";

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

describe("hashInlineScripts", () => {
  it("hashes inline scripts in document order, skipping src scripts and duplicates", async () => {
    const html = [
      "<html><head>",
      '<script src="/_next/static/a.js" async></script>',
      "<script>self.__next_f=[]</script>",
      '<script nonce="x" data-src="y">b()</script>',
      "<script>self.__next_f=[]</script>",
      '<SCRIPT type="application/json">{"é":1}</SCRIPT>',
      "</head></html>",
    ].join("");
    expect(await hashInlineScripts(html)).toEqual([sha("self.__next_f=[]"), sha("b()"), sha('{"é":1}')]);
  });

  it("returns an empty list without inline scripts", async () => {
    expect(await hashInlineScripts('<p>x</p><script src="a.js"></script>')).toEqual([]);
  });

  it("hashes an empty inline script", async () => {
    expect(await hashInlineScripts("<script></script>")).toEqual([sha("")]);
  });
});
