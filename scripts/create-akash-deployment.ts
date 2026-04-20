/**
 * Run the Cloudflare Workflow's `create-deployment-and-lease` step locally (Deno only — no CF
 * account needed). Calls `createDeploymentAndLease` from `cloudflare-backend/src/_shared/...`
 * with the same env tunables the worker uses.
 *
 * For the whole workflow (cert → create → manifest) in one go, use `scripts/deploy-app-e2e.ts`.
 *
 * From repo root:
 *
 *   export AKASH_HOT_MNEMONIC="twelve words …"
 *   deno run -A -c scripts/deno.json scripts/create-akash-deployment.ts \
 *     --image ghcr.io/org/app:latest
 *
 * Optional flags:
 *   --port 3000
 *   --json                    print one JSON line (dseq, provider, gseq, oseq, providerHostUri, warnings)
 *   --strict-uptime           match worker default: require provider uptime ≥ MIN_PROVIDER_UPTIME (default 0.99)
 *                             unless AKASH_RELAX_UPTIME=1. By default this CLI **does not** filter on uptime
 *                             so sandbox bids are easier to get.
 *
 * Env (same names as the worker):
 *   AKASH_MANIFEST_NETWORK (default sandbox-2), AKASH_RPC_URL, AKASH_GRPC_URL
 *   AKASH_DEPOSIT_UACT (or legacy AKASH_DEPOSIT_UAKT)
 *   AKASH_BID_WINDOW_MS (default 60000), AKASH_BID_POLL_MS (default 1500 for this CLI)
 *   AKASH_RELAX_UPTIME=1 or MIN_PROVIDER_UPTIME (default 0.99 unless relaxed)
 *   AKASH_EXCLUDE_PROVIDERS, AKASH_BID_STRATEGY (cheapest|random), AKASH_SKIP_CLOSE_ON_NO_BIDS=1
 */

import { createDeploymentAndLease } from "../cloudflare-backend/src/_shared/akashOrchestrator.ts";
import { akashEndpoints } from "../cloudflare-backend/src/_shared/akashEndpoints.ts";
import { buildStandardWebAppSdl } from "../cloudflare-backend/src/_shared/sdl.ts";
import { akashDepositUact } from "../cloudflare-backend/src/_shared/akashBalance.ts";
import { buildScriptEnv } from "./_shared/denoEnv.ts";

function usage(): void {
	console.log(`
Usage:
  deno run -A -c scripts/deno.json scripts/create-akash-deployment.ts --image <docker-image> [--port N] [--json] [--strict-uptime]

Env:
  AKASH_HOT_MNEMONIC (required)
`);
}

type Args = { image?: string; port: number; json: boolean; strictUptime: boolean };

function parseArgs(): Args {
	const out: Args = { port: 3000, json: false, strictUptime: false };
	const a = Deno.args;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		if (x === "--help" || x === "-h") {
			usage();
			Deno.exit(0);
		}
		if (x === "--image") out.image = a[++i];
		else if (x === "--port") out.port = Math.max(1, Number(a[++i]) || 3000);
		else if (x === "--json") out.json = true;
		else if (x === "--strict-uptime") out.strictUptime = true;
	}
	return out;
}

const args = parseArgs();
if (!args.image?.trim()) {
	console.error("Missing --image <docker-image>\n");
	usage();
	Deno.exit(1);
}

const env = buildScriptEnv();
const endpoints = akashEndpoints(env);
const sdl = buildStandardWebAppSdl(args.image.trim(), { internalPort: args.port });
const depositUact = akashDepositUact(env).toString();
const bidWindowMs = Number(env.AKASH_BID_WINDOW_MS ?? "60000");
/** Shorter default than the worker: time is mostly spent waiting between bid polls when no winner yet. */
const bidPollMs = Number(env.AKASH_BID_POLL_MS ?? "1500");
const minUptime = args.strictUptime
	? env.AKASH_RELAX_UPTIME === "1"
		? 0
		: Number(env.MIN_PROVIDER_UPTIME ?? "0.99")
	: 0;

console.log("endpoints:", JSON.stringify(endpoints));
console.log("depositUact:", depositUact, "bidWindowMs:", bidWindowMs, "minProviderUptime:", minUptime);

const t0 = performance.now();
const result = await createDeploymentAndLease({
	env,
	endpoints,
	sdlYaml: sdl,
	depositUact,
	bidWindowMs,
	bidPollMs,
	minProviderUptime: minUptime,
});
const ms = Math.round(performance.now() - t0);

if (args.json) {
	console.log(
		JSON.stringify({
			dseq: result.dseq,
			provider: result.provider,
			gseq: result.gseq,
			oseq: result.oseq,
			providerHostUri: result.providerHostUri,
			warnings: result.warnings,
			elapsed_ms: ms,
		}),
	);
} else {
	if (result.warnings.length) {
		console.log("warnings:", result.warnings.join(" | "));
	}
	console.log("provider:", result.provider);
	console.log("gseq:", result.gseq, "oseq:", result.oseq);
	console.log("providerHostUri:", result.providerHostUri);
	console.log("elapsed_ms:", ms);
	console.log("");
	console.log(result.dseq);
}

Deno.exit(0);
