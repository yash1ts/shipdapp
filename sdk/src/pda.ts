import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

export function findPlatformConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("platform")], PROGRAM_ID);
}

export function findAppStatePDA(
  creator: PublicKey,
  appName: string
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("app"), creator.toBuffer(), Buffer.from(appName)],
    PROGRAM_ID
  );
}

export function findHostingVaultPDA(
  appState: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), appState.toBuffer()],
    PROGRAM_ID
  );
}
