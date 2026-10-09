import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MockAssetraClient } from "../src/sdk/mock-assetra-client.js";

const app = createApp(new MockAssetraClient());

describe("Assetra API", () => {
  it("reports its health", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("lists demo assets", async () => {
    const response = await request(app).get("/api/assets");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(3);
  });

  it("creates a draft asset", async () => {
    const response = await request(app).post("/api/assets").send({
      name: "Factura Demo 203", symbol: "INV203", type: "invoice",
      description: "Factura ficticia para una prueba automatizada.", issuer: "Demo SRL", custodian: "Demo Custody",
      jurisdiction: "Bolivia", totalValue: 50000, currency: "USDC", supply: 500, maturityDate: "2027-01-30"
    });
    expect(response.status).toBe(201);
    expect(response.body.status).toBe("draft");
  });

  it("mints tokens within the configured supply", async () => {
    const response = await request(app).post("/api/assets/asset-invoice-091/actions").send({ action: "mint", amount: 100 });
    expect(response.status).toBe(200);
    expect(response.body.mintedSupply).toBe(725);
  });

  it("rejects invalid mint amounts", async () => {
    const response = await request(app).post("/api/assets/asset-invoice-091/actions").send({ action: "mint", amount: 10000 });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("INVALID_MINT_AMOUNT");
  });

  it("executes transfer to an authorized participant", async () => {
    const response = await request(app)
      .post("/api/assets/asset-invoice-091/transfers")
      .send({
        from: "Andina Export SRL",
        to: "GAYP4UFK4UFAGCEX3H53AGXDTQPMTLB5XMKTPWOSVTCJO5XYQZDEGT7F", // Aya Capital (authorized)
        amount: 50
      });
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("success");
    expect(response.body.txHash).toBeDefined();
    expect(response.body.amount).toBe(50);
  });

  it("blocks transfer to an unauthorized participant with ReceiverNotAuthorized", async () => {
    const response = await request(app)
      .post("/api/assets/asset-invoice-091/transfers")
      .send({
        from: "Andina Export SRL",
        to: "GDESCONOCIDA999NOAUTORIZADAXASSETRA",
        amount: 25
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("ReceiverNotAuthorized");
    expect(response.body.isComplianceRejection).toBe(true);
    expect(response.body.message).toContain("no está autorizada por Compliance");
  });

  it("blocks transfer to a frozen participant with ReceiverNotAuthorized", async () => {
    const response = await request(app)
      .post("/api/assets/asset-invoice-091/transfers")
      .send({
        from: "Andina Export SRL",
        to: "GFRZ8899AABBCCDDEEFF00112233445566778899AABBCCDDEE", // Frost Liquidator (frozen)
        amount: 10
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("ReceiverNotAuthorized");
    expect(response.body.isComplianceRejection).toBe(true);
    expect(response.body.message).toContain("FROZEN");
  });

  it("updates participant status across the 4 compliance states", async () => {
    // Freeze participant-aya
    const freezeRes = await request(app)
      .patch("/api/assets/asset-invoice-091/participants/participant-aya")
      .send({ status: "frozen" });
    expect(freezeRes.status).toBe(200);
    expect(freezeRes.body.status).toBe("frozen");

    // Revoke participant-aya
    const revokeRes = await request(app)
      .patch("/api/assets/asset-invoice-091/participants/participant-aya")
      .send({ status: "revoked" });
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.status).toBe("revoked");

    // Re-authorize participant-aya
    const authRes = await request(app)
      .patch("/api/assets/asset-invoice-091/participants/participant-aya")
      .send({ status: "authorized" });
    expect(authRes.status).toBe(200);
    expect(authRes.body.status).toBe("authorized");
  });
});


describe("Seguridad HTTP", () => {
  it("envía cabeceras de seguridad y oculta X-Powered-By", async () => {
    const response = await request(app).get("/health");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["strict-transport-security"]).toContain("max-age=");
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("limita las peticiones por IP con 429 RATE_LIMITED", async () => {
    const limited = createApp(new MockAssetraClient(), { readsPerMinute: 3, writesPerMinute: 0 });
    for (let i = 0; i < 3; i++) expect((await request(limited).get("/api/assets")).status).toBe(200);
    const blocked = await request(limited).get("/api/assets");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("RATE_LIMITED");
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  it("aplica un límite más estricto a las escrituras sin afectar las lecturas", async () => {
    const limited = createApp(new MockAssetraClient(), { readsPerMinute: 100, writesPerMinute: 1 });
    const action = () => request(limited).post("/api/assets/asset-invoice-091/actions").send({ action: "pause" });
    expect((await action()).status).toBe(200);
    expect((await action()).status).toBe(429);
    expect((await request(limited).get("/api/assets")).status).toBe(200);
  });

  it("detrás de un proxy de confianza cuenta el límite por IP real del cliente", async () => {
    const limited = createApp(new MockAssetraClient(), { readsPerMinute: 1, writesPerMinute: 0, trustProxy: 1 });
    const from = (ip: string) => request(limited).get("/api/assets").set("X-Forwarded-For", ip);
    expect((await from("203.0.113.10")).status).toBe(200);
    expect((await from("203.0.113.10")).status).toBe(429);
    expect((await from("198.51.100.20")).status).toBe(200);
  });

  it("no limita el healthcheck", async () => {
    const limited = createApp(new MockAssetraClient(), { readsPerMinute: 1, writesPerMinute: 0 });
    for (let i = 0; i < 3; i++) expect((await request(limited).get("/health")).status).toBe(200);
  });
});
