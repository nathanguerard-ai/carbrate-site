import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://carbrate-site.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "CarbRate",
    template: "%s | CarbRate",
  },
  description:
    "Compare les produits de nutrition d'endurance selon leur coût réel, leurs portions et leurs glucides par dollar.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "CarbRate",
    description:
      "Compare les produits de nutrition d'endurance selon leur coût réel, leurs portions et leurs glucides par dollar.",
    url: siteUrl,
    siteName: "CarbRate",
    locale: "fr_CA",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "CarbRate",
    description:
      "Compare les produits de nutrition d'endurance selon leur coût réel, leurs portions et leurs glucides par dollar.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>
        <Header />
        <div className="flex min-h-screen flex-col">
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
