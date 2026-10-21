// Dev-only: streams a whitelisted private fixture to the render spike (Story 2.3).
// 404 unless the spike gate is open (see src/lib/spike/guard.ts).
import type { NextRequest } from "next/server";
import { spikeAllowedFor } from "@/lib/spike/guard";
import { SPIKE_FIXTURES, fileResponse, fixturePath } from "../../assets";

const notFound = () => new Response("Not found", { status: 404 });

export async function GET(request: NextRequest, ctx: RouteContext<"/spike/fixture/[name]">): Promise<Response> {
  if (!spikeAllowedFor(request.nextUrl.host)) return notFound();
  const { name } = await ctx.params;
  const file = Object.hasOwn(SPIKE_FIXTURES, name) ? SPIKE_FIXTURES[name] : undefined;
  if (!file) return notFound();
  return (await fileResponse(fixturePath(file), "application/pdf")) ?? notFound();
}
