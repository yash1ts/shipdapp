/**
 * Step 1: Ensure mTLS certificate is on-chain.
 * Persists owner + PEMs to deploy_workflow_runs, then fires deploy-step-create (no wait).
 * Returns when this step's work is finished; the runtime exits after respondWith.
 *
 * 504 / gateway timeout: Supabase limits wall-clock time *per invocation*.
 * Not awaiting the next function only removes that wait from your code path — it does not
 * shorten `ensureCertOnChain` (RPC, cert wait, etc.). Tune AKASH_CERT_WAIT_MS or split work if needed.
 */
import { createClient } from "@supabase/supabase-js";
import { ensureCertOnChain } from "../_shared/akashOrchestrator.ts";
import { invokeNextStepNoWait } from "../_shared/invokeStep.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import { akashEndpoints } from "../_shared/akashEndpoints.ts";

function log(level: "info" | "error", stage: string, details: Record<string, unknown>) {
  const fn = level === "error" ? console.error : console.log;
  fn(`[deploy-step-cert][${stage}]`, JSON.stringify(details));
}

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hotMnemonic = Deno.env.get("AKASH_HOT_MNEMONIC")?.trim();
  if (!supabaseUrl || !serviceKey || !hotMnemonic) {
    return json({ error: "Missing required env vars" }, 500);
  }

  const body = (await req.json().catch(() => ({}))) as {
    run_id?: string;
    deployment_id?: string;
  };
  const runId = body.run_id?.trim();
  const deploymentId = body.deployment_id?.trim();
  if (!runId || !deploymentId) {
    return json({ error: "run_id and deployment_id required" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    log("info", "start", { runId, deploymentId });

    await supabase
      .from("app_deployments")
      .update({
        status: "DEPLOYING",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deploymentId);

    await supabase
      .from("deploy_workflow_runs")
      .update({
        phase: "CERT",
        phase_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    const endpoints = akashEndpoints();
    const result = await ensureCertOnChain({ mnemonic: hotMnemonic, endpoints });

    await supabase
      .from("deploy_workflow_runs")
      .update({
        phase: "CERT_DONE",
        akash_owner: result.owner,
        tls_cert_pem: result.tlsCertPem,
        tls_key_pem: result.tlsKeyPem,
        warnings: result.warnings,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    log("info", "cert_done", {
      runId,
      deploymentId,
      owner: result.owner,
      warningCount: result.warnings.length,
    });

    invokeNextStepNoWait(supabaseUrl, serviceKey, "deploy-step-create", runId, deploymentId);

    return json({
      ok: true,
      phase: "CERT_DONE",
      runId,
      deploymentId,
      next: "deploy-step-create_dispatched",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", "failed", { runId, deploymentId, error: msg });

    await supabase
      .from("deploy_workflow_runs")
      .update({ phase: "FAILED", error: msg, updated_at: new Date().toISOString() })
      .eq("id", runId);

    await supabase
      .from("app_deployments")
      .update({
        status: "FAILED",
        last_error: `[cert] ${msg}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deploymentId)
      .eq("status", "DEPLOYING");

    return json({ ok: false, error: msg, runId, deploymentId }, 500);
  }
});
