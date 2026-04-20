import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and } from 'drizzle-orm';
import bs58 from 'bs58';
import { appDeployments, users } from './db/schema';
import { type Env } from './_shared/env';
import { mintNonce, consumeNonce, verifySolanaSignature } from './auth/siws';
import { issueSessionToken } from './auth/jwt';
import { requireAuth, type AuthVariables } from './auth/middleware';

// Solana base58 pubkeys are 32 bytes → 43-44 base58 chars. Reject anything obviously off
// so we don't pollute the users table with garbage.
function isLikelySolanaPubkey(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	if (value.length < 32 || value.length > 44) return false;
	return /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}

// Default dev origins when CORS_ALLOWED_ORIGINS is not configured. Production MUST set the var
// so we don't fall open for every site.
const DEV_ORIGINS = [
	'http://localhost:3000',
	'http://127.0.0.1:3000',
	'http://localhost:3001',
	'http://127.0.0.1:3001',
];

function parseAllowedOrigins(raw: string | undefined): string[] {
	if (!raw) return DEV_ORIGINS;
	return raw
		.split(',')
		.map((s) => s.trim().replace(/\/$/, ''))
		.filter(Boolean);
}

// Columns that never leave the worker: they either hold secrets (encrypted treasury / mnemonic
// material) or expose internal state that isn't useful to end users and complicates blast radius
// if the API is scraped. Treat these as reserved for the worker + cron only.
type DeploymentRow = typeof appDeployments.$inferSelect;
type PublicDeployment = Omit<
	DeploymentRow,
	| 'solanaTreasurySecretCipher'
	| 'solanaTreasurySecretIv'
	| 'akashAddress'
	| 'akashMnemonicCipher'
	| 'akashMnemonicIv'
	| 'akashChainResult'
	| 'workflowInstanceId'
	| 'deployAttemptCount'
>;

function toPublicDeployment(row: DeploymentRow): PublicDeployment {
	const {
		solanaTreasurySecretCipher: _a,
		solanaTreasurySecretIv: _b,
		akashAddress: _c,
		akashMnemonicCipher: _d,
		akashMnemonicIv: _e,
		akashChainResult: _f,
		workflowInstanceId: _g,
		deployAttemptCount: _h,
		...publicRow
	} = row;
	return publicRow;
}

export { DeployAppWorkflow } from './workflows/deployAppWorkflow';

const SOL_GATE = 0.1;

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.use('*', (c, next) => {
	const allowed = parseAllowedOrigins(c.env.CORS_ALLOWED_ORIGINS);
	return cors({
		origin: (origin) => {
			// Non-browser clients (no Origin header) pass through — they aren't subject to CORS
			// and blocking them here would only confuse curl / server-to-server callers.
			if (!origin) return origin;
			return allowed.includes(origin) ? origin : null;
		},
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
		maxAge: 600,
	})(c, next);
});

