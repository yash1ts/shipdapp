/**
 * `requireAuth` Hono middleware. Parses a `Authorization: Bearer <jwt>` header, verifies the
 * token with `AUTH_JWT_SECRET`, and exposes the authenticated wallet on `c.var.wallet`.
 *
 * Routes that want owner-scoped access pull the wallet from here — never from the request body
 * or URL — so clients can't impersonate another wallet by lying in the payload.
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../_shared/env';
import { verifySessionToken } from './jwt';

export type AuthVariables = {
	wallet: string;
};

export const requireAuth: MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }> = async (
	c,
	next,
) => {
	const header = c.req.header('authorization') || c.req.header('Authorization');
	if (!header || !header.toLowerCase().startsWith('bearer ')) {
		return c.json({ error: 'Missing bearer token' }, 401);
	}
	const token = header.slice(7).trim();
	if (!token) return c.json({ error: 'Missing bearer token' }, 401);
	if (!c.env.AUTH_JWT_SECRET) {
		// Fail closed — better to 500 than to silently accept unsigned requests in prod.
		return c.json({ error: 'Auth is not configured on this worker' }, 500);
	}

	const claims = await verifySessionToken({ token, secret: c.env.AUTH_JWT_SECRET });
	if (!claims) return c.json({ error: 'Invalid or expired token' }, 401);

	c.set('wallet', claims.sub);
	await next();
};
