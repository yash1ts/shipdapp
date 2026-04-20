/**
 * Sign-In-With-Solana (SIWS) primitives: nonce minting, canonical message text, and Ed25519
 * signature verification via the Workers WebCrypto API.
 *
 * Flow (see routes in src/index.ts):
 *   1. POST /api/auth/nonce { wallet }              → returns { nonce, message, expiresAt }
 *      The exact `message` string must be signed verbatim by the wallet.
 *   2. POST /api/auth/verify { wallet, signature }  → verifies sig against the message we stored
 *      in AUTH_KV, then issues a short-lived HS256 JWT and deletes the nonce (single-use).
 *
 * All nonces are single-use and expire after NONCE_TTL_SECONDS. The KV record is the source of
 * truth for the message text so the client can't swap in a different one after nonce issuance.
 */

import bs58 from 'bs58';

export const NONCE_TTL_SECONDS = 300; // 5 minutes — comfortable for wallet UX, short enough to limit replay
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export const STATEMENT = 'Sign in to ShipDapp. This request will not trigger a blockchain transaction or cost any gas fees.';

function kvKey(wallet: string): string {
	return `siws:nonce:${wallet}`;
}

function randomNonce(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	// URL-safe, fits in message cleanly
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function buildSiwsMessage(params: {
	domain: string;
	wallet: string;
	nonce: string;
	issuedAt: string;
	expiresAt: string;
	chain?: string;
}): string {
	const chain = params.chain ?? 'solana:devnet';
	// Loosely modeled on CAIP-122 / SIWE — keep it human readable so users see what they sign.
	return [
		`${params.domain} wants you to sign in with your Solana account:`,
		params.wallet,
		'',
		STATEMENT,
		'',
		`URI: https://${params.domain}`,
		'Version: 1',
		`Chain ID: ${chain}`,
		`Nonce: ${params.nonce}`,
		`Issued At: ${params.issuedAt}`,
		`Expiration Time: ${params.expiresAt}`,
	].join('\n');
}

type StoredNonce = {
	nonce: string;
	message: string;
	expiresAt: string; // ISO
};

export async function mintNonce(
	kv: KVNamespace,
	args: { wallet: string; domain: string },
): Promise<StoredNonce> {
	const nonce = randomNonce();
	const issuedAtMs = Date.now();
	const expiresAtMs = issuedAtMs + NONCE_TTL_SECONDS * 1000;
	const issuedAt = new Date(issuedAtMs).toISOString();
	const expiresAt = new Date(expiresAtMs).toISOString();
	const message = buildSiwsMessage({
		domain: args.domain,
		wallet: args.wallet,
		nonce,
		issuedAt,
		expiresAt,
	});
	const record: StoredNonce = { nonce, message, expiresAt };
	await kv.put(kvKey(args.wallet), JSON.stringify(record), {
		expirationTtl: NONCE_TTL_SECONDS,
	});
	return record;
}

export async function consumeNonce(
	kv: KVNamespace,
	wallet: string,
): Promise<StoredNonce | null> {
	const raw = await kv.get(kvKey(wallet));
	if (!raw) return null;
	// Single-use: remove before we verify so a replay with the same signature can't double-spend.
	await kv.delete(kvKey(wallet));
	try {
		const parsed = JSON.parse(raw) as StoredNonce;
		if (Date.parse(parsed.expiresAt) < Date.now()) return null;
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Verify an Ed25519 signature produced by a Solana wallet.
 *   - `walletBase58`: the signer's pubkey (base58)
 *   - `message`:      the exact UTF-8 string that was signed
 *   - `signatureBase58`: 64-byte Ed25519 signature, base58 encoded
 *
 * Uses Workers' native WebCrypto Ed25519 support (compat_date ≥ 2023-05-02).
 */
export async function verifySolanaSignature(params: {
	walletBase58: string;
	message: string;
	signatureBase58: string;
}): Promise<boolean> {
	let publicKeyBytes: Uint8Array;
	let signatureBytes: Uint8Array;
	try {
		publicKeyBytes = bs58.decode(params.walletBase58);
		signatureBytes = bs58.decode(params.signatureBase58);
	} catch {
		return false;
	}
	if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return false;

	const messageBytes = new TextEncoder().encode(params.message);
	try {
		const key = await crypto.subtle.importKey(
			'raw',
			publicKeyBytes,
			{ name: 'Ed25519' },
			false,
			['verify'],
		);
		return await crypto.subtle.verify('Ed25519', key, signatureBytes, messageBytes);
	} catch {
		return false;
	}
}
