/**
 * Read-only status check for app_deployments.
 * POST JSON: { deployment_id: string }
 *
 * Reports: SOL gatekeeper status, deployment state, and escrow health.
 */
import { createClient } from "@supabase/supabase-js";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { corsHeadersFor } from "../_shared/cors.ts";
import { fetchEscrowBalanceUact } from "../_shared/akashBalance.ts";

const SOL_GATE_LAMPORTS = BigInt(Math.floor(0.1 * LAMPORTS_PER_SOL));

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const solRpc = Deno.env.get("SOLANA_RPC_URL")?.trim();
    if (!supabaseUrl || !serviceKey) {
      return json(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        500,
      );
    }

    const body = (await req.json()) as { deployment_id?: string };
    const id = body.deployment_id?.trim();
    if (!id || !isUuid(id)) {
      return json({ error: "deployment_id must be a valid UUID" }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: row, error } = await supabase
      .from("app_deployments")
      .select(
        "id, status, app_name, docker_image, port, solana_treasury_public_key, akash_dseq, akash_provider, akash_chain_result, last_error, deploy_attempt_count"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!row) return json({ error: "Deployment not found" }, 404);

    // Latest workflow run progress
    const { data: latestRun } = await supabase
      .from("deploy_workflow_runs")
      .select("id, attempt, phase, phase_started_at, manifest_claimed_at, dseq, provider, gseq, oseq, provider_host_uri, warnings, error, created_at, updated_at")
      .eq("deployment_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // SOL gatekeeper
    let solBalanceLamports: string | null = null;
    let solGatePassed = false;
    if (solRpc) {
      try {
        const connection = new Connection(solRpc, "confirmed");
        const bal = BigInt(
          await connection.getBalance(
            new PublicKey(row.solana_treasury_public_key as string),
            "confirmed",
          ),
        );
        solBalanceLamports = bal.toString();
        solGatePassed = bal >= SOL_GATE_LAMPORTS;
      } catch {
        solBalanceLamports = null;
      }
    }

    // Escrow health (only if deployed)
    let escrowBalanceUact: string | null = null;
    let escrowError: string | null = null;
    const dseq = (row.akash_dseq as string | null)?.trim();
    if (dseq) {
      const hotMnemonic = Deno.env.get("AKASH_HOT_MNEMONIC")?.trim();
      if (hotMnemonic) {
        try {
          const hotWallet = await DirectSecp256k1HdWallet.fromMnemonic(
            hotMnemonic,
            { prefix: "akash" },
          );
          const [hotAcc] = await hotWallet.getAccounts();
          const bal = await fetchEscrowBalanceUact(hotAcc.address, dseq);
          escrowBalanceUact = bal.toString();
        } catch (e) {
          escrowError = e instanceof Error ? e.message : String(e);
        }
      }
    }

    return json({
      deploymentId: row.id,
      status: row.status,
      appName: row.app_name,
      dockerImage: row.docker_image,
      port: row.port,
      userWalletAddress: row.solana_treasury_public_key,
      solBalanceLamports,
      solGatePassed,
      solGateLamports: SOL_GATE_LAMPORTS.toString(),
      akashDseq: row.akash_dseq,
      akashProvider: row.akash_provider,
      deployAttemptCount: row.deploy_attempt_count,
      escrowBalanceUact,
      escrowError,
      chainResult: row.akash_chain_result,
      lastError: row.last_error,
      workflowRun: latestRun
        ? {
            runId: latestRun.id,
            attempt: latestRun.attempt,
            phase: latestRun.phase,
            phaseStartedAt: latestRun.phase_started_at,
            manifestClaimedAt: latestRun.manifest_claimed_at,
            dseq: latestRun.dseq,
            provider: latestRun.provider,
            warnings: latestRun.warnings,
            error: latestRun.error,
            createdAt: latestRun.created_at,
            updatedAt: latestRun.updated_at,
          }
        : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[deployments-status]", msg);
    return json({ error: msg }, 500);
  }
});
