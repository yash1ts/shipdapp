-- Optional: enable scheduling + HTTP from Postgres (used by topup-deployment-wallets cron).
-- On hosted Supabase you may still need to enable pg_cron / pg_net in Dashboard → Database → Extensions.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
