/**
 * Verify Akash mTLS certificate registration using local PEM files.
 *
 * Uses the same logic the Cloudflare Workflow's `ensure-cert-on-chain` step invokes
 * (`ensureCertOnChain` from `cloudflare-backend/src/_shared/akashOrchestrator.ts`). Run this before
 * deploying the worker to confirm your PEMs + hot-wallet mnemonic will pass the `cert` step.
 *
 * From repo root:
 *
 *   deno run -A -c scripts/deno.json scripts/check-akash-cert.ts \
 *     --cert ./path/to/cert.pem --key ./path/to/key.pem --pubkey ./path/to/pub.pem
 *
 * Or a single bundle file (cert + private key + public key PEMs concatenated):
 *
 *   deno run -A -c scripts/deno.json scripts/check-akash-cert.ts --bundle ./path/to/bundle.pem
 *
 * Required env:
 *   AKASH_HOT_MNEMONIC — same hot wallet secret you'll put into wrangler (`wrangler secret put AKASH_HOT_MNEMONIC`)
 *
 * Optional env (same names as the worker):
 *   AKASH_MANIFEST_NETWORK (default sandbox-2; also sandbox, testnet, mainnet)
 *   AKASH_RPC_URL, AKASH_GRPC_URL
 *   AKASH_CERT_WAIT_MS (default 180000), AKASH_CERT_POLL_MS (default 2000)
 *   AKASH_GAS_PRICE
 *
 * PEM shape (important): Akash expects **EC P-256 (secp256r1)** mTLS material. The **public**
 * PEM must use the same headers as `@akashnetwork/chain-sdk`'s `generatePEM`:
 * `-----BEGIN EC PUBLIC KEY-----` … `-----END EC PUBLIC KEY-----`.
 * The leaf cert **Subject CN** must be the hot wallet address in **all-lowercase** bech32
 * (`gen-akash-mtls-bundle.sh` enforces this); mixed-case CN causes createCertificate to fail on-chain.
 * Typical **RSA** `BEGIN PUBLIC KEY` / `BEGIN RSA PUBLIC KEY` files will fail on-chain with
 * `invalid pubkey value: invalid pem block type`.
 *
 * Exit code 0 only when no "hard" warnings (cert visible; create tx not a hard failure).
 */

import { ensureCertOnChain } from "../cloudflare-backend/src/_shared/akashOrchestrator.ts";
import { akashEndpoints } from "../cloudflare-backend/src/_shared/akashEndpoints.ts";
import { buildScriptEnv, setEnvPems } from "./_shared/denoEnv.ts";

function usage(): void {
	console.log(`
Usage:
  deno run -A -c scripts/deno.json scripts/check-akash-cert.ts \\
    --cert <cert.pem> --key <key.pem> --pubkey <pubkey.pem>

  deno run -A -c scripts/deno.json scripts/check-akash-cert.ts \\
    --bundle <combined.pem>

Env:
  AKASH_HOT_MNEMONIC   (required)
  AKASH_MANIFEST_NETWORK, AKASH_RPC_URL, AKASH_GRPC_URL, AKASH_CERT_WAIT_MS, … (optional)
`);
}

type Parsed = {
	cert?: string;
	key?: string;
	pubkey?: string;
	bundle?: string;
};

function parseArgs(): Parsed {
	const out: Parsed = {};
	const args = Deno.args;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--help" || a === "-h") {
			usage();
			Deno.exit(0);
		}
		if (a === "--cert") out.cert = args[++i];
		else if (a === "--key") out.key = args[++i];
		else if (a === "--pubkey") out.pubkey = args[++i];
		else if (a === "--bundle") out.bundle = args[++i];
	}
	return out;
}

async function readPem(path: string, label: string): Promise<string> {
	try {
		return (await Deno.readTextFile(path)).trim();
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		console.error(`Failed to read ${label} (${path}): ${msg}`);
		Deno.exit(1);
	}
}

