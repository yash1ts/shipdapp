/**
 * Step 3 (final): Send manifest to provider + verify lease status.
 * On success → app_deployments.status = ACTIVE.
 * On failure → app_deployments.status = FAILED.
 *
 * Duplicate guard uses `manifest_claimed_at` only — `phase` stays LEASE_DONE
 * until COMPLETED or FAILED (no LEASE_DONE → MANIFEST flicker in the DB).
 */
import { createClient } from "@supabase/supabase-js";
import {
  mtlsClientPemFromEnv,
  sendManifestAndVerify,
  type AkashNetworkId,
} from "../_shared/akashOrchestrator.ts";
import { corsHeadersFor } from "../_shared/cors.ts";
import { buildStandardWebAppSdl } from "../_shared/sdl.ts";
import { formatUnknownError } from "../_shared/formatUnknownError.ts";
import { chainSdkManifestNetworkFromEnv } from "../_shared/manifestNetworkFromEnv.ts";

function log(level: "info" | "error", stage: string, details: Record<string, unknown>) {
  const fn = level === "error" ? console.error : console.log;
  fn(`[deploy-step-manifest][${stage}]`, JSON.stringify(details));
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
  if (!supabaseUrl || !serviceKey) {
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

    const { data: depRow, error: depErr } = await supabase
      .from("app_deployments")
      .select("status")
      .eq("id", deploymentId)
      .maybeSingle();
    if (depErr) throw depErr;
    if (depRow?.status === "ACTIVE") {
      log("info", "skip_already_active", { runId, deploymentId });
      return json({ ok: true, skipped: true, reason: "already_active", runId, deploymentId });
    }

    const { data: runPeek, error: peekErr } = await supabase
      .from("deploy_workflow_runs")
      .select("phase, manifest_claimed_at")
      .eq("id", runId)
      .maybeSingle();
    if (peekErr) throw peekErr;
    if (!runPeek) throw new Error("Workflow run row not found");
    if (runPeek.phase === "COMPLETED") {
      log("info", "skip_already_completed", { runId, deploymentId });
      return json({ ok: true, skipped: true, reason: "already_completed", runId, deploymentId });
    }

    const now = new Date().toISOString();
    // Single winner: set claim timestamp only; phase remains LEASE_DONE (or legacy MANIFEST/SEND_MANIFEST) until terminal.
    const { data: claimed, error: claimErr } = await supabase
      .from("deploy_workflow_runs")
      .update({
        manifest_claimed_at: now,
        updated_at: now,
      })
      .eq("id", runId)
      .is("manifest_claimed_at", null)
      .in("phase", ["LEASE_DONE", "SEND_MANIFEST", "MANIFEST"])
      .select("id")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      log("info", "skip_manifest_already_claimed_or_wrong_phase", {
        runId,
        deploymentId,
        currentPhase: runPeek.phase,
        hasClaim: Boolean(runPeek.manifest_claimed_at),
      });
      return json({
        ok: true,
        skipped: true,
        reason: "manifest_not_claimable",
        phase: runPeek.phase,
        runId,
        deploymentId,
      });
    }

    const { data: run, error: runErr } = await supabase
      .from("deploy_workflow_runs")
      .select("tls_cert_pem, tls_key_pem, dseq, provider, gseq, oseq, provider_host_uri, warnings")
      .eq("id", runId)
      .maybeSingle();
    if (runErr) throw runErr;
    if (!run) throw new Error("Workflow run row not found after claim");
    if (!run.dseq || !run.provider_host_uri || !run.tls_cert_pem || !run.tls_key_pem) {
      throw new Error("Run row missing required fields from previous steps");
    }

    const { data: appRow, error: appErr } = await supabase
      .from("app_deployments")
      .select("docker_image, port")
      .eq("id", deploymentId)
      .maybeSingle();
    if (appErr) throw appErr;
    if (!appRow) throw new Error("Deployment row not found");

    const { error: depTouchErr } = await supabase
      .from("app_deployments")
      .update({
        status: "DEPLOYING",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deploymentId);
    if (depTouchErr) throw depTouchErr;

    const port = typeof appRow.port === "number" && appRow.port > 0 ? appRow.port : 3000;
    const sdl = buildStandardWebAppSdl(appRow.docker_image as string, { internalPort: port });
    const manifestNetwork = chainSdkManifestNetworkFromEnv() as AkashNetworkId;

    const envTls = mtlsClientPemFromEnv();
    const tlsCertPem = envTls?.cert ?? (run.tls_cert_pem as string);
    const tlsKeyPem = envTls?.key ?? (run.tls_key_pem as string);
    if (envTls) {
      log("info", "mtls_from_env", { runId, deploymentId, source: "AKASH_MTLS_*" });
    }

    const result = await sendManifestAndVerify({
      sdlYaml: sdl,
      manifestNetwork,
      tlsCertPem,
      tlsKeyPem,
      dseq: run.dseq as string,
      providerHostUri: run.provider_host_uri as string,
      gseq: run.gseq as number,
      oseq: run.oseq as number,
    });

    const allWarnings = [...((run.warnings as string[]) ?? []), ...result.warnings];

    if (!result.manifestSent) {
      const warnText = allWarnings.length
        ? ` Warnings: ${allWarnings.join(" | ")}`
        : "";
      const errMsg = `Manifest not accepted by provider.${warnText}`;

      const { error: runFailErr } = await supabase
        .from("deploy_workflow_runs")
        .update({
          phase: "FAILED",
          error: errMsg,
          warnings: allWarnings,
          lease_status: result.leaseStatus ?? null,
          manifest_claimed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);
      if (runFailErr) log("error", "db_update_failed", { runId, error: runFailErr.message });

      const { error: appFailErr } = await supabase
        .from("app_deployments")
        .update({
          status: "FAILED",
          akash_dseq: run.dseq,
          akash_provider: run.provider,
          akash_chain_result: {
            manifestSent: false,
            warnings: allWarnings,
            forwardedPorts: result.forwardedPorts ?? null,
            leaseStatus: result.leaseStatus ?? null,
          },
          last_error: errMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deploymentId);
      if (appFailErr) log("error", "db_update_failed", { deploymentId, error: appFailErr.message });

      log("error", "manifest_not_sent", { runId, deploymentId, dseq: run.dseq });
      return json({
        ok: false,
        phase: "FAILED",
        reason: "manifest_not_sent",
        runId,
        deploymentId,
      }, 200);
    }

    const { error: runOkErr } = await supabase
      .from("deploy_workflow_runs")
      .update({
        phase: "COMPLETED",
        warnings: allWarnings,
        lease_status: result.leaseStatus ?? null,
        forwarded_ports: result.forwardedPorts ?? null,
        manifest_claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (runOkErr) log("error", "db_update_failed", { runId, error: runOkErr.message });

    const { error: appOkErr } = await supabase
      .from("app_deployments")
      .update({
        status: "ACTIVE",
        akash_dseq: run.dseq,
        akash_provider: run.provider,
        akash_chain_result: {
          manifestSent: true,
          warnings: allWarnings,
          forwardedPorts: result.forwardedPorts ?? null,
          leaseStatus: result.leaseStatus ?? null,
        },
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deploymentId);
    if (appOkErr) log("error", "db_update_failed", { deploymentId, error: appOkErr.message });

    log("info", "completed", {
      runId,
      deploymentId,
      dseq: run.dseq,
      provider: run.provider,
      manifestSent: true,
    });

    return json({
      ok: true,
      phase: "COMPLETED",
      runId,
      deploymentId,
      dseq: run.dseq,
    });
  } catch (e) {
    const msg = formatUnknownError(e);
    log("error", "failed", { runId, deploymentId, error: msg });

    const { error: runErr2 } = await supabase
      .from("deploy_workflow_runs")
      .update({
        phase: "FAILED",
        error: msg,
        manifest_claimed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (runErr2) log("error", "db_update_failed", { runId, error: runErr2.message });

    const { error: appErr2 } = await supabase
      .from("app_deployments")
      .update({
        status: "FAILED",
        last_error: `[manifest] ${msg}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deploymentId);
    if (appErr2) log("error", "db_update_failed", { deploymentId, error: appErr2.message });

    return json({ ok: false, error: msg, runId, deploymentId }, 500);
  }
});
