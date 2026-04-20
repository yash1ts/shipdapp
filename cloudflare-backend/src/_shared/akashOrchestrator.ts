import { Buffer } from "node:buffer";
import { X509Certificate } from "node:crypto";
/**
 * Akash deployment orchestration helpers for Cloudflare Workers.
 *
 * Three phases (called by `DeployAppWorkflow` as separate `step.do(...)` invocations):
 *   1. ensureCertOnChain           — confirm the mTLS cert (from env/binding bundle) is on-chain.
 *                                    Broadcast createCertificate if missing.
 *   2. createDeploymentAndLease    — deployment TX, bid polling, lease
 *   3. sendManifestAndVerify       — manifest PUT + lease status (via the mtls_certificates binding)
 *
 * Per-run cert generation (`certificateManager.generatePEM`) is intentionally removed because the
 * manifest PUT uses Cloudflare's `mtls_certificates` binding, which can only present a pre-uploaded
 * (static) client cert. Rotate by re-uploading and re-registering on-chain.
 */
import { createChainNodeWebSDK } from "@akashnetwork/chain-sdk/web";
import {
	createStargateClient,
	generateManifest,
	generateManifestVersion,
	yaml,
} from "@akashnetwork/chain-sdk";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import Long from "long";

const SOURCE_BALANCE = 1;
const BID_STATE_OPEN = 1;

export type AkashNetworkId = "sandbox" | "testnet" | "mainnet";

export type AkashEndpoints = {
	rpcUrl: string;
	grpcUrl: string;
	manifestNetwork: AkashNetworkId;
};

/**
 * Loose JSON-shaped value. Typed as `any` so workflow `step.do(...)` return types don't trigger
 * TS2589 ("Type instantiation is excessively deep") when Cloudflare's Serializable<T> constraint
 * walks a recursive JsonValue. Safe in practice because these fields come from `res.json()`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonValue = any;

/**
 * Minimal structural type for the mTLS client.
 *
 * In the Cloudflare Worker, the `mtls_certificates` binding (`env.AKASH_MTLS`, a `Fetcher`) satisfies
 * this. In Deno scripts, wrap `Deno.createHttpClient({ cert, key })` + global `fetch` into an object
 * exposing `.fetch(url, init)` — that also satisfies this type. Keeps the orchestrator free of
 * platform-specific types.
 */
export type MtlsHttpClient = {
	fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
};

type OrchestratorEnv = {
	AKASH_HOT_MNEMONIC: string;
	AKASH_GAS_PRICE?: string;
	AKASH_MTLS_CERT_PEM?: string;
	AKASH_MTLS_PUBLIC_KEY_PEM?: string;
	AKASH_MTLS_PEM_BUNDLE?: string;
	AKASH_CERT_WAIT_MS?: string;
	AKASH_CERT_POLL_MS?: string;
	AKASH_EXCLUDE_PROVIDERS?: string;
	AKASH_BID_STRATEGY?: string;
	AKASH_BID_WINDOW_MS?: string;
	AKASH_BID_POLL_MS?: string;
	AKASH_RELAX_UPTIME?: string;
	MIN_PROVIDER_UPTIME?: string;
	AKASH_SKIP_CLOSE_ON_NO_BIDS?: string;
	AKASH_MANIFEST_RETRY_MAX?: string;
	AKASH_MANIFEST_RETRY_DELAY_MS?: string;
};

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function pageReq(limit: number) {
	return {
		key: new Uint8Array(0),
		offset: Long.UZERO,
		limit: Long.fromNumber(limit),
		countTotal: false,
		reverse: false,
	};
}

/** Normalize provider `hostUri` from chain to an https origin (same as manifest / lease HTTP client). */
export function akashProviderHttpOrigin(hostUri: string): string {
	const t = hostUri.trim().replace(/\/$/, "");
	if (t.startsWith("http://") || t.startsWith("https://")) return t;
	return `https://${t}`;
}

function providerOrigin(hostUri: string): string {
	return akashProviderHttpOrigin(hostUri);
}

