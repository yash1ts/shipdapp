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
import { getBrowserSupabase, supabaseEnvReady } from "@/lib/supabase-browser";

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
      if (!supabaseEnvReady()) {
        if (!alive) return;
        setApps([]);
        setAppsLoading(false);
        setAppsError(
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load live apps."
        );
        return;
      }
      try {
        const supabase = getBrowserSupabase();
        const { data, error } = await supabase
          .from("app_deployments")
          .select(
            "id, app_name, description, docker_image, status, solana_treasury_public_key, akash_dseq, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;

        const cards: CardApp[] = ((data ?? []) as DeploymentRow[]).map((row) => ({
          deploymentId: row.id,
          name: row.app_name,
          description: row.description ?? "No description provided yet.",
          dockerImage: row.docker_image,
          status: mapStatus(row.status),
          tokenSymbol: tokenFromName(row.app_name),
          vaultBalance: 0,
          creator: formatCreator(row.solana_treasury_public_key),
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
    if (!supabaseEnvReady()) return;
    setCheckingId(deploymentId);
    setAppsError(null);
    try {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.functions.invoke("deployments-status", {
        body: { deployment_id: deploymentId },
      });
      if (error) throw new Error(error.message);
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
      <section className="relative overflow-hidden pt-20 pb-16">
        {/* Glowing orb */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-dock-400/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative">
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

            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6">
              <span className="glow-text">Ship apps.</span>
              <br />
              <span className="text-white">Launch tokens.</span>
              <br />
              <span className="text-slate-400 text-4xl sm:text-5xl lg:text-6xl">
                Self-fund hosting.
              </span>
            </h1>

            <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
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
      <section className="py-16 relative">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-2xl font-bold text-white mb-12">
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

          {/* Connector line */}
          <div className="hidden md:block relative h-px mt-[-88px] mb-[88px] mx-12">
            <div className="absolute inset-0 bg-gradient-to-r from-dock-400/0 via-dock-400/30 to-dock-400/0" />
          </div>
        </div>
      </section>

      {/* Stats */}
      <StatsBar />

      {/* App Store */}
      <section className="py-16 relative">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                <Waves className="w-6 h-6 text-dock-400" />
                Docked Apps
              </h2>
              <p className="text-sm text-slate-500 mt-1">
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

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
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
                Showing live deployments from Supabase.
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
