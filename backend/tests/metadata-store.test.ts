import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileMetadataStore, PostgresMetadataStore, postgresConfigFromEnv, type MetadataStore } from "../src/sdk/metadata-store.js";
import type { Asset } from "../src/types.js";

const asset = (id: string, name = "Factura de prueba"): Asset => ({
  id, onChainId: id.replace("asset-", "").toUpperCase(), name, symbol: "TST", type: "invoice",
  description: "Activo de prueba del almacén de metadatos", issuer: "Demo SRL", custodian: "Demo Custody",
  jurisdiction: "Bolivia", totalValue: 1000, currency: "USDC", supply: 100, mintedSupply: 0, holderCount: 0,
  maturityDate: "2027-01-01", status: "draft", documents: [], participants: [], activity: [],
  createdAt: new Date().toISOString()
});

function contract(name: string, makeStore: () => Promise<MetadataStore>) {
  describe(name, () => {
    it("guarda, actualiza y lista activos", async () => {
      const store = await makeStore();
      const id = `asset-t${Date.now().toString(36)}`;
      await store.saveAsset(asset(id));
      await store.saveAsset(asset(id, "Nombre actualizado"));
      expect((await store.getAsset(id))?.name).toBe("Nombre actualizado");
      expect((await store.listAssets()).filter((a) => a.id === id)).toHaveLength(1);
      expect(await store.getAsset("asset-inexistente")).toBeUndefined();
    });

    it("acepta cada txHash una sola vez", async () => {
      const store = await makeStore();
      const id = `asset-u${Date.now().toString(36)}`;
      const hash = Date.now().toString(16).padStart(64, "a");
      await store.saveAsset(asset(id), hash);
      expect(await store.isTxUsed(hash)).toBe(true);
      await expect(store.saveAsset(asset(id, "Reintento"), hash)).rejects.toThrow("TX_ALREADY_USED");
      // El rechazo no modifica el activo
      expect((await store.getAsset(id))?.name).toBe("Factura de prueba");
    });

    it("conserva los datos al reiniciar (nueva instancia)", async () => {
      const first = await makeStore();
      const id = `asset-r${Date.now().toString(36)}`;
      await first.saveAsset(asset(id));
      const second = await makeStore();
      expect((await second.getAsset(id))?.id).toBe(id);
    });
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assetra-store-"));
contract("FileMetadataStore", async () => {
  const store = new FileMetadataStore(path.join(dir, "chain-assets.json"));
  await store.init();
  return store;
});

// Integración real: TEST_DATABASE_URL=postgres://… npm run test -w backend
const pgUrl = process.env.TEST_DATABASE_URL;
// Usa una base de datos de pruebas: los activos de prueba quedan guardados en ella.
if (pgUrl) {
  contract("PostgresMetadataStore", async () => {
    const store = new PostgresMetadataStore(postgresConfigFromEnv({ DATABASE_URL: pgUrl, DATABASE_SSL: process.env.TEST_DATABASE_SSL })!);
    await store.init();
    return store;
  });
}

describe("postgresConfigFromEnv", () => {
  it("sin variables usa el archivo local", () => {
    expect(postgresConfigFromEnv({})).toBeUndefined();
  });
  it("acepta DATABASE_URL y exige TLS verificado por defecto", () => {
    const config = postgresConfigFromEnv({ DATABASE_URL: "postgres://u:p@h/db" });
    expect(config?.connectionString).toBe("postgres://u:p@h/db");
    expect(config?.ssl).toEqual({ rejectUnauthorized: true });
  });
  it("acepta las variables DATABASE_* de Koyeb", () => {
    const config = postgresConfigFromEnv({ DATABASE_HOST: "h", DATABASE_USER: "u", DATABASE_PASSWORD: "p", DATABASE_NAME: "db" });
    expect(config).toMatchObject({ host: "h", port: 5432, user: "u", database: "db" });
  });
  it("permite desactivar TLS para un Postgres local", () => {
    expect(postgresConfigFromEnv({ DATABASE_URL: "postgres://localhost/db", DATABASE_SSL: "disable" })?.ssl).toBe(false);
  });
});
