import { describe, expect, it } from "vitest";
import { MockAssetraClient } from "./mock-client";

describe("MockAssetraClient", () => {
  it("returns isolated fixture data", async () => {
    const client = new MockAssetraClient();
    const first = await client.listAssets();
    first[0].name = "mutated";
    const second = await client.listAssets();
    expect(second[0].name).toBe("Factura Andina 091");
  });

  it("applies lifecycle actions", async () => {
    const client = new MockAssetraClient();
    const paused = await client.runLifecycleAction("asset-invoice-091", { action: "pause" });
    expect(paused.status).toBe("paused");
    const active = await client.runLifecycleAction("asset-invoice-091", { action: "unpause" });
    expect(active.status).toBe("active");
  });

  it("executes transfer to an authorized participant", async () => {
    const client = new MockAssetraClient();
    const result = await client.transferTokens("asset-invoice-091", {
      from: "Andina Export SRL",
      to: "GCRVRGTER4FV3VPIO6C4TIG63OZNXMOCQCZR5LUBFB4OUB53FBOKBGLO", // Aya Capital
      amount: 40
    });
    expect(result.status).toBe("success");
    expect(result.txHash).toBeDefined();
    expect(result.amount).toBe(40);
  });

  it("blocks transfer to an unauthorized destination with ReceiverNotAuthorized", async () => {
    const client = new MockAssetraClient();
    await expect(
      client.transferTokens("asset-invoice-091", {
        from: "Andina Export SRL",
        to: "GDESCONOCIDA999NOAUTORIZADAXASSETRA",
        amount: 25
      })
    ).rejects.toThrow("ReceiverNotAuthorized");
  });

  it("updates participant status across the 4 compliance states", async () => {
    const client = new MockAssetraClient();
    const frozen = await client.updateParticipantStatus("asset-invoice-091", "participant-aya", "frozen");
    expect(frozen.status).toBe("frozen");

    const revoked = await client.updateParticipantStatus("asset-invoice-091", "participant-aya", "revoked");
    expect(revoked.status).toBe("revoked");

    const authorized = await client.updateParticipantStatus("asset-invoice-091", "participant-aya", "authorized");
    expect(authorized.status).toBe("authorized");
  });
});