function uptimeFromAttributes(attrs: { key?: string; value?: string }[]): number | null {
	for (const a of attrs) {
		const k = (a.key ?? "").toLowerCase();
		const v = a.value ?? "";
		if (!k || !v) continue;
		if (k.includes("uptime") || k.includes("availability")) {
			const n = parseFloat(v.replace("%", "").trim());
			if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
		}
	}
	return null;
}

function comparePrice(aAmt: string, bAmt: string): number {
	try {
		const ba = BigInt(aAmt || "0");
		const bb = BigInt(bAmt || "0");
		if (ba < bb) return -1;
		if (ba > bb) return 1;
		return 0;
	} catch {
		return 0;
	}
}

/** Comma- or whitespace-separated `akash1…` provider addresses to skip when accepting a bid. */
function parseExcludedProviders(env: OrchestratorEnv): Set<string> {
	const raw = env.AKASH_EXCLUDE_PROVIDERS?.trim() ?? "";
	const set = new Set<string>();
	for (const part of raw.split(/[\s,]+/)) {
		const a = part.trim().toLowerCase();
		if (a) set.add(a);
	}
	return set;
}

/**
 * `cheapest` (default): lowest `uact` bid wins.
 * `random`: uniform pick among qualifying bids (after sort; use with `AKASH_EXCLUDE_PROVIDERS` to avoid overload).
 */
function bidPickStrategy(env: OrchestratorEnv): "cheapest" | "random" {
	const s = (env.AKASH_BID_STRATEGY ?? "cheapest").trim().toLowerCase();
	return s === "random" ? "random" : "cheapest";
}

function normalizePem(text: string): string {
	return text.replace(/\r/g, "").trim();
}

function canonicalCertBody(pem: string): string {
	return normalizePem(pem)
		.replace(/-----BEGIN CERTIFICATE-----/g, "")
		.replace(/-----END CERTIFICATE-----/g, "")
		.replace(/\s+/g, "");
}

function coerceChainBytesToUtf8(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") {
		const s = value.trim();
		if (!s) return "";
		if (s.includes("-----BEGIN")) return normalizePem(s);
		try {
			const bin = atob(s.replace(/\s/g, ""));
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return normalizePem(new TextDecoder().decode(bytes));
		} catch {
			return normalizePem(s);
		}
	}
	if (value instanceof Uint8Array) {
		return normalizePem(new TextDecoder().decode(value));
	}
	if (Array.isArray(value)) {
		return normalizePem(new TextDecoder().decode(Uint8Array.from(value as number[])));
	}
	return "";
}

function extractCertRows(res: { certificates?: unknown }): unknown[] {
	const raw = res.certificates;
	if (Array.isArray(raw)) return raw;
	if (raw && typeof raw === "object" && "certificate" in (raw as object)) {
		const inner = (raw as { certificate?: unknown }).certificate;
		if (Array.isArray(inner)) return inner;
		if (inner) return [inner];
	}
	return [];
}

/**
 * Akash decodes bech32 from the X.509 subject CN; mixed case fails with
 * "decoding bech32 failed: string not all lowercase or all uppercase".
 */
function validateMtlsCertCnForOwner(certPem: string, owner: string): string | null {
	try {
		const cert = new X509Certificate(normalizePem(certPem));
		let cn = "";
		for (const line of cert.subject.split("\n")) {
			const t = line.trim();
			if (t.startsWith("CN=")) cn = t.slice(3).trim();
		}
		if (!cn) {
			const flat = cert.subject.replace(/\r?\n/g, "/");
			const m = /(?:^|\/)CN=([^/]+)/.exec(flat);
			cn = (m?.[1] ?? "").trim();
		}
		if (!cn) return null;
		const want = owner.trim().toLowerCase();
		const got = cn.trim();
		if (got === want) return null;
		if (got.toLowerCase() === want) {
			return (
				`Invalid mTLS certificate CN: "${got}" uses mixed-case bech32; Akash rejects createCertificate. ` +
				`Regenerate PEMs with an all-lowercase CN matching ${want}.`
			);
		}
		return (
			`Invalid mTLS certificate CN: "${got}" does not match wallet owner ${want}. ` +
			`Regenerate with: ./scripts/gen-akash-mtls-bundle.sh ${want}`
		);
	} catch {
		return null;
	}
}

