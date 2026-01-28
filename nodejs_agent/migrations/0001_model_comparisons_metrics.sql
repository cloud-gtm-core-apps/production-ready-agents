CREATE TABLE IF NOT EXISTS "model_comparisons" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "conversation_hash" varchar(64) NOT NULL,
  "customer_name" text,
  "menu_items_provided" jsonb,
  "input_message_count" integer NOT NULL,
  "openai_metrics" jsonb,
  "trucube_metrics" jsonb,
  "evaluation" jsonb
);

CREATE INDEX IF NOT EXISTS "model_comparisons_conversation_hash_idx"
  ON "model_comparisons" ("conversation_hash");

