import type { Asset } from "./types.js";

const now = new Date("2026-09-26T21:00:00-04:00").toISOString();

export const demoAssets: Asset[] = [
  {
    id: "asset-invoice-091",
    name: "Factura Andina 091",
    symbol: "AINV91",
    type: "invoice",
    description: "Derecho de cobro de una factura comercial ficticia con vencimiento a 90 días.",
    issuer: "Andina Export SRL",
    custodian: "Assetra Demo Custody",
    jurisdiction: "Bolivia",
    totalValue: 100000,
    currency: "USDC",
    supply: 1000,
    mintedSupply: 625,
    holderCount: 3,
    maturityDate: "2026-12-20",
    status: "active",
    contractId: "CAINVOICE091TESTNETASSETARA",
    documents: [
      { id: "doc-invoice-091", name: "Factura comercial 091", kind: "Factura", hash: "a47f8c0d...68d91e20", url: "https://example.com/demo/invoice-091.pdf", version: 1, createdAt: now },
      { id: "doc-custody-091", name: "Constancia del custodio", kind: "Custodia", hash: "f9d7c021...2a0e114c", version: 1, createdAt: now }
    ],
    participants: [
      { id: "participant-aya", name: "Aya Capital", wallet: "GAYA...2KQF", jurisdiction: "Bolivia", status: "authorized", verifiedAt: now },
      { id: "participant-ouali", name: "Ouali Ventures", wallet: "GOUA...8PND", jurisdiction: "Portugal", status: "authorized", verifiedAt: now },
      { id: "participant-norte", name: "Norte Holdings", wallet: "GNOR...7ASW", jurisdiction: "Chile", status: "pending" }
    ],
    activity: [
      { id: "evt-1", type: "mint", label: "625 AINV91 emitidos", actor: "Emisor", timestamp: now, txHash: "8c2...91f" },
      { id: "evt-2", type: "authorize", label: "Ouali Ventures autorizado", actor: "Compliance", timestamp: now },
      { id: "evt-3", type: "document", label: "Constancia de custodio registrada", actor: "Emisor", timestamp: now }
    ],
    createdAt: now
  },
  {
    id: "asset-bond-2027", name: "Bono PyME 2027", symbol: "PYME27", type: "bond",
    description: "Emisión de deuda privada ficticia para pruebas de ciclo de vida.", issuer: "Impulso Productivo SA",
    custodian: "Assetra Demo Custody", jurisdiction: "Bolivia", totalValue: 250000, currency: "USDC", supply: 2500,
    mintedSupply: 0, holderCount: 0, maturityDate: "2027-06-30", status: "draft", documents: [], participants: [], activity: [], createdAt: now
  },
  {
    id: "asset-carbon-041", name: "Bosque Norte 041", symbol: "CARB41", type: "carbon-credit",
    description: "Lote ficticio de créditos ambientales verificados para la demo.", issuer: "Bosque Norte Foundation",
    custodian: "Green Registry Demo", jurisdiction: "Colombia", totalValue: 48000, currency: "USDC", supply: 4800,
    mintedSupply: 4800, holderCount: 8, maturityDate: "2027-03-15", status: "paused", documents: [], participants: [], activity: [], createdAt: now
  }
];
