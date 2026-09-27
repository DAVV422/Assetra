import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AssetraClient } from "./sdk/assetra-client.js";

const createAssetSchema = z.object({
  name: z.string().min(3), symbol: z.string().min(2).max(12),
  type: z.enum(["invoice", "bond", "real-estate", "commodity", "carbon-credit"]),
  description: z.string().min(10), issuer: z.string().min(2), custodian: z.string().min(2),
  jurisdiction: z.string().min(2), totalValue: z.number().positive(), currency: z.string().min(2).max(8),
  supply: z.number().int().positive(), maturityDate: z.string().min(8)
});
const lifecycleSchema = z.object({ action: z.enum(["mint", "burn", "pause", "unpause", "redeem"]), amount: z.number().positive().optional() });
const participantSchema = z.object({ name: z.string().min(2), wallet: z.string().min(8), jurisdiction: z.string().min(2), status: z.enum(["pending", "authorized", "suspended"]), verifiedAt: z.string().optional() });
const participantStatusSchema = z.object({ status: z.enum(["pending", "authorized", "suspended"]) });
const documentSchema = z.object({ name: z.string().min(2), kind: z.string().min(2), hash: z.string().min(8), url: z.string().url().optional().or(z.literal("")), version: z.number().int().positive().default(1) });

export function createApp(client: AssetraClient) {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json());

  app.get("/health", (_request, response) => response.json({ status: "ok", service: "assetra-api", mode: process.env.ASSETRA_MODE ?? "mock" }));
  app.get("/api/assets", async (_request, response, next) => { try { response.json(await client.listAssets()); } catch (error) { next(error); } });
  app.get("/api/assets/:assetId", async (request, response, next) => { try { response.json(await client.getAsset(request.params.assetId)); } catch (error) { next(error); } });
  app.post("/api/assets", async (request, response, next) => { try { response.status(201).json(await client.createAsset(createAssetSchema.parse(request.body))); } catch (error) { next(error); } });
  app.post("/api/assets/:assetId/actions", async (request, response, next) => { try { response.json(await client.runLifecycleAction(request.params.assetId, lifecycleSchema.parse(request.body))); } catch (error) { next(error); } });
  app.post("/api/assets/:assetId/participants", async (request, response, next) => { try { response.status(201).json(await client.addParticipant(request.params.assetId, participantSchema.parse(request.body))); } catch (error) { next(error); } });
  app.patch("/api/assets/:assetId/participants/:participantId", async (request, response, next) => {
    try { const { status } = participantStatusSchema.parse(request.body); response.json(await client.updateParticipantStatus(request.params.assetId, request.params.participantId, status)); } catch (error) { next(error); }
  });
  app.post("/api/assets/:assetId/documents", async (request, response, next) => { try { response.status(201).json(await client.addDocument(request.params.assetId, documentSchema.parse(request.body))); } catch (error) { next(error); } });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "VALIDATION_ERROR", details: error.issues });
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    return response.status(message.endsWith("NOT_FOUND") ? 404 : 400).json({ error: message });
  });
  return app;
}
