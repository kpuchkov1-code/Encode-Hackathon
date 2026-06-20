import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import { Nav } from "@/components/Nav";
import { AccountProvider } from "@/lib/account";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DockMarket — Decentralized Docking Marketplace",
  description:
    "Submit molecular docking jobs to idle GPUs. On-chain escrow, cryptographic proof of execution, real gnina binding-affinity scores.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <AccountProvider>
          <Nav />
          {children}
        </AccountProvider>
        <Analytics />
      </body>
    </html>
  );
}
