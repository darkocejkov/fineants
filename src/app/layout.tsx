import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
  variable: "--font-archivo",
  fallback: ["system-ui", "Helvetica Neue", "Arial", "sans-serif"],
});

export const metadata: Metadata = { title: "fineants", description: "Personal finance dashboard" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <div className="sheet">
          <Nav />
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
