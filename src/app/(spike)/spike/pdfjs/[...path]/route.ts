// Dev-only: serves pdf.js's worker, wasm decoders, standard fonts, cmaps and ICC
// profiles from node_modules to the render spike's worker (Story 2.3). Epic 3
// ships these as static assets instead. 404 unless the spike gate is open.
import type { NextRequest } from "next/server";
import { spikeAllowedFor } from "@/lib/spike/guard";
import { contentTypeFor, fileResponse, pdfjsAssetPath, pdfjsPath } from "../../assets";

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: NextRequest, ctx: RouteContext<"/spike/pdfjs/[...path]">): Promise<Response> {
  if (!spikeAllowedFor(request.nextUrl.host)) return notFound();
  const { path } = await ctx.params;
  const rel = pdfjsAssetPath(path);
  if (!rel) return notFound();
  return (await fileResponse(pdfjsPath(rel), contentTypeFor(rel))) ?? notFound();
}
