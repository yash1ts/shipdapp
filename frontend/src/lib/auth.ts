/**
 * SIWS (Sign-In-With-Solana) client helpers.
 *
 * Flow:
 *   1. `requestNonce(wallet)`  → backend mints a single-use nonce + canonical message
 *   2. wallet `signMessage(message)` (wallet-adapter-react)
 *   3. `verifySignature({wallet, signature})` → backend verifies + returns a JWT
 *   4. Store `{wallet, token, expiresAt}` in localStorage (per wallet)
 *
 * The JWT is attached to protected requests as `Authorization: Bearer <token>` (see api-client).
 * localStorage is XSS-exposed but acceptable for a devnet dapp; for production, consider
 * HttpOnly cookies with a same-site frontend + backend.
 */

import bs58 from "bs58";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8787"
).replace(/\/$/, "");

export type Session = {
  wallet: string;
  token: string;
  expiresAt: string; // ISO
};

const SESSION_KEY_PREFIX = "shipdapp:siws:";

function sessionKey(wallet: string): string {
  return `${SESSION_KEY_PREFIX}${wallet}`;
}

export function loadSession(wallet: string): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(sessionKey(wallet));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || !parsed?.expiresAt) return null;
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(sessionKey(wallet));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(sessionKey(session.wallet), JSON.stringify(session));
}

export function clearSession(wallet: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(sessionKey(wallet));
}

export async function requestNonce(wallet: string): Promise<{
  message: string;
  nonce: string;
  expiresAt: string;
}> {
  const resp = await fetch(`${API_BASE}/api/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body?.error || `Nonce request failed (${resp.status})`);
  }
  return resp.json();
}

export async function verifySignature(params: {
  wallet: string;
  signature: Uint8Array;
}): Promise<Session> {
  const resp = await fetch(`${API_BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      wallet: params.wallet,
      signature: bs58.encode(params.signature),
    }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body?.error || `Verify failed (${resp.status})`);
  }
  const data = (await resp.json()) as {
    token: string;
    expiresAt: string;
    wallet: string;
  };
  return { wallet: data.wallet, token: data.token, expiresAt: data.expiresAt };
}

export async function probeSession(token: string): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * End-to-end sign-in using a wallet-adapter `signMessage` function. Returns the resulting
 * Session. Does NOT persist it — the caller (AuthProvider) decides when to save.
 */
export async function runSiwsSignIn(args: {
  wallet: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<Session> {
  const { message } = await requestNonce(args.wallet);
  const messageBytes = new TextEncoder().encode(message);
  const signature = await args.signMessage(messageBytes);
  return verifySignature({ wallet: args.wallet, signature });
}
