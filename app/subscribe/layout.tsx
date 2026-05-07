import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscribe - Monadic DNA Explorer",
  description: "Get premium access to AI-powered DNA analysis, DNA Chat, and Overview Reports for $4.99/month.",
  keywords: ["DNA analysis subscription", "personal genomics premium", "genetic insights subscription"],
  alternates: {
    canonical: "https://explorer.monadicdna.com/subscribe",
  },
  openGraph: {
    title: "Subscribe - Monadic DNA Explorer",
    description: "Get premium access to AI-powered DNA analysis, DNA Chat, and Overview Reports for $4.99/month.",
    type: "website",
    url: "https://explorer.monadicdna.com/subscribe",
    siteName: "Monadic DNA Explorer",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Subscribe - Monadic DNA Explorer",
    description: "Get premium access to AI-powered DNA analysis, DNA Chat, and Overview Reports for $4.99/month.",
    creator: "@MonadicDNA",
  },
};

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
