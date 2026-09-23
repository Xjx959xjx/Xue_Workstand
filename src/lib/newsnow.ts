// 第一阶段仅支持与工作台同一台 Mac 上的 NewsNow。
export const NEWSNOW_ORIGIN = "http://127.0.0.1:4444";
export const NEWSNOW_URL = `${NEWSNOW_ORIGIN}/c/hottest`;

export type NewsNowStatus = { available: boolean; message: string };
