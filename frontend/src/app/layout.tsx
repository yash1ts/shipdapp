import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Navbar } from "@/components/Navbar";
import AnimatedShaderBackground from "@/components/ui/animated-shader-background";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ShipDapp — pump.fun for apps",
  description:
    "Deploy an app, launch a token, trading tax pays hosting. All on Solana devnet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-abyss min-h-screen antialiased`}>
        <Providers>
          <div className="relative min-h-screen flex flex-col">
            <AnimatedShaderBackground />
            <Navbar />
            <main className="flex-1 relative z-10">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
