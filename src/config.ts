import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env
dotenv.config();

const configSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .default("postgresql://anvil_user:anvil_password@localhost:5432/anvil_db"),
  LLM_MODE: z.enum(["mock", "gemini"]).default("mock"),
  GEMINI_API_KEY: z.string().optional(),
  REPO_PATH: z.string().default(process.cwd()),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),
  AUTH_PASSCODE: z.string().optional(),
  DAILY_TASK_CAP: z.coerce.number().default(50),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().default(60),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((val) => val === "true" || val === "1")
    .default("false"),
});

export const config = configSchema.parse(process.env);
