export type AppMode = "workspace" | "gross-margin";

export function getAppMode(): AppMode {
  return process.env.APP_MODE === "gross-margin" ? "gross-margin" : "workspace";
}

export function isGrossMarginAppMode() {
  return getAppMode() === "gross-margin";
}
