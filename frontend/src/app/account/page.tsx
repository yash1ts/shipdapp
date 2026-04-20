"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Boxes,
  Coins,
  Container,
  ExternalLink,
  Fuel,
  Ship,
  UserCircle2,
  Wallet,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { apiEnvReady } from "@/lib/api-client";
import { useAuth } from "@/components/AuthProvider";
import { API_BASE } from "@/lib/auth";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletMultiButton
    ),
  { ssr: false }
);

type DeploymentRow = {
  id: string;
  appName: string;
  description: string | null;
  dockerImage: string;
  port: number;
  status: string;
  akashDseq: string | null;
  akashProvider: string | null;
  ownerWallet: string | null;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenMint: string | null;
  // Drizzle `{mode: 'timestamp'}` round-trips through Hono's JSON serializer as an ISO string,
  // so treat it as string. Epoch-seconds fallback covers older rows and future changes.
  createdAt: string | number;
};

function parseCreatedAt(v: string | number | null | undefined): Date | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v * 1000);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

type CardStatus = "Active" | "Deploying" | "Paused" | "Dead";

const statusConfig: Record<
  CardStatus,
  { class: string; dot: string }
> = {
  Active: { class: "tag-active", dot: "bg-emerald-400" },
  Deploying: { class: "tag-deploying", dot: "bg-dock-400" },
  Paused: { class: "tag-paused", dot: "bg-amber-400" },
  Dead: { class: "tag-dead", dot: "bg-red-400" },
};

function mapStatus(status: string): CardStatus {
  if (status === "ACTIVE") return "Active";
  if (
    status === "DEPLOYING" ||
    status === "PENDING_FUNDS" ||
    status === "FUNDED"
  ) {
    return "Deploying";
  }
  if (status === "FAILED") return "Dead";
  return "Paused";
}

function tokenFromName(name: string, fallback: string | null): string {
  if (fallback && fallback.trim()) {
    const s = fallback.trim().toUpperCase();
    return s.startsWith("$") ? s : `$${s}`;
  }
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  const base = letters.slice(0, 5) || "APP";
  return `$${base}`;
}

function shortenAddress(addr: string | null, length = 4): string {
  if (!addr) return "—";
  return addr.length > length * 2
    ? `${addr.slice(0, length)}...${addr.slice(-length)}`
    : addr;
}

