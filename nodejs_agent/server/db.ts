import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Use standard postgres driver for local databases
// For Neon serverless, you would use: import { neon } from "@neondatabase/serverless" and drizzle-orm/neon-http
const client = postgres(process.env.DATABASE_URL);
export const db = drizzle(client, { schema });
