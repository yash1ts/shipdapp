"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Anchor, Ship, Boxes } from "lucide-react";
import { useShipdappProgram } from "@/hooks/useShipdappProgram";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-white/[0.06] bg-abyss/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-dock-400 to-dock-600 shadow-glow group-hover:shadow-dock-lg transition-shadow">
              <Ship className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              <span className="glow-text">Ship</span>
              <span className="text-white">Dapp</span>
            </span>
            <span className="hidden sm:inline-flex tag-deploying text-[10px] ml-1">
              DEVNET
            </span>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-1">
            <NavLink href="/" icon={<Boxes className="w-4 h-4" />}>
              App Store
            </NavLink>
            <NavLink href="/launch" icon={<Ship className="w-4 h-4" />}>
              Launch
            </NavLink>
            <NavLink href="/trade" icon={<Anchor className="w-4 h-4" />}>
              Trade
            </NavLink>
          </div>

          {/* Wallet */}
          <div className="flex items-center gap-3">
            <ProgramIdChip />
            <WalletMultiButton
              style={{
                background: "linear-gradient(135deg, #2496ed 0%, #1268b3 100%)",
                borderRadius: "0.5rem",
                fontSize: "0.875rem",
                height: "2.5rem",
                padding: "0 1rem",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}

function ProgramIdChip() {
  const { programId, connected } = useShipdappProgram();
  const id = programId.toBase58();
  const short = `${id.slice(0, 4)}…${id.slice(-4)}`;
  return (
    <div
      className="hidden xl:flex flex-col items-end text-[10px] text-slate-600 font-mono leading-tight max-w-[140px]"
      title={id}
    >
      <span className="truncate w-full text-right">prog {short}</span>
      {connected ? (
        <span className="text-emerald-500/80">signer</span>
      ) : (
        <span className="text-slate-600">read-only</span>
      )}
    </div>
  );
}

function NavLink({
  href,
  children,
  icon,
}: {
  href: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:text-white hover:bg-white/[0.04]"
    >
      {icon}
      {children}
    </Link>
  );
}
