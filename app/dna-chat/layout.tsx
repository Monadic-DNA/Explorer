import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chat - Monadic DNA Explorer",
  description: "Ask private AI questions about your saved genetic results. Your DNA data never leaves your device.",
  keywords: ["DNA chat", "genetic AI", "private DNA analysis", "personal genomics AI", "DNA questions"],
  alternates: {
    canonical: "https://explorer.monadicdna.com/dna-chat",
  },
  openGraph: {
    title: "Chat - Monadic DNA Explorer",
    description: "Ask private AI questions about your saved genetic results. Your DNA data never leaves your device.",
    type: "website",
    url: "https://explorer.monadicdna.com/dna-chat",
    siteName: "Monadic DNA Explorer",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Chat - Monadic DNA Explorer",
    description: "Ask private AI questions about your saved genetic results. Your DNA data never leaves your device.",
    creator: "@MonadicDNA",
  },
};

export default function DNAChatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
