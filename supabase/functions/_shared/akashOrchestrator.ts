import { Buffer } from "node:buffer";
import { X509Certificate } from "node:crypto";
/**
 * Akash deployment orchestration helpers for Deno (Supabase Edge).
 *
 * Split into 3 resumable phases that chained step functions call independently:
 *   1. ensureCertOnChain   — wallet + mTLS cert
 *   2. createDeploymentAndLease — deployment TX, bid polling, lease
 *   3. sendManifestAndVerify — manifest PUT + lease status
 */
import {
  certificateManager,
  createChainNodeSDK,
  createStargateClient,
  generateManifest,
  generateManifestVersion,
  yaml,
} from "@akashnetwork/chain-sdk";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import Long from "long";

const SOURCE_BALANCE = 1;
const BID_STATE_OPEN = 1;

export type AkashNetworkId = "sandbox" | "testnet" | "mainnet";

export type AkashEndpoints = {
  rpcUrl: string;
  grpcUrl: string;
  manifestNetwork: AkashNetworkId;
};

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

/** Normalize provider `hostUri` from chain to an https origin (same as manifest / lease HTTP client). */
export function akashProviderHttpOrigin(hostUri: string): string {
  const t = hostUri.trim().replace(/\/$/, "");
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  return `https://${t}`;
}

function providerOrigin(hostUri: string): string {
  return akashProviderHttpOrigin(hostUri);
}

function uptimeFromAttributes(
  attrs: { key?: string; value?: string }[]
): number | null {
  for (const a of attrs) {
    const k = (a.key ?? "").toLowerCase();
    const v = a.value ?? "";
    if (!k || !v) continue;
    if (k.includes("uptime") || k.includes("availability")) {
      const n = parseFloat(v.replace("%", "").trim());
      if (Number.isFinite(n)) return n > 1 ? n / 100 : n;
    }
  }
  return null;
}

function comparePrice(aAmt: string, bAmt: string): number {
  try {
    const ba = BigInt(aAmt || "0");
    const bb = BigInt(bAmt || "0");
    if (ba < bb) return -1;
    if (ba > bb) return 1;
    return 0;
  } catch {
    return 0;
  }
}

/** Comma- or whitespace-separated `akash1…` provider addresses to skip when accepting a bid. */
function parseExcludedProvidersFromEnv(): Set<string> {
  const raw = Deno.env.get("AKASH_EXCLUDE_PROVIDERS")?.trim() ?? "";
  const set = new Set<string>();
  for (const part of raw.split(/[\s,]+/)) {
    const a = part.trim().toLowerCase();
    if (a) set.add(a);
  }
  return set;
}

/**
 * `cheapest` (default): lowest `uact` bid wins.
 * `random`: uniform pick among qualifying bids (after sort; use with `AKASH_EXCLUDE_PROVIDERS` to avoid overload).
 */
function bidPickStrategyFromEnv(): "cheapest" | "random" {
  const s = (Deno.env.get("AKASH_BID_STRATEGY") ?? "cheapest").trim().toLowerCase();
  return s === "random" ? "random" : "cheapest";
}

function normalizePem(text: string): string {
  return text.replace(/\r/g, "").trim();
}

