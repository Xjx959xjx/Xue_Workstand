import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "drizzle");
const destination = path.join(root, "dist", "server", "migrations");

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
