// Story 2.3 render spike page. Not reachable in production: 404 unless the
// spike gate is open (next dev, or a local build with PLAN_MARKUP_LOCAL_SPIKE=1
// on a loopback host; see src/lib/spike/guard.ts).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { spikeAllowedFor } from "@/lib/spike/guard";
import { SpikeRenderViewer } from "./viewer";

export const metadata: Metadata = { title: "Render spike", robots: { index: false, follow: false } };

export default async function SpikeRenderPage() {
  if (!spikeAllowedFor((await headers()).get("host"))) notFound();
  return <SpikeRenderViewer />;
}
