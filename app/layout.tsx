import type { Metadata } from "next";
import "./globals.css";
import "./design-system.css";
import "./embedded-mode.css";
import EmbeddedMode from "./embedded-mode";
import ProductShell from "./product-shell";

export const metadata: Metadata = {
  title: "UX Audit · UX Direct engine",
  description: "Evidence-led information architecture, UX audits, and competitive benchmarking inside UX Direct.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <EmbeddedMode />
        <ProductShell>{children}</ProductShell>
      </body>
    </html>
  );
}
