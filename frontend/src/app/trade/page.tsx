"use client";

import { useState } from "react";
import {
  Anchor,
  ArrowDownUp,
  Coins,
  TrendingUp,
  Fuel,
  Heart,
  Droplets,
} from "lucide-react";

const MOCK_TOKENS = [
  {
    symbol: "$NOTE",
    name: "NoteFlow",
    price: 0.0042,
    change: "+12.5%",
    mcap: "4.2K SOL",
    positive: true,
  },
  {
    symbol: "$PIXEL",
    name: "PixelForge",
    price: 0.0089,
    change: "+34.2%",
    mcap: "8.9K SOL",
    positive: true,
  },
  {
    symbol: "$CHAT",
    name: "ChainChat",
    price: 0.0001,
    change: "New",
    mcap: "0.1K SOL",
    positive: true,
  },
  {
    symbol: "$DASH",
    name: "DefiDash",
    price: 0.0003,
    change: "-8.1%",
    mcap: "0.3K SOL",
    positive: false,
  },
];

export default function TradePage() {
  const [selectedToken, setSelectedToken] = useState(MOCK_TOKENS[0]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [donateAmount, setDonateAmount] = useState("");

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 relative">
      {/* Glow */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[300px] bg-ocean-400/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Token List */}
        <div className="lg:col-span-1">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Droplets className="w-5 h-5 text-dock-400" />
            App Tokens
          </h2>

          <div className="space-y-2">
            {MOCK_TOKENS.map((token) => (
              <button
                key={token.symbol}
                onClick={() => setSelectedToken(token)}
                className={`w-full container-card p-4 text-left transition-all ${
                  selectedToken.symbol === token.symbol
                    ? "!border-dock-400/30 shadow-dock"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-dock-400/20 to-ocean-500/20 flex items-center justify-center border border-white/[0.06]">
                      <Coins className="w-4 h-4 text-dock-300" />
                    </div>
                    <div>
                      <div className="font-semibold text-white text-sm">
                        {token.symbol}
                      </div>
                      <div className="text-xs text-slate-500">{token.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-white">
                      {token.price} SOL
                    </div>
                    <div
                      className={`text-xs ${
                        token.positive ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {token.change}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Swap Panel */}
        <div className="lg:col-span-1">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <ArrowDownUp className="w-5 h-5 text-dock-400" />
            Swap
          </h2>

          <div className="container-card p-6">
            {/* Token info header */}
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/[0.06]">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-dock-400/20 to-ocean-500/20 flex items-center justify-center border border-white/[0.06]">
                <TrendingUp className="w-5 h-5 text-dock-300" />
              </div>
              <div>
                <div className="font-bold text-white">
                  {selectedToken.symbol}
                </div>
                <div className="text-xs text-slate-500">
                  {selectedToken.name} — {selectedToken.mcap} mcap
                </div>
              </div>
            </div>

            {/* Buy/Sell toggle */}
            <div className="flex rounded-lg bg-abyss/80 border border-white/[0.06] p-1 mb-6">
              <button
                onClick={() => setSide("buy")}
                className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                  side === "buy"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/20"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => setSide("sell")}
                className={`flex-1 rounded-md py-2 text-sm font-medium transition-all ${
                  side === "sell"
                    ? "bg-red-500/20 text-red-400 border border-red-500/20"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Sell
              </button>
            </div>

            {/* Input */}
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  {side === "buy" ? "You pay (SOL)" : `You sell (${selectedToken.symbol})`}
                </label>
                <input
                  className="input-dock text-lg font-mono"
                  placeholder="0.00"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <div className="w-8 h-8 rounded-full border border-white/[0.06] bg-abyss flex items-center justify-center">
                  <ArrowDownUp className="w-4 h-4 text-dock-400" />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  {side === "buy" ? `You receive (${selectedToken.symbol})` : "You receive (SOL)"}
                </label>
                <div className="input-dock text-lg font-mono text-slate-500">
                  {amount
                    ? side === "buy"
                      ? (parseFloat(amount) / selectedToken.price).toFixed(2)
                      : (parseFloat(amount) * selectedToken.price).toFixed(6)
                    : "0.00"}
                </div>
              </div>

              {/* Fee notice */}
              <div className="rounded-lg bg-dock-400/5 border border-dock-400/10 p-3 text-xs text-slate-400">
                <span className="text-dock-300 font-medium">2% transfer fee</span>{" "}
                on every trade goes to the app's hosting vault
              </div>

              <button
                className={`w-full justify-center py-3 text-base ${
                  side === "buy" ? "btn-ocean" : "btn-dock"
                } disabled:opacity-40 disabled:cursor-not-allowed`}
                disabled={!amount || parseFloat(amount) <= 0}
              >
                {side === "buy" ? "Buy" : "Sell"} {selectedToken.symbol}
              </button>
            </div>
          </div>
        </div>

        {/* Vault / Donate Panel */}
        <div className="lg:col-span-1">
          <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Fuel className="w-5 h-5 text-dock-400" />
            Hosting Vault
          </h2>

          <div className="container-card p-6 mb-4">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-dock-400/10 to-ocean-500/10 border border-white/[0.06] mb-3">
                <Anchor className="w-7 h-7 text-dock-300" />
              </div>
              <div className="text-2xl font-bold text-white">
                {selectedToken.symbol === "$NOTE"
                  ? "2.40"
                  : selectedToken.symbol === "$PIXEL"
                  ? "5.10"
                  : "0.00"}{" "}
                SOL
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {selectedToken.name} hosting balance
              </div>
            </div>

            {/* Vault stats */}
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Fees collected (total)</span>
                <span className="text-white font-mono">12.4 SOL</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Monthly hosting cost</span>
                <span className="text-white font-mono">~0.5 SOL</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Runway</span>
                <span className="text-emerald-400 font-mono">~4.8 months</span>
              </div>
            </div>

            {/* Health bar */}
            <div className="mb-2">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500">Vault Health</span>
                <span className="text-emerald-400">Healthy</span>
              </div>
              <div className="h-2 rounded-full bg-abyss/80 border border-white/[0.04] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-dock-400 to-ocean-400 transition-all duration-500"
                  style={{ width: "78%" }}
                />
              </div>
            </div>
          </div>

          {/* Donate */}
          <div className="container-card p-6">
            <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-400" />
              Donate to Vault
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Keep {selectedToken.name} alive by donating SOL directly to its
              hosting vault.
            </p>
            <div className="flex gap-2">
              <input
                className="input-dock flex-1 font-mono"
                placeholder="0.1 SOL"
                type="number"
                value={donateAmount}
                onChange={(e) => setDonateAmount(e.target.value)}
              />
              <button
                className="btn-ocean px-4 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!donateAmount || parseFloat(donateAmount) <= 0}
              >
                <Heart className="w-4 h-4" />
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
