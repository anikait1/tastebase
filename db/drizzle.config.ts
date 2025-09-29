import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "/home/anikait/Development/recipe-gpt/db/schema.ts",
  out: "/home/anikait/Development/recipe-gpt/db/migrations/",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
