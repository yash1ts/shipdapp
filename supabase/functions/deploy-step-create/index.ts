/**
 * Step 2: Create Akash deployment, poll bids, create lease.
 * Then fires deploy-step-manifest (no wait). Returns when this step is done.
 */
import { createClient } from "@supabase/supabase-js";
import { createDeploymentAndLease } from "../_shared/akashOrchestrator.ts";
import { invokeNextStepNoWait } from "../_shared/invokeStep.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import { akashDepositUact } from "../_shared/akashBalance.ts";
import { buildStandardWebAppSdl } from "../_shared/sdl.ts";
import { akashEndpoints } from "../_shared/akashEndpoints.ts";

function log(level: "info" | "error", stage: string, details: Record<string, unknown>) {
  const fn = level === "error" ? console.error : console.log;
  fn(`[deploy-step-create][${stage}]`, JSON.stringify(details));
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

    const { data: appRow, error: appErr } = await supabase
      .from("app_deployments")
      .select("docker_image, port")
      .eq("id", deploymentId)
      .maybeSingle();
    if (appErr) throw appErr;
    if (!appRow) throw new Error("Deployment row not found");

    await supabase
      .from("deploy_workflow_runs")
      .update({
        phase: "CREATE_DEPLOY",
        phase_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    const port = typeof appRow.port === "number" && appRow.port > 0 ? appRow.port : 3000;
    const sdl = buildStandardWebAppSdl(appRow.docker_image as string, { internalPort: port });
    const endpoints = akashEndpoints();
    const depositUact = akashDepositUact().toString();
    const bidWindowMs = Number(Deno.env.get("AKASH_BID_WINDOW_MS") ?? "60000");
    const bidPollMs = Number(Deno.env.get("AKASH_BID_POLL_MS") ?? "3000");
    const minUptime =
      Deno.env.get("AKASH_RELAX_UPTIME") === "1"
        ? 0
        : Number(Deno.env.get("MIN_PROVIDER_UPTIME") ?? "0.99");

    const result = await createDeploymentAndLease({
      sdlYaml: sdl,
      mnemonic: hotMnemonic,
      endpoints,
      depositUact,
      bidWindowMs,
      bidPollMs,
      minProviderUptime: minUptime,
    });

    await supabase
      .from("deploy_workflow_runs")
      .update({
        phase: "LEASE_DONE",
        dseq: result.dseq,
        provider: result.provider,
        gseq: result.gseq,
        oseq: result.oseq,
        provider_host_uri: result.providerHostUri,
        warnings: result.warnings,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await supabase
      .from("app_deployments")
      .update({
        status: "DEPLOYING",
        akash_dseq: result.dseq,
        akash_provider: result.provider,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deploymentId);

    log("info", "lease_done", {
      runId,
      deploymentId,
      dseq: result.dseq,
      provider: result.provider,
    });

    invokeNextStepNoWait(supabaseUrl, serviceKey, "deploy-step-manifest", runId, deploymentId);

    return json({
      ok: true,
      phase: "LEASE_DONE",
      runId,
      deploymentId,
      dseq: result.dseq,
      next: "deploy-step-manifest_dispatched",
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
        last_error: `[create] ${msg}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deploymentId)
      .eq("status", "DEPLOYING");

    return json({ ok: false, error: msg, runId, deploymentId }, 500);
  }
});
