/**
 * Local mTLS sanity check for an Akash provider. Talks to the provider the same way the
 * Cloudflare Workflow's `send-manifest-and-verify` step does — except instead of going through
 * `env.AKASH_MTLS` (the mtls_certificates binding), Deno presents the client cert via
 * `Deno.createHttpClient({ cert, key })`.
 *
 * Also optionally verifies the cert+pubkey is registered on-chain for AKASH_HOT_MNEMONIC's owner
 * (same gRPC query as `ensureCertOnChain`).
 *
 * Usage (repo root):
 *
 *   export AKASH_HOT_MNEMONIC="twelve words …"   # optional but recommended
 *   deno run -A -c scripts/deno.json scripts/verify-provider-mtls.ts \
 *     --bundle ./akash-mtls-fresh/mtls-bundle.pem \
 *     --host "https://provider.example.com:8443" \
 *     --dseq 2936438 --gseq 1 --oseq 1
 *
 * If you always get 401 but cert + deployment look fine, your **gseq/oseq or host** may not match
 * the active lease. Re-run with **--sync-url-from-chain** (requires mnemonic) to take host + order
 * from `getLeases` + `getProvider` (same as the worker's create step).
 *
 * Env: AKASH_MANIFEST_NETWORK (default sandbox-2), AKASH_RPC_URL, AKASH_GRPC_URL (same as worker).
 */
import Long from "long";
import {
	akashProviderHttpOrigin,
	createAkashClients,
	isMtlsPemRegisteredOnChain,
	parseMtlsPemBundleText,
} from "../cloudflare-backend/src/_shared/akashOrchestrator.ts";
import { akashEndpoints } from "../cloudflare-backend/src/_shared/akashEndpoints.ts";
import { buildScriptEnv, createDenoMtlsFetcher } from "./_shared/denoEnv.ts";

function jsonPreview(x: unknown, max = 1500): string {
	try {
		return JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2).slice(0, max);
	} catch {
		return String(x);
	}
}

function usage(): void {
	console.log(`
verify-provider-mtls.ts

  --bundle PATH              PEM bundle (cert + EC key + EC pubkey)
  --cert PATH --key PATH --pubkey PATH

  --host URL                 Provider host URI (omit if using --sync-url-from-chain)
  --dseq STRING              Deployment sequence
  --gseq NUMBER              Group sequence (default 1 if syncing)
  --oseq NUMBER              Order sequence (default 1 if syncing)
  --sync-url-from-chain      Set host + gseq + oseq from first active lease (needs mnemonic)
  --provider BECH32          Optional: filter leases to this provider address

  AKASH_HOT_MNEMONIC         If set, checks cert + deployment + leases on-chain.

Examples:
  deno run -A -c scripts/deno.json scripts/verify-provider-mtls.ts \\
    --bundle ./akash-mtls-fresh/mtls-bundle.pem \\
    --host "https://provider.akash.example:8443" --dseq 123 --gseq 1 --oseq 1
`);
}

type Args = {
	bundle?: string;
	cert?: string;
	key?: string;
	pubkey?: string;
	host?: string;
	dseq?: string;
	gseq?: number;
	oseq?: number;
	syncUrlFromChain?: boolean;
	providerFilter?: string;
};

function parseArgs(): Args {
	const out: Args = {};
	const a = Deno.args;
	for (let i = 0; i < a.length; i++) {
		const x = a[i];
		if (x === "--help" || x === "-h") {
			usage();
			Deno.exit(0);
		}
		if (x === "--bundle") out.bundle = a[++i];
		else if (x === "--cert") out.cert = a[++i];
		else if (x === "--key") out.key = a[++i];
		else if (x === "--pubkey") out.pubkey = a[++i];
		else if (x === "--host") out.host = a[++i];
		else if (x === "--dseq") out.dseq = a[++i];
		else if (x === "--gseq") out.gseq = Number(a[++i]);
		else if (x === "--oseq") out.oseq = Number(a[++i]);
		else if (x === "--sync-url-from-chain") out.syncUrlFromChain = true;
		else if (x === "--provider") out.providerFilter = a[++i];
	}
	return out;
}

