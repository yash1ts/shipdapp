"use client";

import { useMemo } from "react";
import { Program } from "@anchor-lang/core";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  createReadOnlyWallet,
  createShipdappProgram,
  getShipdappProgramId,
} from "@/lib/shipdapp";

export type ShipdappProgram = Program;

/**
 * Anchor `Program` for ShipDapp, wired to the wallet adapter connection.
 *
 * - Always returns a `Program` (uses a read-only wallet stub when disconnected)
 *   so you can call `program.account.appState.all()` without a wallet.
 * - Set `connected` / `publicKey` before sending transactions via
 *   `program.methods.*` (user must sign).
 *
 * Configure `NEXT_PUBLIC_SHIPDAPP_PROGRAM_ID` after deploying the program.
 */
export function useShipdappProgram(): {
  program: ShipdappProgram;
  programId: PublicKey;
  connected: boolean;
  publicKey: PublicKey | null;
} {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  return useMemo(() => {
    const wallet = anchorWallet ?? createReadOnlyWallet();
    const program = createShipdappProgram(connection, wallet);
    return {
      program,
      programId: getShipdappProgramId(),
      connected: Boolean(anchorWallet?.publicKey),
      publicKey: anchorWallet?.publicKey ?? null,
    };
  }, [connection, anchorWallet]);
}
