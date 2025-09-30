import { drizzle } from "drizzle-orm/node-postgres";

export const dbClient = drizzle(Bun.env.DATABASE_URL);

export type Database = typeof dbClient;
export type DbTransaction = Parameters<
  Parameters<(typeof dbClient)["transaction"]>[0]
>[0];
