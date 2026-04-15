"use client";

import { useState } from "react";
import {
  Ship,
  Container,
  Rocket,
  FileCode,
  Info,
  CheckCircle2,
  Loader2,
  Anchor,
  Wallet,
  Copy,
  RefreshCw,
} from "lucide-react";
import {
  getBrowserSupabase,
  supabaseEnvReady,
} from "@/lib/supabase-browser";

type FlowStep =
  | "details"
  | "init_loading"
  | "awaiting_funds"
  | "done"
  | "error";

type InitResponse = {
  deploymentId: string;
  fundingAddress: string;
  port: number;
  minSolGate: number;
  minSolGateLamports: string;
  note?: string;
};

type StatusPayload = {
  error?: string;
  status?: string;
  akashDseq?: string | null;
  akashProvider?: string | null;
  solBalanceLamports?: string | null;
  solGatePassed?: boolean;
  escrowBalanceUact?: string | null;
  lastError?: string | null;
};

export default function LaunchPage() {
  const [step, setStep] = useState<FlowStep>("details");
  const [form, setForm] = useState({
    name: "",
    description: "",
    dockerImage: "",
    port: "3000",
  });
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [fundingAddress, setFundingAddress] = useState<string | null>(null);
  const [minSol, setMinSol] = useState("0.1");
  const [handshakeNote, setHandshakeNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneSummary, setDoneSummary] = useState<{
    akashDeploymentId: string | null;
    dseq?: string;
  } | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const checkDeploymentStatus = async () => {
    if (!deploymentId || !supabaseEnvReady()) return;
    setStatusBusy(true);
    setStatusHint(null);
    setErrorMsg(null);
    try {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.functions.invoke(
        "deployments-status",
        { body: { deployment_id: deploymentId } }
      );
      if (error) throw new Error(error.message);
      const st = data as StatusPayload;
      if (st?.error) throw new Error(st.error);

      const s = st.status ?? "";
      if (s === "ACTIVE") {
        const dseq = st.akashDseq ?? undefined;
        setDoneSummary({
          akashDeploymentId: dseq ? `akash-${dseq}` : null,
          dseq: dseq ?? undefined,
        });
        setStep("done");
        return;
      }
      if (s === "DEPLOYING") {
        setStatusHint(
          "Deploy is in progress on Akash. Check again in a minute."
        );
        return;
      }
      if (s === "FAILED") {
        setErrorMsg(st.lastError ?? "Deployment failed");
        setStep("error");
        return;
      }

      const gate = st.solGatePassed
        ? "SOL gate passed — deploying on next cron cycle."
        : `Waiting for >= ${minSol} SOL at the funding address.`;
      setStatusHint(
        `Still PENDING_FUNDS. ${gate} The cron runs every minute.`
      );
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    } finally {
      setStatusBusy(false);
    }
  };

  const handleInit = async () => {
    if (!supabaseEnvReady()) {
      setErrorMsg(
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY for Launch."
      );
      setStep("error");
      return;
    }
    setErrorMsg(null);
    setStatusHint(null);
    setStep("init_loading");
    try {
      const port = Number(form.port) || 3000;
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.functions.invoke(
        "deployments-init",
        {
          body: {
            appName: form.name.trim(),
            description: form.description.trim(),
            dockerImage: form.dockerImage.trim(),
            port,
          },
        }
      );
      if (error) throw new Error(error.message);
      const init = data as InitResponse & { error?: string };
      if (init?.error) throw new Error(init.error);
      if (!init?.deploymentId) throw new Error("Init failed");

      setDeploymentId(init.deploymentId);
      setFundingAddress(init.fundingAddress);
      setMinSol(String(init.minSolGate ?? "0.1"));
      setHandshakeNote(init.note ?? null);
      setStep("awaiting_funds");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  };

  const canStart = form.name.trim() && form.dockerImage.trim() && form.description.trim();

  const qrUrl = (text: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(text)}`;

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-16 relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-dock-400/8 rounded-full blur-[100px] pointer-events-none" />

      <div className="text-center mb-12 relative">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-dock-400 to-dock-600 shadow-dock-lg mb-6">
          <Ship className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3">
          Ship a New <span className="glow-text">Container</span>
        </h1>
        <p className="text-slate-400 max-w-lg mx-auto">
          Fund your app&apos;s wallet with 0.1 SOL and the platform handles the
          rest. Deploys automatically on Akash via the AKT Hot Wallet.
        </p>
      </div>

      {step === "details" && (
        <div className="container-card p-8 relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-dock-400/5 rounded-bl-[80px] pointer-events-none" />

          <div className="space-y-6 relative">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Anchor className="w-4 h-4 text-dock-400" />
                App Name
              </label>
              <input
                className="input-dock"
                placeholder="my-awesome-app"
                maxLength={50}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <p className="text-xs text-slate-600 mt-1">
                {form.name.length}/50
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <FileCode className="w-4 h-4 text-dock-400" />
                Description
              </label>
              <textarea
                className="input-dock min-h-[80px] resize-none"
                placeholder="What does your app do?"
                maxLength={200}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
              <p className="text-xs text-slate-600 mt-1">
                {form.description.length}/200
              </p>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Container className="w-4 h-4 text-dock-400" />
                Docker Image URI
              </label>
              <input
                className="input-dock font-mono text-sm"
                placeholder="ghcr.io/username/app:latest"
                maxLength={300}
                value={form.dockerImage}
                onChange={(e) =>
                  setForm({ ...form, dockerImage: e.target.value })
                }
              />
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                <Rocket className="w-4 h-4 text-dock-400" />
                Container port (SDL &rarr; host 80)
              </label>
              <input
                className="input-dock w-32"
                type="number"
                placeholder="3000"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </div>

            <div className="rounded-lg border border-dock-400/10 bg-dock-400/5 p-4 flex gap-3">
              <Info className="w-5 h-5 text-dock-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-400 space-y-1 text-left">
                <p>
                  <strong className="text-slate-300">How it works</strong>
                </p>
                <ol className="list-decimal list-inside space-y-0.5 text-xs">
                  <li>
                    We generate a dedicated{" "}
                    <strong className="text-slate-300">funding wallet</strong>{" "}
                    for your app.
                  </li>
                  <li>
                    Send{" "}
                    <strong className="text-slate-300">&ge; 0.1 SOL</strong>{" "}
                    (devnet) to activate it &mdash; that&apos;s the on/off switch.
                  </li>
                  <li>
                    The <strong className="text-slate-300">AKT Hot Wallet</strong>{" "}
                    pays for Akash deployment &mdash; you don&apos;t need AKT.
                  </li>
                  <li>
                    A cron runs every minute: checks the funding balance, deploys
                    when ready, and tops up escrow automatically.
                  </li>
                </ol>
              </div>
            </div>

            <button
              className="btn-dock w-full justify-center text-base py-3.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:transform-none disabled:hover:shadow-none"
              disabled={!canStart}
              onClick={handleInit}
            >
              <Ship className="w-5 h-5" />
              Generate funding wallet
            </button>
          </div>
        </div>
      )}

      {step === "init_loading" && (
        <div className="container-card p-12 text-center">
          <Loader2 className="w-12 h-12 text-dock-400 animate-spin mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            Creating funding wallet&hellip;
          </h3>
          <p className="text-slate-400 text-sm">
            Generating a Solana keypair for your app.
          </p>
        </div>
      )}

      {step === "awaiting_funds" && fundingAddress && (
        <div className="container-card p-8 space-y-8">
          <div className="text-center">
            <h3 className="text-xl font-semibold text-white mb-1">
              Fund Your App
            </h3>
            <p className="text-slate-400 text-sm">
              Send <strong className="text-slate-300">{minSol} SOL</strong>{" "}
              (devnet) to the address below. The cron auto-deploys once funded.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-8 items-center justify-center">
            <div className="rounded-xl border border-white/[0.08] p-3 bg-black/20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl(fundingAddress)}
                alt="Funding wallet QR"
                width={180}
                height={180}
                className="rounded-lg"
              />
            </div>
            <div className="flex-1 space-y-4 text-left min-w-0">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-1">
                  <Wallet className="w-3 h-3" /> Funding wallet (SOL gate)
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs sm:text-sm text-dock-200 break-all flex-1">
                    {fundingAddress}
                  </code>
                  <button
                    type="button"
                    className="p-2 rounded-lg border border-white/10 hover:bg-white/5"
                    onClick={() => copyText(fundingAddress)}
                    aria-label="Copy funding address"
                  >
                    <Copy className="w-4 h-4 text-dock-400" />
                  </button>
                </div>
              </div>

              {handshakeNote && (
                <p className="text-xs text-amber-200/90 border border-amber-500/20 rounded-lg p-3">
                  {handshakeNote}
                </p>
              )}
              {statusHint && (
                <p className="text-xs text-slate-400 border border-white/10 rounded-lg p-3">
                  {statusHint}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <button
              type="button"
              className="btn-dock inline-flex items-center justify-center gap-2 disabled:opacity-50"
              disabled={statusBusy}
              onClick={() => void checkDeploymentStatus()}
            >
              {statusBusy ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5" />
              )}
              Check deployment status
            </button>
          </div>
        </div>
      )}

      {step === "done" && doneSummary && (
        <div className="container-card p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">Launched</h3>
          <p className="text-slate-400 text-sm mb-4">
            Akash deployment{" "}
            <code className="text-dock-300 text-xs break-all">
              {doneSummary.akashDeploymentId ?? "—"}
            </code>
            {doneSummary.dseq && (
              <>
                <br />
                <span className="text-slate-500">dseq</span>{" "}
                <code className="text-slate-300">{doneSummary.dseq}</code>
              </>
            )}
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <a href="/" className="btn-dock">
              App Store
            </a>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setStep("details");
                setDeploymentId(null);
                setFundingAddress(null);
                setDoneSummary(null);
                setStatusHint(null);
              }}
            >
              Ship another
            </button>
          </div>
        </div>
      )}

      {step === "error" && (
        <div className="container-card p-8 text-center border-red-500/30">
          <p className="text-red-300 text-sm mb-4">{errorMsg}</p>
          <button
            type="button"
            className="btn-dock"
            onClick={() => {
              setStep("details");
              setErrorMsg(null);
              setStatusHint(null);
            }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
