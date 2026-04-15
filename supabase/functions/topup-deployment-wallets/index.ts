/**
 * Unified cron handler: AKT Hot Wallet as central bank.
 *
 * Runs every minute via pg_cron. For every app in PENDING_FUNDS, FAILED, or ACTIVE:
 * 1. Gatekeeper — user Solana wallet balance >= 0.1 SOL or skip.
 * 2. PENDING_FUNDS → set DEPLOYING, insert run row, call deploy-step-cert.
 * 3. FAILED (deploy_attempt_count < MAX_DEPLOY_ATTEMPTS) → set DEPLOYING, insert run row, restart chain.
 * 4. ACTIVE + has DSEQ → check escrow; top up if low.
 *
 * DEPLOYING rows are only touched for stale recovery (mark FAILED for retry).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import {
  createChainNodeSDK,
  createStargateClient,
} from "@akashnetwork/chain-sdk";
import { corsHeadersFor } from "../_shared/cors.ts";
import { akashDepositUact, fetchEscrowBalanceUact } from "../_shared/akashBalance.ts";
import { invokeNextStepNoWait } from "../_shared/invokeStep.ts";
import { akashEndpoints } from "../_shared/akashEndpoints.ts";

const SOL_GATE_LAMPORTS = BigInt(Math.floor(0.1 * LAMPORTS_PER_SOL));
const ESCROW_LOW_UACT = 2_000_000n;
const TOPUP_DEPOSIT_UACT = "2000000";
const MAX_PER_RUN = 40;
/** No new workflow run when deploy_attempt_count >= this (default 3). Override with MAX_DEPLOY_ATTEMPTS. */
const MAX_DEPLOY_ATTEMPTS = Number(Deno.env.get("MAX_DEPLOY_ATTEMPTS") ?? "3");
const DEPLOYING_STALE_MS = Number(Deno.env.get("DEPLOYING_STALE_MS") ?? "600000");

/** `akash.escrow.id.v1.Scope.deployment` — deployment escrow account. */
const ESCROW_SCOPE_DEPLOYMENT = 1;
/** `akash.base.deposit.v1.Source.balance` — pay from signer bank balance. */
const DEPOSIT_SOURCE_BALANCE = 1;

function logFailure(stage: string, details: Record<string, unknown>) {
  console.error(`[topup-deployment-wallets][${stage}]`, JSON.stringify(details));
}

function logInfo(stage: string, details: Record<string, unknown>) {
  console.log(`[topup-deployment-wallets][${stage}]`, JSON.stringify(details));
}

/**
 * Insert a new run row and kick off the step chain.
 */
