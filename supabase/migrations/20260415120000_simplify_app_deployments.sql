-- Drop state-machine columns from app_deployments now that
-- deploy_workflow_runs tracks all granular workflow progress.
-- Keep only deploy_attempt_count (used by topup for max-retry logic).

drop index if exists app_deployments_status_next_attempt_idx;

alter table public.app_deployments
  drop column if exists deploy_phase,
  drop column if exists phase_started_at,
  drop column if exists next_attempt_at,
  drop column if exists worker_lease_until,
  drop column if exists last_transition,
  drop column if exists last_transition_error;

comment on column public.app_deployments.deploy_attempt_count is
  'Number of deploy chain attempts. Topup stops retrying after MAX_DEPLOY_ATTEMPTS.';
