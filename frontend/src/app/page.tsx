"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Ship,
  Container,
  Anchor,
  ArrowRight,
  Waves,
  Coins,
  Globe,
  Zap,
} from "lucide-react";
import { AppCard } from "@/components/AppCard";
import { StatsBar } from "@/components/StatsBar";
import { apiEnvReady } from "@/lib/api-client";

type DeploymentRow = {
  id: string;
  app_name: string;
  description: string | null;
  docker_image: string;
  status: string;
  solana_treasury_public_key: string;
  akash_dseq: string | null;
  created_at: string;
};

type CardStatus = "Active" | "Deploying" | "Paused" | "Dead";
type CardApp = {
  deploymentId: string;
  name: string;
  description: string;
  dockerImage: string;
  status: CardStatus;
  tokenSymbol: string;
  vaultBalance: number;
  creator: string;
  appUrl: string;
};

function formatCreator(addr: string): string {
  if (!addr) return "unknown";
  return addr.length > 12 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

function tokenFromName(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  const base = letters.slice(0, 5) || "APP";
  return `$${base}`;
}

function mapStatus(status: string): CardStatus {
  if (status === "ACTIVE") return "Active";
  if (status === "DEPLOYING" || status === "PENDING_FUNDS" || status === "FUNDED") {
    return "Deploying";
  }
  if (status === "FAILED") return "Dead";
  return "Paused";
}

export default function HomePage() {
  const [apps, setApps] = useState<CardApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadApps() {
      if (!apiEnvReady()) {
        if (!alive) return;
        setApps([]);
        setAppsLoading(false);
        setAppsError(
          "Set NEXT_PUBLIC_API_URL to load live apps."
        );
        return;
      }
      try {
        const baseUrl = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
        const resp = await fetch(`${baseUrl}/api/deployments`);
        if (!resp.ok) throw new Error("Failed to fetch deployments");
        const data = await resp.json();

        const cards: CardApp[] = ((data ?? []) as any[]).map((row) => ({
          deploymentId: row.id,
          name: row.appName,
          description: row.description ?? "No description provided yet.",
          dockerImage: row.dockerImage,
          status: mapStatus(row.status),
          tokenSymbol: tokenFromName(row.appName),
          vaultBalance: 0,
          creator: formatCreator(row.solanaTreasuryPublicKey),
          appUrl: "",
        }));
        if (!alive) return;
        setApps(cards);
        setAppsError(null);
      } catch (e) {
        if (!alive) return;
        setApps([]);
        setAppsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setAppsLoading(false);
      }
    }
    void loadApps();
    return () => {
      alive = false;
    };
  }, []);

  async function checkDeploymentStatus(deploymentId: string) {
    if (!apiEnvReady()) return;
    setCheckingId(deploymentId);
    setAppsError(null);
    try {
      const { apiClient } = await import("@/lib/api-client");
      const { data, error } = await apiClient.invoke("deployments-status", {
        body: { deployment_id: deploymentId },
      });
      if (error) throw error;
      const payload = data as { error?: string; status?: string };
      if (payload?.error) throw new Error(payload.error);
      const nextStatus = mapStatus(payload?.status ?? "");
      setApps((prev) =>
        prev.map((app) =>
          app.deploymentId === deploymentId ? { ...app, status: nextStatus } : app
        )
      );
    } catch (e) {
      setAppsError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="relative">
      {/* Hero */}
      <section className="relative overflow-hidden pt-24 pb-20">
        {/* Glowing orb */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-dock-400/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="section-shell relative">
          <div className="text-center max-w-3xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-dock-400/20 bg-dock-400/5 px-4 py-1.5 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-dock-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-dock-400" />
              </span>
              <span className="text-xs font-medium text-dock-300">
                Live on Solana Devnet
              </span>
            </div>

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight mb-6">
              <span className="glow-text">Ship apps.</span>
              <br />
              <span className="text-white">Launch tokens.</span>
              <br />
              <span className="text-slate-400 text-4xl sm:text-5xl lg:text-6xl">
                Self-fund hosting.
              </span>
            </h1>

            <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-11 leading-relaxed">
              Deploy any Dockerized app to the decentralized cloud. Each app
              gets its own token with a 2% transfer fee that pays for hosting.
              Popular apps self-fund. Dead apps die naturally.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/launch" className="btn-dock text-base px-8 py-3">
                <Ship className="w-5 h-5" />
                Launch Your App
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/trade" className="btn-ghost text-base px-8 py-3">
                <Anchor className="w-5 h-5" />
                Trade App Tokens
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 relative">
        <div className="section-shell">
          <h2 className="text-center section-title mb-12">
            How the <span className="glow-text">Dock</span> Works
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <StepCard
              step={1}
              icon={<Container className="w-6 h-6" />}
              title="Ship a Container"
              desc="Paste your Docker image URI — any containerized app works"
            />
            <StepCard
              step={2}
              icon={<Globe className="w-6 h-6" />}
              title="Deploy to Cloud"
              desc="Akash Network spins up your app on decentralized infra"
            />
            <StepCard
              step={3}
              icon={<Coins className="w-6 h-6" />}
              title="Token Launches"
              desc="Token-2022 mint with 2% transfer fee + bonding curve"
            />
            <StepCard
              step={4}
              icon={<Zap className="w-6 h-6" />}
              title="Self-Funding"
              desc="Trading fees flow to hosting vault — popular apps never die"
            />
          </div>

        </div>
      </section>

      {/* Stats */}
      <StatsBar />

      {/* App Store */}
      <section className="py-20 relative">
        <div className="section-shell">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="section-title flex items-center gap-3">
                <Waves className="w-6 h-6 text-dock-400" />
                Docked Apps
              </h2>
              <p className="section-subtitle">
                Browse deployed containers and trade their tokens
              </p>
            </div>
            <Link
              href="/launch"
              className="btn-dock text-sm"
            >
              <Ship className="w-4 h-4" />
              Ship New App
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {apps.map((app) => (
              <AppCard
                key={app.deploymentId}
                {...app}
                onCheckStatus={checkDeploymentStatus}
                checkingStatus={checkingId === app.deploymentId}
              />
            ))}
          </div>

          {/* Empty state hint */}
          <div className="mt-12 text-center">
            {appsLoading ? (
              <p className="text-slate-600 text-sm">Loading deployed apps...</p>
            ) : appsError ? (
              <p className="text-red-300 text-sm">{appsError}</p>
            ) : apps.length === 0 ? (
              <p className="text-slate-600 text-sm">
                No apps yet. Ship your first app to see it listed here.
              </p>
            ) : (
              <p className="text-slate-600 text-sm">
                Showing live deployments from Cloudflare.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function StepCard({
  step,
  icon,
  title,
  desc,
}: {
  step: number;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="container-card text-center group">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-dock-400/10 text-dock-400 mb-4 group-hover:bg-dock-400/20 transition-colors">
        {icon}
      </div>
      <div className="text-[10px] font-bold text-dock-500 uppercase tracking-widest mb-2">
        Step {step}
      </div>
      <h3 className="text-white font-semibold mb-2">{title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed">{desc}</p>
    </div>
  );
}
