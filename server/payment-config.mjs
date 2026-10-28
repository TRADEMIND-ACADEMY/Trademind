export const PLANS = {
  FREE: {
    code: "FREE",
    identity: "FOUNDATION",
    priceUsdMonthly: 0,
    tradeLimit: 10,
    description: "Essential Discipline",
    features: ["Dashboard de base", "Journal & Add Trade", "Guardian basique", "Psychology basique", "Statistiques fondamentales"]
  },
  PRO: {
    code: "PRO",
    identity: "ASCEND",
    priceUsdMonthly: 2.5,
    tradeLimit: 30,
    description: "Growth & Intelligence",
    features: ["Analytics avancés", "Evolution", "Matrix", "DAN Coach", "Reviews avancées", "Discipline & Plan adherence"]
  },
  "PRO MAX": {
    code: "PRO MAX",
    identity: "APEX",
    priceUsdMonthly: 5,
    tradeLimit: 50,
    description: "Advanced Analysis",
    features: ["Analyses historiques", "Matrix avancée", "Calendar", "Data Quality", "Contribution", "Reporting avancé"]
  },
  ELITE: {
    code: "ELITE",
    identity: "SOVEREIGN",
    priceUsdMonthly: 10,
    tradeLimit: null,
    description: "Private Trading Intelligence",
    features: ["Tout APEX", "DAN Sovereign", "Reviews globales", "Synthèse du processus", "Parcours comportemental"]
  }
};

export const PAYMENT_METHODS = [
  {
    id: "airtel-rdc",
    kind: "mobile_money",
    name: "Airtel Money RDC",
    asset: "RDC Franc / USD selon le provider",
    receiver: "+243965430389",
    network: "Airtel Money",
    mode: "MANUAL",
    status: "ACTIVE_MANUAL",
    warning: "Paiement manuel : le plan est activé uniquement après vérification et confirmation par l'Owner. Aucune activation automatique."
  },
  {
    id: "usdt-erc20",
    kind: "crypto",
    name: "USDT — Ethereum",
    asset: "USDT",
    network: "Ethereum / ERC-20",
    address: "0x4fb5dd52e54545a2e7e36768b33c6c4ec955c286",
    mode: "MANUAL",
    status: "ACTIVE_MANUAL",
    warning: "Envoyer uniquement de l'USDT sur Ethereum/ERC-20. Cette adresse ne doit pas être présentée comme une adresse ETH native."
  },
  {
    id: "usdt-bep20",
    kind: "crypto",
    name: "USDT — BNB Smart Chain",
    asset: "USDT",
    network: "BNB Smart Chain / BEP-20",
    address: "0x4fb5dd52e54545a2e7e36768b33c6c4ec955c286",
    mode: "MANUAL",
    status: "ACTIVE_MANUAL",
    warning: "Envoyer uniquement de l'USDT sur BNB Smart Chain/BEP-20. Vérifier le réseau avant toute opération."
  },
  {
    id: "bitcoin",
    kind: "crypto",
    name: "Bitcoin",
    asset: "BTC",
    network: "Bitcoin",
    address: "15Nby76XKWCbEtf5EezR3BEFLKqmZYTj9T",
    mode: "MANUAL",
    status: "ACTIVE_MANUAL",
    warning: "Envoyer uniquement du BTC sur le réseau Bitcoin. Aucun autre réseau n'est supporté par cette adresse."
  }
];

export const NOWPAYMENTS_METHOD = {
  id: "nowpayments",
  kind: "crypto_auto",
  name: "Crypto (USDT / BTC)",
  asset: "USDT / BTC",
  network: "NOWPayments",
  mode: "AUTOMATIC",
  status: "ACTIVE_AUTOMATIC",
  warning: "Le plan est activé automatiquement après confirmation du réseau, via une notification signée vérifiée côté serveur."
};
const autoConfigured = () => Boolean(process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET);

export const PAYMENT_PROVIDER = {
  get configured() { return autoConfigured() || Boolean(process.env.PAYMENT_API_KEY && process.env.PAYMENT_WEBHOOK_SECRET); },
  get status() { return autoConfigured() ? (process.env.NOWPAYMENTS_SANDBOX === "1" ? "nowpayments_sandbox" : "configured_pending_verification") : "not_configured"; },
  get message() { return autoConfigured() ? "Crypto automatique (NOWPayments) configuré" + (process.env.NOWPAYMENTS_SANDBOX === "1" ? " en mode TEST (sandbox)" : "") + " : activation uniquement après notification signée vérifiée. Airtel Money et dépôts directs restent manuels (confirmation Owner)." : "Aucun provider automatisé n'est connecté. Paiements manuels : l'Owner confirme après vérification. Aucun paiement ne peut activer un plan depuis le frontend."; }
};

export const planCatalog = () => Object.values(PLANS).map(({ code, identity, priceUsdMonthly, tradeLimit, description, features }) => ({ code, identity, priceUsdMonthly, tradeLimit, description, features }));
export const paymentCatalog = () => [...(autoConfigured() ? [NOWPAYMENTS_METHOD] : []), ...PAYMENT_METHODS].map(method => ({ ...method }));
