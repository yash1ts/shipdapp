import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  PublicKey,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  getMintLen,
  createMintToInstruction,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  DEVNET_RPC,
  TRANSFER_FEE_BPS,
  TOKEN_DECIMALS,
  DEFAULT_TOKEN_SUPPLY,
  MAX_FEE_PER_TRANSFER,
} from "./constants";

export interface CreateAppTokenResult {
  mint: PublicKey;
  mintKeypair: Keypair;
  payerAta: PublicKey;
  signature: string;
}

export async function createAppToken(
  payer: Keypair,
  opts?: {
    transferFeeBps?: number;
    maxFee?: bigint;
    supply?: bigint;
    connection?: Connection;
  }
): Promise<CreateAppTokenResult> {
  const transferFeeBps = opts?.transferFeeBps ?? TRANSFER_FEE_BPS;
  const maxFee = opts?.maxFee ?? MAX_FEE_PER_TRANSFER;
  const supply = opts?.supply ?? DEFAULT_TOKEN_SUPPLY;
  const connection =
    opts?.connection ?? new Connection(DEVNET_RPC, "confirmed");

  const mintKeypair = Keypair.generate();

  const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      payer.publicKey,
      payer.publicKey,
      transferFeeBps,
      maxFee,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      TOKEN_DECIMALS,
      payer.publicKey,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, createMintTx, [
    payer,
    mintKeypair,
  ]);

  const payerAta = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    payer.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const mintSupplyTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      payerAta,
      payer.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      payerAta,
      payer.publicKey,
      supply,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  const signature = await sendAndConfirmTransaction(connection, mintSupplyTx, [
    payer,
  ]);

  return { mint: mintKeypair.publicKey, mintKeypair, payerAta, signature };
}