async function startDeployChain(
  supabase: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  deploymentId: string,
  attempt: number,
): Promise<{ ok: boolean; runId?: string; error?: string }> {
  const { data: run, error: insertErr } = await supabase
    .from("deploy_workflow_runs")
    .insert({
      deployment_id: deploymentId,
      attempt,
      phase: "CERT",
    })
    .select("id")
    .single();

  if (insertErr || !run) {
    return { ok: false, error: insertErr?.message ?? "Failed to insert run row" };
  }

  const runId = run.id as string;
  invokeNextStepNoWait(supabaseUrl, serviceKey, "deploy-step-cert", runId, deploymentId);

  return { ok: true, runId };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const solRpc = Deno.env.get("SOLANA_RPC_URL");
    const hotMnemonic = Deno.env.get("AKASH_HOT_MNEMONIC")?.trim();

    if (!supabaseUrl || !serviceKey || !solRpc) {
      logFailure("startup", {
        error: "missing_required_env",
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceKey: Boolean(serviceKey),
        hasSolanaRpc: Boolean(solRpc),
      });
      return json({ error: "Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SOLANA_RPC_URL" }, 500);
    }
    if (!hotMnemonic) {
      logFailure("startup", { error: "missing_akash_hot_mnemonic" });
      return json({ error: "AKASH_HOT_MNEMONIC not configured" }, 500);
    }

    const hotWallet = await DirectSecp256k1HdWallet.fromMnemonic(hotMnemonic, { prefix: "akash" });
    const [hotAcc] = await hotWallet.getAccounts();
    const hotAddr = hotAcc.address;

    const supabase = createClient(supabaseUrl, serviceKey);
    const connection = new Connection(solRpc, "confirmed");

    // Fetch DEPLOYING as well, but only for stale recovery (never re-trigger directly).
    const { data: apps, error } = await supabase
      .from("app_deployments")
      .select(
        "id, status, docker_image, port, solana_treasury_public_key, akash_dseq, deploy_attempt_count, updated_at",
      )
      .in("status", ["PENDING_FUNDS", "FAILED", "DEPLOYING", "ACTIVE"])
      .order("created_at", { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) throw error;
    if (!apps?.length) {
      logInfo("run_empty", { processed: 0 });
      return json({ ok: true, processed: 0, results: [] });
    }
    logInfo("run_start", {
      totalCandidates: apps.length,
      statuses: apps.map((a) => ({ id: a.id, status: a.status })),
    });

    let chainSdk: ReturnType<typeof createChainNodeSDK> | null = null;
    function getChainSdk() {
      if (chainSdk) return chainSdk;
      const ep = akashEndpoints();
      const gasPrice = Deno.env.get("AKASH_GAS_PRICE")?.trim() || "0.025uakt";
      const signer = createStargateClient({
        baseUrl: ep.rpcUrl,
        signer: hotWallet,
        defaultGasPrice: gasPrice,
      });
      chainSdk = createChainNodeSDK({
        query: {
          baseUrl: ep.grpcUrl,
          transportOptions: { retry: { maxAttempts: 4, maxDelayMs: 8_000 } },
        },
        tx: { signer },
      });
      return chainSdk;
    }

    const results: Record<string, unknown>[] = [];

    for (const app of apps) {
      const result: Record<string, unknown> = {
        deploymentId: app.id,
        status: app.status,
      };
      const deploymentId = app.id as string;
      const attemptCount = Number(app.deploy_attempt_count ?? 0);

      logInfo("app_start", {
        deploymentId,
        status: app.status,
        attemptCount,
        hasDseq: Boolean((app.akash_dseq as string | null)?.trim()),
      });

      // ---- DEPLOYING: do not retrigger; only stale recovery ----
      if (app.status === "DEPLOYING") {
        const updatedAtMs = Date.parse(String(app.updated_at ?? ""));
        const stale = Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > DEPLOYING_STALE_MS;
        if (!stale) {
          result.action = "deploying_in_progress";
          results.push(result);
          continue;
        }

        await supabase
          .from("app_deployments")
          .update({
            status: "FAILED",
            last_error: "DEPLOYING stale timeout reached; marked FAILED for retry",
            updated_at: new Date().toISOString(),
          })
          .eq("id", deploymentId)
          .eq("status", "DEPLOYING");
        result.action = "deploying_stale_marked_failed";
        logFailure("deploying_stale", { deploymentId, updatedAt: app.updated_at });
        results.push(result);
        continue;
      }

      // ---- SOL gate ----
      try {
        const walletPk = new PublicKey(app.solana_treasury_public_key as string);
        const solBal = BigInt(await connection.getBalance(walletPk, "confirmed"));
        result.solBalanceLamports = solBal.toString();

        if (solBal < SOL_GATE_LAMPORTS) {
          result.action = "skipped";
          result.reason = "balance_below_0.1_sol";
          logInfo("sol_gate_skip", { deploymentId, solBalanceLamports: solBal.toString() });
          results.push(result);
          continue;
        }
        logInfo("sol_gate_pass", { deploymentId, solBalanceLamports: solBal.toString() });
      } catch (e) {
        result.action = "skipped";
        result.reason = "sol_balance_error";
        result.error = e instanceof Error ? e.message : String(e);
        logFailure("sol_balance_error", { deploymentId, error: result.error });
        results.push(result);
        continue;
      }

      // ---- PENDING_FUNDS: start new deploy chain ----
      if (app.status === "PENDING_FUNDS") {
        if (attemptCount >= MAX_DEPLOY_ATTEMPTS) {
          result.action = "skipped";
          result.reason = "deploy_attempt_count_at_cap";
          result.attemptCount = attemptCount;
          logInfo("pending_skip_max_attempts", { deploymentId, attemptCount, max: MAX_DEPLOY_ATTEMPTS });
          results.push(result);
          continue;
        }

        const { data: locked, error: lockErr } = await supabase
          .from("app_deployments")
          .update({
            status: "DEPLOYING",
            deploy_attempt_count: 1,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", deploymentId)
          .eq("status", "PENDING_FUNDS")
          .select("id")
          .maybeSingle();

        if (lockErr || !locked) {
          logFailure("deploy_lock_error", { deploymentId, error: lockErr?.message ?? "row not locked" });
          result.action = "deploy_lock_failed";
          results.push(result);
          continue;
        }

        const chain = await startDeployChain(supabase, supabaseUrl, serviceKey, deploymentId, 1);
        result.action = chain.ok ? "chain_started" : "chain_start_failed";
        result.runId = chain.runId;
        if (!chain.ok) {
          logFailure("chain_start_failed", { deploymentId, error: chain.error });
        } else {
          logInfo("chain_started", { deploymentId, runId: chain.runId });
        }
        results.push(result);
        continue;
      }

      // ---- FAILED: restart chain if under max attempts ----
      if (app.status === "FAILED") {
        if (attemptCount >= MAX_DEPLOY_ATTEMPTS) {
          result.action = "max_attempts_reached";
          logInfo("max_attempts_reached", { deploymentId, attemptCount });
          results.push(result);
          continue;
        }

        const nextAttempt = attemptCount + 1;
        const { data: locked, error: lockErr } = await supabase
          .from("app_deployments")
          .update({
            status: "DEPLOYING",
            deploy_attempt_count: nextAttempt,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", deploymentId)
          .eq("status", "FAILED")
          .select("id")
          .maybeSingle();

        if (lockErr || !locked) {
          logFailure("retry_lock_error", { deploymentId, error: lockErr?.message ?? "row not locked" });
          result.action = "retry_lock_failed";
          results.push(result);
          continue;
        }

        const chain = await startDeployChain(supabase, supabaseUrl, serviceKey, deploymentId, nextAttempt);
        result.action = chain.ok ? "chain_restarted" : "chain_restart_failed";
        result.runId = chain.runId;
        result.attempt = nextAttempt;
        if (!chain.ok) {
          logFailure("chain_restart_failed", { deploymentId, error: chain.error, attempt: nextAttempt });
        } else {
          logInfo("chain_restarted", { deploymentId, runId: chain.runId, attempt: nextAttempt });
        }
        results.push(result);
        continue;
      }

      // ---- ACTIVE: escrow check / top-up ----
      if (app.status === "ACTIVE") {
        const dseq = (app.akash_dseq as string | null)?.trim();
        if (!dseq) {
          result.action = "active_no_dseq";
          results.push(result);
          continue;
        }

        try {
          const escrowBal = await fetchEscrowBalanceUact(hotAddr, dseq);
          result.escrowBalanceUact = escrowBal.toString();

          if (escrowBal >= ESCROW_LOW_UACT) {
            result.action = "escrow_healthy";
            logInfo("escrow_healthy", { deploymentId, dseq, escrowBalanceUact: escrowBal.toString() });
          } else {
            const sdk = getChainSdk();
            await sdk.akash.escrow.v1.accountDeposit({
              signer: hotAddr,
              id: {
                scope: ESCROW_SCOPE_DEPLOYMENT,
                xid: `${hotAddr}/${dseq}`,
              },
              deposit: {
                amount: { denom: "uact", amount: TOPUP_DEPOSIT_UACT },
                sources: [DEPOSIT_SOURCE_BALANCE],
              },
            });
            result.action = "escrow_topped_up";
            result.depositUact = TOPUP_DEPOSIT_UACT;
            logInfo("escrow_topped_up", { deploymentId, dseq, depositUact: TOPUP_DEPOSIT_UACT });
          }
        } catch (e) {
          result.action = "escrow_error";
          result.error = e instanceof Error ? e.message : String(e);
          logFailure("escrow_error", { deploymentId, dseq, error: result.error });
        }

        results.push(result);
        continue;
      }

      results.push(result);
    }

    logInfo("run_done", {
      processed: results.length,
      counts: results.reduce<Record<string, number>>((acc, r) => {
        const action = String((r as { action?: unknown }).action ?? "unknown");
        acc[action] = (acc[action] ?? 0) + 1;
        return acc;
      }, {}),
    });
    return json({ ok: true, processed: results.length, hotWallet: hotAddr, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[topup-deployment-wallets]", msg);
    return json({ error: msg }, 500);
  }
});
