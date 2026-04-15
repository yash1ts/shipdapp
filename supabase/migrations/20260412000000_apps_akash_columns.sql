-- Columns used by Edge Function `deploy-akt` when `public.apps` exists (skip on fresh projects).

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'apps'
  ) then
    alter table public.apps
      add column if not exists treasury_sol_address text,
      add column if not exists akash_dseq text,
      add column if not exists akash_provider text,
      add column if not exists akash_mnemonic_cipher_b64 text,
      add column if not exists akash_mnemonic_iv_b64 text,
      add column if not exists akash_tls_bundle_cipher_b64 text,
      add column if not exists akash_tls_bundle_iv_b64 text;

    comment on column public.apps.treasury_sol_address is 'Per-app Solana treasury (base58) checked for MIN_LAUNCH_DEPOSIT_LAMPORTS';
    comment on column public.apps.akash_mnemonic_cipher_b64 is 'AES-GCM ciphertext (includes auth tag), base64';
    comment on column public.apps.akash_mnemonic_iv_b64 is 'AES-GCM IV, base64';
    comment on column public.apps.akash_tls_bundle_cipher_b64 is 'Encrypted JSON { cert, key } PEM strings for mTLS';
    comment on column public.apps.akash_tls_bundle_iv_b64 is 'AES-GCM IV for TLS bundle';
  end if;
end $$;
