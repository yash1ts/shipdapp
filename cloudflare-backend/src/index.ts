import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/d1';
import { eq, desc, and } from 'drizzle-orm';
import bs58 from 'bs58';
import { appDeployments } from './db/schema';
import { type Env } from './_shared/env';

export { DeployAppWorkflow } from './workflows/deployAppWorkflow';

const SOL_GATE = 0.1;

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.post('/api/deployments-init', async (c) => {
	const db = drizzle(c.env.DB);
	const body = await c.req.json();
	const { appName, dockerImage, description, port } = body;

	if (!appName || !dockerImage) {
		return c.json({ error: 'appName and dockerImage are required' }, 400);
	}

	const p = port === undefined || port === null ? 3000 : Number(port);
	const portNum = Number.isFinite(p) && p > 0 ? Math.floor(p) : 3000;

	const pubkey = new Uint8Array(32);
	crypto.getRandomValues(pubkey);
	const fundingAddress = bs58.encode(pubkey);

	const [row] = await db
		.insert(appDeployments)
		.values({
			appName,
			description: description || null,
			dockerImage,
			port: portNum,
			solanaTreasuryPublicKey: fundingAddress,
			status: 'PENDING_FUNDS',
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

	return c.json({ ...deployment, workflow });
});

app.get('/api/deployments', async (c) => {
	const db = drizzle(c.env.DB);
	const rows = await db.select().from(appDeployments).orderBy(desc(appDeployments.createdAt)).limit(20);
	return c.json(rows);
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
