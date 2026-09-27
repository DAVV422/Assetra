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
});
