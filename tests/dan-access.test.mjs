// Accès à DAN : à partir de APEX (5 $/mois). FOUNDATION et ASCEND verrouillés ; ELITE (et Owner) = Sovereign.
import { danTier } from "../server/dan.mjs";
let fail = 0;
for (const [plan, want] of [["FREE", null], ["PRO", null], ["PRO MAX", "COACH"], ["ELITE", "SOVEREIGN"]]) {
  const got = danTier(plan); const ok = got === want; if (!ok) fail++;
  console.log(ok ? "  PASS " : "  FAIL ", `DAN ${plan} -> ${want || "verrouillé"}`);
}
console.log(`RÉSULTAT: ${4 - fail} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
