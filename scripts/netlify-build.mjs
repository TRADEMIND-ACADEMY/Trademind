import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sourceManifest } from "./source-hash.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(root, "..");
const output = path.join(project, "netlify-dist");
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
copy(path.join(project, "products", "public-site"), output);
copy(path.join(project, "products", "application", "public"), path.join(output, "app"));
copy(path.join(project, "products", "control-center"), path.join(output, "owner"));
for (const file of ["auth.js", "refactor.js", "architecture.js", "ui.js", "tmsync-core.js", "tmsync.js", "pw-eye.js", "qr.js", "payment.js", "pwa.js"]) copy(path.join(project, "products", "application", "public", file), path.join(output, file));
copy(path.join(project, "products", "application", "public", "assets"), path.join(output, "assets"));
copy(path.join(project, "products", "application", "public", "assets"), path.join(output, "app-assets"));
copy(path.join(project, "products", "control-center", "assets"), path.join(output, "owner-assets"));
copy(path.join(project,"products","public-site","assets"), path.join(output,"site-assets"));
copy(path.join(project, "public", "manifest.webmanifest"), path.join(output, "manifest.webmanifest"));
copy(path.join(project, "public", "favicon.ico"), path.join(output, "favicon.ico"));
copy(path.join(project, "public", "sw.js"), path.join(output, "sw.js"));
copy(path.join(project, "public", "offline.html"), path.join(output, "offline.html"));
{ const m = sourceManifest(project); fs.writeFileSync(path.join(output, "build-info.json"), JSON.stringify({ name: "TRADEMIND ACADEMY", sourceSha256: m.sha256, files: m.rows.length, builtAt: new Date().toISOString(), note: "Compare sourceSha256 with: node scripts/source-hash.mjs (run in the extracted ZIP)." }, null, 2) + "\n"); }
console.log(`NETLIFY_BUILD_OK output=${path.relative(project, output)}`);
