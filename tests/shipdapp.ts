import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { expect } from "chai";
import {
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
} from "@solana/spl-token";

// Import IDL type after anchor build
// import { Shipdapp } from "../target/types/shipdapp";

describe("shipdapp", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // const program = anchor.workspace.Shipdapp as Program<Shipdapp>;
  const authority = provider.wallet;

  let platformConfig: PublicKey;
  let platformBump: number;

  it("Initializes the platform", async () => {
    [platformConfig, platformBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("platform")],
      // program.programId
      SystemProgram.programId // placeholder until deployed
    );

    // const tx = await program.methods
    //   .initializePlatform()
    //   .accounts({
    //     platformConfig,
    //     authority: authority.publicKey,
    //     systemProgram: SystemProgram.programId,
    //   })
    //   .rpc();

    // const config = await program.account.platformConfig.fetch(platformConfig);
    // expect(config.authority.toBase58()).to.equal(authority.publicKey.toBase58());
    // expect(config.appCount.toNumber()).to.equal(0);

    console.log("Platform initialization test — deploy program first");
  });

  it("Creates a Token-2022 mint with transfer fee", async () => {
    const mintKeypair = Keypair.generate();
    const mintLen = getMintLen([ExtensionType.TransferFeeConfig]);
    const lamports =
      await provider.connection.getMinimumBalanceForRentExemption(mintLen);

    const tx = new anchor.web3.Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: authority.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mintKeypair.publicKey,
        authority.publicKey,
        authority.publicKey,
        200, // 2%
        BigInt(1_000_000_000),
        TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mintKeypair.publicKey,
        6,
        authority.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID
      )
    );

    await provider.sendAndConfirm(tx, [mintKeypair]);
    console.log("Token-2022 mint created:", mintKeypair.publicKey.toBase58());
  });

  it("Launches an app", async () => {
    // const mintKeypair = Keypair.generate();
    // // ... create Token-2022 mint first ...

    // const appName = "test-app";
    // const [appState] = PublicKey.findProgramAddressSync(
    //   [Buffer.from("app"), authority.publicKey.toBuffer(), Buffer.from(appName)],
    //   program.programId
    // );
    // const [vault] = PublicKey.findProgramAddressSync(
    //   [Buffer.from("vault"), appState.toBuffer()],
    //   program.programId
    // );

    // const tx = await program.methods
    //   .launchApp(appName, "A test application", "docker.io/test/app:latest")
    //   .accounts({
    //     appState,
    //     tokenMint: mintKeypair.publicKey,
    //     hostingVault: vault,
    //     platformConfig,
    //     creator: authority.publicKey,
    //     systemProgram: SystemProgram.programId,
    //   })
    //   .rpc();

    // const app = await program.account.appState.fetch(appState);
    // expect(app.name).to.equal(appName);
    // expect(app.status).to.deep.equal({ deploying: {} });

    console.log("App launch test — deploy program first");
  });

  it("Donates to an app vault", async () => {
    console.log("Donate test — deploy program first");
  });

  it("Withdraws hosting funds", async () => {
    console.log("Withdraw test — deploy program first");
  });
});
