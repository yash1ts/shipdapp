-- Claim manifest work without changing `phase` away from LEASE_DONE (avoids UI flicker).
-- Only one invocation wins: sets manifest_claimed_at where it was null.

alter table public.deploy_workflow_runs
  add column if not exists manifest_claimed_at timestamptz;

comment on column public.deploy_workflow_runs.manifest_claimed_at is
  'First manifest step invocation sets this; phase stays LEASE_DONE until COMPLETED or FAILED.';
