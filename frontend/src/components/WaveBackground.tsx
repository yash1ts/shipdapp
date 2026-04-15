"use client";

export function WaveBackground() {
  return (
    <>
      {/* Top glow */}
      <div className="fixed inset-0 pointer-events-none z-0 bg-ocean-glow" />

      {/* Bottom waves */}
      <div className="wave-bg">
        <svg
          viewBox="0 0 1440 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full animate-wave"
          preserveAspectRatio="none"
        >
          <path
            d="M0 80C240 120 480 40 720 80C960 120 1200 40 1440 80V200H0V80Z"
            fill="url(#wave1)"
          />
          <defs>
            <linearGradient id="wave1" x1="0" y1="0" x2="1440" y2="0">
              <stop offset="0%" stopColor="#2496ed" stopOpacity="0.3" />
              <stop offset="50%" stopColor="#14b89e" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#2496ed" stopOpacity="0.3" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <div className="wave-bg" style={{ opacity: 0.08 }}>
        <svg
          viewBox="0 0 1440 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full animate-wave-slow"
          preserveAspectRatio="none"
        >
          <path
            d="M0 100C360 60 720 140 1080 80C1260 50 1380 90 1440 100V200H0V100Z"
            fill="url(#wave2)"
          />
          <defs>
            <linearGradient id="wave2" x1="0" y1="0" x2="1440" y2="0">
              <stop offset="0%" stopColor="#0db7ed" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#2496ed" stopOpacity="0.4" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Grid overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(36,150,237,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(36,150,237,0.03) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
    </>
  );
}
