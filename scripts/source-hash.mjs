// Empreinte du code source (indépendante de l'archive) : SHA-256 d'un manifeste « chemin + SHA-256 du fichier » trié.
// Sert à comparer le code déployé (/build-info.json) avec le dossier extrait du ZIP : node scripts/source-hash.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", "netlify-dist", ".git", ".github", "data", "__MACOSX"]);
export function sourceManifest(project) {
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { if (SKIP_DIRS.has(entry.name) && dir === project) continue; const full = path.join(dir, entry.name); if (entry.isDirectory()) { if (entry.name === "node_modules" || entry.name === "__MACOSX") continue; walk(full); } else if (entry.isFile() && !/\.(zip|tmp|log)$/i.test(entry.name) && entry.name !== ".DS_Store" && !(dir === project && entry.name === "FINAL-RELEASE-REPORT.md")) files.push(full); } };
  walk(project);
  const rows = files.map(file => `${path.relative(project, file).split(path.sep).join("/")}  ${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`).sort();
  return { rows, sha256: crypto.createHash("sha256").update(rows.join("\n")).digest("hex") };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); const m = sourceManifest(project); console.log(`SOURCE_SHA256 ${m.sha256} files=${m.rows.length}`); }