async function waitForCertificateVisible(
	sdk: ReturnType<typeof createChainNodeWebSDK>,
	owner: string,
	certPem: string,
	pubkeyPem: string,
	opts: { maxWaitMs: number; intervalMs: number; onProgress?: (message: string) => void }
): Promise<void> {
	const log = opts.onProgress ?? (() => undefined);
	const deadline = Date.now() + opts.maxWaitMs;
	const target = normalizePem(certPem);
	const targetBody = canonicalCertBody(certPem);
	const targetPubkey = normalizePem(pubkeyPem);
	const started = Date.now();
	let nextProgressLog = started + 10_000;
	while (Date.now() < deadline) {
		const res = await sdk.akash.cert.v1.getCertificates({
			filter: { owner, serial: "", state: "" },
			pagination: pageReq(200),
		});
		const certs = extractCertRows(res);
		for (const c of certs) {
			const row = c as Record<string, unknown>;
			const inner = (row.certificate ?? row) as Record<string, unknown>;
			const onChainPem = coerceChainBytesToUtf8(inner.cert ?? inner.certificate ?? row.cert);
			const onChainPubkey = coerceChainBytesToUtf8(inner.pubkey ?? inner.publicKey ?? row.pubkey);
			if (!onChainPem && !onChainPubkey) continue;
			if (onChainPem === target) return;
			if (onChainPem && canonicalCertBody(onChainPem) === targetBody) return;
			if (onChainPubkey && onChainPubkey === targetPubkey) return;
		}
		const now = Date.now();
		if (now >= nextProgressLog) {
			const elapsedS = Math.round((now - started) / 1000);
			const maxS = Math.round(opts.maxWaitMs / 1000);
			log(
				`Certificate not visible via gRPC yet (${elapsedS}s / ${maxS}s max); next poll in ${opts.intervalMs}ms — check AKASH_GRPC_URL or indexer lag.`
			);
			nextProgressLog = now + 10_000;
		}
		await sleep(opts.intervalMs);
	}
	throw new Error(
		"Certificate tx not visible on chain for current mTLS cert — increase AKASH_CERT_WAIT_MS or retry"
	);
}

/* ------------------------------------------------------------------ */
/*  Shared SDK / wallet factory                                        */
/* ------------------------------------------------------------------ */

export function createAkashClients(env: OrchestratorEnv, endpoints: AkashEndpoints) {
	const walletPromise = DirectSecp256k1HdWallet.fromMnemonic(env.AKASH_HOT_MNEMONIC, {
		prefix: "akash",
	});

	return {
		async init() {
			const directWallet = await walletPromise;
			const [account] = await directWallet.getAccounts();
			const owner = account.address;

			const gasPrice = env.AKASH_GAS_PRICE?.trim() || "0.025uakt";
			const signer = createStargateClient({
				baseUrl: endpoints.rpcUrl,
				signer: directWallet,
				defaultGasPrice: gasPrice,
			});
			const sdk = createChainNodeWebSDK({
				query: {
					baseUrl: endpoints.grpcUrl,
					transportOptions: {
						// Keep retries low — every retried request counts against Cloudflare Workers'
						// subrequest budget (50 free / 1000 paid per invocation). The bid-poll loop
						// can already make dozens of calls per window; 4× retry multiplies that.
						retry: { maxAttempts: 2, maxDelayMs: 4_000 },
					},
				},
				tx: { signer },
			});

			return { owner, sdk, signer, directWallet };
		},
	};
}

export type AkashChainSdk = Awaited<ReturnType<ReturnType<typeof createAkashClients>["init"]>>["sdk"];

type ProviderRowAttrs = { key?: string; value?: string }[];

type ProviderLookup = {
	attrs: ProviderRowAttrs;
	hostUri: string;
	loadFailed: boolean;
};

