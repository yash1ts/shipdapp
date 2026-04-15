import { AnchorProvider, Idl, Program } from "@anchor-lang/core";
import type { Wallet } from "@anchor-lang/core/dist/cjs/provider";
import { Connection, PublicKey } from "@solana/web3.js";
import rawIdl from "@/idl/shipdapp.json";

const CONFIRM_OPTS = {
  commitment: "confirmed" as const,
  preflightCommitment: "confirmed" as const,
};

/**
 * Merges `NEXT_PUBLIC_SHIPDAPP_PROGRAM_ID` into the IDL when set.
 * After `anchor deploy`, paste your program id in `.env.local`.
 */
export function getShipdappIdl(): Idl {
  const envPid = process.env.NEXT_PUBLIC_SHIPDAPP_PROGRAM_ID?.trim();
  const base = rawIdl as unknown as Idl;
  if (!envPid?.length) return base;
  return { ...base, address: envPid };
}

export function getShipdappProgramId(): PublicKey {
  return new PublicKey(getShipdappIdl().address);
}

/** Wallet stub for read-only RPC (account fetch, simulate without signing). */
export function createReadOnlyWallet(): Wallet {
  return {
    publicKey: PublicKey.default,
    signTransaction: async () => {
      throw new Error("Wallet not connected");
    },
    signAllTransactions: async () => {
      throw new Error("Wallet not connected");
    },
  };
}

export function createShipdappProgram(
  connection: Connection,
  wallet: Wallet
): Program {
  const idl = getShipdappIdl();
  const provider = new AnchorProvider(connection, wallet, CONFIRM_OPTS);
  return new Program(idl, provider);
}
