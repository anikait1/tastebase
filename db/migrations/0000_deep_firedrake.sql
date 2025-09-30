CREATE TABLE "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"type" text NOT NULL,
	"data" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "recipe_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_source_id" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step_index" integer,
	"started_at" timestamp,
	"updated_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	CONSTRAINT "recipe_jobs_recipe_source_id_unique" UNIQUE("recipe_source_id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_source_id" integer NOT NULL,
	"name" text NOT NULL,
	"instructions" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"ingredients" jsonb
);
--> statement-breakpoint
CREATE TABLE "recipe_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"type" text NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "recipe_sources_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_jobs" ADD CONSTRAINT "recipe_jobs_recipe_source_id_recipe_sources_id_fk" FOREIGN KEY ("recipe_source_id") REFERENCES "public"."recipe_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_recipe_source_id_recipe_sources_id_fk" FOREIGN KEY ("recipe_source_id") REFERENCES "public"."recipe_sources"("id") ON DELETE no action ON UPDATE no action;