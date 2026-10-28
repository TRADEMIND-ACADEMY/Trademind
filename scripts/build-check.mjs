import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS, PAYMENT_METHODS } from '../server/payment-config.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const required = [
  '../server.mjs', '../server/app.mjs', '../server/local-env.mjs', '../server/payment-config.mjs', '../server/billing.mjs', '../server/accounts.mjs', '../server/security.mjs', '../server/dan.mjs', '../server/nowpayments.mjs', '../public/sw.js', '../public/offline.html', '../products/application/public/payment.js', '../products/application/public/qr.js', '../products/application/public/ui.js', '../products/application/public/pwa.js', '../products/public-site/index.html', '../products/public-site/assets/site.css', '../products/public-site/assets/site.js',
  '../products/control-center/index.html', '../products/control-center/assets/owner.css', '../products/control-center/assets/owner.js', '../public/manifest.webmanifest', '../public/favicon.ico', '../netlify/functions/api.mjs', '../scripts/netlify-build.mjs', '../scripts/source-hash.mjs', '../scripts/migrate-to-blobs.mjs', '../netlify.toml'
];
for (const relative of required) if (!fs.existsSync(path.resolve(root, relative))) throw new Error(`Missing required file: ${relative}`);
if (Object.keys(PLANS).length !== 4) throw new Error('Expected four plans');
if (PLANS.FREE.tradeLimit !== 10 || PLANS.PRO.tradeLimit !== 30 || PLANS['PRO MAX'].tradeLimit !== 50 || PLANS.ELITE.tradeLimit !== null) throw new Error('Plan limits do not match the approved catalog');
if (PLANS.PRO.priceUsdMonthly !== 2.5 || PLANS['PRO MAX'].priceUsdMonthly !== 5 || PLANS.ELITE.priceUsdMonthly !== 10) throw new Error('Plan pricing does not match the approved catalog');
if (PAYMENT_METHODS.find(method => method.network === 'Ethereum / ERC-20' && method.asset !== 'USDT')) throw new Error('USDT ERC-20 network label is inconsistent');
for (const file of ['../server.mjs', '../server/app.mjs', '../server/accounts.mjs', '../server/security.mjs', '../server/billing.mjs', '../server/dan.mjs', '../products/application/public/payment.js']) {
  const source = fs.readFileSync(path.resolve(root, file), 'utf8');
  for (const secret of ['ADMIN_PRIVATE_KEY=', 'PAYMENT_API_KEY=', 'PAYMENT_WEBHOOK_SECRET=']) if (source.includes(secret)) throw new Error(`Secret literal found: ${secret}`);
}
if (!fs.existsSync(path.resolve(root, '../package-lock.json'))) throw new Error('package-lock.json is required for Netlify builds');
console.log(`BUILD_OK plans=${Object.keys(PLANS).length} payment_methods=${PAYMENT_METHODS.length} netlify=ready`);
