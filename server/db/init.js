import "dotenv/config";
import { getDbPath, initDb } from "./schema.js";

initDb();
console.log(`[DB] Initialized at ${getDbPath()}`);

