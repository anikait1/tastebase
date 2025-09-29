declare module "bun" {
  interface Env {
    DATABASE_URL: string;
    OPENROUTER_API_KEY: string;
  }
}
