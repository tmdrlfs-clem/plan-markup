import type { Metadata } from "next";
import { Barlow_Condensed } from "next/font/google";
import { Landing } from "@/features/marketing/landing";

// The landing page. The fuller marketing site (pricing, FAQ, help) is Epic 13.
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  description:
    "PDF markup for fire sprinkler designers: open a plan, draw a zone, and Plan Markup places and checks the heads to NZS 4541 spacing.",
};

export default function Home() {
  return (
    <div className={`${display.variable} flex flex-1 flex-col`}>
      <Landing />
    </div>
  );
}