/** One gRPC round-trip per unique provider, in parallel (was N sequential calls per poll). */
async function fetchProvidersByOwner(
	sdk: AkashChainSdk,
	owners: readonly string[]
): Promise<Map<string, ProviderLookup>> {
	const unique = [...new Set(owners.filter((o) => o))];
	const pairs = await Promise.all(
		unique.map(async (owner): Promise<[string, ProviderLookup]> => {
			try {
				const pr = await sdk.akash.provider.v1beta4.getProvider({ owner });
				const hostUri = pr.provider?.hostUri?.trim() ?? "";
				const attrs = [...(pr.provider?.attributes ?? [])] as ProviderRowAttrs;
				return [owner, { attrs, hostUri, loadFailed: false }];
			} catch {
				return [owner, { attrs: [], hostUri: "", loadFailed: true }];
			}
		})
	);
	return new Map(pairs);
}

/* ------------------------------------------------------------------ */
/*  PEM loading helpers (env-based stable mTLS certs)                  */
/* ------------------------------------------------------------------ */

/**
 * Parsed mTLS bundle. `privateKey` is only used by local Deno scripts (for
 * `Deno.createHttpClient`); the Cloudflare Worker path uses the mtls_certificates binding and
 * ignores it entirely. Kept on the type so both call sites can reuse the parser.
 */
export type PemBundle = { cert: string; privateKey: string; publicKey: string };

function loadPemFromEnv(env: OrchestratorEnv): PemBundle | null {
	const cert = env.AKASH_MTLS_CERT_PEM?.trim();
	const publicKey = env.AKASH_MTLS_PUBLIC_KEY_PEM?.trim();
	if (cert && publicKey) return { cert, privateKey: "", publicKey };
	return null;
}

/** Parse concat PEM bundle (cert + private key + public key). */
export function parseMtlsPemBundleText(raw: string): PemBundle | null {
	let bundle = raw.trim();
	if (!bundle) return null;
	if (bundle.includes("-----BEGIN") && bundle.includes("\\n") && bundle.split("\n").length <= 2) {
		bundle = bundle.replace(/\\n/g, "\n");
	}
	bundle = bundle.replace(/\r\n/g, "\n");
	const chunks = bundle
		.split(/(?=-----BEGIN )/g)
		.map((x) => x.trim())
		.filter(Boolean);
	let cert = "";
	let privateKey = "";
	let publicKey = "";
	for (const p of chunks) {
		const n = normalizePem(p);
		if (n.includes("BEGIN CERTIFICATE")) cert = n;
		else if (n.includes("BEGIN") && n.includes("PRIVATE KEY")) privateKey = n;
		// chain-sdk uses PKCS#8 EC pubkey with this header; plain BEGIN PUBLIC KEY is often RSA and rejected on-chain
		else if (n.includes("BEGIN EC PUBLIC KEY")) publicKey = n;
		else if (n.includes("BEGIN PUBLIC KEY")) publicKey = n;
	}
	if (cert && publicKey) return { cert, privateKey, publicKey };
	return null;
}

function loadPemBundleFromEnv(env: OrchestratorEnv): PemBundle | null {
	let b = env.AKASH_MTLS_PEM_BUNDLE;
	if (!b) return null;
	b = b.trim();
	if (b.includes("-----BEGIN") && b.includes("\\n") && b.split("\n").length <= 2) {
		b = b.replace(/\\n/g, "\n");
	}
	return parseMtlsPemBundleText(b);
}

function requireMtlsPemBundle(env: OrchestratorEnv): PemBundle {
	const p = loadPemFromEnv(env) ?? loadPemBundleFromEnv(env);
	if (!p) {
		throw new Error(
			"Missing mTLS PEMs. Set AKASH_MTLS_CERT_PEM + AKASH_MTLS_PUBLIC_KEY_PEM (or AKASH_MTLS_PEM_BUNDLE) as wrangler secrets; they must match the cert uploaded to the AKASH_MTLS binding and registered on-chain."
		);
	}
	return p;
}

/* ------------------------------------------------------------------ */
/*  PHASE 1: ensureCertOnChain                                         */
/* ------------------------------------------------------------------ */

export type CertResult = {
	owner: string;
	warnings: string[];
};

