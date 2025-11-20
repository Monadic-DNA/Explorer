import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "./components/AuthProvider";

export const metadata: Metadata = {
  title: "Monadic DNA Explorer",
  description: "Explore thousands of genetic traits from the GWAS Catalog and analyze your own DNA data with privacy-focused AI insights",
  keywords: ["GWAS", "genetics", "DNA analysis", "genome explorer", "genetic traits", "GWAS Catalog", "personal genomics", "23andMe", "AncestryDNA"],
  authors: [{ name: "Recherché Inc" }],
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
  openGraph: {
    type: "website",
    title: "Monadic DNA Explorer",
    description: "Explore thousands of genetic traits from the GWAS Catalog and analyze your own DNA data",
    siteName: "Monadic DNA Explorer",
    url: "https://monadicdna.com",
  },
  twitter: {
    card: "summary_large_image",
    title: "Monadic DNA Explorer",
    description: "Explore thousands of genetic traits from the GWAS Catalog and analyze your own DNA data",
    creator: "@MonadicDNA",
  },
  robots: {
    index: true,
    follow: true,
  },
  metadataBase: new URL("https://monadicdna.com"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Theme Script - Must run before any rendering to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const savedTheme = localStorage.getItem('theme') || 'light';
                document.documentElement.setAttribute('data-theme', savedTheme);
                document.documentElement.style.colorScheme = savedTheme;
              })();
            `,
          }}
        />
        {/* Google Analytics */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-HP3FB0GX80"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-HP3FB0GX80', {
              anonymize_ip: true,
            });
          `}
        </Script>
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
