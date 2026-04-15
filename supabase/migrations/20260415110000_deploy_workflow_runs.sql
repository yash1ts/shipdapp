-- Separate table for tracking granular deploy workflow progress.
-- One row per deployment attempt. Step functions update this row as they progress.

create table if not exists public.deploy_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.app_deployments(id) on delete cascade,
  attempt integer not null default 1,
  phase text not null default 'CERT',
  phase_started_at timestamptz not null default now(),

  -- Persisted after cert step
  akash_owner text,
  tls_cert_pem text,
  tls_key_pem text,

  -- Persisted after create-deployment step
  dseq text,
  provider text,
  gseq integer,
  oseq integer,
  provider_host_uri text,

  -- Persisted after manifest step
  lease_status jsonb,
  forwarded_ports jsonb,

  warnings jsonb not null default '[]'::jsonb,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deploy_workflow_runs_deployment_idx
  on public.deploy_workflow_runs (deployment_id, created_at desc);

create index if not exists deploy_workflow_runs_phase_idx
  on public.deploy_workflow_runs (phase);

comment on table public.deploy_workflow_runs is
  'Granular progress for each deploy attempt. One row per attempt, updated by chained step functions.';
comment on column public.deploy_workflow_runs.phase is
  'CERT | CERT_DONE | CREATE_DEPLOY | LEASE_DONE | COMPLETED | FAILED';
comment on column public.deploy_workflow_runs.attempt is
  'Attempt number for this deployment (1-based).';
