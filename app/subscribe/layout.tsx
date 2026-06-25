import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Subscribe - Monadic DNA Explorer",
  description: "Try Monadic DNA Explorer Premium free for 7 days, then $4.99/month. Research in DNA Chat, all premium reports. Cancel any time.",
  keywords: ["DNA analysis subscription", "personal genomics premium", "genetic insights subscription"],
  alternates: {
    canonical: "https://explorer.monadicdna.com/subscribe",
  },
  openGraph: {
    title: "Subscribe - Monadic DNA Explorer",
    description: "Try Monadic DNA Explorer Premium free for 7 days, then $4.99/month. Research in DNA Chat, all premium reports. Cancel any time.",
    type: "website",
    url: "https://explorer.monadicdna.com/subscribe",
    siteName: "Monadic DNA Explorer",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Subscribe - Monadic DNA Explorer",
    description: "Try Monadic DNA Explorer Premium free for 7 days, then $4.99/month. Research in DNA Chat, all premium reports. Cancel any time.",
    creator: "@MonadicDNA",
  },
};

export default function SubscribeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
