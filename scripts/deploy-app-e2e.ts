/**
 * End-to-end local run of the Cloudflare `DeployAppWorkflow`: cert → create+lease → manifest.
 *
 * Equivalent to calling `env.DEPLOY_APP_WORKFLOW.create(...)` on the worker, but executes all three
 * phases in-process via Deno. Uses the same orchestrator helpers the worker uses; mTLS to the
 * Akash provider is tunneled through `Deno.createHttpClient({ cert, key })` instead of the
 * Cloudflare `mtls_certificates` binding.
 *
 * From repo root:
 *
 *   export AKASH_HOT_MNEMONIC="twelve words …"
 *   deno run -A -c scripts/deno.json scripts/deploy-app-e2e.ts \
 *     --image ghcr.io/org/app:latest \
 *     --bundle ./akash-mtls-fresh/mtls-bundle.pem
 *
 * Flags:
 *   --image <docker-image>      (required)
 *   --port <N>                  container port; default 3000 (matches DB default)
 *   --bundle <path>             PEM bundle (cert + EC private key + EC public key)
 *     OR
 *   --cert <path> --key <path> --pubkey <path>
 *   --skip-cert                 skip the ensureCertOnChain phase (cert already registered)
 *   --json                      print final result as one JSON line
 *
 * Env (same names the worker reads; see cloudflare-backend/src/_shared/env.ts):
 *   AKASH_HOT_MNEMONIC          (required)
 *   AKASH_MANIFEST_NETWORK      default sandbox-2
 *   AKASH_RPC_URL, AKASH_GRPC_URL, AKASH_REST_URL
 *   AKASH_DEPOSIT_UACT          default 5_000_000
 *   AKASH_BID_WINDOW_MS         default 60000
 *   AKASH_BID_POLL_MS           default 1500 (shorter than worker's 3000 for faster local runs)
 *   AKASH_MIN_PROVIDER_UPTIME   default 0 (relaxed for sandbox; worker defaults 0.99)
 *   AKASH_MANIFEST_RETRY_MAX    default 5
 *   AKASH_MANIFEST_RETRY_DELAY_MS default 5000
 *   AKASH_CERT_WAIT_MS          default 180000
 */

import { akashEndpoints } from "../cloudflare-backend/src/_shared/akashEndpoints.ts";
import { akashDepositUact } from "../cloudflare-backend/src/_shared/akashBalance.ts";
import { buildStandardWebAppSdl } from "../cloudflare-backend/src/_shared/sdl.ts";
import { chainSdkManifestNetworkFromEnv } from "../cloudflare-backend/src/_shared/manifestNetworkFromEnv.ts";
import {
	createDeploymentAndLease,
	ensureCertOnChain,
	parseMtlsPemBundleText,
	sendManifestAndVerify,
	type AkashNetworkId,
} from "../cloudflare-backend/src/_shared/akashOrchestrator.ts";
import { buildScriptEnv, createDenoMtlsFetcher, setEnvPems } from "./_shared/denoEnv.ts";

function usage(): void {
	console.log(`
Usage:
  deno run -A -c scripts/deno.json scripts/deploy-app-e2e.ts \\
    --image <docker-image> [--port N] \\
    (--bundle <path> | --cert <path> --key <path> --pubkey <path>) \\
    [--skip-cert] [--json]

Env:
  AKASH_HOT_MNEMONIC (required) — hot-wallet mnemonic, same as worker
`);
}

type Args = {
	image?: string;
	port: number;
	bundle?: string;
	cert?: string;
	key?: string;
	pubkey?: string;
	skipCert: boolean;
	json: boolean;
};

function parseArgs(): Args {
	const out: Args = { port: 3000, skipCert: false, json: false };
	const a = Deno.args;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		if (x === "--help" || x === "-h") {
			usage();
			Deno.exit(0);
		} else if (x === "--image") out.image = a[++i];
		else if (x === "--port") out.port = Math.max(1, Number(a[++i]) || 3000);
		else if (x === "--bundle") out.bundle = a[++i];
		else if (x === "--cert") out.cert = a[++i];
		else if (x === "--key") out.key = a[++i];
		else if (x === "--pubkey") out.pubkey = a[++i];
		else if (x === "--skip-cert") out.skipCert = true;
		else if (x === "--json") out.json = true;
	}
	return out;
}

async function readText(path: string): Promise<string> {
	return (await Deno.readTextFile(path)).trim();
}

