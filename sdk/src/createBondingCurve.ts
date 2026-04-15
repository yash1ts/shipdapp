import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { DEVNET_RPC, METEORA_DBC_PROGRAM_ID } from "./constants";

/**
 * Creates a Meteora Dynamic Bonding Curve pool for an app token.
 *
 * The DBC SDK (`@meteora-ag/dynamic-bonding-curve-sdk`) provides the actual
 * pool creation / buy / sell transactions. This module wraps the setup with
 * ShipDapp-specific defaults.
 *
 * Install: npm install @meteora-ag/dynamic-bonding-curve-sdk
 *
 * Reference: https://docs.meteora.ag/integration/dynamic-bonding-curve-dbc-integration
 */

export interface BondingCurveConfig {
  baseMint: PublicKey;
  migrationThresholdLamports: number;
}

export async function createBondingCurvePool(
  payer: Keypair,
  tokenMint: PublicKey,
  opts?: {
    migrationThreshold?: number;
    connection?: Connection;
  }
) {
  const connection =
    opts?.connection ?? new Connection(DEVNET_RPC, "confirmed");
  const migrationThreshold = opts?.migrationThreshold ?? 10_000_000_000; // 10 SOL on devnet

  // Dynamic import so this module doesn't hard-fail if SDK isn't installed yet
  let DynamicBondingCurveClient: any;
  try {
    const sdk = await import("@meteora-ag/dynamic-bonding-curve-sdk");
    DynamicBondingCurveClient = sdk.DynamicBondingCurveClient;
  } catch {
    console.warn(
      "Meteora DBC SDK not installed. Run: npm install @meteora-ag/dynamic-bonding-curve-sdk"
    );
    return null;
  }

  const client = new DynamicBondingCurveClient(connection, "devnet");

  // The actual pool creation depends on the SDK version.
  // See: https://docs.meteora.ag/integration/dynamic-bonding-curve-dbc-integration/dbc-scripts
  // Typical flow:
  //   1. client.createConfig(...)  — or use an existing config
  //   2. client.createPool(...)    — creates the bonding curve pool
  //   3. client.buy(...) / client.sell(...)

  console.log(
    `Meteora DBC client initialized for mint: ${tokenMint.toBase58()}`
  );
  console.log(`Migration threshold: ${migrationThreshold / 1e9} SOL`);
  console.log(`Program ID: ${METEORA_DBC_PROGRAM_ID.toBase58()}`);

  return { client, connection, migrationThreshold };
}

/**
 * Buy tokens on an existing bonding curve pool.
 */
export async function buyToken(
  client: any,
  pool: PublicKey,
  buyer: Keypair,
  solLamports: number
) {
  const tx = await client.buy({
    pool,
    user: buyer.publicKey,
    quoteAmount: solLamports,
    minBaseAmount: 0,
  });
  return tx;
}

/**
 * Sell tokens back into the bonding curve.
 */
export async function sellToken(
  client: any,
  pool: PublicKey,
  seller: Keypair,
  tokenAmount: number
) {
  const tx = await client.sell({
    pool,
    user: seller.publicKey,
    baseAmount: tokenAmount,
    minQuoteAmount: 0,
  });
  return tx;
}
