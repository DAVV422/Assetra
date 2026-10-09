import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { MockAssetraClient } from "./sdk/mock-assetra-client.js";
import { ChainAssetraClient } from "./sdk/chain-assetra-client.js";

// Cargar variables de entorno desde .env si existe
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "backend/.env"),
  path.resolve(import.meta.dirname, "../.env")
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envPath);
      break;
    } catch {
      // Ignorar si ya fue cargado
    }
  }
}

const isLive = (process.env.ASSETRA_MODE ?? "").toLowerCase() === "live";
const client = isLive ? new ChainAssetraClient() : new MockAssetraClient();
const port = Number(process.env.PORT ?? 4000);

createApp(client).listen(port, () => {
  console.log(`Assetra API listening on http://localhost:${port} [MODE: ${isLive ? "LIVE (on-chain, sin claves)" : "MOCK"}]`);
});
