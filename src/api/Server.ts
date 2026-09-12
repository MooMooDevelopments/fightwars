/**
 * FightWars API entry point.
 *
 *   npm run start:api-dev   → http://localhost:8787 (the issuer the game
 *                             server and client already use when DOMAIN=localhost)
 *
 * Env: API_PORT (8787), DOMAIN (audience; "localhost" in dev), API_KEY (the
 * shared secret game servers send as x-api-key), API_JWT_PRIVATE_KEY (PKCS#8
 * PEM; generated per start when unset), DATABASE_URL or PGLITE_DIR (see Db.ts),
 * REPLAY_DIR (records pushed here are also kept as replays).
 */
import { createApiApp } from "./App";

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.API_PORT ?? "8787", 10);
  const { app, db, issuer } = await createApiApp(process.env);
  const server = app.listen(port, () => {
    console.log(
      `FightWars API listening on http://localhost:${port} (issuer ${issuer}, db ${db.kind})`,
    );
  });
  const shutdown = () => {
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
