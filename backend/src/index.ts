import { createApp } from "./app.js";
import { MockAssetraClient } from "./sdk/mock-assetra-client.js";

const port = Number(process.env.PORT ?? 4000);
createApp(new MockAssetraClient()).listen(port, () => console.log(`Assetra API listening on http://localhost:${port}`));
