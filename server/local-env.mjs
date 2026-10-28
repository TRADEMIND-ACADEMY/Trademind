// Point d'entrée local uniquement : fixe la racine du projet avant le chargement de server/app.mjs.
// Ce fichier n'est jamais importé par la Function Netlify.
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.TM_ROOT = process.env.TM_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
