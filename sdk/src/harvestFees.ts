import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  Keypair,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createHarvestWithheldTokensToMintInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  getAccount,
  getTransferFeeAmount,
} from "@solana/spl-token";

/**
 * Finds all Token-2022 accounts for a given mint that have withheld transfer fees.
 * In production you'd use getProgramAccounts with filters; for the hackathon
 * we accept an explicit list.
 */
export async function harvestAndWithdrawFees(
  connection: Connection,
  authority: Keypair,
  mint: PublicKey,
  sourceAccounts: PublicKey[],
  destinationVault: PublicKey
): Promise<{ harvestSig: string; withdrawSig: string }> {
  const harvestTx = new Transaction().add(
    createHarvestWithheldTokensToMintInstruction(
      mint,
      sourceAccounts,
      TOKEN_2022_PROGRAM_ID
    )
  );
  const harvestSig = await sendAndConfirmTransaction(connection, harvestTx, [
    authority,
  ]);

  const withdrawTx = new Transaction().add(
    createWithdrawWithheldTokensFromMintInstruction(
      mint,
      destinationVault,
      authority.publicKey,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  const withdrawSig = await sendAndConfirmTransaction(
    connection,
    withdrawTx,
    [authority]
  );

  return { harvestSig, withdrawSig };
}

/**
 * Check how much fee is withheld in a particular token account.
 */
export async function getWithheldAmount(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const account = await getAccount(
    connection,
    tokenAccount,
    "confirmed",
    TOKEN_2022_PROGRAM_ID
  );
  const feeAmount = getTransferFeeAmount(account);
  return feeAmount?.withheldAmount ?? BigInt(0);
}
