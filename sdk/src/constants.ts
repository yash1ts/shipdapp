import { PublicKey } from "@solana/web3.js";

export const DEVNET_RPC = "https://api.devnet.solana.com";

export const PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111" // Replace after `anchor deploy`
);

export const METEORA_DBC_PROGRAM_ID = new PublicKey(
  "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
);

export const TRANSFER_FEE_BPS = 200; // 2%
export const TOKEN_DECIMALS = 6;
export const DEFAULT_TOKEN_SUPPLY = BigInt(1_000_000_000_000_000); // 1B tokens
export const MAX_FEE_PER_TRANSFER = BigInt(1_000_000_000);

/** Official Akash testnet (testnet-oracle). See https://github.com/akash-network/net/tree/main/testnet-oracle */
export const AKASH_TESTNET_RPC = "https://testnetoraclerpc.akashnet.net:443";
export const AKASH_TESTNET_GRPC = "http://grpc.oracle.akash.pub:30090";
export const AKASH_TESTNET_REST = "https://testnetoracleapi.akashnet.net";
export const AKASH_TESTNET_CHAIN_ID = "testnet-oracle";

/** Akash Sandbox-2 playground (SDK `sandbox`; chain-id `sandbox-2`). Defaults: aksh.pw mirrors from akash-network/net. */
export const AKASH_SANDBOX_RPC = "https://rpc.sandbox-2.aksh.pw:443";
export const AKASH_SANDBOX_GRPC = "http://grpc.sandbox-2.aksh.pw:9090";
export const AKASH_SANDBOX_CHAIN_ID = "sandbox-2";

/** Default for hackathon: Akash Sandbox-2 (legacy Sandbox-1 retired). */
export const AKASH_DEFAULT_RPC = AKASH_SANDBOX_RPC;
export const AKASH_DEFAULT_CHAIN_ID = AKASH_SANDBOX_CHAIN_ID;

/** @deprecated Use AKASH_SANDBOX_RPC / AKASH_TESTNET_RPC or AKASH_DEFAULT_RPC */
export const AKASH_CHAIN_ID = AKASH_DEFAULT_CHAIN_ID;
