import { type AkashEndpoints } from "./akashOrchestrator";
import { chainSdkManifestNetworkFromEnv } from "./manifestNetworkFromEnv";

/**
 * Sandbox-2 defaults use **akash-network/net** community mirrors (`*.sandbox-2.aksh.pw`).
 *
 * IMPORTANT: despite the `AKASH_GRPC_URL` name, `chain-sdk/web` does **not** speak gRPC or
 * gRPC-web. It uses `createGrpcGatewayTransport`, a **REST/JSON** client for Cosmos'
 * grpc-gateway (LCD) API. We must pass an LCD endpoint (`api.*.aksh.pw` / `api.akashnet.net`),
 * NOT the gRPC endpoint (`grpc.*`, `:9090`, or `:443` gRPC-web gateways):
 *   - Hitting a plain gRPC port returns HTTP/2 gRPC framing that Workers surfaces as an opaque 520.
 *   - Hitting a gRPC-web gateway rejects `application/json` with 415.
 *
 * Reference: `ChainNodeWebSDKOptions.query.baseUrl` in
 * `@akashnetwork/chain-sdk/dist/types/sdk/chain/createChainNodeWebSDK.d.ts`:
 *   "Blockchain gRPC gateway endpoint (also known as REST endpoint)".
 */
const SANDBOX2_RPC_DEFAULT = "https://rpc.sandbox-2.aksh.pw:443";
const SANDBOX2_GRPC_DEFAULT = "https://api.sandbox-2.aksh.pw";

export function akashEndpoints(env: {
	AKASH_RPC_URL?: string;
	AKASH_GRPC_URL?: string;
	AKASH_MANIFEST_NETWORK?: string;
}): AkashEndpoints {
	const manifestNetwork = chainSdkManifestNetworkFromEnv(env);

	const rpcUrl =
		env.AKASH_RPC_URL?.trim() ||
		(manifestNetwork === "sandbox"
			? SANDBOX2_RPC_DEFAULT
			: manifestNetwork === "testnet"
				? "https://testnetoraclerpc.akashnet.net:443"
				: "https://rpc.akashnet.net:443");
	const grpcUrl =
		env.AKASH_GRPC_URL?.trim() ||
		(manifestNetwork === "sandbox"
			? SANDBOX2_GRPC_DEFAULT
			: manifestNetwork === "testnet"
				? "https://api.testnet-02.aksh.pw"
				: "https://api.akashnet.net");
	return { rpcUrl, grpcUrl, manifestNetwork };
}
