/** Tendermint HTTP RPC + chain ID defaults for CosmJS / chain-sdk. */

import {
  AKASH_PLAYGROUND_CHAIN_ID,
  chainSdkManifestNetworkFromEnv,
} from "./manifestNetworkFromEnv.ts";

function manifestNetwork(): "sandbox" | "testnet" | "mainnet" {
  return chainSdkManifestNetworkFromEnv();
}

export function akashTendermintRpcUrl(): string {
  const o = Deno.env.get("AKASH_RPC_URL")?.trim();
  if (o) return o.replace(/\/$/, "");
  const net = manifestNetwork();
  if (net === "sandbox") return "https://rpc.sandbox-2.aksh.pw:443";
  if (net === "testnet") return "https://testnetoraclerpc.akashnet.net:443";
  return "https://rpc.akashnet.net:443";
}

export function akashChainId(): string {
  const e = Deno.env.get("AKASH_CHAIN_ID")?.trim();
  if (e) return e;
  const net = manifestNetwork();
  if (net === "sandbox") return AKASH_PLAYGROUND_CHAIN_ID;
  if (net === "testnet") return "akashtestnet-8";
  return "akashnet-2";
}
