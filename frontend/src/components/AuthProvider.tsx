"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  clearSession,
  loadSession,
  probeSession,
  runSiwsSignIn,
  type Session,
} from "@/lib/auth";

type AuthStatus =
  | "disconnected" // no wallet connected
  | "needs_signin" // wallet connected but no valid session
  | "signing_in" // signature modal / in-flight request
  | "authenticated" // valid session
  | "error";

type AuthContextValue = {
  status: AuthStatus;
  wallet: string | null;
  token: string | null;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, connected, signMessage } = useWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  // Guard auto-signin so React strict mode / re-renders don't pop multiple wallet prompts.
  const inflight = useRef(false);
  // Track which wallet we've already auto-attempted, so repeated failures don't spam the modal.
  const attemptedFor = useRef<string | null>(null);

  const walletAddr = publicKey?.toBase58() ?? null;

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError("Wallet is not ready to sign messages");
      setStatus("error");
      return;
    }
    if (inflight.current) return;
    inflight.current = true;
    setStatus("signing_in");
    setError(null);
    try {
      const wallet = publicKey.toBase58();
      const s = await runSiwsSignIn({ wallet, signMessage });
      window.localStorage.setItem(
        `shipdapp:siws:${s.wallet}`,
        JSON.stringify(s)
      );
      setSession(s);
      setStatus("authenticated");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("needs_signin");
    } finally {
      inflight.current = false;
    }
  }, [publicKey, signMessage]);

  const signOut = useCallback(() => {
    if (walletAddr) clearSession(walletAddr);
    setSession(null);
    setError(null);
    setStatus(connected ? "needs_signin" : "disconnected");
    attemptedFor.current = null;
  }, [walletAddr, connected]);

  // Rehydrate from localStorage / verify server-side whenever the wallet changes.
  useEffect(() => {
    let alive = true;
    async function hydrate() {
      if (!connected || !walletAddr) {
        setSession(null);
        setStatus("disconnected");
        attemptedFor.current = null;
        return;
      }
      const existing = loadSession(walletAddr);
      if (existing) {
        const ok = await probeSession(existing.token);
        if (!alive) return;
        if (ok) {
          setSession(existing);
          setStatus("authenticated");
          return;
        }
        clearSession(walletAddr);
      }
      setSession(null);
      setStatus("needs_signin");
      // Kick off the signature prompt once per wallet; user can retry manually via signIn().
      if (attemptedFor.current !== walletAddr && signMessage) {
        attemptedFor.current = walletAddr;
        void signIn();
      }
    }
    void hydrate();
    return () => {
      alive = false;
    };
  }, [connected, walletAddr, signMessage, signIn]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      wallet: session?.wallet ?? null,
      token: session?.token ?? null,
      error,
      signIn,
      signOut,
    }),
    [status, session, error, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
