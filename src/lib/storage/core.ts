import path from "path";
import { safeSegment } from "../utils";

export function libraryRoot() {
  return path.resolve(process.cwd(), process.env.STYLE_LIBRARY_DIR || "style-library");
}

export function normalizeStorageSegment(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized || normalized === "." || normalized.includes("..") || normalized !== safeSegment(normalized)) {
    throw new Error(`${label} 不合法`);
  }
  return normalized;
}
