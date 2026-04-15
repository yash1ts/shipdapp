/**
 * Create a new app deployment record with a dedicated funding wallet.
 * POST JSON: { appName, dockerImage, description?, port? }
 *
 * Generates a per-app Solana keypair. The user sends >= 0.1 SOL to it.
 * The cron checks this address as the gatekeeper before deploying on Akash.
 */
import { createClient } from "@supabase/supabase-js";
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { corsHeadersFor } from "../_shared/cors.ts";

const SOL_GATE = 0.1;

Deno.serve(async (req: Request) => {
  const cors = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        500,
      );
    }

    const body = (await req.json()) as {
      appName?: string;
      dockerImage?: string;
      description?: string;
      port?: number;
    };
    const appName = body.appName?.trim();
    const dockerImage = body.dockerImage?.trim();
    if (!appName || !dockerImage) {
      return json({ error: "appName and dockerImage are required" }, 400);
    }

    const p =
      body.port === undefined || body.port === null ? 3000 : Number(body.port);
    const portNum = Number.isFinite(p) && p > 0 ? Math.floor(p) : 3000;
    const description = body.description?.trim() || null;

    const fundingKp = Keypair.generate();
    const fundingAddress = fundingKp.publicKey.toBase58();

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: row, error: insErr } = await supabase
      .from("app_deployments")
      .insert({
        app_name: appName,
        description,
        docker_image: dockerImage,
        port: portNum,
        solana_treasury_public_key: fundingAddress,
        status: "PENDING_FUNDS",
      })
      .select("id")
      .single();

    if (insErr) throw insErr;
    if (!row?.id) throw new Error("insert returned no id");

    const minLamports = Math.floor(SOL_GATE * LAMPORTS_PER_SOL);

    return json({
      deploymentId: row.id as string,
      status: "PENDING_FUNDS",
      fundingAddress,
      port: portNum,
      minSolGate: SOL_GATE,
      minSolGateLamports: minLamports.toString(),
      note: `Send >= ${SOL_GATE} SOL to the funding address. The cron auto-deploys via the AKT Hot Wallet once funded.`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[deployments-init]", msg);
    return json({ error: msg }, 500);
  }
});
