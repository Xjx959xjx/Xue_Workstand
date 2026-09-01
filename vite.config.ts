import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";

const LOCAL_D1_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const { d1, r2 } = hostingConfig;

const localBindingConfig = {
  main: "vinext/server/fetch-handler",
  compatibility_flags: ["nodejs_compat"],
  vars: {
    SITES_STORAGE_MODE: "cloud"
  },
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "account-style-library-local",
          database_id: LOCAL_D1_DATABASE_ID
        }
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "account-style-library-local"
        }
      ]
    : []
};

const devWatchIgnorePatterns = [
  "**/.git/**",
  "**/.next/**",
  "**/node_modules/**",
  "**/style-library/**",
  "**/.dev-server/**",
  "**/output/**",
  "**/dist/**",
  "**/coverage/**",
  "**/.playwright-cli/**"
];

export default defineConfig({
  server: {
    watch: { ignored: devWatchIgnorePatterns }
  },
  plugins: [
    vinext(),
    sites(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      config: localBindingConfig
    })
  ]
});