export async function ensureCertOnChain(input: {
	env: OrchestratorEnv;
	endpoints: AkashEndpoints;
	/** Optional progress sink (used by workflow logs). */
	onProgress?: (message: string) => void;
}): Promise<CertResult> {
	const warnings: string[] = [];
	const log = input.onProgress ?? (() => undefined);

	log("Initializing wallet and chain clients (first contact uses RPC + gRPC)…");
	const { owner, sdk, signer } = await createAkashClients(input.env, input.endpoints).init();
	log(`Wallet ready: owner=${owner}`);

	const pem = requireMtlsPemBundle(input.env);

	const cnReject = validateMtlsCertCnForOwner(pem.cert, owner);
	if (cnReject) {
		await signer.disconnect?.().catch(() => undefined);
		throw new Error(cnReject);
	}

	async function certAlreadyOnChain(): Promise<boolean> {
		log("Querying on-chain certificates (gRPC getCertificates)…");
		const res = await sdk.akash.cert.v1.getCertificates({
			filter: { owner, serial: "", state: "" },
			pagination: pageReq(200),
		});
		const targetPub = normalizePem(pem.publicKey);
		const targetBody = canonicalCertBody(pem.cert);
		for (const c of extractCertRows(res)) {
			const row = c as Record<string, unknown>;
			const inner = (row.certificate ?? row) as Record<string, unknown>;
			const onChainPem = coerceChainBytesToUtf8(inner.cert ?? inner.certificate ?? row.cert);
			const onChainPub = coerceChainBytesToUtf8(inner.pubkey ?? inner.publicKey ?? row.pubkey);
			if (onChainPub && onChainPub === targetPub) {
				log("This PEM matches an on-chain certificate (by public key).");
				return true;
			}
			if (onChainPem && canonicalCertBody(onChainPem) === targetBody) {
				log("This PEM matches an on-chain certificate (by cert body).");
				return true;
			}
		}
		log("No on-chain certificate matches this PEM yet.");
		return false;
	}

	const already = await certAlreadyOnChain();
	if (!already) {
		log("Broadcasting createCertificate transaction…");
		try {
			await sdk.akash.cert.v1.createCertificate({
				owner,
				cert: Buffer.from(pem.cert, "utf8"),
				pubkey: Buffer.from(pem.publicKey, "utf8"),
			});
			log("createCertificate broadcast returned.");
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			warnings.push(`createCertificate: ${msg}`);
		}
	} else {
		log("This PEM is already registered on-chain; skipping createCertificate.");
	}

	const certWaitMs = Number(input.env.AKASH_CERT_WAIT_MS || "180000");
	const certPollMs = Number(input.env.AKASH_CERT_POLL_MS || "2000");
	try {
		log(`Waiting for certificate to be visible to queries (up to ${certWaitMs}ms)…`);
		await waitForCertificateVisible(sdk, owner, pem.cert, pem.publicKey, {
			maxWaitMs: certWaitMs,
			intervalMs: certPollMs,
			onProgress: log,
		});
		log("Certificate is visible on-chain.");
	} catch (e) {
		warnings.push(e instanceof Error ? e.message : String(e));
	}

	await signer.disconnect?.().catch(() => undefined);

	return { owner, warnings };
}

/** True if this cert+pubkey appears in on-chain x509 certificates for the mnemonic's owner. */
export async function isMtlsPemRegisteredOnChain(input: {
	env: OrchestratorEnv;
	endpoints: AkashEndpoints;
	certPem: string;
	publicKeyPem: string;
}): Promise<{ owner: string; registered: boolean }> {
	const { owner, sdk, signer } = await createAkashClients(input.env, input.endpoints).init();
	try {
		const res = await sdk.akash.cert.v1.getCertificates({
			filter: { owner, serial: "", state: "" },
			pagination: pageReq(200),
		});
		const targetPub = normalizePem(input.publicKeyPem);
		const targetBody = canonicalCertBody(input.certPem);
		for (const c of extractCertRows(res)) {
			const row = c as Record<string, unknown>;
			const inner = (row.certificate ?? row) as Record<string, unknown>;
			const onChainPem = coerceChainBytesToUtf8(inner.cert ?? inner.certificate ?? row.cert);
			const onChainPub = coerceChainBytesToUtf8(inner.pubkey ?? inner.publicKey ?? row.pubkey);
			if (onChainPub && onChainPub === targetPub) return { owner, registered: true };
			if (onChainPem && canonicalCertBody(onChainPem) === targetBody) return { owner, registered: true };
		}
		return { owner, registered: false };
	} finally {
		await signer.disconnect?.().catch(() => undefined);
	}
}

