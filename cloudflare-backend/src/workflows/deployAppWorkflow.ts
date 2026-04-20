/**
 * Durable multi-step Akash deployment workflow.
 *
 * Replaces the previous 3× chained Edge Function handoff (cert → create → manifest). On Cloudflare
 * Workflows, each `step.do(...)` is automatically persisted + retried, so we don't need a separate
 * `deploy_workflow_runs` table for cross-invocation state.
 *
 * Step timing budgets (all in one workflow):
 *   - ensure-cert-on-chain: up to AKASH_CERT_WAIT_MS (default 180s)
 *   - create-deployment-and-lease: up to AKASH_BID_WINDOW_MS (default 60s) + tx broadcast
 *   - send-manifest-and-verify: up to AKASH_MANIFEST_RETRY_MAX × AKASH_MANIFEST_RETRY_DELAY_MS
 */

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { type Env } from "../_shared/env";
import { appDeployments } from "../db/schema";
import { akashEndpoints } from "../_shared/akashEndpoints";
import { akashDepositUact } from "../_shared/akashBalance";
import { buildStandardWebAppSdl } from "../_shared/sdl";
import { chainSdkManifestNetworkFromEnv } from "../_shared/manifestNetworkFromEnv";
import {
	createDeploymentAndLease,
	ensureCertOnChain,
	sendManifestAndVerify,
	type AkashNetworkId,
} from "../_shared/akashOrchestrator";

export type DeployAppParams = {
	deploymentId: string;
};

export type DeployAppResult = {
	deploymentId: string;
	owner: string;
	dseq: string;
	provider: string;
	manifestSent: boolean;
	warnings: string[];
};

export class DeployAppWorkflow extends WorkflowEntrypoint<Env, DeployAppParams> {
	async run(event: WorkflowEvent<DeployAppParams>, step: WorkflowStep): Promise<DeployAppResult> {
		const { deploymentId } = event.payload;
		const db = drizzle(this.env.DB);

		const deployment = await step.do("load-deployment", async () => {
			const [row] = await db
				.select({
					id: appDeployments.id,
					dockerImage: appDeployments.dockerImage,
					port: appDeployments.port,
				})
				.from(appDeployments)
				.where(eq(appDeployments.id, deploymentId));
			if (!row) throw new Error(`deployment ${deploymentId} not found`);
			return row;
		});

		const endpoints = akashEndpoints(this.env);

		const cert = await step.do(
			"ensure-cert-on-chain",
			{
				retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
				timeout: "10 minutes",
			},
			async () => {
				const res = await ensureCertOnChain({
					env: this.env,
					endpoints,
					onProgress: (m) => console.log(`[cert] ${m}`),
				});
				return { owner: res.owner, warnings: res.warnings };
			},
		);

		const sdl = buildStandardWebAppSdl(deployment.dockerImage, {
			internalPort: deployment.port,
		});

		const bidWindowMs = Number(this.env.AKASH_BID_WINDOW_MS ?? "60000");
		// 5s (vs. 3s) cuts bid-poll iterations from ~20 → ~12 in a 60s window — important because
		// every poll consumes a Workers subrequest, and the default budget is only 50 (free plan).
		const bidPollMs = Number(this.env.AKASH_BID_POLL_MS ?? "5000");
		const minProviderUptime =
			this.env.AKASH_RELAX_UPTIME === "1"
				? 0
				: Number(this.env.MIN_PROVIDER_UPTIME ?? "0.99");
		const depositUact = akashDepositUact(this.env).toString();

		const lease = await step.do(
			"create-deployment-and-lease",
			{
				retries: { limit: 2, delay: "15 seconds", backoff: "exponential" },
				timeout: "10 minutes",
			},
			async () => {
				return await createDeploymentAndLease({
					env: this.env,
					endpoints,
					sdlYaml: sdl,
					depositUact,
					bidWindowMs,
					bidPollMs,
					minProviderUptime,
				});
			},
		);

		await step.do("persist-lease", async () => {
			await db
				.update(appDeployments)
				.set({
					status: "DEPLOYING",
					akashDseq: lease.dseq,
					akashProvider: lease.provider,
					updatedAt: new Date(),
				})
				.where(eq(appDeployments.id, deploymentId));
		});

		const manifestNetwork = chainSdkManifestNetworkFromEnv(this.env) as AkashNetworkId;

		const manifest = await step.do(
			"send-manifest-and-verify",
			{
				retries: { limit: 5, delay: "5 seconds", backoff: "exponential" },
				timeout: "5 minutes",
			},
			async () => {
				return await sendManifestAndVerify({
					env: this.env,
					mtlsFetcher: this.env.AKASH_MTLS,
					sdlYaml: sdl,
					manifestNetwork,
					dseq: lease.dseq,
					providerHostUri: lease.providerHostUri,
					gseq: lease.gseq,
					oseq: lease.oseq,
				});
			},
		);

		const allWarnings = [...cert.warnings, ...lease.warnings, ...manifest.warnings];

		await step.do("finalize", async () => {
			await db
				.update(appDeployments)
				.set({
					status: manifest.manifestSent ? "ACTIVE" : "FAILED",
					akashDseq: lease.dseq,
					akashProvider: lease.provider,
					akashChainResult: {
						manifestSent: manifest.manifestSent,
						warnings: allWarnings,
						forwardedPorts: manifest.forwardedPorts ?? null,
						leaseStatus: manifest.leaseStatus ?? null,
					},
					lastError: manifest.manifestSent
						? null
						: `Manifest not accepted by provider. ${allWarnings.join(" | ")}`.slice(0, 2000),
					updatedAt: new Date(),
				})
				.where(eq(appDeployments.id, deploymentId));
		});

		// `sendManifestAndVerify` deliberately swallows mTLS 401s into `warnings[]` so that
		// Cloudflare Workflows doesn't burn its own step-level retry budget on an unrecoverable
		// cert-mismatch. But that means the workflow instance was silently marked "completed" in
		// the CF dashboard even though the manifest never reached the provider. Throw AFTER
		// `finalize` has persisted `status=FAILED` + `lastError`, so the DB is consistent and the
		// CF Workflows instance is surfaced as `errored` for observability. Workflow-level retries
		// don't exist in CF Workflows, so this throw will not re-run the entire pipeline.
		if (!manifest.manifestSent) {
			const has401 = allWarnings.some((w) => w.includes("Manifest mTLS HTTP 401"));
			if (has401) {
				throw new Error(
					`Manifest rejected by provider with persistent HTTP 401 (mTLS cert mismatch or stale lease) for deployment ${deploymentId}. See appDeployments.lastError.`,
				);
			}
		}

		return {
			deploymentId,
			owner: cert.owner,
			dseq: lease.dseq,
			provider: lease.provider,
			manifestSent: manifest.manifestSent,
			warnings: allWarnings,
		};
	}
}