/** Akash cert module matches chain-sdk: EC pubkey PEM uses BEGIN EC PUBLIC KEY, not RSA SPKI. */
function assertAkashCompatiblePubkeyPem(pubkey: string): void {
	const n = pubkey.replace(/\r/g, "").trim();
	if (n.includes("BEGIN EC PUBLIC KEY")) return;
	if (n.includes("BEGIN RSA PUBLIC KEY") || n.includes("BEGIN RSA PRIVATE KEY")) {
		console.error(`
Public key / key material looks **RSA**. Akash mTLS here must be **EC P-256 (prime256v1 / secp256r1)**,
same as certificateManager.generatePEM in @akashnetwork/chain-sdk.

Generate a fresh EC keypair (or use PEMs from a successful Edge run / generatePEM once), then register
that cert on-chain. RSA PEMs will fail with: invalid pubkey value: invalid pem block type
`);
		Deno.exit(1);
	}
	if (n.includes("BEGIN PUBLIC KEY")) {
		console.error(`
Public key uses -----BEGIN PUBLIC KEY-----. Akash expects -----BEGIN EC PUBLIC KEY----- for this flow
(sdk does PKCS#8 EC pubkey PEM then renames the boundary to EC PUBLIC KEY).
`);
		Deno.exit(1);
	}
	console.error("Public key PEM must include -----BEGIN EC PUBLIC KEY----- (Akash / chain-sdk format).");
	Deno.exit(1);
}

async function loadFromBundle(bundlePath: string): Promise<{ cert: string; publicKey: string }> {
	const raw = await readPem(bundlePath, "bundle");
	const chunks = raw
		.split(/(?=-----BEGIN )/g)
		.map((x) => x.trim())
		.filter(Boolean);
	let cert = "";
	let publicKey = "";
	for (const p of chunks) {
		const n = p.replace(/\r/g, "").trim();
		if (n.includes("BEGIN CERTIFICATE")) cert = n;
		else if (n.includes("BEGIN EC PUBLIC KEY")) publicKey = n;
		else if (n.includes("BEGIN PUBLIC KEY")) publicKey = n;
	}
	if (!cert || !publicKey) {
		console.error("Bundle must contain PEM blocks: CERTIFICATE, PRIVATE KEY, EC PUBLIC KEY (or PUBLIC KEY for EC)");
		Deno.exit(1);
	}
	assertAkashCompatiblePubkeyPem(publicKey);
	return { cert, publicKey };
}

function isHardFailureWarning(w: string): boolean {
	if (w.includes("Invalid mTLS certificate CN:")) return true;
	if (w.includes("Certificate tx not visible on chain")) return true;
	const low = w.toLowerCase();
	if (low.startsWith("createcertificate:")) {
		if (low.includes("already") || low.includes("duplicate")) return false;
		return true;
	}
	return false;
}

const parsed = parseArgs();

let pem: { cert: string; publicKey: string };
if (parsed.bundle) {
	pem = await loadFromBundle(parsed.bundle);
} else if (parsed.cert && parsed.key && parsed.pubkey) {
	const cert = await readPem(parsed.cert, "cert");
	await readPem(parsed.key, "private key"); // validate existence; orchestrator doesn't need the key
	const publicKey = await readPem(parsed.pubkey, "public key");
	assertAkashCompatiblePubkeyPem(publicKey);
	pem = { cert, publicKey };
} else {
	console.error("Provide --cert, --key, and --pubkey, or --bundle.\n");
	usage();
	Deno.exit(1);
}

const env = setEnvPems(buildScriptEnv(), pem);
const endpoints = akashEndpoints(env);

console.log("Network / endpoints:", JSON.stringify(endpoints, null, 2));
console.log(
	"(Progress lines below use gRPC; if nothing appears for a long time, verify AKASH_GRPC_URL / firewall. Tune AKASH_CERT_WAIT_MS / AKASH_CERT_POLL_MS.)",
);

const t0 = performance.now();
const result = await ensureCertOnChain({
	env,
	endpoints,
	onProgress: (m) => console.log("[cert]", m),
});
const ms = Math.round(performance.now() - t0);

console.log("\n--- Result ---");
console.log("owner:", result.owner);
console.log("elapsed_ms:", ms);
console.log("warnings:", result.warnings.length ? result.warnings : "(none)");

const hard = result.warnings.filter(isHardFailureWarning);
if (hard.length > 0) {
	console.error("\nHard failures:\n", hard.join("\n"));
	Deno.exit(1);
}

if (result.warnings.length > 0) {
	console.log("\n(non-fatal warnings above — cert path likely still OK)");
}

console.log("\nOK: certificate is registered for this wallet + PEM set.");
Deno.exit(0);
