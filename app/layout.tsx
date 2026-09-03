import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UX Audit",
  description: "AI-assisted UX audits for websites.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
