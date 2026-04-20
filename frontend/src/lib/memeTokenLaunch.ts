import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type SendOptions,
} from "@solana/web3.js";
import {
  ExtensionType,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMintLen,
} from "@solana/spl-token";

export type WalletSendTransaction = (
  transaction: Transaction,
  connection: Connection,
  options?: SendOptions & { signers?: Keypair[] }
) => Promise<string>;

export interface LaunchMemeTokenInput {
  connection: Connection;
  walletPublicKey: PublicKey;
  sendTransaction: WalletSendTransaction;
  name: string;
  symbol: string;
  metadataUri?: string;
  totalSupplyUi?: number;
  transferFeeBps?: number;
  maxFeeUi?: number;
  decimals?: number;
}

export interface LaunchMemeTokenResult {
  config: PublicKey;
  pool: PublicKey;
  mint: PublicKey;
  ownerAta: PublicKey;
  mintTx: string;
  configTx: string;
  bondingCurveTx: string;
}

/**
 * Creates a Token-2022 meme token and then attempts a Meteora bonding-curve bootstrap.
 * The bonding-curve call is best-effort because Meteora SDK API varies across versions.
 */
export async function launchMemeTokenWithBondingCurve(
  input: LaunchMemeTokenInput
): Promise<LaunchMemeTokenResult> {
  const {
    connection,
    walletPublicKey,
    sendTransaction,
    name,
    symbol,
    metadataUri,
    decimals = 6,
    totalSupplyUi = 1_000_000_000,
    transferFeeBps = 200,
    maxFeeUi = 1_000,
  } = input;

  const mintKeypair = Keypair.generate();
  const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
  const rent = await connection.getMinimumBalanceForRentExemption(mintLen);
  const scale = BigInt(10 ** decimals);
  const supplyBaseUnits = BigInt(Math.floor(totalSupplyUi)) * scale;
  const maxFeeBaseUnits = BigInt(Math.floor(maxFeeUi)) * scale;

  const ownerAta = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    walletPublicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );

  const mintTx = new Transaction().add(
    // Create Token-2022 mint account.
    SystemProgram.createAccount({
      fromPubkey: walletPublicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports: rent,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferFeeConfigInstruction(
      mintKeypair.publicKey,
      walletPublicKey,
      walletPublicKey,
      transferFeeBps,
      maxFeeBaseUnits,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      decimals,
      walletPublicKey,
      walletPublicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    createAssociatedTokenAccountInstruction(
      walletPublicKey,
      ownerAta,
      walletPublicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      ownerAta,
      walletPublicKey,
      supplyBaseUnits,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  const mintSig = await sendTransaction(mintTx, connection, {
    signers: [mintKeypair],
  });
  await connection.confirmTransaction(mintSig, "confirmed");

  const sdk = await import("@meteora-ag/dynamic-bonding-curve-sdk");
  const {
    ActivationType,
    BaseFeeMode,
    CollectFeeMode,
    DammV2BaseFeeMode,
    DammV2DynamicFeeMode,
    DynamicBondingCurveClient,
    MigratedCollectFeeMode,
    MigrationFeeOption,
    MigrationOption,
    TokenDecimal,
    TokenType,
    TokenUpdateAuthorityOption,
    buildCurveWithMarketCap,
    deriveDbcPoolAddress,
  } = sdk;

  const client = DynamicBondingCurveClient.create(connection, "confirmed");
  const configKeypair = Keypair.generate();

  // Pump.fun-like default profile: Token-2022 supply, SOL quote, migration gate.
  const configParams = buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.Token2022,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenUpdateAuthority: TokenUpdateAuthorityOption.CreatorUpdateAuthority,
      totalTokenSupply: Math.floor(totalSupplyUi),
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 120,
          endingFeeBps: 30,
          numberOfPeriod: 8,
          totalDuration: 3600,
        },
      },
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 20,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: true,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.Customizable,
      migrationFee: {
        feePercentage: 1,
        creatorFeePercentage: 20,
      },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Enabled,
        poolFeeBps: 100,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 0,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 10,
      creatorLiquidityPercentage: 90,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: 24,
    migrationMarketCap: 96,
  });

  const createConfigTx = await client.partner.createConfig({
    config: configKeypair.publicKey,
    feeClaimer: walletPublicKey,
    leftoverReceiver: walletPublicKey,
    quoteMint: NATIVE_MINT,
    payer: walletPublicKey,
    ...configParams,
  });

  const configSig = await sendTransaction(createConfigTx, connection, {
    signers: [configKeypair],
  });
  await connection.confirmTransaction(configSig, "confirmed");

  const createPoolTx = await client.pool.createPool({
    config: configKeypair.publicKey,
    payer: walletPublicKey,
    poolCreator: walletPublicKey,
    baseMint: mintKeypair.publicKey,
    name: name.trim(),
    symbol: symbol.trim().toUpperCase(),
    uri:
      metadataUri?.trim() ||
      `https://images.unsplash.com/photo-1639762681485-074b7f938ba0?auto=format&fit=crop&w=512&q=80`,
  });

  const poolSig = await sendTransaction(createPoolTx, connection);
  await connection.confirmTransaction(poolSig, "confirmed");

  const poolAddress = deriveDbcPoolAddress(
    NATIVE_MINT,
    mintKeypair.publicKey,
    configKeypair.publicKey
  );

  return {
    config: configKeypair.publicKey,
    pool: poolAddress,
    mint: mintKeypair.publicKey,
    ownerAta,
    mintTx: mintSig,
    configTx: configSig,
    bondingCurveTx: poolSig,
  };
}
