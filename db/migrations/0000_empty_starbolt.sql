CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"transcription" text,
	"name" text NOT NULL,
	"instructions" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"ingredients" jsonb,
	"embedding" vector(1536)
);
