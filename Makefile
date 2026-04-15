# Common Shipd / Akash Sandbox-2 commands (from typical zsh usage).
# Secrets: export AKASH_HOT_MNEMONIC in your shell (never store it in this file).
#
# Examples:
#   make help
#   make env-akash-print          # copy/paste exports for akash CLI
#   make rpc-check
#   make cert-check
#   make deploy-create IMAGE=public.ecr.aws/docker/library/alpine:latest
#   make verify-mtls DSEQ=2939010
#   make gen-mtls AKASH_OWNER=akash1youraddress...
#   make akash-cert-list AKASH_OWNER=akash1...
#   make bme-burn-uact BME_AMOUNT=22000000uact    # uact → uakt
#   make bme-mint-uact BME_AMOUNT=5000000uakt     # uakt → uact (escrow)

SHELL := /bin/bash
.ONESHELL:

ROOT         := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DENO         ?= npx --yes deno@2
DENO_FLAGS   := run -A -c $(ROOT)/scripts/deno.json

# Akash chain (matches supabase/functions/_shared/akashEndpoints.ts defaults)
AKASH_CHAIN_ID       ?= sandbox-2
AKASH_RPC_URL        ?= https://rpc.sandbox-2.aksh.pw:443
AKASH_GRPC_URL       ?= http://grpc.sandbox-2.aksh.pw:9090
AKASH_MANIFEST_NETWORK ?= sandbox

# akash CLI (Cosmos tx/query) — same endpoints as Deno unless you override
AKASH_NODE           ?= $(AKASH_RPC_URL)
AKASH_GAS_PRICES     ?= 0.025uakt
AKASH_GAS_ADJUSTMENT ?= 1.5
AKASH_KEY_NAME       ?= hot-sandbox

# Your hot wallet bech32 (used by gen-mtls, queries, test-akash-mtls.sh)
AKASH_OWNER          ?=

# mTLS bundle path
MTLS_BUNDLE          ?= $(ROOT)/akash-mtls-fresh/mtls-bundle.pem

# Optional: comma-separated providers to skip when leasing (see akashOrchestrator)
AKASH_EXCLUDE_PROVIDERS ?=
# cheapest | random
AKASH_BID_STRATEGY   ?= cheapest

# Docker image for deploy-create
IMAGE                ?= public.ecr.aws/docker/library/alpine:latest
DEPLOY_PORT          ?= 3000

# BME burn-mint: amount including denom, e.g. 22000000uact or 5000000uakt
BME_AMOUNT           ?=

.PHONY: help env-akash-print env-deno-print rpc-check grpc-note cert-check \
	deploy-create verify-mtls gen-mtls write-secrets test-mtls-probe \
	akash-cert-list akash-bids-open providers-list cert-revoke-serial \
	bme-burn-uact bme-mint-uact

help:
	@echo "Shipd / Akash — common targets"
	@echo ""
	@echo "  make env-akash-print     Print exports for akash CLI (RPC, gas, chain-id)"
	@echo "  make env-deno-print      Print exports for Deno scripts (RPC, GRPC, manifest network)"
	@echo "  make rpc-check           curl RPC /status (chain id)"
	@echo "  make grpc-note           Reminder if GRPC is blocked from your network"
	@echo "  make cert-check          check-akash-cert.ts (needs AKASH_HOT_MNEMONIC)"
	@echo "  make deploy-create       create-akash-deployment.ts (needs AKASH_HOT_MNEMONIC)"
	@echo "  make verify-mtls DSEQ=n verify-provider-mtls.ts --sync-url-from-chain"
	@echo "  make gen-mtls AKASH_OWNER=akash1…  ./scripts/gen-akash-mtls-bundle.sh"
	@echo "  make write-secrets       .secrets.mtls.env from MTLS_BUNDLE"
	@echo "  make test-mtls-probe     curl lease/status (needs DSEQ, PROVIDER, AKASH_OWNER)"
	@echo "  make akash-cert-list     akash query cert list --state valid"
	@echo "  make akash-bids-open     akash query market bid list --state open (needs DSEQ, AKASH_OWNER)"
	@echo "  make providers-list      akash query provider list (JSON, first page)"
	@echo "  make bme-burn-uact       akash tx bme burn-mint <uact> uakt (needs BME_AMOUNT=…uact)"
	@echo "  make bme-mint-uact       akash tx bme burn-mint <uakt> uact (needs BME_AMOUNT=…uakt)"
	@echo ""
	@echo "Override URLs: AKASH_RPC_URL=… AKASH_GRPC_URL=… make cert-check"

