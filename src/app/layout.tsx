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