function pageReq(limit: number) {
	return {
		key: new Uint8Array(0),
		offset: Long.UZERO,
		limit: Long.fromNumber(limit),
		countTotal: false,
		reverse: false,
	};
}

async function readText(path: string): Promise<string> {
	return await Deno.readTextFile(path);
}

async function main(): Promise<void> {
	const args = parseArgs();
	const hasMnemonic = Boolean(Deno.env.get("AKASH_HOT_MNEMONIC")?.trim());

	if (!args.dseq) {
		console.error("Missing --dseq\n");
		usage();
		Deno.exit(1);
	}
	if (args.syncUrlFromChain && !hasMnemonic) {
		console.error("--sync-url-from-chain requires AKASH_HOT_MNEMONIC\n");
		Deno.exit(1);
	}
	if (!args.syncUrlFromChain) {
		if (!args.host || args.gseq === undefined || args.oseq === undefined) {
			console.error("Missing --host, --gseq, or --oseq (or use --sync-url-from-chain)\n");
			usage();
			Deno.exit(1);
		}
	}

	let pem: { cert: string; privateKey: string; publicKey: string } | null = null;
	if (args.bundle) {
		pem = parseMtlsPemBundleText(await readText(args.bundle));
	} else if (args.cert && args.key && args.pubkey) {
		pem = parseMtlsPemBundleText(
			[
				(await readText(args.cert)).trim(),
				(await readText(args.key)).trim(),
				(await readText(args.pubkey)).trim(),
			].join("\n"),
		);
	}

	if (!pem || !pem.privateKey) {
		console.error("Could not parse PEM bundle (need --bundle or --cert/--key/--pubkey with a PRIVATE KEY block).\n");
		Deno.exit(1);
	}

	let probeHost = (args.host ?? "").replace(/\/$/, "");
	let probeGseq = args.gseq ?? 1;
	let probeOseq = args.oseq ?? 1;

	console.log("--- Parsed PEM bundle ---");
	console.log("cert bytes:", pem.cert.length, "key bytes:", pem.privateKey.length, "pub bytes:", pem.publicKey.length);

	// buildScriptEnv skips the required check when we pass no required list (mnemonic is optional here)
	const env = hasMnemonic ? buildScriptEnv() : (Deno.env.toObject() as Record<string, string>);

	if (hasMnemonic) {
		const endpoints = akashEndpoints(env);
		console.log("\n--- On-chain registration (same query as cert step) ---");
		console.log("endpoints:", JSON.stringify(endpoints));
		const chain = await isMtlsPemRegisteredOnChain({
			env: env as { AKASH_HOT_MNEMONIC: string },
			endpoints,
			certPem: pem.cert,
			publicKeyPem: pem.publicKey,
		});
		console.log("owner:", chain.owner);
		console.log("registered_on_chain:", chain.registered);
		if (!chain.registered) {
			console.error(
				"\nFAIL: This cert/public key is not in the chain's certificate list for that owner.\n" +
					"Run check-akash-cert.ts until createCertificate succeeds for the same wallet.",
			);
			Deno.exit(1);
		}

		const { owner: hotOwner, sdk, signer } = await createAkashClients(
			env as { AKASH_HOT_MNEMONIC: string },
			endpoints,
		).init();
		try {
			console.log("\n--- On-chain deployment (dseq must belong to this hot wallet) ---");
			console.log("hot_wallet_owner:", hotOwner, "dseq:", args.dseq);
			try {
				const dr = await sdk.akash.deployment.v1beta4.getDeployment({
					id: { owner: hotOwner, dseq: Long.fromString(args.dseq!) },
				});
				console.log("getDeployment: OK");
				console.log(jsonPreview(dr));
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				console.error("getDeployment: FAILED —", msg);
				console.error(
					"\nThis almost always means this dseq is NOT owned by AKASH_HOT_MNEMONIC's wallet.\n" +
						"Fix: use dseq / gseq / oseq from the same deploy run, or the mnemonic that actually created the deployment.",
				);
			}

			const provFilter = args.providerFilter?.trim() ?? "";
			const fetchLeases = (state: string) =>
				sdk.akash.market.v1beta5.getLeases({
					filters: {
						owner: hotOwner,
						dseq: Long.fromString(args.dseq!),
						gseq: 0,
						oseq: 0,
						provider: provFilter,
						state,
						bseq: 0,
					},
					pagination: pageReq(100),
				});

			let lr = await fetchLeases("active");
			let rows = lr.leases ?? [];
			if (rows.length === 0) {
				lr = await fetchLeases("");
				rows = lr.leases ?? [];
			}

			console.log("\n--- On-chain leases (match gseq/oseq + provider host to avoid 401) ---");
			console.log("  (lease.state: 1=active, 2=insufficient_funds, 3=closed — provider mTLS needs active)");
			if (rows.length === 0) {
				console.error(
					"No leases returned for this owner+dseq. Without an active lease, provider APIs often return 401.",
				);
			} else {
				type LeaseRow = {
					lease?: {
						id?: { gseq?: number; oseq?: number; provider?: string };
						state?: number;
					};
				};
				const activeRows = (rows as LeaseRow[]).filter((r) => r.lease?.state === 1);
				for (const r of rows as LeaseRow[]) {
					const id = r.lease?.id;
					if (!id) continue;
					console.log(`  lease state=${r.lease?.state} gseq=${id.gseq} oseq=${id.oseq} provider=${id.provider}`);
				}
				const wanted = activeRows.find(
					(r) => r.lease?.id?.gseq === probeGseq && r.lease?.id?.oseq === probeOseq,
				);
				if (activeRows.length > 0 && !wanted && !args.syncUrlFromChain) {
					const first = activeRows[0]!.lease!.id!;
					console.error(
						`\n!!! No ACTIVE lease with gseq=${probeGseq} oseq=${probeOseq}. First active lease uses gseq=${first.gseq} oseq=${first.oseq}.`,
					);
					console.error(`Re-run with --gseq ${first.gseq} --oseq ${first.oseq} or use --sync-url-from-chain.`);
				}
				if (args.syncUrlFromChain) {
					if (activeRows.length === 0) {
						console.error(
							"\nFAIL: --sync-url-from-chain requires an **ACTIVE** on-chain lease (state=1).\n",
						);
						Deno.exit(1);
					}
					const pickLease = activeRows[0] as LeaseRow;
					const lid = pickLease.lease?.id;
					if (!lid?.provider) {
						console.error("Cannot --sync-url-from-chain: no lease id in response.");
						Deno.exit(1);
					}
					const pr = await sdk.akash.provider.v1beta4.getProvider({ owner: lid.provider });
					const hu = pr.provider?.hostUri?.trim();
					if (!hu) {
						console.error("Cannot --sync-url-from-chain: provider hostUri empty.");
						Deno.exit(1);
					}
					probeHost = akashProviderHttpOrigin(hu);
					probeGseq = lid.gseq ?? probeGseq;
					probeOseq = lid.oseq ?? probeOseq;
					console.log("\n*** --sync-url-from-chain: using lease + getProvider ***");
					console.log(
						JSON.stringify({ host: probeHost, gseq: probeGseq, oseq: probeOseq, provider: lid.provider }, null, 2),
					);
				} else if (probeHost && wanted?.lease?.id?.provider) {
					const pr = await sdk.akash.provider.v1beta4.getProvider({
						owner: wanted.lease.id.provider,
					});
					const chainOrigin = akashProviderHttpOrigin(pr.provider?.hostUri?.trim() ?? "");
					if (chainOrigin && chainOrigin.replace(/\/$/, "") !== probeHost.replace(/\/$/, "")) {
						console.error(
							`\n!!! --host does not match getProvider hostUri for this lease.\n    CLI host: ${probeHost}\n    chain:    ${chainOrigin}`,
						);
						console.error("Fix --host or run with --sync-url-from-chain.");
					}
				}
			}
		} finally {
			await signer.disconnect?.().catch(() => undefined);
		}
	} else {
		console.log(
			"\n⚠️  AKASH_HOT_MNEMONIC not set — skipping on-chain cert + getDeployment + lease checks.\n" +
				"   Re-run with the same mnemonic as the worker to confirm cert registration and dseq ownership.",
		);
	}

	if (!probeHost) {
		console.error("No provider host: pass --host or use --sync-url-from-chain with AKASH_HOT_MNEMONIC.\n");
		Deno.exit(1);
	}

	const statusUrl = `${probeHost}/lease/${args.dseq}/${probeGseq}/${probeOseq}/status`;
	const manifestUrl = `${probeHost}/deployment/${args.dseq}/manifest`;

	console.log("\n--- Provider mTLS (same URLs the worker hits via env.AKASH_MTLS) ---");
	console.log("GET", statusUrl);

	const { mtlsFetcher, close } = createDenoMtlsFetcher(pem.cert, pem.privateKey);
	let stStatus = 0;
	let stBody = "";
	let putStatus = 0;
	try {
		const stRes = await mtlsFetcher.fetch(statusUrl, {
			method: "GET",
			headers: { Accept: "application/json" },
		});
		stStatus = stRes.status;
		stBody = (await stRes.text()).slice(0, 800);
		console.log("lease/status HTTP:", stStatus);
		console.log("body (truncated):", stBody || "(empty)");

		console.log("\n--- Manifest PUT probe (minimal body; expect 4xx if auth OK) ---");
		console.log("PUT", manifestUrl);
		const putRes = await mtlsFetcher.fetch(manifestUrl, {
			method: "PUT",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: "[]",
		});
		putStatus = putRes.status;
		const putBody = (await putRes.text()).slice(0, 800);
		console.log("manifest PUT HTTP:", putStatus);
		console.log("body (truncated):", putBody || "(empty)");
	} finally {
		close();
	}

	if (stStatus === 401 || putStatus === 401) {
		const skippedChain = !hasMnemonic;
		console.error(
			`\nFAIL: Provider returned HTTP 401 (lease/status=${stStatus}, manifest PUT=${putStatus}).\n` +
				`{"message":"unauthorized access"} means the provider did not accept your **client TLS certificate** for this deployment/lease.\n\n` +
				(skippedChain
					? "You did **not** set AKASH_HOT_MNEMONIC — the script could not verify on-chain cert registration or that dseq belongs to your wallet.\n"
					: "") +
				"Checklist:\n" +
				"  1. AKASH_HOT_MNEMONIC is the wallet that **created** deployment dseq (getDeployment must succeed above).\n" +
				"  2. This PEM bundle is the same one registered on-chain for that owner (registered_on_chain: true).\n" +
				"  3. Cert and private key are a matching pair; CN on the cert is that owner address.\n" +
				"  4. --host must match getProvider(hostUri) for the lease's provider; gseq/oseq must match an **active** lease.\n" +
				"  5. Re-run with **--sync-url-from-chain** to align host + gseq + oseq with chain.\n" +
				"  6. AKASH_MANIFEST_NETWORK + RPC/GRPC match the chain (Sandbox-2 defaults use rpc.sandbox-2.aksh.pw unless you override).\n" +
				"  7. If the same URL returns 401 with **curl --cert/--key**, it is not a Deno/worker problem — the provider gateway rejected the cert.\n",
		);
		Deno.exit(1);
	}

	if (![200, 404].includes(stStatus)) {
		console.error("\nWARN: unexpected lease/status HTTP", stStatus, "(200 or 404 is common)");
		Deno.exit(1);
	}

	console.log("\nOK: mTLS accepted for lease/status (no 401).");
	Deno.exit(0);
}

main().catch((e) => {
	console.error(e);
	Deno.exit(1);
});
