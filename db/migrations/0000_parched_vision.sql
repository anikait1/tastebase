CREATE TABLE "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_step_id" integer NOT NULL,
	"content" jsonb NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"type" text NOT NULL,
	"data" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "job_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"type" text NOT NULL,
	"order" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"updated_at" timestamp,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "recipe_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_source_id" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
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
	"instructions" text NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"ingredients" jsonb NOT NULL
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
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_job_step_id_job_steps_id_fk" FOREIGN KEY ("job_step_id") REFERENCES "public"."job_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_steps" ADD CONSTRAINT "job_steps_job_id_recipe_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."recipe_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_jobs" ADD CONSTRAINT "recipe_jobs_recipe_source_id_recipe_sources_id_fk" FOREIGN KEY ("recipe_source_id") REFERENCES "public"."recipe_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_recipe_source_id_recipe_sources_id_fk" FOREIGN KEY ("recipe_source_id") REFERENCES "public"."recipe_sources"("id") ON DELETE no action ON UPDATE no action;