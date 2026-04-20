/**
 * Build the env object that the cloudflare-backend orchestrator helpers accept, from the current
 * Deno process env. Enforces the required fields (AKASH_HOT_MNEMONIC) up front so scripts can
 * surface a friendly error before the first gRPC round-trip.
 */
/**
 * Superset of every env key the cloudflare-backend orchestrator helpers read. Listed explicitly
 * (rather than as `Record<string, string>`) so this type is assignable to the narrower per-function
 * param types (`BalanceEnv`, endpoints env, etc.) without TS "no overlap with index signature"
 * errors.
 */
export type ScriptEnv = {
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
	AKASH_MIN_PROVIDER_UPTIME?: string;
	MIN_PROVIDER_UPTIME?: string;
	AKASH_SKIP_CLOSE_ON_NO_BIDS?: string;
	AKASH_MANIFEST_RETRY_MAX?: string;
	AKASH_MANIFEST_RETRY_DELAY_MS?: string;
	AKASH_RPC_URL?: string;
	AKASH_GRPC_URL?: string;
	AKASH_REST_URL?: string;
	AKASH_MANIFEST_NETWORK?: string;
	AKASH_DEPOSIT_UACT?: string;
	AKASH_DEPOSIT_UAKT?: string;
};

export function buildScriptEnv(required: readonly string[] = ["AKASH_HOT_MNEMONIC"]): ScriptEnv {
	const missing: string[] = [];
	const raw = Deno.env.toObject();
	for (const key of required) {
		const v = raw[key]?.trim();
		if (!v) missing.push(key);
	}
	if (missing.length > 0) {
		console.error(`Missing required env var(s): ${missing.join(", ")}`);
		Deno.exit(1);
	}
	return raw as unknown as ScriptEnv;
}

/** Attach PEMs to the in-memory script env so the orchestrator's requireMtlsPemBundle picks them up. */
export function setEnvPems(env: ScriptEnv, pem: { cert: string; publicKey: string }): ScriptEnv {
	env.AKASH_MTLS_CERT_PEM = pem.cert;
	env.AKASH_MTLS_PUBLIC_KEY_PEM = pem.publicKey;
	return env;
}

/**
 * Adapt `Deno.createHttpClient({ cert, key })` + global fetch into an object compatible with the
 * orchestrator's `MtlsHttpClient` type. Returns `{ mtlsFetcher, close }` — call close() when done
 * so the underlying http client is released.
 */
export function createDenoMtlsFetcher(certPem: string, keyPem: string): {
	mtlsFetcher: { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> };
	close: () => void;
} {
	// deno-lint-ignore no-explicit-any
	const client = (Deno as any).createHttpClient({ cert: certPem, key: keyPem });
	return {
		mtlsFetcher: {
			async fetch(input, init) {
				return await fetch(input as Request, { ...(init ?? {}), client } as RequestInit);
			},
		},
		close: () => {
			try {
				client?.close?.();
			} catch {
				/* best-effort */
			}
		},
	};
}
