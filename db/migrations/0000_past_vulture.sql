CREATE TABLE "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_source_id" integer NOT NULL,
	"step" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"type" text NOT NULL,
	"data" vector(1536)
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_source_id" integer NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"ingredients" jsonb NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb,
	CONSTRAINT "recipe_sources_external_id_type_unique" UNIQUE("external_id","type")
);
--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_recipe_source_id_recipe_sources_id_fk" FOREIGN KEY ("recipe_source_id") REFERENCES "public"."recipe_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_recipe_source_id_recipe_sources_id_fk" FOREIGN KEY ("recipe_source_id") REFERENCES "public"."recipe_sources"("id") ON DELETE no action ON UPDATE no action;