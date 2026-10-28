// Serveur local de développement. La logique API/statique vit dans server/app.mjs
// (réutilisée telle quelle par la Function Netlify, sans listen ni import.meta).
import http from "node:http";
import "./server/local-env.mjs";
import { api, serveStatic } from "./server/app.mjs";

const server = http.createServer((req, res) => { if (req.url.startsWith("/api/")) return api(req, res); return serveStatic(req, res); });
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => console.log(`TradeMind final delivery listening on http://0.0.0.0:${port}`));
