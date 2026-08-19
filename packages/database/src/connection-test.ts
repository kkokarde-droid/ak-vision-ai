import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "./client/index.js";

try {
  const result = await db.execute(sql`
    SELECT
      current_database() AS database,
      current_user AS user_name,
      version() AS version
  `);

  console.log("Database connection successful.");
  console.log(result.rows[0]);
} catch (error) {
  console.error("Database connection failed.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