function canonicalCertBody(pem: string): string {
  return normalizePem(pem)
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

function coerceChainBytesToUtf8(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "";
    if (s.includes("-----BEGIN")) return normalizePem(s);
    try {
      const bin = atob(s.replace(/\s/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return normalizePem(new TextDecoder().decode(bytes));
    } catch {
      return normalizePem(s);
    }
  }
  if (value instanceof Uint8Array) {
    return normalizePem(new TextDecoder().decode(value));
  }
  if (Array.isArray(value)) {
    return normalizePem(
      new TextDecoder().decode(Uint8Array.from(value as number[])),
    );
  }
  return "";
}

function extractCertRows(res: { certificates?: unknown }): unknown[] {
  const raw = res.certificates;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && "certificate" in (raw as object)) {
    const inner = (raw as { certificate?: unknown }).certificate;
    if (Array.isArray(inner)) return inner;
    if (inner) return [inner];
  }
  return [];
}

/**
 * Akash decodes bech32 from the X.509 subject CN; mixed case fails with
 * "decoding bech32 failed: string not all lowercase or all uppercase".
 */
function validateMtlsCertCnForOwner(certPem: string, owner: string): string | null {
  try {
    const cert = new X509Certificate(normalizePem(certPem));
    let cn = "";
    for (const line of cert.subject.split("\n")) {
      const t = line.trim();
      if (t.startsWith("CN=")) cn = t.slice(3).trim();
    }
    if (!cn) {
      const flat = cert.subject.replace(/\r?\n/g, "/");
      const m = /(?:^|\/)CN=([^/]+)/.exec(flat);
      cn = (m?.[1] ?? "").trim();
    }
    if (!cn) return null;
    const want = owner.trim().toLowerCase();
    const got = cn.trim();
    if (got === want) return null;
    if (got.toLowerCase() === want) {
      return (
        `Invalid mTLS certificate CN: "${got}" uses mixed-case bech32; Akash rejects createCertificate. ` +
        `Regenerate PEMs with an all-lowercase CN matching ${want} (e.g. ./scripts/gen-akash-mtls-bundle.sh ${want}).`
      );
    }
    return (
      `Invalid mTLS certificate CN: "${got}" does not match wallet owner ${want}. ` +
      `Regenerate with: ./scripts/gen-akash-mtls-bundle.sh ${want}`
    );
  } catch {
    return null;
  }
}

async function waitForCertificateVisible(
  sdk: ReturnType<typeof createChainNodeSDK>,
  owner: string,
  certPem: string,
  pubkeyPem: string,
  opts: { maxWaitMs: number; intervalMs: number; onProgress?: (message: string) => void },
): Promise<void> {
  const log = opts.onProgress ?? (() => undefined);
  const deadline = Date.now() + opts.maxWaitMs;
  const target = normalizePem(certPem);
  const targetBody = canonicalCertBody(certPem);
  const targetPubkey = normalizePem(pubkeyPem);
  const started = Date.now();
  let nextProgressLog = started + 10_000;
  while (Date.now() < deadline) {
    const res = await sdk.akash.cert.v1.getCertificates({
      filter: { owner, serial: "", state: "" },
      pagination: pageReq(200),
    });
    const certs = extractCertRows(res);
    for (const c of certs) {
      const row = c as Record<string, unknown>;
      const inner = (row.certificate ?? row) as Record<string, unknown>;
      const onChainPem = coerceChainBytesToUtf8(
        inner.cert ?? inner.certificate ?? row.cert,
      );
      const onChainPubkey = coerceChainBytesToUtf8(
        inner.pubkey ?? inner.publicKey ?? row.pubkey,
      );
      if (!onChainPem && !onChainPubkey) continue;
      if (onChainPem === target) return;
      if (onChainPem && canonicalCertBody(onChainPem) === targetBody) return;
      if (onChainPubkey && onChainPubkey === targetPubkey) return;
    }
    const now = Date.now();
    if (now >= nextProgressLog) {
      const elapsedS = Math.round((now - started) / 1000);
      const maxS = Math.round(opts.maxWaitMs / 1000);
      log(
        `Certificate not visible via gRPC yet (${elapsedS}s / ${maxS}s max); next poll in ${opts.intervalMs}ms — check AKASH_GRPC_URL or indexer lag.`,
      );
      nextProgressLog = now + 10_000;
    }
    await sleep(opts.intervalMs);
  }
  throw new Error(
    "Certificate tx not visible on chain for current mTLS cert — increase AKASH_CERT_WAIT_MS or retry"
  );
}

/* ------------------------------------------------------------------ */
/*  Shared SDK / wallet factory                                        */
/* ------------------------------------------------------------------ */

export function createAkashClients(mnemonic: string, endpoints: AkashEndpoints) {
  const walletPromise = DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: "akash",
  });

  return {
    async init() {
      const directWallet = await walletPromise;
      const [account] = await directWallet.getAccounts();
      const owner = account.address;

      const gasPrice = Deno.env.get("AKASH_GAS_PRICE")?.trim() || "0.025uakt";
      const signer = createStargateClient({
        baseUrl: endpoints.rpcUrl,
        signer: directWallet,
        defaultGasPrice: gasPrice,
      });
      const sdk = createChainNodeSDK({
        query: {
          baseUrl: endpoints.grpcUrl,
          transportOptions: {
            retry: { maxAttempts: 4, maxDelayMs: 8_000 },
          },
        },
        tx: { signer },
      });

      return { owner, sdk, signer, directWallet };
    },
  };
}

