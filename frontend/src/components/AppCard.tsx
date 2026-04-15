"use client";

import {
  Container,
  ExternalLink,
  Fuel,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";

interface AppCardProps {
  deploymentId?: string;
  name: string;
  description: string;
  dockerImage: string;
  status: "Active" | "Deploying" | "Paused" | "Dead";
  tokenSymbol: string;
  vaultBalance: number;
  creator: string;
  appUrl: string;
  onCheckStatus?: (deploymentId: string) => void;
  checkingStatus?: boolean;
}

const statusConfig = {
  Active: { class: "tag-active", dot: "bg-emerald-400" },
  Deploying: { class: "tag-deploying", dot: "bg-dock-400" },
  Paused: { class: "tag-paused", dot: "bg-amber-400" },
  Dead: { class: "tag-dead", dot: "bg-red-400" },
};

export function AppCard({
  deploymentId,
  name,
  description,
  dockerImage,
  status,
  tokenSymbol,
  vaultBalance,
  creator,
  appUrl,
  onCheckStatus,
  checkingStatus = false,
}: AppCardProps) {
  const cfg = statusConfig[status];

  return (
    <div className="container-card group">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-dock-400/20 to-ocean-500/20 border border-white/[0.06]">
            <Container className="w-5 h-5 text-dock-300" />
          </div>
          <div>
            <h3 className="font-semibold text-white group-hover:text-dock-300 transition-colors">
              {name}
            </h3>
            <p className="text-xs text-slate-500 font-mono">{creator}</p>
          </div>
        </div>
        <span className={cfg.class}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {status}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-slate-400 mb-4 leading-relaxed">
        {description}
      </p>

      {/* Docker image */}
      <div className="flex items-center gap-2 rounded-lg bg-abyss/60 border border-white/[0.04] px-3 py-2 mb-4">
        <Container className="w-3.5 h-3.5 text-dock-500 flex-shrink-0" />
        <code className="text-xs text-slate-500 truncate">{dockerImage}</code>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-abyss/40 border border-white/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <TrendingUp className="w-3 h-3" />
            Token
          </div>
          <div className="font-semibold text-white text-sm">{tokenSymbol}</div>
        </div>
        <div className="rounded-lg bg-abyss/40 border border-white/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
            <Fuel className="w-3 h-3" />
            Vault
          </div>
          <div className="font-semibold text-white text-sm">
            {vaultBalance.toFixed(2)} SOL
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
        <Link href="/trade" className="btn-dock flex-1 justify-center text-xs py-2">
          <Wallet className="w-3.5 h-3.5" />
          Trade {tokenSymbol}
        </Link>
        {appUrl ? (
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-xs py-2 px-3"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open
          </a>
        ) : (
          <span className="btn-ghost text-xs py-2 px-3 opacity-40 cursor-not-allowed">
            <ExternalLink className="w-3.5 h-3.5" />
            Pending
          </span>
        )}
      </div>
      {deploymentId && onCheckStatus ? (
        <div className="pt-2">
          <button
            type="button"
            className="btn-ghost w-full justify-center text-xs py-2 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={checkingStatus}
            onClick={() => onCheckStatus(deploymentId)}
          >
            {checkingStatus ? "Checking..." : "Check deployment status"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
