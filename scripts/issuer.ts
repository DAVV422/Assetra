// Gestión de emisores aprobados (solo el admin de la plataforma), tras el KYB fuera de la cadena.
//   npm run script:issuer -- approve G...
//   npm run script:issuer -- revoke  G...
//   npm run script:issuer -- status  G...
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [action, issuer] = process.argv.slice(2);
const actions: Record<string, string> = { approve: "approve_issuer", revoke: "revoke_issuer", status: "is_approved_issuer" };

if (!actions[action] || !/^G[A-Z2-7]{55}$/.test(issuer ?? "")) {
  console.error("Uso: npm run script:issuer -- <approve|revoke|status> <dirección G...>");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "contracts.json"), "utf8"));
const args = [
  "contract", "invoke",
  "--id", config.registryContractId,
  "--source-account", "admin",
  "--network", config.network ?? "testnet",
  ...(action === "status" ? ["--send=no"] : []),
  "--", actions[action], "--issuer", issuer
];

// execFile sin shell: la dirección nunca se interpreta como comando
const output = execFileSync("stellar", args, { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"], shell: false }).trim();
if (action === "status") {
  console.log(`Emisor ${issuer}: ${output === "true" ? "APROBADO" : "NO aprobado"}`);
} else {
  console.log(`✔ Emisor ${issuer} ${action === "approve" ? "APROBADO" : "REVOCADO"} en RwaRegistry ${config.registryContractId}`);
}
