import { type AkashEndpoints } from "./akashOrchestrator.ts";
import { chainSdkManifestNetworkFromEnv } from "./manifestNetworkFromEnv.ts";

/**
 * Sandbox-2 defaults use **akash-network/net** community mirrors (`*.sandbox-2.aksh.pw`).
 * Hostnames like `grpc.sandbox-02.akash.network` are not always in public DNS yet; when they
 * resolve, set `AKASH_RPC_URL` / `AKASH_GRPC_URL` to those endpoints.
 */
const SANDBOX2_RPC_DEFAULT = "https://rpc.sandbox-2.aksh.pw:443";
const SANDBOX2_GRPC_DEFAULT = "http://grpc.sandbox-2.aksh.pw:9090";

export function akashEndpoints(): AkashEndpoints {
  const manifestNetwork = chainSdkManifestNetworkFromEnv();

  const rpcUrl =
    Deno.env.get("AKASH_RPC_URL")?.trim() ??
    (manifestNetwork === "sandbox"
      ? SANDBOX2_RPC_DEFAULT
      : manifestNetwork === "testnet"
        ? "https://testnetoraclerpc.akashnet.net:443"
        : "https://rpc.akashnet.net:443");
  const grpcUrl =
    Deno.env.get("AKASH_GRPC_URL")?.trim() ??
    (manifestNetwork === "sandbox"
      ? SANDBOX2_GRPC_DEFAULT
      : manifestNetwork === "testnet"
        ? "http://grpc.oracle.akash.pub:30090"
        : "https://grpc.akashnet.net:443");
  return { rpcUrl, grpcUrl, manifestNetwork };
}