env-akash-print:
	@echo "# Paste into your shell for \`akash\` / \`provider-services\`"
	@echo "export AKASH_CHAIN_ID=\"$(AKASH_CHAIN_ID)\""
	@echo "export AKASH_NODE=\"$(AKASH_NODE)\""
	@echo "export AKASH_GAS_PRICES=\"$(AKASH_GAS_PRICES)\""
	@echo "export AKASH_GAS_ADJUSTMENT=\"$(AKASH_GAS_ADJUSTMENT)\""
	@echo "export AKASH_KEY_NAME=\"$(AKASH_KEY_NAME)\""

env-deno-print:
	@echo "# Paste into your shell for Deno scripts (check-akash-cert, deploy, verify)"
	@echo "export AKASH_MANIFEST_NETWORK=\"$(AKASH_MANIFEST_NETWORK)\""
	@echo "export AKASH_RPC_URL=\"$(AKASH_RPC_URL)\""
	@echo "export AKASH_GRPC_URL=\"$(AKASH_GRPC_URL)\""

rpc-check:
	@curl -sS "$(AKASH_RPC_URL)/status" | jq -r '.result.node_info.network // .jsonrpc // .'

grpc-note:
	@echo "If Deno fails with ECONNREFUSED on port 9090, set a reachable gRPC mirror, e.g.:"
	@echo "  export AKASH_GRPC_URL=\"http://HOST:9090\""
	@echo "Then: make env-deno-print && make cert-check"

cert-check:
	@test -n "$$AKASH_HOT_MNEMONIC" || { echo "ERROR: export AKASH_HOT_MNEMONIC (same hot wallet as Edge)"; exit 1; }
	cd "$(ROOT)" && \
	AKASH_MANIFEST_NETWORK="$(AKASH_MANIFEST_NETWORK)" \
	AKASH_RPC_URL="$(AKASH_RPC_URL)" \
	AKASH_GRPC_URL="$(AKASH_GRPC_URL)" \
	$(DENO) $(DENO_FLAGS) "$(ROOT)/scripts/check-akash-cert.ts" --bundle "$(MTLS_BUNDLE)"

deploy-create:
	@test -n "$$AKASH_HOT_MNEMONIC" || { echo "ERROR: export AKASH_HOT_MNEMONIC"; exit 1; }
	cd "$(ROOT)" && \
	export AKASH_MANIFEST_NETWORK="$(AKASH_MANIFEST_NETWORK)"; \
	export AKASH_RPC_URL="$(AKASH_RPC_URL)"; \
	export AKASH_GRPC_URL="$(AKASH_GRPC_URL)"; \
	export AKASH_EXCLUDE_PROVIDERS="$(AKASH_EXCLUDE_PROVIDERS)"; \
	export AKASH_BID_STRATEGY="$(AKASH_BID_STRATEGY)"; \
	$(DENO) $(DENO_FLAGS) "$(ROOT)/scripts/create-akash-deployment.ts" \
		--image "$(IMAGE)" --port "$(DEPLOY_PORT)"

verify-mtls:
	@test -n "$$AKASH_HOT_MNEMONIC" || { echo "ERROR: export AKASH_HOT_MNEMONIC"; exit 1; }
	@test -n "$(DSEQ)" || { echo "ERROR: pass DSEQ=… (deployment sequence)"; exit 1; }
	cd "$(ROOT)" && \
	AKASH_MANIFEST_NETWORK="$(AKASH_MANIFEST_NETWORK)" \
	AKASH_RPC_URL="$(AKASH_RPC_URL)" \
	AKASH_GRPC_URL="$(AKASH_GRPC_URL)" \
	$(DENO) $(DENO_FLAGS) "$(ROOT)/scripts/verify-provider-mtls.ts" \
		--bundle "$(MTLS_BUNDLE)" \
		--dseq "$(DSEQ)" \
		--sync-url-from-chain

gen-mtls:
	@test -n "$(AKASH_OWNER)" || { echo "ERROR: pass AKASH_OWNER=akash1… (CN for cert; usually hot wallet)"; exit 1; }
	"$(ROOT)/scripts/gen-akash-mtls-bundle.sh" "$(AKASH_OWNER)"

write-secrets:
	"$(ROOT)/scripts/write-mtls-supabase-env.sh" "$(MTLS_BUNDLE)"

