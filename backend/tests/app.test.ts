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
});
