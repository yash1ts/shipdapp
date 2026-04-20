# ShipDapp

**pump.fun for apps** — Deploy an app, launch a token, trading tax pays hosting.

A platform where anyone can deploy a full-stack Dockerized app to decentralized cloud (Akash Network), and each app automatically gets its own Token-2022 token with a built-in 2% transfer fee. That fee collects into a hosting vault that pays for the app's infrastructure. Popular apps self-fund. Dead apps die naturally.

**Everything runs on testnets — zero real money needed.**

---

## Architecture

```
Frontend (Next.js)  →  Cloudflare Worker (D1 + Workflows)  →  Solana Devnet
                                                          →  Akash Sandbox-2 (playground)
                                                          →  Meteora DBC (Devnet)
```

| Component | Network | Cost |
|---|---|---|
| Solana Programs + Token-2022 | Devnet | Free (airdrop SOL) |
| Meteora DBC Bonding Curves | Devnet | Free |
| Akash Deployments | **Sandbox-2** (default) or testnet-oracle | Free playground / test funds |
| Cloudflare Worker + D1 | Workers | Free tier available |
| Frontend | localhost / Vercel | Free |

---

## Project Structure

```
shipdapp/
├── programs/shipdapp/       # Anchor Solana program (Rust)
│   └── src/lib.rs           # App Registry, Vault, platform config
├── sdk/                     # Shared TypeScript SDK
│   └── src/
│       ├── createAppToken.ts    # Token-2022 mint + transfer fee
│       ├── harvestFees.ts       # Fee harvesting utilities
│       ├── createBondingCurve.ts # Meteora DBC integration
│       ├── generateSDL.ts       # Akash SDL template generator
│       └── pda.ts               # PDA derivation helpers
├── cloudflare-backend/      # Cloudflare Worker API + Workflow
│   ├── src/                 # Worker routes, Akash orchestrator, deploy workflow
│   ├── drizzle/migrations/  # D1 (SQLite) schema (e.g. app_deployments)
│   └── wrangler.jsonc       # Bindings: D1, Workflows, mTLS cert, cron trigger
├── frontend/                # Next.js web app
│   └── src/
│       ├── app/                 # App router pages
│       ├── components/          # UI components
│       └── lib/                 # Client utilities
├── tests/                   # Anchor program tests
├── Anchor.toml
├── Cargo.toml
└── package.json
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Rust + Cargo
- Anchor CLI (`avm install latest && avm use latest`)
- Solana CLI (`solana config set --url devnet`)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`) for the Cloudflare Worker + D1 migrations

### 1. Install Dependencies

```bash
# Root (Anchor tests)
npm install

# Frontend
cd frontend && npm install

# SDK
cd ../sdk && npm install
```

### 2. Build & Deploy Solana Program

```bash
# Get devnet SOL
solana airdrop 5

# Build the Anchor program
anchor build

# Deploy to devnet
anchor deploy

# Update program ID in Anchor.toml and lib.rs, then rebuild
anchor build
```

### 3. Cloudflare Worker + Launch (Akash fund-then-deploy)

Apply D1 migrations and deploy the Worker (from `cloudflare-backend/`):

```bash
cd cloudflare-backend
npm install
npx wrangler d1 migrations apply shipdapp-db --remote
npx wrangler deploy
```

Set Worker secrets via `wrangler secret put <NAME>` (see `cloudflare-backend/wrangler.jsonc` for the full list):

- `AKASH_HOT_MNEMONIC` — Akash hot wallet mnemonic (owner of on-chain cert)
- `AKASH_MTLS_CERT_PEM`, `AKASH_MTLS_PUBLIC_KEY_PEM` (or `AKASH_MTLS_PEM_BUNDLE`) — must match the cert uploaded via `wrangler mtls-certificate upload` and registered on-chain
- `SOLANA_RPC_URL` — devnet/mainnet-beta RPC endpoint

