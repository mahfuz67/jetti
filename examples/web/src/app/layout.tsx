import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Jetti — smart Solana transaction stack",
  description: "Jito bundles, lifecycle tracking, and AI-driven retry.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <Nav />
        <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
