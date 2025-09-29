import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  jsonb,
  vector,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const recipe_source_schema = pgTable("recipe_sources", {
  id: serial("id").primaryKey(),
  external_id: text("source_id").notNull().unique(),
  type: text("type").notNull(),
  metadata: jsonb("metadata"),
});

export const recipe_schema = pgTable("recipes", {
  id: serial("id").primaryKey(),
  recipe_source_id: integer("recipe_source_id")
    .references(() => recipe_source_schema.id)
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  ingredients: jsonb("ingredients"),
});

export const embedding_schema = pgTable("embeddings", {
  id: serial("id").primaryKey(),
  recipe_id: integer("recipe_id")
    .references(() => recipe_schema.id)
    .notNull(),
  type: text("type").notNull(),
  data: vector({ dimensions: 1536 }),
});

export const recipe_job_schema = pgTable("recipe_jobs", {
  id: serial("id").primaryKey(),
  recipe_source_id: integer("recipe_source_id")
    .references(() => recipe_source_schema.id)
    .notNull()
    .unique(),
  // created, processing, failed, success
  status: text("status").notNull().default("created"),
  steps: jsonb("steps").notNull().default([]),
  current_step_index: integer("current_step_index"),
  started_at: timestamp("started_at"),
  updated_at: timestamp("updated_at"),
  completed_at: timestamp("completed_at"),
  error_message: text("error_message"),
});
