import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/LanguageProvider";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sinotechjobs.vercel.app"),
  title: "SinotechJobs | Tech Careers in DACH for Chinese-Speaking Talent",
  description:
    "Discover AI, robotics, drone, and software engineering positions in Germany, Austria, and Switzerland where Chinese language skills are valued.",
  alternates: {
    languages: {
      en: "https://sinotechjobs.vercel.app?lang=en",
      zh: "https://sinotechjobs.vercel.app?lang=zh",
      de: "https://sinotechjobs.vercel.app?lang=de",
      "x-default": "https://sinotechjobs.vercel.app",
    },
  },
  openGraph: {
    type: "website",
    url: "https://sinotechjobs.vercel.app",
    siteName: "SinotechJobs",
    locale: "en_US",
    alternateLocale: ["zh_CN", "de_DE"],
    title: "SinotechJobs | Tech Careers in DACH for Chinese-Speaking Talent",
    description:
      "Discover AI, robotics, drone, and software engineering positions in Germany, Austria, and Switzerland where Chinese language skills are valued.",
    images: [
      {
        url: "/media/og-home.png",
        width: 1200,
        height: 630,
        alt: "SinotechJobs — Tech Careers in DACH for Chinese-Speaking Talent",
      },
      {
        url: "/media/og-jobs.png",
        width: 1200,
        height: 630,
        alt: "SinotechJobs — Find Your Next Role",
      },
      {
        url: "/media/og-article.png",
        width: 1200,
        height: 630,
        alt: "SinotechJobs — DACH Tech Insights",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@sinotechjobs",
    title: "SinotechJobs | Tech Careers in DACH for Chinese-Speaking Talent",
    description:
      "Discover AI, robotics, drone, and software engineering positions in Germany, Austria, and Switzerland where Chinese language skills are valued.",
    images: ["/media/og-home.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const plausibleDomain =
    process.env.PLAUSIBLE_DOMAIN ||
    process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ||
    "sinotechjobs.vercel.app";
  const isPlausibleDisabled =
    process.env.PLAUSIBLE_DISABLED === "true" ||
    process.env.NEXT_PUBLIC_PLAUSIBLE_DISABLED === "true" ||
    plausibleDomain === "disabled" ||
    process.env.PLAUSIBLE_DOMAIN === "false";

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {!isPlausibleDisabled && (
          <script defer data-domain={plausibleDomain} src="https://plausible.io/js/script.js"></script>
        )}
      </head>
      <body className="min-h-full flex flex-col">
        <LanguageProvider>
          <Navbar />
          <main style={{ flex: 1 }}>{children}</main>
          <Footer />
        </LanguageProvider>
      </body>
    </html>
  );
}