export type AkashChainSdk = Awaited<
  ReturnType<ReturnType<typeof createAkashClients>["init"]>
>["sdk"];

type ProviderRowAttrs = { key?: string; value?: string }[];

type ProviderLookup = {
  attrs: ProviderRowAttrs;
  hostUri: string;
  loadFailed: boolean;
};

/** One gRPC round-trip per unique provider, in parallel (was N sequential calls per poll). */
async function fetchProvidersByOwner(
  sdk: AkashChainSdk,
  owners: readonly string[],
): Promise<Map<string, ProviderLookup>> {
  const unique = [...new Set(owners.filter((o) => o))];
  const pairs = await Promise.all(
    unique.map(async (owner): Promise<[string, ProviderLookup]> => {
      try {
        const pr = await sdk.akash.provider.v1beta4.getProvider({ owner });
        const hostUri = pr.provider?.hostUri?.trim() ?? "";
        const attrs = [...(pr.provider?.attributes ?? [])] as ProviderRowAttrs;
        return [owner, { attrs, hostUri, loadFailed: false }];
      } catch {
        return [owner, { attrs: [], hostUri: "", loadFailed: true }];
      }
    }),
  );
  return new Map(pairs);
}

/* ------------------------------------------------------------------ */
/*  PEM loading helpers (env-based stable mTLS certs)                  */
/* ------------------------------------------------------------------ */

function loadPemFromEnv(): {
  cert: string;
  privateKey: string;
  publicKey: string;
} | null {
  const cert = Deno.env.get("AKASH_MTLS_CERT_PEM")?.trim();
  const privateKey = Deno.env.get("AKASH_MTLS_KEY_PEM")?.trim();
  const publicKey = Deno.env.get("AKASH_MTLS_PUBLIC_KEY_PEM")?.trim();
  if (cert && privateKey && publicKey) {
    return { cert, privateKey, publicKey };
  }
  return null;
}

function rawMtlsPemBundleFromEnv(): string | null {
  let b = Deno.env.get("AKASH_MTLS_PEM_BUNDLE");
  if (!b) return null;
  b = b.trim();
  // Dashboard / JSON paste sometimes stores literal backslash-n instead of newlines
  if (b.includes("-----BEGIN") && b.includes("\\n") && b.split("\n").length <= 2) {
    b = b.replace(/\\n/g, "\n");
  }
  return b;
}

/** Parse concat PEM bundle (cert + private key + public key), same rules as Edge env bundle. */
export function parseMtlsPemBundleText(raw: string): {
  cert: string;
  privateKey: string;
  publicKey: string;
} | null {
  let bundle = raw.trim();
  if (!bundle) return null;
  if (bundle.includes("-----BEGIN") && bundle.includes("\\n") && bundle.split("\n").length <= 2) {
    bundle = bundle.replace(/\\n/g, "\n");
  }
  bundle = bundle.replace(/\r\n/g, "\n");
  const chunks = bundle
    .split(/(?=-----BEGIN )/g)
    .map((x) => x.trim())
    .filter(Boolean);
  let cert = "";
  let privateKey = "";
  let publicKey = "";
  for (const p of chunks) {
    const n = normalizePem(p);
    if (n.includes("BEGIN CERTIFICATE")) cert = n;
    else if (n.includes("BEGIN") && n.includes("PRIVATE KEY")) privateKey = n;
    // chain-sdk uses PKCS#8 EC pubkey with this header; plain BEGIN PUBLIC KEY is often RSA and rejected on-chain
    else if (n.includes("BEGIN EC PUBLIC KEY")) publicKey = n;
    else if (n.includes("BEGIN PUBLIC KEY")) publicKey = n;
  }
  if (cert && privateKey && publicKey) return { cert, privateKey, publicKey };
  return null;
}