**Launch page (`/launch`):** The browser calls the Worker at `…/api/{deployments-init,deployments-status,deploy-akt}`. The durable `DeployAppWorkflow` (bound as `DEPLOY_APP_WORKFLOW`) runs the cert → create → manifest steps. Set **`frontend/.env.local`**: `NEXT_PUBLIC_API_URL` to your Worker URL. Fund each launch's **`akash1…`** with sandbox **uAKT** before deploy.

### 4. Start Frontend

```bash
cd frontend
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SHIPDAPP_PROGRAM_ID
npm run dev
# Open http://localhost:3000
```

---

## How It Works

1. **Ship a Container** — User provides a Docker image URI
2. **Token Created** — Token-2022 mint with 2% transfer fee on Solana devnet
3. **Bonding Curve** — Meteora DBC pool created for price discovery
4. **Akash Deploy** — On-chain deploy via **Cloudflare Worker + Workflow** (`/launch`: init → fund → `deploy-akt`)
5. **Self-Funding** — Transfer fees from token trades flow into hosting vault
6. **Lifecycle** — Popular apps stay alive, unfunded apps pause/die naturally

---

## Tech Stack

- **Solana** — Anchor framework, Token-2022 (transfer fee extension)
- **Meteora DBC** — Dynamic bonding curve for token price discovery
- **Akash Network** — Decentralized cloud ([Sandbox-2](https://github.com/akash-network/net/tree/main/sandbox-2) playground; legacy Sandbox-1 retired after v2.0 / Twilight-era upgrades). Worker/scripts use **`@akashnetwork/chain-sdk@alpha`** on npm (currently tracks the latest **1.0.0-alpha.\*** line; the `latest` dist-tag is stale) plus **CosmJS 0.36.x** to match chain-sdk's peer range.
- **Cloudflare Workers + D1 + Workflows** — API, SQLite database, and durable multi-step Akash deploy orchestration (with `mtls_certificates` binding for provider mTLS)
- **Next.js 14** — Frontend with App Router
- **Tailwind CSS** — Dark web3 + Docker/ship theme

---

## Devnet Resources

```bash
# Get devnet SOL
solana airdrop 2

# Or use the faucet
# https://faucet.solana.com

# Akash Sandbox-2 — fund each launch’s `akash1…` (from /launch), then Edge `deploy-akt` runs on-chain.
# Default RPC/gRPC/LCD in this repo: akash-network/net community mirrors on **aksh.pw** (always resolvable):
#   https://rpc.sandbox-2.aksh.pw:443  |  http://grpc.sandbox-2.aksh.pw:9090  |  https://api.sandbox-2.aksh.pw
# When `*.sandbox-02.akash.network` is in DNS for you, you may point secrets at those hosts instead.
# Faucet: [akash-network/net sandbox-2](https://github.com/akash-network/net/tree/main/sandbox-2) (faucet-url.txt) or Console → Sandbox.
# Console: https://console.akash.network → Settings → Sandbox
# For testnet-oracle instead: https://oraclefaucet.dev.akash.pub/
```

### Akash Sandbox-2 troubleshooting

- **Akash CLI** — Use **v2.0.0+**; older CLIs do not understand post-Twilight transaction and marketplace shapes.
- **Balances / escrow** — After BME-related changes, fund from the **current** Sandbox-2 faucet and ensure deployment escrow (e.g. `uact`) plus fee denoms match what the chain expects.
- **RPC sync** — Use a synced node (defaults: `rpc.sandbox-2.aksh.pw`, or your own / `*.sandbox-02.akash.network` when it resolves). Stale RPC can show broadcasts that never land.
- **SDL** — Providers on v2.0+ enforce stricter SDL/resource shapes; invalid manifests fail at bid or send-manifest time.
- **No bids** — Playground provider inventory fluctuates; relax uptime filters (`AKASH_RELAX_UPTIME`) or adjust CPU/mem in SDL.
- **Manifest / lease 401** — Confirm mTLS PEM matches the on-chain cert for the deployment owner, the lease is still active, and `hostUri` with gseq/oseq match that lease (see `scripts/verify-provider-mtls.ts`).
- **Debug** — `akash tx … --trace` (or `-v`) helps surface sequence mismatches vs insufficient funds.

---

## License

MIT
