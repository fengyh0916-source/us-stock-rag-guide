import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    ".next-build/**",
    "public/asset-tracker/**",
    "**/.venv/**",
    "**/node_modules/**",
    "agent/data/**",
    "agent/eval/results/**",
  ]),
  {
    // These effects intentionally hydrate client-only state or start an async
    // refresh after mount; they are not render-derived state loops.
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["asset-tracker/frontend/**/*.{ts,tsx}"],
    rules: {
      // This is an independently built Vite app, so next/link is unavailable.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
]);
