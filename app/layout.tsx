import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { AuthProvider } from "./components/AuthProvider";
import { GenotypeProvider } from "./components/UserDataUpload";
import { ResultsProvider } from "./components/ResultsContext";
import { CustomizationProvider } from "./components/CustomizationContext";
import MobileCompatibilityNotice from "./components/MobileCompatibilityNotice";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Monadic DNA | Personal DNA insights with privacy, autonomy, and boundless curiosity",
  description: "Private DNA insights from trusted genetic research. Learn from your DNA while your data remains private, protected, and entirely in your hands.",
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
    title: "Monadic DNA | Personal DNA insights with privacy, autonomy, and boundless curiosity",
    description: "Private DNA insights from trusted genetic research. Learn from your DNA while your data remains private, protected, and entirely in your hands.",
    siteName: "Monadic DNA Explorer",
    url: "https://explorer.monadicdna.com",
    locale: "en_US",
    images: [
      {
        url: "https://monadicdna.com/og-image.png",
        width: 1199,
        height: 630,
        alt: "Monadic DNA Explorer - Private DNA insights from trusted genetic research",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Monadic DNA | Personal DNA insights with privacy, autonomy, and boundless curiosity",
    description: "Private DNA insights from trusted genetic research. Learn from your DNA while your data remains private, protected, and entirely in your hands.",
    creator: "@MonadicDNA",
    images: ["https://monadicdna.com/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  metadataBase: new URL("https://explorer.monadicdna.com"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
        {/* Reddit Pixel */}
        {process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID && (
          <Script id="reddit-pixel" strategy="afterInteractive">
            {`
              !function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js?pixel_id=${process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID}",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);
              rdt('init','${process.env.NEXT_PUBLIC_REDDIT_PIXEL_ID}');
              rdt('track', 'PageVisit');
            `}
          </Script>
        )}
        {/* X (Twitter) Pixel */}
        {process.env.NEXT_PUBLIC_X_PIXEL_ID && (
          <Script id="x-pixel" strategy="afterInteractive">
            {`
              !function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
              },s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
              a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
              twq('config','${process.env.NEXT_PUBLIC_X_PIXEL_ID}');
            `}
          </Script>
        )}
      </head>
      <body>
        <AuthProvider>
          <GenotypeProvider>
            <ResultsProvider>
              <CustomizationProvider>
                <MobileCompatibilityNotice />
                {children}
              </CustomizationProvider>
            </ResultsProvider>
          </GenotypeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
