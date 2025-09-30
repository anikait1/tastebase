import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import type { Pool } from "pg";

// export type DbTransaction = PgTransaction<
//   NodePgQueryResultHKT,
//   typeof schema,
//   ExtractTablesWithRelations<typeof schema>
// >;

export const dbClient = drizzle(Bun.env.DATABASE_URL);

export type Database = typeof dbClient;
export type DbTransaction = Parameters<Parameters<typeof dbClient["transaction"]>[0]>[0];
