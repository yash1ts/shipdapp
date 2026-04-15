"use client";

import { Anchor, Container, Coins, Waves } from "lucide-react";

const stats = [
  { label: "Apps Docked", value: "4", icon: Container },
  { label: "Tokens Launched", value: "4", icon: Coins },
  { label: "Total Vault TVL", value: "7.52 SOL", icon: Anchor },
  { label: "Network", value: "Devnet", icon: Waves },
];

export function StatsBar() {
  return (
    <section className="py-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="glass-card p-1">
          <div className="grid grid-cols-2 md:grid-cols-4">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className={`flex items-center gap-3 px-6 py-4 ${
                  i < stats.length - 1 ? "md:border-r border-white/[0.06]" : ""
                }`}
              >
                <stat.icon className="w-5 h-5 text-dock-400 flex-shrink-0" />
                <div>
                  <div className="text-lg font-bold text-white">
                    {stat.value}
                  </div>
                  <div className="text-xs text-slate-500">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
