import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: "#f5efe4",
        ink: "#112019",
        accent: "#c95c2b",
        pine: "#2e5d50",
        sand: "#d8c49c",
      },
      boxShadow: {
        card: "0 18px 60px rgba(17, 32, 25, 0.12)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
    },
  },
  plugins: [],
};

export default config;
