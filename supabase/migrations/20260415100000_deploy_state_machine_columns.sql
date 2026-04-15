alter table public.app_deployments
  add column if not exists deploy_phase text not null default 'IDLE',
  add column if not exists deploy_attempt_count integer not null default 0,
  add column if not exists phase_started_at timestamptz,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists worker_lease_until timestamptz,
  add column if not exists last_transition text,
  add column if not exists last_transition_error text;

create index if not exists app_deployments_status_next_attempt_idx
  on public.app_deployments (status, next_attempt_at);

comment on column public.app_deployments.deploy_phase is
  'Resumable worker phase: IDLE | SOL_GATE | DEPLOY_WORKFLOW | ESCROW_CHECK | RECOVERED';
comment on column public.app_deployments.deploy_attempt_count is
  'Number of deployment workflow attempts started by worker.';
comment on column public.app_deployments.phase_started_at is
  'Timestamp when current deploy_phase began.';
comment on column public.app_deployments.next_attempt_at is
  'Worker should not process this row before this timestamp.';
comment on column public.app_deployments.last_transition is
  'Last state transition marker from worker.';
comment on column public.app_deployments.last_transition_error is
  'Last non-terminal transition error for debugging/retry visibility.';
