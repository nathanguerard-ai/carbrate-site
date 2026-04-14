import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "CarbRate",
    template: "%s | CarbRate",
  },
  description:
    "Compare gels, boissons, bonbons et barres selon leur coût réel et leurs glucides par dollar.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "CarbRate",
    description:
      "Compare gels, boissons, bonbons et barres selon leur coût réel et leurs glucides par dollar.",
    url: siteUrl,
    siteName: "CarbRate",
    locale: "fr_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CarbRate",
    description:
      "Compare gels, boissons, bonbons et barres selon leur coût réel et leurs glucides par dollar.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
