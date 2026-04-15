-- Hot-wallet simplification: per-app Akash wallets and encrypted treasury
-- keys are no longer generated. Make those columns nullable so init can
-- create rows with just the user's Solana wallet address.

alter table public.app_deployments
  alter column solana_treasury_secret_cipher drop not null,
  alter column solana_treasury_secret_iv     drop not null,
  alter column akash_address                 drop not null,
  alter column akash_mnemonic_cipher         drop not null,
  alter column akash_mnemonic_iv             drop not null;

comment on table public.app_deployments is
  'PENDING_FUNDS → DEPLOYING → ACTIVE. Hot wallet signs all Akash deployments; '
  'solana_treasury_public_key stores the user wallet used for the 0.1 SOL gate.';
comment on column public.app_deployments.solana_treasury_public_key is
  'User Solana wallet address — checked for >= 0.1 SOL by the cron.';
