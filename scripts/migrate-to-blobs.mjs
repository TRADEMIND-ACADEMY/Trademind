import fs from "node:fs/promises";
import { getStore } from "@netlify/blobs";

const root = new URL("..", import.meta.url);
const store = getStore({ name: process.env.TM_BLOBS_STORE || "trademind-data", consistency: "strong" });
for (const key of ["users", "sessions", "audit"]) {
  const file = new URL(`data/${key}.json`, root);
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  await store.setJSON(key, value);
  console.log(`MIGRATED ${key}`);
}
console.log("NETLIFY_BLOBS_MIGRATION_OK");