// Root: never use a static `public/index.html` here — that hid the real app behind a template.
// Either redirect to the Next.js Pages URL or show a tiny API landing page.
app.get('/', (c) => {
	const raw = (c.env.PUBLIC_FRONTEND_URL ?? '').trim();
	if (raw && /^https?:\/\//i.test(raw)) {
		return c.redirect(raw, 302);
	}
	const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ShipDapp API</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;max-width:40rem;line-height:1.55;color:#e2e8f0;background:#0f172a}
a{color:#38bdf8}code{background:#1e293b;padding:0.15rem 0.4rem;border-radius:4px}
</style>
</head>
<body>
<h1>ShipDapp API</h1>
<p>This hostname is the <strong>Cloudflare Worker</strong> (REST API + cron + workflows). The marketing / app UI is the <strong>Next.js build on Cloudflare Pages</strong> — open that URL in the browser.</p>
<p>To auto-redirect from here to your UI, set <code>PUBLIC_FRONTEND_URL</code> in <code>wrangler.jsonc</code> vars (e.g. your <code>*.pages.dev</code> URL) and redeploy this Worker.</p>
<hr/>
<p><a href="/api/deployments"><code>GET /api/deployments</code></a> — list recent deployments (public JSON).</p>
</body>
</html>`;
	return c.html(html);
});

// ---------------- SIWS auth ----------------

// Derive the domain used inside the signed message from the request's Host header. Signing with
// a different domain than the one actually serving the API is one of the key replay defenses in
// SIWE/SIWS, so we pin this server-side rather than trusting the client.
function siwsDomain(c: { req: { header: (k: string) => string | undefined } }): string {
	const host = c.req.header('host') ?? c.req.header('x-forwarded-host') ?? 'shipdapp.local';
	return host.split(':')[0] ?? 'shipdapp.local';
}

// Issue a fresh nonce + canonical SIWS message for the wallet. Client signs the returned
// `message` VERBATIM with their wallet; never modify / reformat it.
app.post('/api/auth/nonce', async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const wallet = typeof body?.wallet === 'string' ? body.wallet : '';
	if (!isLikelySolanaPubkey(wallet)) {
		return c.json({ error: 'Invalid wallet address' }, 400);
	}
	const record = await mintNonce(c.env.AUTH_KV, { wallet, domain: siwsDomain(c) });
	return c.json({
		nonce: record.nonce,
		message: record.message,
		expiresAt: record.expiresAt,
	});
});

// Verify the signed SIWS message and exchange it for a session JWT.
app.post('/api/auth/verify', async (c) => {
	if (!c.env.AUTH_JWT_SECRET) {
		return c.json({ error: 'Auth is not configured on this worker' }, 500);
	}
	const body = await c.req.json().catch(() => ({}));
	const wallet = typeof body?.wallet === 'string' ? body.wallet : '';
	const signature = typeof body?.signature === 'string' ? body.signature : '';
	if (!isLikelySolanaPubkey(wallet) || !signature) {
		return c.json({ error: 'wallet and signature are required' }, 400);
	}

	const stored = await consumeNonce(c.env.AUTH_KV, wallet);
	if (!stored) {
		return c.json({ error: 'Nonce expired or not found. Request a new one.' }, 401);
	}

	const ok = await verifySolanaSignature({
		walletBase58: wallet,
		message: stored.message,
		signatureBase58: signature,
	});
	if (!ok) {
		return c.json({ error: 'Invalid signature' }, 401);
	}

	// First login for this wallet? Make sure the users row exists so FK constraints hold when
	// the user later launches an app.
	const db = drizzle(c.env.DB);
	await db.insert(users).values({ walletAddress: wallet }).onConflictDoNothing();

	const { token, expiresAt } = await issueSessionToken({
		wallet,
		secret: c.env.AUTH_JWT_SECRET,
	});
	return c.json({ token, expiresAt, wallet });
});

// Cheap probe the frontend can call to see if a stored token is still valid.
app.get('/api/auth/me', requireAuth, async (c) => {
	return c.json({ wallet: c.var.wallet });
});

// ---------------- Deployments ----------------

app.post('/api/deployments-init', requireAuth, async (c) => {
	const db = drizzle(c.env.DB);
	const body = await c.req.json();
	const { appName, dockerImage, description, port, tokenName, tokenSymbol } = body;
	// Always take the owner wallet from the verified session, never from the body. The body's
	// `ownerWallet`, if any, is ignored.
	const owner = c.var.wallet;

	if (!appName || !dockerImage) {
		return c.json({ error: 'appName and dockerImage are required' }, 400);
	}

	const p = port === undefined || port === null ? 3000 : Number(port);
	const portNum = Number.isFinite(p) && p > 0 ? Math.floor(p) : 3000;

	const pubkey = new Uint8Array(32);
	crypto.getRandomValues(pubkey);
	const fundingAddress = bs58.encode(pubkey);

	// Make sure the users row exists (auth/verify usually creates it; this is belt-and-braces).
	await db.insert(users).values({ walletAddress: owner }).onConflictDoNothing();

	const [row] = await db
		.insert(appDeployments)
		.values({
			appName,
			description: description || null,
			dockerImage,
			port: portNum,
			solanaTreasuryPublicKey: fundingAddress,
			status: 'PENDING_FUNDS',
			ownerWallet: owner,
			tokenName: typeof tokenName === 'string' && tokenName.trim() ? tokenName.trim() : null,
			tokenSymbol: typeof tokenSymbol === 'string' && tokenSymbol.trim() ? tokenSymbol.trim().toUpperCase() : null,
		})
		.returning({ id: appDeployments.id });

	const minLamports = Math.floor(SOL_GATE * 1_000_000_000);

	return c.json({
		deploymentId: row.id,
		status: 'PENDING_FUNDS',
		fundingAddress,
		port: portNum,
		minSolGate: SOL_GATE,
		minSolGateLamports: minLamports.toString(),
		note: `Send >= ${SOL_GATE} SOL to the funding address. The cron auto-deploys via the AKT Hot Wallet once funded.`,
	});
});

app.get('/api/deployments-status/:id', async (c) => {
	const db = drizzle(c.env.DB);
	const { id } = c.req.param();

	const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, id));
	if (!deployment) return c.json({ error: 'Not found' }, 404);

	let workflow: { id: string; status: unknown; output?: unknown; error?: unknown } | null = null;
	if (deployment.workflowInstanceId) {
		try {
			const instance = await c.env.DEPLOY_APP_WORKFLOW.get(deployment.workflowInstanceId);
			const status = await instance.status();
			workflow = {
				id: deployment.workflowInstanceId,
				status: status.status,
				output: status.output,
				error: status.error,
			};
		} catch (e) {
			workflow = {
				id: deployment.workflowInstanceId,
				status: 'unknown',
				error: e instanceof Error ? e.message : String(e),
			};
		}
	}

	return c.json({ ...toPublicDeployment(deployment), workflow });
});

app.get('/api/deployments', async (c) => {
	const db = drizzle(c.env.DB);
	const rows = await db.select().from(appDeployments).orderBy(desc(appDeployments.createdAt)).limit(20);
	return c.json(rows.map(toPublicDeployment));
});

// Deployments scoped to the authenticated wallet. The path param must match the session wallet;
// we don't let one authenticated wallet enumerate another wallet's apps.
app.get('/api/users/:wallet/deployments', requireAuth, async (c) => {
	const db = drizzle(c.env.DB);
	const { wallet } = c.req.param();
	if (!isLikelySolanaPubkey(wallet)) {
		return c.json({ error: 'Invalid wallet address' }, 400);
	}
	if (wallet !== c.var.wallet) {
		return c.json({ error: 'Forbidden' }, 403);
	}
	const rows = await db
		.select()
		.from(appDeployments)
		.where(eq(appDeployments.ownerWallet, wallet))
		.orderBy(desc(appDeployments.createdAt));
	return c.json(rows.map(toPublicDeployment));
});

/**
 * Kick off the deployment workflow for a given deployment row. Used by the cron after the SOL
 * gate passes. Idempotent against double-invocation via the `status` guard + workflow id reuse.
 */
async function startDeploymentWorkflow(env: Env, deploymentId: string): Promise<string | null> {
	const db = drizzle(env.DB);
	const updated = await db
		.update(appDeployments)
		.set({ status: 'DEPLOYING', updatedAt: new Date() })
		.where(and(eq(appDeployments.id, deploymentId), eq(appDeployments.status, 'PENDING_FUNDS')))
		.returning({ id: appDeployments.id });
	if (updated.length === 0) return null;

	// Workflow instance ids must be globally unique. If a prior attempt failed we can't reuse
	// `deploymentId` as the instance id, so derive a fresh one per attempt.
	const instanceId = `${deploymentId}-${Date.now()}`;
	try {
		const instance = await env.DEPLOY_APP_WORKFLOW.create({
			id: instanceId,
			params: { deploymentId },
		});
		await db
			.update(appDeployments)
			.set({ workflowInstanceId: instance.id, updatedAt: new Date() })
			.where(eq(appDeployments.id, deploymentId));
		return instance.id;
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		await db
			.update(appDeployments)
			.set({ status: 'FAILED', lastError: `[workflow-create] ${msg}`, updatedAt: new Date() })
			.where(eq(appDeployments.id, deploymentId));
		return null;
	}
}

export default {
	fetch: app.fetch,
	async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
		const db = drizzle(env.DB);
		const pending = await db
			.select()
			.from(appDeployments)
			.where(eq(appDeployments.status, 'PENDING_FUNDS'));
		console.log(`[cron] Found ${pending.length} PENDING_FUNDS deployments`);

		// TODO: gate each deployment on its treasury's SOL balance before kicking off the workflow.
		// For now, any PENDING_FUNDS row is eligible — wire in the Solana balance check here and
		// skip rows that are below SOL_GATE.
		ctx.waitUntil(
			Promise.all(pending.map((d) => startDeploymentWorkflow(env, d.id))).then(() => undefined),
		);
	},
};
