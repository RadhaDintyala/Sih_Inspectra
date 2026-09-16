import type { Metadata } from "next";
import { RoleProvider } from "@/context/RoleContext";
import "./globals.css";

export const metadata: Metadata = { title: "Inspectra | Legal Metrology Inspection Console", description: "Evidence-backed packaged commodities compliance inspection." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <RoleProvider>{children}</RoleProvider>
      </body>
    </html>
  );
}

