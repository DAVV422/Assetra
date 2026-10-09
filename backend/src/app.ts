import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import type { AssetraClient } from "./sdk/assetra-client.js";

// Prueba de autoría en modo live: hash de la transacción firmada por el usuario
const txHash = z.string().regex(/^[0-9a-fA-F]{64}$/, "txHash debe ser un hash de 64 caracteres hexadecimales").optional();

const createAssetSchema = z.object({
  name: z.string().min(3).max(120), symbol: z.string().min(2).max(12),
  type: z.enum(["invoice", "bond", "real-estate", "commodity", "carbon-credit"]),
  description: z.string().min(10).max(2000), issuer: z.string().min(2).max(120), custodian: z.string().min(2).max(120),
  jurisdiction: z.string().min(2).max(80), totalValue: z.number().positive(), currency: z.string().min(2).max(8),
  supply: z.number().int().positive(), maturityDate: z.string().min(8).max(32),
  creatorWallet: z.string().max(56).optional(),
  onChainId: z.string().regex(/^[A-Z0-9_]{2,12}$/).optional(),
  txHash
});
const lifecycleSchema = z.object({
  action: z.enum(["activate", "mint", "burn", "pause", "unpause", "redeem"]),
  amount: z.number().positive().optional(),
  txHash
});
const participantSchema = z.object({
  name: z.string().min(2).max(120), wallet: z.string().min(8).max(56), jurisdiction: z.string().min(2).max(80),
  status: z.enum(["pending", "authorized", "revoked", "frozen"]), verifiedAt: z.string().optional(), txHash
});
const participantStatusSchema = z.object({ status: z.enum(["pending", "authorized", "revoked", "frozen"]), txHash });
const transferSchema = z.object({ from: z.string().min(2).max(56), to: z.string().min(2).max(56), amount: z.number().positive(), txHash });
const documentSchema = z.object({
  name: z.string().min(2).max(160), kind: z.string().min(2).max(60), hash: z.string().min(8).max(128),
  url: z.string().url().max(500).optional().or(z.literal("")), version: z.number().int().positive().default(1), txHash
});

const complianceErrors = ["ReceiverNotAuthorized", "WalletFrozen", "SenderNotAuthorized"];

export interface AppOptions {
  /** Peticiones por minuto y por IP a la API (lecturas + escrituras). */
  readsPerMinute?: number;
  /** Escrituras (POST/PATCH) por minuto y por IP. */
  writesPerMinute?: number;
  /** Proxies de confianza delante de la API (Koyeb, Nginx…): necesario para identificar la IP real. */
  trustProxy?: number;
}

const envInt = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

function limiter(limit: number, methods?: string[]) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: methods ? (request) => !methods.includes(request.method) : undefined,
    handler: (_request, response) => {
      response.status(429).json({
        error: "RATE_LIMITED",
        message: "Demasiadas peticiones desde esta dirección. Intenta de nuevo en un minuto."
      });
    }
  });
}

export function createApp(client: AssetraClient, options: AppOptions = {}) {
  const readsPerMinute = options.readsPerMinute ?? envInt("RATE_LIMIT_PER_MINUTE", 300);
  const writesPerMinute = options.writesPerMinute ?? envInt("RATE_LIMIT_WRITES_PER_MINUTE", 30);
  const trustProxy = options.trustProxy ?? envInt("TRUST_PROXY", 0);

  const app = express();
  if (trustProxy > 0) app.set("trust proxy", trustProxy);

  // Cabeceras de seguridad HTTP (incluye la eliminación de X-Powered-By)
  app.use(helmet());
  // Sin cookies ni sesiones: no se necesitan credenciales CORS
  app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true }));

  // Límites por IP. /health queda fuera para no interferir con los healthchecks de la plataforma.
  if (readsPerMinute > 0) app.use("/api", limiter(readsPerMinute));
  if (writesPerMinute > 0) app.use("/api", limiter(writesPerMinute, ["POST", "PATCH", "PUT", "DELETE"]));

  app.use(express.json({ limit: "100kb" }));

  app.get("/health", (_request, response) => response.json({ status: "ok", service: "assetra-api", mode: process.env.ASSETRA_MODE ?? "mock" }));
  app.get("/api/config", (_request, response) => {
    const config = client.config?.();
    if (!config) return response.status(404).json({ error: "NOT_AVAILABLE", message: "La configuración on-chain solo existe en modo live" });
    return response.json(config);
  });

  app.get("/api/assets", async (_request, response, next) => { try { response.json(await client.listAssets()); } catch (error) { next(error); } });
  app.get("/api/assets/:assetId", async (request, response, next) => { try { response.json(await client.getAsset(request.params.assetId)); } catch (error) { next(error); } });
  app.post("/api/assets", async (request, response, next) => { try { response.status(201).json(await client.createAsset(createAssetSchema.parse(request.body))); } catch (error) { next(error); } });
  app.post("/api/assets/:assetId/actions", async (request, response, next) => { try { response.json(await client.runLifecycleAction(request.params.assetId, lifecycleSchema.parse(request.body))); } catch (error) { next(error); } });
  app.post("/api/assets/:assetId/transfers", async (request, response, next) => {
    try {
      const input = transferSchema.parse(request.body);
      response.status(200).json(await client.transferTokens(request.params.assetId, input));
    } catch (error) { next(error); }
  });
  app.post("/api/assets/:assetId/participants", async (request, response, next) => {
    try {
      const { txHash: proof, ...participant } = participantSchema.parse(request.body);
      response.status(201).json(await client.addParticipant(request.params.assetId, participant, proof));
    } catch (error) { next(error); }
  });
  app.patch("/api/assets/:assetId/participants/:participantId", async (request, response, next) => {
    try {
      const { status, txHash: proof } = participantStatusSchema.parse(request.body);
      response.json(await client.updateParticipantStatus(request.params.assetId, request.params.participantId, status, proof));
    } catch (error) { next(error); }
  });
  app.post("/api/assets/:assetId/documents", async (request, response, next) => {
    try {
      const { txHash: proof, ...document } = documentSchema.parse(request.body);
      response.status(201).json(await client.addDocument(request.params.assetId, document, proof));
    } catch (error) { next(error); }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "VALIDATION_ERROR", details: error.issues });
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    const code = message.includes(":") ? message.split(":")[0].trim() : message;
    const isNotFound = message.endsWith("NOT_FOUND");
    // Fallos al consultar la red: no se exponen detalles internos al cliente
    if (!/^[A-Za-z_]+$/.test(code)) {
      console.error("Unhandled error:", error);
      return response.status(500).json({ error: "INTERNAL_ERROR", message: "Error interno" });
    }
    return response.status(isNotFound ? 404 : 400).json({
      error: code,
      message,
      isComplianceRejection: complianceErrors.some((name) => message.includes(name))
    });
  });
  return app;
}
