import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import type { Asset } from "../types.js";

/**
 * Persistencia de los metadatos off-chain del catálogo (nombre, descripción, participantes,
 * documentos, actividad) y de los hashes de transacción ya usados como prueba.
 * Permisos, saldos y estados viven on-chain; esto solo guarda lo que la cadena no tiene.
 */
export interface MetadataStore {
  readonly kind: "postgres" | "file";
  init(): Promise<void>;
  listAssets(): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | undefined>;
  /**
   * Guarda el activo. Si se pasa `txHash`, lo marca como usado en la misma operación y falla
   * con TX_ALREADY_USED si otra petición (u otra réplica) ya lo registró.
   */
  saveAsset(asset: Asset, txHash?: string): Promise<void>;
  isTxUsed(hash: string): Promise<boolean>;
}

export class TxAlreadyUsedError extends Error {
  constructor() {
    super("TX_ALREADY_USED: esa transacción ya fue registrada");
  }
}

// ----------------------------------------------------------------------
// PostgreSQL (producción: Koyeb, Neon, Supabase…)
// ----------------------------------------------------------------------

export function postgresConfigFromEnv(env = process.env): pg.PoolConfig | undefined {
  const ssl = (env.DATABASE_SSL ?? "require").toLowerCase() === "disable" ? false : { rejectUnauthorized: true };
  const base: pg.PoolConfig = { ssl, max: Number(env.DATABASE_POOL_MAX) || 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 };
  if (env.DATABASE_URL) return { ...base, connectionString: env.DATABASE_URL };
  if (env.DATABASE_HOST) {
    return {
      ...base,
      host: env.DATABASE_HOST,
      port: Number(env.DATABASE_PORT) || 5432,
      user: env.DATABASE_USER,
      password: env.DATABASE_PASSWORD,
      database: env.DATABASE_NAME
    };
  }
  return undefined;
}

export class PostgresMetadataStore implements MetadataStore {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;

  constructor(config: pg.PoolConfig) {
    this.pool = new pg.Pool(config);
    // Un error en una conexión inactiva no debe tumbar el proceso
    this.pool.on("error", (err) => console.error("Postgres pool error:", err.message));
  }

  async init() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS assetra_assets (
        id          TEXT PRIMARY KEY,
        on_chain_id TEXT UNIQUE,
        data        JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS assetra_used_tx (
        hash       TEXT PRIMARY KEY,
        asset_id   TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  async listAssets(): Promise<Asset[]> {
    const { rows } = await this.pool.query<{ data: Asset }>("SELECT data FROM assetra_assets ORDER BY created_at DESC");
    return rows.map((row) => row.data);
  }

  async getAsset(id: string): Promise<Asset | undefined> {
    const { rows } = await this.pool.query<{ data: Asset }>("SELECT data FROM assetra_assets WHERE id = $1", [id]);
    return rows[0]?.data;
  }

  async saveAsset(asset: Asset, txHash?: string) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      if (txHash) {
        const inserted = await db.query("INSERT INTO assetra_used_tx (hash, asset_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [txHash, asset.id]);
        if (inserted.rowCount === 0) throw new TxAlreadyUsedError();
      }
      await db.query(
        `INSERT INTO assetra_assets (id, on_chain_id, data, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [asset.id, asset.onChainId ?? null, JSON.stringify(asset), asset.createdAt]
      );
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      db.release();
    }
  }

  async isTxUsed(hash: string) {
    const { rowCount } = await this.pool.query("SELECT 1 FROM assetra_used_tx WHERE hash = $1", [hash]);
    return (rowCount ?? 0) > 0;
  }
}

// ----------------------------------------------------------------------
// Archivo JSON (desarrollo local sin base de datos)
// ----------------------------------------------------------------------

interface FileData {
  assets: Asset[];
  usedTx: string[];
}

export class FileMetadataStore implements MetadataStore {
  readonly kind = "file" as const;
  private data: FileData = { assets: [], usedTx: [] };

  constructor(readonly filePath: string) {}

  static defaultPath(): string {
    const dirs = [
      path.resolve(process.cwd(), "backend/data"),
      path.resolve(process.cwd(), "data"),
      path.resolve(import.meta.dirname, "../../data"),
      path.resolve(import.meta.dirname, "../../../data")
    ];
    const dir = dirs.find((d) => fs.existsSync(d)) ?? dirs[1];
    return path.join(dir, "chain-assets.json");
  }

  async init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (Array.isArray(parsed.assets)) this.data = { assets: parsed.assets, usedTx: parsed.usedTx ?? [] };
      }
    } catch (err) {
      console.error("Warning: could not read chain asset store:", err);
    }
  }

  async listAssets() {
    return structuredClone(this.data.assets);
  }

  async getAsset(id: string) {
    const asset = this.data.assets.find((item) => item.id === id);
    return asset ? structuredClone(asset) : undefined;
  }

  async saveAsset(asset: Asset, txHash?: string) {
    if (txHash) {
      if (this.data.usedTx.includes(txHash)) throw new TxAlreadyUsedError();
      this.data.usedTx.push(txHash);
    }
    const index = this.data.assets.findIndex((item) => item.id === asset.id);
    if (index >= 0) this.data.assets[index] = structuredClone(asset);
    else this.data.assets.unshift(structuredClone(asset));
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  async isTxUsed(hash: string) {
    return this.data.usedTx.includes(hash);
  }
}

/** Postgres si hay DATABASE_URL o DATABASE_HOST; si no, archivo local en data/. */
export function createMetadataStore(env = process.env): MetadataStore {
  const pgConfig = postgresConfigFromEnv(env);
  return pgConfig ? new PostgresMetadataStore(pgConfig) : new FileMetadataStore(FileMetadataStore.defaultPath());
}
