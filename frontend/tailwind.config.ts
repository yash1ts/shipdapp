import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Deep ocean / Docker dark palette
        dock: {
          50: "#e6f4fc",
          100: "#c0e3f8",
          200: "#86cff3",
          300: "#4ab8eb",
          400: "#2496ed", // Docker blue
          500: "#1a7fd4",
          600: "#1268b3",
          700: "#0d4f8a",
          800: "#0a3a66",
          900: "#072743",
          950: "#041a2e",
        },
        ocean: {
          50: "#f0fdf9",
          100: "#ccfbef",
          200: "#99f6df",
          300: "#5eeace",
          400: "#2dd4b7",
          500: "#14b89e",
          600: "#0d9481",
          700: "#0f7669",
          800: "#115e55",
          900: "#134e47",
          950: "#042f2e",
        },
        abyss: {
          DEFAULT: "#060b18",
          light: "#0c1425",
          medium: "#101c32",
          card: "#0f172a",
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "ocean-glow":
          "radial-gradient(ellipse at 50% 0%, rgba(36,150,237,0.15) 0%, transparent 60%)",
        "ocean-glow-b":
          "radial-gradient(ellipse at 50% 100%, rgba(36,150,237,0.08) 0%, transparent 50%)",
      },
      boxShadow: {
        dock: "0 0 30px rgba(36, 150, 237, 0.15)",
        "dock-lg": "0 0 60px rgba(36, 150, 237, 0.2)",
        glow: "0 0 20px rgba(36, 150, 237, 0.3)",
      },
      animation: {
        "wave": "wave 8s ease-in-out infinite",
        "wave-slow": "wave 12s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
      },
      keyframes: {
        wave: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "50%": { transform: "translateY(-12px) rotate(2deg)" },
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