/* ------------------------------------------------------------------ */
/*  PHASE 2: createDeploymentAndLease                                  */
/* ------------------------------------------------------------------ */
/* If createDeployment succeeds but no bid qualifies, we broadcast closeDeployment so */
/* deployment escrow (uact) is not left locked on a dead dseq. Opt out: AKASH_SKIP_CLOSE_ON_NO_BIDS=1. */

export type LeaseResult = {
	dseq: string;
	provider: string;
	gseq: number;
	oseq: number;
	providerHostUri: string;
	warnings: string[];
};

export async function createDeploymentAndLease(input: {
	env: OrchestratorEnv;
	endpoints: AkashEndpoints;
	sdlYaml: string;
	depositUact: string;
	bidWindowMs: number;
	bidPollMs: number;
	minProviderUptime: number;
}): Promise<LeaseResult> {
	const warnings: string[] = [];

	const { owner, sdk, signer } = await createAkashClients(input.env, input.endpoints).init();

	const manifestResult = generateManifest(yaml.raw(input.sdlYaml), input.endpoints.manifestNetwork);
	if (!manifestResult.ok) {
		throw new Error(`SDL validation failed: ${JSON.stringify(manifestResult.value)}`);
	}
	const { groups, groupSpecs } = manifestResult.value;
	const hash = await generateManifestVersion(groups);

	const latest = await sdk.cosmos.base.tendermint.v1beta1.getLatestBlock({});
	const height = latest.block?.header?.height;
	if (height === undefined || height === null) {
		throw new Error("Could not read latest block height for dseq");
	}
	const dseq = Long.fromString(String(height));

	await sdk.akash.deployment.v1beta4.createDeployment({
		id: { owner, dseq },
		groups: groupSpecs,
		hash,
		deposit: {
			amount: { denom: "uact", amount: input.depositUact },
			sources: [SOURCE_BALANCE],
		},
	});

	const deadline = Date.now() + input.bidWindowMs;
	const excludedProviders = parseExcludedProviders(input.env);
	const strategy = bidPickStrategy(input.env);
	if (excludedProviders.size > 0) {
		warnings.push(`AKASH_EXCLUDE_PROVIDERS excludes: ${[...excludedProviders].join(", ")}`);
	}
	if (strategy === "random") {
		warnings.push(
			"AKASH_BID_STRATEGY=random: picking a random qualifying bid (not strictly the cheapest)."
		);
	}
	type Candidate = {
		bidId: NonNullable<NonNullable<{ bid?: { id?: unknown } }["bid"]>["id"]>;
		priceAmt: string;
		uptime: number;
	};
	let chosen: Candidate | null = null;
	const skipUptimeGate = input.minProviderUptime <= 0;
	// Cache provider attribute lookups across poll iterations. Within a 60s bid window provider
	// attributes (hostUri, uptime tag, etc.) don't change, so re-fetching each iteration just
	// burns through Cloudflare Workers' per-invocation subrequest budget.
	const provByOwner = new Map<string, ProviderLookup>();

	while (Date.now() < deadline && !chosen) {
		const bidsRes = await sdk.akash.market.v1beta5.getBids({
			filters: {
				owner,
				dseq,
				gseq: 0,
				oseq: 0,
				provider: "",
				state: "open",
				bseq: 0,
			},
			pagination: pageReq(100),
		});

		const open = (bidsRes.bids ?? []).filter(
			(b: {
				bid?: { state?: number; id?: Candidate["bidId"]; price?: { amount?: string } };
			}) => b.bid && b.bid.state === BID_STATE_OPEN
		);

		// Only fetch provider attrs when we actually need them (uptime gating on) and only for
		// providers we haven't seen yet in this bid window.
		if (!skipUptimeGate) {
			const seenProviders = new Set<string>();
			for (const row of open) {
				const bidId = row.bid?.id as Candidate["bidId"] | undefined;
				const provider =
					bidId && typeof (bidId as { provider?: string }).provider === "string"
						? (bidId as { provider: string }).provider
						: "";
				if (provider && !provByOwner.has(provider)) seenProviders.add(provider);
			}
			if (seenProviders.size > 0) {
				const fresh = await fetchProvidersByOwner(sdk, [...seenProviders]);
				for (const [k, v] of fresh) provByOwner.set(k, v);
			}
		}

		const candidates: Candidate[] = [];

		for (const row of open) {
			const b = row.bid!;
			const bidId = b.id as Candidate["bidId"];
			if (!bidId || typeof (bidId as { provider?: string }).provider !== "string") continue;
			const provider = (bidId as { provider: string }).provider;
			if (excludedProviders.has(provider.toLowerCase())) continue;
			const priceAmt = b.price?.amount ?? "0";
			const info = provByOwner.get(provider);
			const provAttrs = info?.attrs ?? [];
			if (info?.loadFailed) {
				warnings.push(`Could not load provider ${provider} attributes`);
			}
			const uptime = uptimeFromAttributes(provAttrs);
			const skipUptime = input.minProviderUptime <= 0;
			if (!skipUptime && (uptime === null || uptime < input.minProviderUptime)) {
				continue;
			}
			candidates.push({ bidId, priceAmt, uptime: uptime ?? 0 });
		}

		if (candidates.length === 0 && input.minProviderUptime <= 0) {
			for (const row of open) {
				const b = row.bid!;
				const bidId = b.id as Candidate["bidId"];
				if (!bidId || typeof (bidId as { provider?: string }).provider !== "string") {
					continue;
				}
				const provider = (bidId as { provider: string }).provider;
				if (excludedProviders.has(provider.toLowerCase())) continue;
				candidates.push({
					bidId,
					priceAmt: b.price?.amount ?? "0",
					uptime: 0,
				});
			}
		}

		if (candidates.length > 0) {
			candidates.sort((a, b) => comparePrice(a.priceAmt, b.priceAmt));
			chosen =
				strategy === "random"
					? candidates[Math.floor(Math.random() * candidates.length)]!
					: candidates[0]!;
			break;
		}

		await sleep(input.bidPollMs);
	}

	if (!chosen) {
		let hint =
			excludedProviders.size > 0
				? ` AKASH_EXCLUDE_PROVIDERS is set (${excludedProviders.size} address(es)); every open bid may have been filtered out.`
				: "";
		const dseqStr = dseq.toString();
		if (input.env.AKASH_SKIP_CLOSE_ON_NO_BIDS === "1") {
			hint += ` (AKASH_SKIP_CLOSE_ON_NO_BIDS=1: not sending closeDeployment; reclaim escrow manually for dseq ${dseqStr}.)`;
		} else {
			try {
				await sdk.akash.deployment.v1beta4.closeDeployment({
					id: { owner, dseq },
				});
				hint += ` Sent closeDeployment for dseq ${dseqStr} so unspent escrow can return to your account.`;
			} catch (closeErr) {
				const closeMsg = closeErr instanceof Error ? closeErr.message : String(closeErr);
				warnings.push(`closeDeployment after no bids failed (dseq=${dseqStr}): ${closeMsg}`);
				hint += ` Auto-close failed for dseq ${dseqStr}: ${closeMsg}. Close the deployment manually (akash tx deployment close) to reclaim escrow.`;
			}
		}
		await signer.disconnect?.().catch(() => undefined);
		throw new Error(
			`No qualifying bids within ${input.bidWindowMs}ms (open bid + provider uptime ≥ ${input.minProviderUptime}).${hint}`
		);
	}

	await sdk.akash.market.v1beta5.createLease({
		bidId: chosen.bidId as never,
	});

	const providerAddr = (chosen.bidId as { provider: string }).provider;
	const provRes = await sdk.akash.provider.v1beta4.getProvider({
		owner: providerAddr,
	});
	const hostUri = provRes.provider?.hostUri?.trim();
	if (!hostUri) {
		await signer.disconnect?.().catch(() => undefined);
		throw new Error("Provider hostUri missing after lease");
	}

	const bidId = chosen.bidId as { gseq: number; oseq: number };

	await signer.disconnect?.().catch(() => undefined);

	return {
		dseq: dseq.toString(),
		provider: providerAddr,
		gseq: bidId.gseq,
		oseq: bidId.oseq,
		providerHostUri: providerOrigin(hostUri),
		warnings,
	};
}

