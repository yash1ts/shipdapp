/**
 * Akash bank REST: balances + minimums for deploy.
 *
 * New deployments: escrow deposit is **uact** (ACT); tx fees stay **uakt** (AKT).
 * See akash-network/node `x/deployment/handler/server.go` CreateDeployment.
 */

import { chainSdkManifestNetworkFromEnv } from "./manifestNetworkFromEnv";

type BalanceEnv = {
	AKASH_REST_URL?: string;
	AKASH_MANIFEST_NETWORK?: string;
	AKASH_DEPOSIT_UACT?: string;
	AKASH_DEPOSIT_UAKT?: string;
	AKASH_MIN_BALANCE_UACT?: string;
	AKASH_MIN_UAKT_GAS?: string;
};

/** Public LCD; override with AKASH_REST_URL. Testnet has no stable default — set the secret. */
export function akashRestBaseUrl(env: BalanceEnv): string | null {
	const override = env.AKASH_REST_URL?.trim();
	if (override) return override.replace(/\/$/, "");
	const net = chainSdkManifestNetworkFromEnv(env);
	if (net === "sandbox") return "https://api.sandbox-2.aksh.pw";
	if (net === "mainnet") return "https://api.akashnet.net";
	return null;
}

/** On-chain deployment escrow amount (uact). Falls back to legacy AKASH_DEPOSIT_UAKT env name. */
export function akashDepositUact(env: BalanceEnv): bigint {
	const uact = env.AKASH_DEPOSIT_UACT?.trim();
	if (uact) return BigInt(uact);
	const legacy = env.AKASH_DEPOSIT_UAKT?.trim();
	if (legacy) return BigInt(legacy);
	return 5_000_000n;
}

/** Minimum uact before deploy (escrow + small buffer). Override with AKASH_MIN_BALANCE_UACT. */
export function minAkashUactForDeploy(env: BalanceEnv): bigint {
	const raw = env.AKASH_MIN_BALANCE_UACT?.trim();
	if (raw) return BigInt(raw);
	return akashDepositUact(env) + 1_000_000n;
}

/** Minimum uakt kept for cert / deployment / lease gas. */
export function minAkashUaktForGas(env: BalanceEnv): bigint {
	const raw = env.AKASH_MIN_UAKT_GAS?.trim();
	if (raw) return BigInt(raw);
	return 3_000_000n;
}

async function fetchDenomBalance(env: BalanceEnv, akashAddress: string, denom: string): Promise<bigint> {
	const base = akashRestBaseUrl(env);
	if (!base) {
		throw new Error("Set secret AKASH_REST_URL (required for testnet balance checks)");
	}
	const url = `${base}/cosmos/bank/v1beta1/balances/${encodeURIComponent(akashAddress)}`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Akash REST ${res.status} for ${url}`);
	const j = (await res.json()) as {
		balances?: { denom?: string; amount?: string }[];
	};
	for (const b of j.balances ?? []) {
		if (b.denom === denom) return BigInt(b.amount ?? "0");
	}
	return 0n;
}

export async function fetchUaktBalance(env: BalanceEnv, akashAddress: string): Promise<bigint> {
	return fetchDenomBalance(env, akashAddress, "uakt");
}

export async function fetchUactBalance(env: BalanceEnv, akashAddress: string): Promise<bigint> {
	return fetchDenomBalance(env, akashAddress, "uact");
}

/**
 * Query the on-chain escrow balance (uact) for a specific deployment.
 * Uses the deployment list REST endpoint which includes escrow_account data.
 */
export async function fetchEscrowBalanceUact(env: BalanceEnv, owner: string, dseq: string): Promise<bigint> {
	const base = akashRestBaseUrl(env);
	if (!base) {
		throw new Error("AKASH_REST_URL required for escrow balance queries");
	}
	const url = `${base}/akash/deployment/v1beta3/deployments/list?filters.owner=${encodeURIComponent(owner)}&filters.dseq=${encodeURIComponent(dseq)}`;
	const res = await fetch(url);
	if (!res.ok) {
		if (res.status === 404) return 0n;
		throw new Error(`Akash REST ${res.status} for escrow query`);
	}
	const j = (await res.json()) as {
		deployments?: {
			escrow_account?: { balance?: { amount?: string } };
		}[];
	};
	const deps = j.deployments ?? [];
	if (deps.length === 0) return 0n;
	const amt = deps[0]?.escrow_account?.balance?.amount;
	return amt ? BigInt(amt) : 0n;
}