# Requires: DSEQ, PROVIDER (akash1…), AKASH_OWNER; uses cert/key next to bundle dir
test-mtls-probe:
	@test -n "$(DSEQ)" || { echo "ERROR: DSEQ=…"; exit 1; }
	@test -n "$(PROVIDER)" || { echo "ERROR: PROVIDER=akash1… (from deploy output)"; exit 1; }
	@test -n "$(AKASH_OWNER)" || { echo "ERROR: AKASH_OWNER=akash1…"; exit 1; }
	@CERT="$(dir $(MTLS_BUNDLE))cert.pem"; KEY="$(dir $(MTLS_BUNDLE))key.pem"; \
	test -f "$$CERT" && test -f "$$KEY" || { echo "ERROR: missing $$CERT / $$KEY (set MTLS_BUNDLE=.../mtls-bundle.pem)"; exit 1; }; \
	"$(ROOT)/scripts/test-akash-mtls.sh" \
		--owner "$(AKASH_OWNER)" \
		--dseq "$(DSEQ)" \
		--provider "$(PROVIDER)" \
		--cert "$$CERT" \
		--key "$$KEY"

akash-cert-list:
	@test -n "$(AKASH_OWNER)" || { echo "ERROR: AKASH_OWNER=akash1…"; exit 1; }
	akash query cert list \
		--owner "$(AKASH_OWNER)" \
		--state valid \
		--node "$(AKASH_NODE)" \
		--chain-id "$(AKASH_CHAIN_ID)" \
		-o json | jq .

akash-bids-open:
	@test -n "$(AKASH_OWNER)" || { echo "ERROR: AKASH_OWNER=akash1…"; exit 1; }
	@test -n "$(DSEQ)" || { echo "ERROR: DSEQ=…"; exit 1; }
	akash query market bid list \
		--owner "$(AKASH_OWNER)" \
		--dseq "$(DSEQ)" \
		--state open \
		--node "$(AKASH_NODE)" \
		--chain-id "$(AKASH_CHAIN_ID)" \
		-o json | jq .

providers-list:
	akash query provider list \
		--node "$(AKASH_NODE)" \
		--chain-id "$(AKASH_CHAIN_ID)" \
		--limit 200 \
		-o json | jq '.providers | length'

# Burn sandbox uact (compute balance) back to uakt. Requires `akash` + funded key for fees.
#   make bme-burn-uact BME_AMOUNT=22000000uact
bme-burn-uact:
	@test -n "$(BME_AMOUNT)" || { echo "ERROR: BME_AMOUNT=22000000uact (coins to burn, must end in uact)"; exit 1; }
	akash tx bme burn-mint "$(BME_AMOUNT)" uakt \
		--from "$(AKASH_KEY_NAME)" \
		--node "$(AKASH_NODE)" \
		--chain-id "$(AKASH_CHAIN_ID)" \
		--gas auto \
		--gas-prices "$(AKASH_GAS_PRICES)" \
		--gas-adjustment "$(AKASH_GAS_ADJUSTMENT)" \
		-y

# Burn uakt to mint uact (top up deployment escrow on sandbox).
#   make bme-mint-uact BME_AMOUNT=5000000uakt
bme-mint-uact:
	@test -n "$(BME_AMOUNT)" || { echo "ERROR: BME_AMOUNT=5000000uakt (coins to burn, must end in uakt)"; exit 1; }
	akash tx bme burn-mint "$(BME_AMOUNT)" uact \
		--from "$(AKASH_KEY_NAME)" \
		--node "$(AKASH_NODE)" \
		--chain-id "$(AKASH_CHAIN_ID)" \
		--gas auto \
		--gas-prices "$(AKASH_GAS_PRICES)" \
		--gas-adjustment "$(AKASH_GAS_ADJUSTMENT)" \
		-y

# Revoke one client cert by serial (from cert list). Uses AKASH_KEY_NAME for --from
cert-revoke-serial:
	@test -n "$(SERIAL)" || { echo "ERROR: SERIAL=decimal_serial_from_cert_list"; exit 1; }
	akash tx cert revoke client \
		--serial "$(SERIAL)" \
		--from "$(AKASH_KEY_NAME)" \
		--node "$(AKASH_NODE)" \
		--chain-id "$(AKASH_CHAIN_ID)" \
		--gas auto \
		--gas-adjustment "$(AKASH_GAS_ADJUSTMENT)" \
		--fees 30000uakt \
		-y
