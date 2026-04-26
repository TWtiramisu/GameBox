/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0a0a0c",
        sidebar: "#121214",
        accent: "#7c3aed", // Violet/Purple
        "accent-hover": "#8b5cf6",
      }
    },
  },
  plugins: [],
}
