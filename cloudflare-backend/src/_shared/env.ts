/**
 * Worker bindings + secrets surface used across deployment logic.
 *
 * Anything optional is a secret you set via `wrangler secret put …` (or `vars` in wrangler.jsonc for
 * non-sensitive values). Required bindings are declared in wrangler.jsonc.
 */
export type Env = {
	/** D1 binding (wrangler.jsonc) */
	DB: D1Database;
	/** Cloudflare Workflow binding for `DeployAppWorkflow` (wrangler.jsonc). */
	DEPLOY_APP_WORKFLOW: Workflow<{ deploymentId: string }>;
	/**
	 * mTLS certificate binding. The uploaded cert+key must match the PEMs registered on-chain
	 * for `AKASH_HOT_MNEMONIC`'s owner. Call this binding's `.fetch(url, init)` exactly like
	 * global fetch — Cloudflare presents the client cert automatically.
	 *
	 * Upload cert once:
	 *   npx wrangler mtls-certificate upload --cert ./akash-mtls.crt.pem --key ./akash-mtls.key.pem --name akash-mtls
	 * Then put the returned certificate_id in wrangler.jsonc under `mtls_certificates`.
	 */
	AKASH_MTLS: Fetcher;

	SOLANA_RPC_URL: string;
	AKASH_HOT_MNEMONIC: string;

	/** Public key PEM (same bundle that produced the uploaded mTLS binding). Used to confirm cert is on-chain. */
	AKASH_MTLS_CERT_PEM?: string;
	AKASH_MTLS_PUBLIC_KEY_PEM?: string;
	AKASH_MTLS_PEM_BUNDLE?: string;

	AKASH_RPC_URL?: string;
	AKASH_GRPC_URL?: string;
	AKASH_REST_URL?: string;
	AKASH_MANIFEST_NETWORK?: string;
	AKASH_CHAIN_ID?: string;
	AKASH_GAS_PRICE?: string;

	AKASH_CERT_WAIT_MS?: string;
	AKASH_CERT_POLL_MS?: string;

	AKASH_DEPOSIT_UACT?: string;
	AKASH_DEPOSIT_UAKT?: string;
	AKASH_MIN_BALANCE_UACT?: string;
	AKASH_MIN_UAKT_GAS?: string;

	AKASH_BID_WINDOW_MS?: string;
	AKASH_BID_POLL_MS?: string;
	AKASH_EXCLUDE_PROVIDERS?: string;
	AKASH_BID_STRATEGY?: string;
	AKASH_RELAX_UPTIME?: string;
	MIN_PROVIDER_UPTIME?: string;
	AKASH_SKIP_CLOSE_ON_NO_BIDS?: string;

	AKASH_MANIFEST_RETRY_MAX?: string;
	AKASH_MANIFEST_RETRY_DELAY_MS?: string;
};
