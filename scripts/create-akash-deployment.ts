/**
 * Create an Akash deployment + lease the same way as Edge `deploy-step-create`
 * (`createDeploymentAndLease` + `buildStandardWebAppSdl` + `akashEndpoints` + deposit/bid env).
 *
 * From repo root:
 *
 *   export AKASH_HOT_MNEMONIC="twelve words …"
 *   npx --yes deno@2 run -A -c scripts/deno.json scripts/create-akash-deployment.ts \
 *     --image ghcr.io/org/app:latest
 *
 * Optional:
 *   --port 3000
 *   --json                    print one JSON line (dseq, provider, gseq, oseq, providerHostUri, warnings)
 *   --strict-uptime           match Edge: require provider uptime ≥ MIN_PROVIDER_UPTIME (default 0.99)
 *                             unless AKASH_RELAX_UPTIME=1. By default this CLI **does not** filter on uptime
 *                             so sandbox bids are easier to get.
 *
 * Env (same as deploy-step-create when --strict-uptime):
 *   AKASH_MANIFEST_NETWORK (default sandbox-2), AKASH_RPC_URL, AKASH_GRPC_URL
 *   (defaults use aksh.pw Sandbox-2 mirrors; set AKASH_*_URL if you use official *.akash.network hosts)
 *   AKASH_DEPOSIT_UACT (or AKASH_DEPOSIT_UAKT)
 *   AKASH_BID_WINDOW_MS (default 60000), AKASH_BID_POLL_MS (default 1500 for this CLI; Edge uses 3000 unless set)
 *   AKASH_RELAX_UPTIME=1 or MIN_PROVIDER_UPTIME (default 0.99 unless relaxed)
 *
 * Provider selection (SDL has no signedBy/attributes — any provider may bid):
 *   AKASH_EXCLUDE_PROVIDERS — comma-separated provider `akash1…` addresses skipped when taking a bid
 *                             (e.g. overloaded gateway under test).
 *   AKASH_BID_STRATEGY — `cheapest` (default) or `random` among qualifying bids after filters.
 */

import { createDeploymentAndLease } from "../supabase/functions/_shared/akashOrchestrator.ts";
import { akashEndpoints } from "../supabase/functions/_shared/akashEndpoints.ts";
import { buildStandardWebAppSdl } from "../supabase/functions/_shared/sdl.ts";
import { akashDepositUact } from "../supabase/functions/_shared/akashBalance.ts";

function usage(): void {
  console.log(`
Usage:
  deno run -A -c scripts/deno.json scripts/create-akash-deployment.ts --image <docker-image> [--port N] [--json] [--strict-uptime]

Env:
  AKASH_HOT_MNEMONIC (required)
`);
}

type Args = { image?: string; port: number; json: boolean; strictUptime: boolean };

function parseArgs(): Args {
  const out: Args = { port: 3000, json: false, strictUptime: false };
  const a = Deno.args;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--help" || x === "-h") {
      usage();
      Deno.exit(0);
    }
    if (x === "--image") out.image = a[++i];
    else if (x === "--port") out.port = Math.max(1, Number(a[++i]) || 3000);
    else if (x === "--json") out.json = true;
    else if (x === "--strict-uptime") out.strictUptime = true;
  }
  return out;
}

const args = parseArgs();
if (!args.image?.trim()) {
  console.error("Missing --image <docker-image>\n");
  usage();
  Deno.exit(1);
}

const mnemonic = Deno.env.get("AKASH_HOT_MNEMONIC")?.trim();
if (!mnemonic) {
  console.error("Set AKASH_HOT_MNEMONIC (same hot wallet as Edge).");
  Deno.exit(1);
}

const sdl = buildStandardWebAppSdl(args.image.trim(), { internalPort: args.port });
const endpoints = akashEndpoints();
const depositUact = akashDepositUact().toString();
const bidWindowMs = Number(Deno.env.get("AKASH_BID_WINDOW_MS") ?? "60000");
/** Shorter default than Edge: time is mostly spent waiting between bid polls when no winner yet. */
const bidPollMs = Number(Deno.env.get("AKASH_BID_POLL_MS") ?? "1500");
const minUptime = args.strictUptime
  ? Deno.env.get("AKASH_RELAX_UPTIME") === "1"
    ? 0
    : Number(Deno.env.get("MIN_PROVIDER_UPTIME") ?? "0.99")
  : 0;

console.log("endpoints:", JSON.stringify(endpoints));
console.log("depositUact:", depositUact, "bidWindowMs:", bidWindowMs, "minProviderUptime:", minUptime);

const t0 = performance.now();
const result = await createDeploymentAndLease({
  sdlYaml: sdl,
  mnemonic,
  endpoints,
  depositUact,
  bidWindowMs,
  bidPollMs,
  minProviderUptime: minUptime,
});
const ms = Math.round(performance.now() - t0);

if (args.json) {
  console.log(
    JSON.stringify({
      dseq: result.dseq,
      provider: result.provider,
      gseq: result.gseq,
      oseq: result.oseq,
      providerHostUri: result.providerHostUri,
      warnings: result.warnings,
      elapsed_ms: ms,
    }),
  );
} else {
  if (result.warnings.length) {
    console.log("warnings:", result.warnings.join(" | "));
  }
  console.log("provider:", result.provider);
  console.log("gseq:", result.gseq, "oseq:", result.oseq);
  console.log("providerHostUri:", result.providerHostUri);
  console.log("elapsed_ms:", ms);
  console.log("");
  console.log(result.dseq);
}

Deno.exit(0);