function loadPemBundleFromEnv(): {
  cert: string;
  privateKey: string;
  publicKey: string;
} | null {
  const bundle = rawMtlsPemBundleFromEnv();
  if (!bundle) return null;
  return parseMtlsPemBundleText(bundle);
}

/**
 * Stable mTLS cert+key from Edge secrets (three PEM vars or AKASH_MTLS_PEM_BUNDLE).
 * Manifest should prefer this over DB tls_* when set, so rotating secrets does not require
 * a new workflow row for the PUT /lease TLS client cert to match what is on-chain.
 */
export function mtlsClientPemFromEnv(): { cert: string; key: string } | null {
  const p = loadPemFromEnv() ?? loadPemBundleFromEnv();
  if (!p) return null;
  return { cert: p.cert, key: p.privateKey };
}

/* ------------------------------------------------------------------ */
/*  PHASE 1: ensureCertOnChain                                         */
/* ------------------------------------------------------------------ */

export type CertResult = {
  owner: string;
  tlsCertPem: string;
  tlsKeyPem: string;
  warnings: string[];
};

export async function ensureCertOnChain(input: {
  mnemonic: string;
  endpoints: AkashEndpoints;
  /** When set (e.g. CLI scripts), emits step messages so long gRPC waits do not look hung. */
  onProgress?: (message: string) => void;
}): Promise<CertResult> {
  const warnings: string[] = [];
  const log = input.onProgress ?? (() => undefined);

  log("Initializing wallet and chain clients (first contact uses RPC + gRPC)…");
  const { owner, sdk, signer } = await createAkashClients(
    input.mnemonic,
    input.endpoints,
  ).init();
  log(`Wallet ready: owner=${owner}`);

  const fromEnv = loadPemFromEnv() ?? loadPemBundleFromEnv();
  const clientPem = fromEnv ?? await certificateManager.generatePEM(owner);
  if (fromEnv) {
    warnings.push("Using AKASH_MTLS_* env PEMs for mTLS (recommended for Edge).");
  }

  const cnReject = validateMtlsCertCnForOwner(clientPem.cert, owner);
  if (cnReject) {
    warnings.push(cnReject);
    await signer.disconnect?.().catch(() => undefined);
    return {
      owner,
      tlsCertPem: clientPem.cert,
      tlsKeyPem: clientPem.privateKey,
      warnings,
    };
  }

  async function certAlreadyOnChain(): Promise<boolean> {
    log("Querying on-chain certificates (gRPC getCertificates)…");
    const res = await sdk.akash.cert.v1.getCertificates({
      filter: { owner, serial: "", state: "" },
      pagination: pageReq(200),
    });
    const targetPub = normalizePem(clientPem.publicKey);
    const targetBody = canonicalCertBody(clientPem.cert);
    for (const c of extractCertRows(res)) {
      const row = c as Record<string, unknown>;
      const inner = (row.certificate ?? row) as Record<string, unknown>;
      const onChainPem = coerceChainBytesToUtf8(
        inner.cert ?? inner.certificate ?? row.cert,
      );
      const onChainPub = coerceChainBytesToUtf8(
        inner.pubkey ?? inner.publicKey ?? row.pubkey,
      );
      if (onChainPub && onChainPub === targetPub) {
        log("This PEM matches an on-chain certificate (by public key).");
        return true;
      }
      if (onChainPem && canonicalCertBody(onChainPem) === targetBody) {
        log("This PEM matches an on-chain certificate (by cert body).");
        return true;
      }
    }
    log("No on-chain certificate matches this PEM yet.");
    return false;
  }

  const already = await certAlreadyOnChain();
  if (!already) {
    log("Broadcasting createCertificate transaction…");
    try {
      await sdk.akash.cert.v1.createCertificate({
        owner,
        cert: Buffer.from(clientPem.cert, "utf8"),
        pubkey: Buffer.from(clientPem.publicKey, "utf8"),
      });
      log("createCertificate broadcast returned.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`createCertificate: ${msg}`);
    }
  } else {
    log("This PEM is already registered on-chain; skipping createCertificate.");
  }

  const certWaitMs = Number(Deno.env.get("AKASH_CERT_WAIT_MS") || "180000");
  const certPollMs = Number(Deno.env.get("AKASH_CERT_POLL_MS") || "2000");
  try {
    log(`Waiting for certificate to be visible to queries (up to ${certWaitMs}ms)…`);
    await waitForCertificateVisible(sdk, owner, clientPem.cert, clientPem.publicKey, {
      maxWaitMs: certWaitMs,
      intervalMs: certPollMs,
      onProgress: log,
    });
    log("Certificate is visible on-chain.");
  } catch (e) {
    warnings.push(e instanceof Error ? e.message : String(e));
  }

  await signer.disconnect?.().catch(() => undefined);

  return {
    owner,
    tlsCertPem: clientPem.cert,
    tlsKeyPem: clientPem.privateKey,
    warnings,
  };
}

/** True if this cert+pubkey appears in on-chain x509 certificates for the mnemonic’s owner. */
export async function isMtlsPemRegisteredOnChain(input: {
  mnemonic: string;
  endpoints: AkashEndpoints;
  certPem: string;
  publicKeyPem: string;
}): Promise<{ owner: string; registered: boolean }> {
  const { owner, sdk, signer } = await createAkashClients(
    input.mnemonic,
    input.endpoints,
  ).init();
  try {
    const res = await sdk.akash.cert.v1.getCertificates({
      filter: { owner, serial: "", state: "" },
      pagination: pageReq(200),
    });
    const targetPub = normalizePem(input.publicKeyPem);
    const targetBody = canonicalCertBody(input.certPem);
    for (const c of extractCertRows(res)) {
      const row = c as Record<string, unknown>;
      const inner = (row.certificate ?? row) as Record<string, unknown>;
      const onChainPem = coerceChainBytesToUtf8(
        inner.cert ?? inner.certificate ?? row.cert,
      );
      const onChainPub = coerceChainBytesToUtf8(
        inner.pubkey ?? inner.publicKey ?? row.pubkey,
      );
      if (onChainPub && onChainPub === targetPub) return { owner, registered: true };
      if (onChainPem && canonicalCertBody(onChainPem) === targetBody) return { owner, registered: true };
    }
    return { owner, registered: false };
  } finally {
    await signer.disconnect?.().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/*  PHASE 2: createDeploymentAndLease                                  */
/* ------------------------------------------------------------------ */

export type LeaseResult = {
  dseq: string;
  provider: string;
  gseq: number;
  oseq: number;
  providerHostUri: string;
  warnings: string[];
};

export async function createDeploymentAndLease(input: {
  sdlYaml: string;
  mnemonic: string;
  endpoints: AkashEndpoints;
  depositUact: string;
  bidWindowMs: number;
  bidPollMs: number;
  minProviderUptime: number;
}): Promise<LeaseResult> {
  const warnings: string[] = [];

  const { owner, sdk, signer } = await createAkashClients(
    input.mnemonic,
    input.endpoints,
  ).init();

  const manifestResult = generateManifest(
    yaml.raw(input.sdlYaml),
    input.endpoints.manifestNetwork,
  );
  if (!manifestResult.ok) {
    throw new Error(
      `SDL validation failed: ${JSON.stringify(manifestResult.value)}`,
    );
  }
  const { groups, groupSpecs } = manifestResult.value;
  const hash = await generateManifestVersion(groups);

  const latest = await sdk.cosmos.base.tendermint.v1beta1.getLatestBlock({});
  const height = latest.block?.header?.height;
  if (height === undefined || height === null) {
    throw new Error("Could not read latest block height for dseq");
  }
  const dseq = Long.fromString(String(height));

  await sdk.akash.deployment.v1beta4.createDeployment({
    id: { owner, dseq },
    groups: groupSpecs,
    hash,
    deposit: {
      amount: { denom: "uact", amount: input.depositUact },
      sources: [SOURCE_BALANCE],
    },
  });

  const deadline = Date.now() + input.bidWindowMs;
  const excludedProviders = parseExcludedProvidersFromEnv();
  const bidPickStrategy = bidPickStrategyFromEnv();
  if (excludedProviders.size > 0) {
    warnings.push(
      `AKASH_EXCLUDE_PROVIDERS excludes: ${[...excludedProviders].join(", ")}`,
    );
  }
  if (bidPickStrategy === "random") {
    warnings.push(
      "AKASH_BID_STRATEGY=random: picking a random qualifying bid (not strictly the cheapest).",
    );
  }
  type Candidate = {
    bidId: NonNullable<NonNullable<{ bid?: { id?: unknown } }["bid"]>["id"]>;
    priceAmt: string;
    uptime: number;
  };
  let chosen: Candidate | null = null;

  while (Date.now() < deadline && !chosen) {
    const bidsRes = await sdk.akash.market.v1beta5.getBids({
      filters: {
        owner,
        dseq,
        gseq: 0,
        oseq: 0,
        provider: "",
        state: "open",
        bseq: 0,
      },
      pagination: pageReq(100),
    });

    const open = (bidsRes.bids ?? []).filter(
      (b: { bid?: { state?: number; id?: Candidate["bidId"]; price?: { amount?: string } } }) =>
        b.bid && b.bid.state === BID_STATE_OPEN,
    );

    const providerAddrs = open
      .map((row: { bid?: { id?: Candidate["bidId"] } }) => {
        const bidId = row.bid?.id as Candidate["bidId"] | undefined;
        if (!bidId || typeof (bidId as { provider?: string }).provider !== "string") return "";
        return (bidId as { provider: string }).provider;
      })
      .filter(Boolean);
    const provByOwner = await fetchProvidersByOwner(sdk, providerAddrs);

    const candidates: Candidate[] = [];

    for (const row of open) {
      const b = row.bid!;
      const bidId = b.id as Candidate["bidId"];
      if (!bidId || typeof (bidId as { provider?: string }).provider !== "string") continue;
      const provider = (bidId as { provider: string }).provider;
      if (excludedProviders.has(provider.toLowerCase())) continue;
      const priceAmt = b.price?.amount ?? "0";
      const info = provByOwner.get(provider);
      const provAttrs = info?.attrs ?? [];
      if (info?.loadFailed) {
        warnings.push(`Could not load provider ${provider} attributes`);
      }
      const uptime = uptimeFromAttributes(provAttrs);
      const skipUptime = input.minProviderUptime <= 0;
      if (
        !skipUptime &&
        (uptime === null || uptime < input.minProviderUptime)
      ) {
        continue;
      }
      candidates.push({ bidId, priceAmt, uptime: uptime ?? 0 });
    }

    if (candidates.length === 0 && input.minProviderUptime <= 0) {
      for (const row of open) {
        const b = row.bid!;
        const bidId = b.id as Candidate["bidId"];
        if (!bidId || typeof (bidId as { provider?: string }).provider !== "string") {
          continue;
        }
        const provider = (bidId as { provider: string }).provider;
        if (excludedProviders.has(provider.toLowerCase())) continue;
        const info = provByOwner.get(provider);
        candidates.push({
          bidId,
          priceAmt: b.price?.amount ?? "0",
          uptime: 0,
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => comparePrice(a.priceAmt, b.priceAmt));
      chosen =
        bidPickStrategy === "random"
          ? candidates[Math.floor(Math.random() * candidates.length)]!
          : candidates[0]!;
      break;
    }

    await sleep(input.bidPollMs);
  }

  if (!chosen) {
    const hint =
      excludedProviders.size > 0
        ? ` AKASH_EXCLUDE_PROVIDERS is set (${excludedProviders.size} address(es)); every open bid may have been filtered out.`
        : "";
    throw new Error(
      `No qualifying bids within ${input.bidWindowMs}ms (open bid + provider uptime ≥ ${input.minProviderUptime}).${hint}`,
    );
  }

  await sdk.akash.market.v1beta5.createLease({
    bidId: chosen.bidId as never,
  });

  const providerAddr = (chosen.bidId as { provider: string }).provider;
  const provRes = await sdk.akash.provider.v1beta4.getProvider({
    owner: providerAddr,
  });
  const hostUri = provRes.provider?.hostUri?.trim();
  if (!hostUri) {
    await signer.disconnect?.().catch(() => undefined);
    throw new Error("Provider hostUri missing after lease");
  }

  const bidId = chosen.bidId as { gseq: number; oseq: number };

  await signer.disconnect?.().catch(() => undefined);

  return {
    dseq: dseq.toString(),
    provider: providerAddr,
    gseq: bidId.gseq,
    oseq: bidId.oseq,
    providerHostUri: providerOrigin(hostUri),
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/*  PHASE 3: sendManifestAndVerify                                     */
/* ------------------------------------------------------------------ */

export type ManifestResult = {
  manifestSent: boolean;
  leaseStatus: unknown;
  forwardedPorts: unknown;
  warnings: string[];
};

export async function sendManifestAndVerify(input: {
  sdlYaml: string;
  manifestNetwork: AkashNetworkId;
  tlsCertPem: string;
  tlsKeyPem: string;
  dseq: string;
  providerHostUri: string;
  gseq: number;
  oseq: number;
}): Promise<ManifestResult> {
  const warnings: string[] = [];

  const manifestResult = generateManifest(
    yaml.raw(input.sdlYaml),
    input.manifestNetwork,
  );
  if (!manifestResult.ok) {
    throw new Error(
      `SDL validation failed: ${JSON.stringify(manifestResult.value)}`,
    );
  }
  const { groups } = manifestResult.value;

  const manifestUrl = `${input.providerHostUri}/deployment/${input.dseq}/manifest`;
  const manifestRetryMax = Number(Deno.env.get("AKASH_MANIFEST_RETRY_MAX") ?? "5");
  const manifestRetryDelayMs = Number(Deno.env.get("AKASH_MANIFEST_RETRY_DELAY_MS") ?? "5000");

  let manifestSent = false;
  for (let attempt = 1; attempt <= Math.max(1, manifestRetryMax); attempt++) {
    const httpClient = Deno.createHttpClient({
      cert: input.tlsCertPem,
      key: input.tlsKeyPem,
    });
    try {
      const putRes = await fetch(manifestUrl, {
        method: "PUT",
        client: httpClient,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(groups),
      });
      manifestSent = putRes.ok;
      if (manifestSent) break;
      const body = await putRes.text().catch(() => "");
      warnings.push(`Manifest mTLS HTTP ${putRes.status}: ${body.slice(0, 400)}`);
      if (putRes.status === 401 && attempt < manifestRetryMax) {
        await sleep(manifestRetryDelayMs);
        continue;
      }
      break;
    } finally {
      httpClient.close();
    }
  }

  if (!manifestSent) {
    warnings.push(
      "Manifest still failing: use AKASH_MTLS_CERT_PEM + AKASH_MTLS_KEY_PEM + AKASH_MTLS_PUBLIC_KEY_PEM (or AKASH_MTLS_PEM_BUNDLE) matching the cert registered on-chain for the hot wallet; redeploy manifest (secrets are preferred over DB tls_*).",
    );
    if (warnings.some((w) => w.includes("Manifest mTLS HTTP 401"))) {
      warnings.push(
        "HTTP 401 from the provider often means the on-chain lease is no longer active or dseq/gseq/oseq/host do not match the active lease — not necessarily a bad PEM when cert checks pass.",
      );
    }
  }

  const statusUrl = `${input.providerHostUri}/lease/${input.dseq}/${input.gseq}/${input.oseq}/status`;
  let leaseStatus: unknown = null;
  let forwardedPorts: unknown = null;

  for (let attempt = 1; attempt <= Math.max(1, manifestRetryMax); attempt++) {
    const stClient = Deno.createHttpClient({
      cert: input.tlsCertPem,
      key: input.tlsKeyPem,
    });
    try {
      const stRes = await fetch(statusUrl, {
        headers: { Accept: "application/json" },
        client: stClient,
      });
      if (stRes.ok) {
        leaseStatus = await stRes.json();
        const ls = leaseStatus as Record<string, unknown>;
        forwardedPorts = ls.forwarded_ports ?? ls.forwardedPorts;
        break;
      }
      warnings.push(`Lease status HTTP ${stRes.status}`);
      if (stRes.status === 401 && attempt < manifestRetryMax) {
        await sleep(manifestRetryDelayMs);
        continue;
      }
      break;
    } finally {
      stClient.close();
    }
  }

  return { manifestSent, leaseStatus, forwardedPorts, warnings };
}
