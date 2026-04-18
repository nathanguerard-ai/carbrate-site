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
        surface: "#f6faf7",
        ink: "#17251e",
        accent: "#e64b5d",
        pine: "#177d72",
        sand: "#f4c542",
      },
      boxShadow: {
        card: "0 18px 50px rgba(23, 37, 30, 0.12)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
    },
  },
  plugins: [],
};

export default config;
