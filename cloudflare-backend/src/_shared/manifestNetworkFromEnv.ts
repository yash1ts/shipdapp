/**
 * AKASH_MANIFEST_NETWORK: human-facing name (default sandbox-2).
 * @akashnetwork/chain-sdk `generateManifest` expects: sandbox | testnet | mainnet.
 *
 * The legacy "Sandbox-1" playground has been retired; **Sandbox-2** (chain-id `sandbox-2`, public
 * routing often labeled **sandbox-02**) is the supported developer playground for v2.0+ (BME, VM, etc.).
 */
export type ChainSdkManifestNetwork = "sandbox" | "testnet" | "mainnet";

/** Default Akash developer playground (Sandbox-2). */
export const DEFAULT_AKASH_MANIFEST_NETWORK = "sandbox-2";

/** CometBFT `network` / chain-id from live playground nodes (see `akash-network/net` sandbox-2). */
export const AKASH_PLAYGROUND_CHAIN_ID = "sandbox-2";

export function chainSdkManifestNetworkFromEnv(env: {
	AKASH_MANIFEST_NETWORK?: string;
}): ChainSdkManifestNetwork {
	const raw = (env.AKASH_MANIFEST_NETWORK ?? DEFAULT_AKASH_MANIFEST_NETWORK)
		.toLowerCase()
		.trim();
	if (raw === "testnet") return "testnet";
	if (raw === "mainnet") return "mainnet";
	return "sandbox";
}
