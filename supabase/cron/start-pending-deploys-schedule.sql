-- pg_cron + pg_net: call `topup-deployment-wallets` every minute.
-- Run in the Supabase SQL Editor AFTER deploying that Edge function.
-- Replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY.
--
-- To remove old jobs:
-- SELECT cron.unschedule('start-pending-deploys-every-minute');
-- SELECT cron.unschedule('deployment-harvester-every-minute');

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'topup-deployment-wallets-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/topup-deployment-wallets',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY',
      'apikey', 'YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- topup-deployment-wallets inserts a deploy_workflow_runs row and calls
-- deploy-step-cert, which chains to deploy-step-create, then deploy-step-manifest.
