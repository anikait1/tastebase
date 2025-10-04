import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  jsonb,
  vector,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import type { Ingredient } from "../recipe/type";

export const recipe_source_schema = pgTable(
  "recipe_sources",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    external_id: text("external_id").notNull(),
    created_at: timestamp("created_at")
      .notNull()
      .default(sql`now()`),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    uniqueExternalIdType: unique().on(table.external_id, table.type),
  }),
);

export const recipe_schema = pgTable("recipes", {
  id: serial("id").primaryKey(),
  recipe_source_id: integer("recipe_source_id")
    .references(() => recipe_source_schema.id)
    .notNull(),
  name: text("name").notNull(),
  instructions: text("instructions").notNull(),
  ingredients: jsonb("ingredients").$type<Ingredient[]>().notNull(),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  created_at: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});

export const embedding_schema = pgTable("embeddings", {
  id: serial("id").primaryKey(),
  recipe_id: integer("recipe_id")
    .references(() => recipe_schema.id)
    .notNull(),
  type: text("type").notNull(),
  /** OpenAI text-embedding-3-small produces 1536-d vectors */
  data: vector({ dimensions: 1536 }),
});

export const content_item_schema = pgTable("content_items", {
  id: serial("id").primaryKey(),
  recipe_source_id: integer("recipe_source_id")
    .references(() => recipe_source_schema.id)
    .notNull(),
  pipeline_step: text("step").notNull(),
  data: jsonb("data").notNull(),
  created_at: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
});