export default function AccountPage() {
  const { publicKey, connected } = useWallet();
  const {
    token,
    status: authStatus,
    signIn,
    error: authError,
  } = useAuth();
  const [rows, setRows] = useState<DeploymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      if (!publicKey || !token) {
        setRows([]);
        return;
      }
      if (!apiEnvReady()) {
        setErr("Set NEXT_PUBLIC_API_URL to load your apps.");
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const resp = await fetch(
          `${API_BASE}/api/users/${publicKey.toBase58()}/deployments`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body?.error || resp.statusText);
        }
        const data = (await resp.json()) as DeploymentRow[];
        if (!alive) return;
        setRows(data ?? []);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
        setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [publicKey, token]);

  return (
    <div className="section-shell py-16 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[340px] bg-dock-400/8 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative">
        <div className="flex items-start justify-between flex-wrap gap-6 mb-10">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-dock-400/20 bg-dock-400/5 px-3 py-1 mb-4">
              <UserCircle2 className="w-3.5 h-3.5 text-dock-300" />
              <span className="text-xs font-medium text-dock-300">
                My Account
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-2">
              Your <span className="glow-text">Docked Apps</span>
            </h1>
            <p className="text-slate-400 text-sm max-w-xl">
              Apps launched from this wallet and the tokens that power their
              hosting vaults.
            </p>
          </div>

          {connected && publicKey ? (
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-abyss/40 px-4 py-3">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-dock-400/20 to-ocean-500/20 flex items-center justify-center border border-white/[0.06]">
                <Wallet className="w-4 h-4 text-dock-300" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-slate-500">
                  Connected wallet
                </div>
                <code className="text-xs text-white font-mono">
                  {shortenAddress(publicKey.toBase58(), 6)}
                </code>
              </div>
            </div>
          ) : null}
        </div>

        {!connected || !publicKey ? (
          <GatedCard />
        ) : authStatus !== "authenticated" ? (
          <SignInCard
            status={authStatus}
            error={authError}
            onSignIn={() => void signIn()}
          />
        ) : loading ? (
          <div className="container-card p-12 text-center text-slate-500 text-sm">
            Loading your apps…
          </div>
        ) : err ? (
          <div className="container-card p-8 text-center border-red-500/30 text-red-300 text-sm">
            {err}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {rows.map((row) => (
              <MyAppCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GatedCard() {
  return (
    <div className="container-card p-10 text-center max-w-xl mx-auto">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-dock-400/15 to-ocean-500/15 border border-white/[0.06] mb-4">
        <Wallet className="w-7 h-7 text-dock-300" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Connect a wallet
      </h2>
      <p className="text-slate-400 text-sm mb-6">
        Your deployed apps are tied to the wallet that launched them. Connect
        to see your apps and their tokens.
      </p>
      <div className="inline-block">
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
  );
}

function SignInCard({
  status,
  error,
  onSignIn,
}: {
  status: string;
  error: string | null;
  onSignIn: () => void;
}) {
  const busy = status === "signing_in";
  return (
    <div className="container-card p-10 text-center max-w-xl mx-auto">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-dock-400/15 to-ocean-500/15 border border-white/[0.06] mb-4">
        <UserCircle2 className="w-7 h-7 text-dock-300" />
      </div>
      <h2 className="text-xl font-semibold text-white mb-2">
        Sign in to your account
      </h2>
      <p className="text-slate-400 text-sm mb-6">
        Prove you own this wallet by signing a short message. No transaction is
        sent and no fees are charged.
      </p>
      {error ? (
        <p className="text-red-300 text-xs mb-4 border border-red-500/20 rounded-lg p-2">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className="btn-dock disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={busy}
        onClick={onSignIn}
      >
        {busy ? "Waiting for wallet…" : "Sign in with wallet"}
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="container-card p-12 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-dock-400/10 to-ocean-500/10 border border-white/[0.06] mb-4">
        <Boxes className="w-7 h-7 text-dock-300" />
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">
        No apps launched yet
      </h3>
      <p className="text-sm text-slate-400 mb-6">
        Ship your first Dockerized app and we&apos;ll link it to this wallet.
      </p>
      <Link href="/launch" className="btn-dock">
        <Ship className="w-4 h-4" />
        Launch an app
      </Link>
    </div>
  );
}

function MyAppCard({ row }: { row: DeploymentRow }) {
  const status = mapStatus(row.status);
  const cfg = statusConfig[status];
  const symbol = tokenFromName(row.appName, row.tokenSymbol);
  const tokenLabel =
    row.tokenName && row.tokenName.trim() ? row.tokenName.trim() : row.appName;

  return (
    <div className="container-card group h-full">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-dock-400/20 to-ocean-500/20 border border-white/[0.06]">
            <Container className="w-5 h-5 text-dock-300" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-white truncate tracking-tight">
              {row.appName}
            </h3>
            <p className="text-xs text-slate-500">
              Launched{" "}
              {parseCreatedAt(row.createdAt)?.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              }) ?? "—"}
            </p>
          </div>
        </div>
        <span className={cfg.class}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {status}
        </span>
      </div>

      {row.description ? (
        <p className="text-sm text-slate-400 mb-4 leading-relaxed min-h-[42px]">
          {row.description}
        </p>
      ) : (
        <p className="text-sm text-slate-600 italic mb-4">No description</p>
      )}

      <div className="flex items-center gap-2 rounded-lg bg-abyss/60 border border-white/[0.04] px-3 py-2 mb-4">
        <Container className="w-3.5 h-3.5 text-dock-500 flex-shrink-0" />
        <code className="text-xs text-slate-500 truncate">
          {row.dockerImage}
        </code>
      </div>

      <div className="rounded-lg border border-ocean-400/15 bg-ocean-500/5 p-4 mb-4 space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-ocean-200/80">
          <Coins className="w-3.5 h-3.5" />
          App token
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TokenStat label="Symbol" value={symbol} mono />
          <TokenStat label="Name" value={tokenLabel} />
          <TokenStat
            label="Mint"
            value={row.tokenMint ? shortenAddress(row.tokenMint, 4) : "Pending"}
            mono
            dim={!row.tokenMint}
          />
          <TokenStat
            label="Funding wallet"
            value={shortenAddress(row.ownerWallet, 4)}
            mono
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-abyss/40 border border-white/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Fuel className="w-3 h-3" />
            Port
          </div>
          <div className="font-semibold text-white text-sm font-mono">
            {row.port}
          </div>
        </div>
        <div className="rounded-lg bg-abyss/40 border border-white/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Boxes className="w-3 h-3" />
            dseq
          </div>
          <div className="font-semibold text-white text-sm font-mono truncate">
            {row.akashDseq ?? "—"}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-white/[0.05]">
        <Link
          href="/trade"
          className="btn-dock flex-1 justify-center text-xs py-2"
        >
          <Wallet className="w-3.5 h-3.5" />
          Trade {symbol}
        </Link>
        {row.akashDseq ? (
          <a
            href={`https://console.akash.network/deployments/${row.akashDseq}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs py-2 px-3"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Akash
          </a>
        ) : (
          <span className="btn-ghost text-xs py-2 px-3 opacity-40 cursor-not-allowed">
            <ExternalLink className="w-3.5 h-3.5" />
            Pending
          </span>
        )}
      </div>
    </div>
  );
}

function TokenStat({
  label,
  value,
  mono = false,
  dim = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
        {label}
      </div>
      <div
        className={`text-sm truncate ${mono ? "font-mono" : "font-semibold"} ${
          dim ? "text-slate-500" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
