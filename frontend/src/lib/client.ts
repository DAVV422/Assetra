import { HttpAssetraClient } from "./http-client";
import { MockAssetraClient } from "./mock-client";

export const assetraClient = import.meta.env.VITE_ASSETRA_CLIENT === "http"
  ? new HttpAssetraClient(import.meta.env.VITE_API_URL ?? "http://localhost:4000")
  : new MockAssetraClient();
