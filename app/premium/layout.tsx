import type { Metadata} from "next";

export const metadata: Metadata = {
  title: "Premium Features - Monadic DNA Explorer",
  description: "Unlock advanced AI-powered genetic analysis with LLM Chat and comprehensive overview reports. Privacy-preserving analysis with Trusted Execution Environment.",
  keywords: ["LLM genetic analysis", "AI DNA analysis", "premium genomics", "genetic AI chat", "comprehensive DNA report"],
  openGraph: {
    title: "Premium Features - Monadic DNA Explorer",
    description: "Advanced AI-powered genetic analysis with privacy-preserving LLM technology",
    type: "website",
  },
};

export default function PremiumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
