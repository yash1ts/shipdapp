-- Per-app Solana treasury + encrypted Akash identity (fund-then-deploy).

create table if not exists public.app_deployments (
  id uuid primary key default gen_random_uuid(),
  app_name text not null,
  description text,
  docker_image text not null,
  port int not null default 3000,
  solana_treasury_public_key text not null,
  solana_treasury_secret_cipher text not null,
  solana_treasury_secret_iv text not null,
  akash_address text not null,
  akash_mnemonic_cipher text not null,
  akash_mnemonic_iv text not null,
  status text not null default 'PENDING_FUNDS',
  akash_dseq text,
  akash_provider text,
  akash_chain_result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_deployments_status_idx
  on public.app_deployments (status);

create index if not exists app_deployments_sol_treasury_idx
  on public.app_deployments (solana_treasury_public_key);

comment on table public.app_deployments is 'Phase 1: PENDING_FUNDS; Phase 2: DEPLOYING → ACTIVE after Akash chain-sdk deploy';
comment on column public.app_deployments.status is 'PENDING_FUNDS | FUNDED | DEPLOYING | ACTIVE | FAILED';
