import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Plan Markup", template: "%s · Plan Markup" },
  description: "Plan Markup",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The nonce CSP (src/proxy.ts) needs per-request rendering: Next.js puts the
  // nonce on its scripts only while rendering a request (Next CSP guide). This
  // makes every page under this layout dynamic; check:dynamic-routes guards it.
  // The Epic 13 marketing group gets its own root layout without this.
  await connection();
  return (
    <html
      lang="en"
      data-theme="blueprint"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-surface-0 text-text font-sans">
        {children}
      </body>
    </html>
  );
}
