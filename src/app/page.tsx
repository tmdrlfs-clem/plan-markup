import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { Landing } from "@/features/marketing/landing";

// The landing page. The fuller marketing site (pricing, FAQ, help) is Epic 13.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  description:
    "NZS 4541 sprinkler head layouts, placed and checked in your browser: outline a zone on your PDF, choose its use, and Plan Markup places the heads and reports every check.",
};

export default function Home() {
  return (
    <div className={`${mono.variable} flex flex-1 flex-col`}>
      <Landing />
    </div>
  );
}
