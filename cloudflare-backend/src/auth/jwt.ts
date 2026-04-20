/**
 * Thin wrappers over `hono/jwt` for issuing and verifying SIWS session tokens.
 *
 * Tokens are HS256 JWTs signed with `AUTH_JWT_SECRET`. The only claim we rely on is `sub`
 * (the wallet base58 pubkey). Expiration is enforced by `hono/jwt` via the `exp` claim.
 */

import { sign, verify } from 'hono/jwt';
import { SESSION_TTL_SECONDS } from './siws';

export type SessionClaims = {
	sub: string; // wallet base58 pubkey
	iat: number;
	exp: number;
};

export async function issueSessionToken(args: {
	wallet: string;
	secret: string;
}): Promise<{ token: string; expiresAt: string }> {
	const iat = Math.floor(Date.now() / 1000);
	const exp = iat + SESSION_TTL_SECONDS;
	const payload: SessionClaims = { sub: args.wallet, iat, exp };
	const token = await sign(payload, args.secret, 'HS256');
	return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function verifySessionToken(args: {
	token: string;
	secret: string;
}): Promise<SessionClaims | null> {
	try {
		const payload = (await verify(args.token, args.secret, 'HS256')) as SessionClaims;
		if (!payload?.sub) return null;
		return payload;
	} catch {
		return null;
	}
}
