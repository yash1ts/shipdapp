import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const appDeployments = sqliteTable('app_deployments', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	appName: text('app_name').notNull(),
	description: text('description'),
	dockerImage: text('docker_image').notNull(),
	port: integer('port').notNull().default(3000),
	solanaTreasuryPublicKey: text('solana_treasury_public_key'),
	solanaTreasurySecretCipher: text('solana_treasury_secret_cipher'),
	solanaTreasurySecretIv: text('solana_treasury_secret_iv'),
	akashAddress: text('akash_address'),
	akashMnemonicCipher: text('akash_mnemonic_cipher'),
	akashMnemonicIv: text('akash_mnemonic_iv'),
	status: text('status').notNull().default('PENDING_FUNDS'),
	akashDseq: text('akash_dseq'),
	akashProvider: text('akash_provider'),
	akashChainResult: text('akash_chain_result', { mode: 'json' }),
	lastError: text('last_error'),
	deployAttemptCount: integer('deploy_attempt_count').notNull().default(0),
	// Cloudflare Workflows instance id for the in-flight / most recent DeployAppWorkflow run.
	// Used by GET /api/deployments-status/:id to surface live step state.
	workflowInstanceId: text('workflow_instance_id'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
});