async function main(): Promise<void> {
	const args = parseArgs();
	if (!args.image?.trim()) {
		console.error("Missing --image <docker-image>\n");
		usage();
		Deno.exit(1);
	}

	let pem: { cert: string; privateKey: string; publicKey: string } | null = null;
	if (args.bundle) {
		pem = parseMtlsPemBundleText(await readText(args.bundle));
	} else if (args.cert && args.key && args.pubkey) {
		pem = parseMtlsPemBundleText(
			[
				await readText(args.cert),
				await readText(args.key),
				await readText(args.pubkey),
			].join("\n"),
		);
	} else {
		console.error("Provide --bundle or --cert/--key/--pubkey.\n");
		usage();
		Deno.exit(1);
	}
	if (!pem || !pem.cert || !pem.privateKey || !pem.publicKey) {
		console.error("Could not parse PEM bundle; need CERTIFICATE + PRIVATE KEY + EC PUBLIC KEY.\n");
		Deno.exit(1);
	}

	const env = setEnvPems(buildScriptEnv(), pem);
	const endpoints = akashEndpoints(env);
	const manifestNetwork = chainSdkManifestNetworkFromEnv(env) as AkashNetworkId;
	const sdl = buildStandardWebAppSdl(args.image.trim(), { internalPort: args.port });

	const tTotal = performance.now();

	console.log("==================================================");
	console.log("Phase 1/3  ensure-cert-on-chain");
	console.log("==================================================");
	if (args.skipCert) {
		console.log("(--skip-cert passed; skipping cert phase)");
	} else {
		const t0 = performance.now();
		const cert = await ensureCertOnChain({
			env,
			endpoints,
			onProgress: (m) => console.log("[cert]", m),
		});
		console.log(`owner: ${cert.owner}`);
		console.log(`warnings: ${cert.warnings.length ? cert.warnings.join(" | ") : "(none)"}`);
		console.log(`elapsed_ms: ${Math.round(performance.now() - t0)}`);
	}

	console.log("\n==================================================");
	console.log("Phase 2/3  create-deployment-and-lease");
	console.log("==================================================");
	const depositUact = akashDepositUact(env).toString();
	const bidWindowMs = Number(env.AKASH_BID_WINDOW_MS ?? "60000");
	const bidPollMs = Number(env.AKASH_BID_POLL_MS ?? "1500");
	const minProviderUptime = Number(env.AKASH_MIN_PROVIDER_UPTIME ?? env.MIN_PROVIDER_UPTIME ?? "0");

	console.log("endpoints:", JSON.stringify(endpoints));
	console.log("depositUact:", depositUact, "bidWindowMs:", bidWindowMs, "minProviderUptime:", minProviderUptime);

	const tLease = performance.now();
	const lease = await createDeploymentAndLease({
		env,
		endpoints,
		sdlYaml: sdl,
		depositUact,
		bidWindowMs,
		bidPollMs,
		minProviderUptime,
	});
	console.log(`dseq: ${lease.dseq}  provider: ${lease.provider}`);
	console.log(`gseq: ${lease.gseq}  oseq: ${lease.oseq}`);
	console.log(`providerHostUri: ${lease.providerHostUri}`);
	console.log(`warnings: ${lease.warnings.length ? lease.warnings.join(" | ") : "(none)"}`);
	console.log(`elapsed_ms: ${Math.round(performance.now() - tLease)}`);

	console.log("\n==================================================");
	console.log("Phase 3/3  send-manifest-and-verify");
	console.log("==================================================");
	const { mtlsFetcher, close } = createDenoMtlsFetcher(pem.cert, pem.privateKey);
	const tManifest = performance.now();
	let manifest;
	try {
		manifest = await sendManifestAndVerify({
			env,
			mtlsFetcher,
			sdlYaml: sdl,
			manifestNetwork,
			dseq: lease.dseq,
			providerHostUri: lease.providerHostUri,
			gseq: lease.gseq,
			oseq: lease.oseq,
		});
	} finally {
		close();
	}
	console.log(`manifestSent: ${manifest.manifestSent}`);
	console.log(`forwardedPorts: ${JSON.stringify(manifest.forwardedPorts ?? null)}`);
	console.log(`warnings: ${manifest.warnings.length ? manifest.warnings.join(" | ") : "(none)"}`);
	console.log(`elapsed_ms: ${Math.round(performance.now() - tManifest)}`);

	const totalMs = Math.round(performance.now() - tTotal);
	console.log(`\nTOTAL elapsed_ms: ${totalMs}`);

	if (args.json) {
		console.log(
			"\n" +
				JSON.stringify({
					dseq: lease.dseq,
					provider: lease.provider,
					gseq: lease.gseq,
					oseq: lease.oseq,
					providerHostUri: lease.providerHostUri,
					manifestSent: manifest.manifestSent,
					forwardedPorts: manifest.forwardedPorts ?? null,
					warnings: [...lease.warnings, ...manifest.warnings],
					elapsed_ms: totalMs,
				}),
		);
	}

	Deno.exit(manifest.manifestSent ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	Deno.exit(1);
});
