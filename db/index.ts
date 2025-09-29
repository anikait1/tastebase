import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import type { Pool } from "pg";

export type DbTransaction = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
export type Database = ReturnType<typeof drizzle<{ schema: typeof schema }>>;
