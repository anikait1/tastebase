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
import type { Ingredient } from "../recipe/type";

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
  instructions: text("instructions").notNull(),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  ingredients: jsonb("ingredients").$type<Ingredient[]>().notNull(),
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
  status: text("status").notNull().default("created"),
  created_at: timestamp("created_at")
    .notNull()
    .default(sql`now()`),
  started_at: timestamp("started_at"),
  updated_at: timestamp("updated_at"),
  completed_at: timestamp("completed_at"),
  error_message: text("error_message"),
});

export const job_step_schema = pgTable("job_steps", {
  id: serial("id").primaryKey(),
  job_id: integer("job_id")
    .references(() => recipe_job_schema.id)
    .notNull(),
  type: text("type").notNull(),
  order: integer("order").notNull(),
  status: text("status").notNull().default("created"),
  error_message: text("error_message"),
  started_at: timestamp("started_at"),
  completed_at: timestamp("completed_at"),
  metadata: jsonb("metadata"),
});

export const content_item_schema = pgTable("content_items", {
  id: serial("id").primaryKey(),
  job_step_id: integer("job_step_id")
    .references(() => job_step_schema.id)
    .notNull(),
  content: jsonb("content").notNull(),
  metadata: jsonb("metadata"),
});
