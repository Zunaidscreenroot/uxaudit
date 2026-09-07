import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UX Audit",
  description: "AI-assisted UX audits for websites.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <a href="/knowledge-base" style={{ position: "fixed", right: 20, bottom: 20, zIndex: 50, padding: "11px 15px", borderRadius: 999, background: "#111", color: "#fff", textDecoration: "none", fontSize: 12, fontWeight: 800, boxShadow: "0 8px 22px rgba(17,17,17,.18)" }}>
          Knowledge base →
        </a>
      </body>
    </html>
  );
}
