import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".vinext/**",
      ".wrangler/**",
      ".dev-server/**",
      ".remote-server/**",
      "dist/**",
      "node_modules/**",
      "output/**",
      "style-library/**",
      "next-env.d.ts"
    ]
  },
  ...compat.extends("next/core-web-vitals", "next/typescript")
];

export default eslintConfig;
