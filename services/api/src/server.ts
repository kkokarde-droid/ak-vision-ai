import "dotenv/config";
import { buildApp } from "./app.js";

const app = buildApp();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";

try {
  await app.listen({
    port,
    host,
  });

  console.log(`AK Vision AI API running at http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