/* ------------------------------------------------------------------ */
/*  PHASE 3: sendManifestAndVerify                                     */
/* ------------------------------------------------------------------ */

export type ManifestResult = {
	manifestSent: boolean;
	leaseStatus: JsonValue;
	forwardedPorts: JsonValue;
	warnings: string[];
};

export async function sendManifestAndVerify(input: {
	env: OrchestratorEnv;
	/**
	 * mTLS client. In the Worker, pass `env.AKASH_MTLS` (mtls_certificates binding, a Fetcher).
	 * In Deno scripts, pass any object with a `fetch(url, init)` method that tunnels through a
	 * `Deno.createHttpClient({ cert, key })`.
	 */
	mtlsFetcher: MtlsHttpClient;
	sdlYaml: string;
	manifestNetwork: AkashNetworkId;
	dseq: string;
	providerHostUri: string;
	gseq: number;
	oseq: number;
}): Promise<ManifestResult> {
	const warnings: string[] = [];

	const manifestResult = generateManifest(yaml.raw(input.sdlYaml), input.manifestNetwork);
	if (!manifestResult.ok) {
		throw new Error(`SDL validation failed: ${JSON.stringify(manifestResult.value)}`);
	}
	const { groups } = manifestResult.value;

	const manifestUrl = `${input.providerHostUri}/deployment/${input.dseq}/manifest`;
	const manifestRetryMax = Number(input.env.AKASH_MANIFEST_RETRY_MAX ?? "5");
	const manifestRetryDelayMs = Number(input.env.AKASH_MANIFEST_RETRY_DELAY_MS ?? "5000");

	let manifestSent = false;
	for (let attempt = 1; attempt <= Math.max(1, manifestRetryMax); attempt++) {
		const putRes = await input.mtlsFetcher.fetch(manifestUrl, {
			method: "PUT",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(groups),
		});
		manifestSent = putRes.ok;
		if (manifestSent) break;
		const body = await putRes.text().catch(() => "");
		warnings.push(`Manifest mTLS HTTP ${putRes.status}: ${body.slice(0, 400)}`);
		if (putRes.status === 401 && attempt < manifestRetryMax) {
			await sleep(manifestRetryDelayMs);
			continue;
		}
		break;
	}

	if (!manifestSent) {
		warnings.push(
			"Manifest still failing: confirm the AKASH_MTLS cert binding points at the same PEM registered on-chain for the hot wallet. Re-upload via `wrangler mtls-certificate upload` if rotated."
		);
		if (warnings.some((w) => w.includes("Manifest mTLS HTTP 401"))) {
			warnings.push(
				"HTTP 401 from the provider often means the on-chain lease is no longer active or dseq/gseq/oseq/host do not match the active lease — not necessarily a bad PEM when cert checks pass."
			);
		}
	}

	const statusUrl = `${input.providerHostUri}/lease/${input.dseq}/${input.gseq}/${input.oseq}/status`;
	let leaseStatus: JsonValue = null;
	let forwardedPorts: JsonValue = null;

	for (let attempt = 1; attempt <= Math.max(1, manifestRetryMax); attempt++) {
		const stRes = await input.mtlsFetcher.fetch(statusUrl, {
			headers: { Accept: "application/json" },
		});
		if (stRes.ok) {
			leaseStatus = (await stRes.json()) as JsonValue;
			const ls = (leaseStatus as { [k: string]: JsonValue } | null) ?? {};
			forwardedPorts = (ls.forwarded_ports ?? ls.forwardedPorts ?? null) as JsonValue;
			break;
		}
		warnings.push(`Lease status HTTP ${stRes.status}`);
		if (stRes.status === 401 && attempt < manifestRetryMax) {
			await sleep(manifestRetryDelayMs);
			continue;
		}
		break;
	}

	return { manifestSent, leaseStatus, forwardedPorts, warnings };
}
