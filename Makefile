# Sigil — Build & Development Makefile
# Prevents the manual copy mistakes that caused the redc_param debug loop.

SHELL := /bin/bash
.PHONY: help circuits ios android contracts test test-all typecheck clean clean-ios clean-circuits clean-contracts deps build-all install-dev

# ─── Paths ─────────────────────────────────────────────────────────────
CIRCUITS_SRC      := packages/circuits
CIRCUITS_TARGET   := $(CIRCUITS_SRC)/target
MOPRO_SRC         := packages/mopro-circuits/MoproReactNativeBindings
MOPRO_XCFRAMEWORK := $(MOPRO_SRC)/MoproFfiFramework.xcframework
APP_MODULES       := apps/mobile/modules/mopro
APP_ASSETS        := apps/mobile/assets/circuits
CONTRACTS         := packages/contracts

# ─── Default ───────────────────────────────────────────────────────────
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Dependencies ──────────────────────────────────────────────────────
deps: ## Install all monorepo dependencies
	pnpm install

# ─── Noir Circuits ────────────────────────────────────────────────────
circuits: ## Compile Noir circuits and copy to app assets
	@echo "━━━ Compiling Noir circuits (workspace) ━━━"
	cd $(CIRCUITS_SRC) && nargo compile --workspace
	@echo "━━━ Copying circuit JSON to app assets ━━━"
	mkdir -p $(APP_ASSETS)
	cp -f $(CIRCUITS_TARGET)/passport_base.json $(APP_ASSETS)/
	cp -f $(CIRCUITS_TARGET)/passport_primary.json $(APP_ASSETS)/
	cp -f certs/tree-data.json $(APP_ASSETS)/
	@echo "✅ Circuits built and copied to $(APP_ASSETS)/"

# ─── Mopro iOS Framework ──────────────────────────────────────────────
ios: ## Build Mopro Rust FFI for iOS and copy to app modules
	@echo "━━━ Building Mopro iOS xcframework ━━━"
	cd $(MOPRO_SRC) && uniffi-bindgen-react-native build ios --config ubrn.config.yaml --release --and-generate
	@echo "━━━ Copying xcframework to app modules ━━━"
	rm -rf $(APP_MODULES)/MoproFfiFramework.xcframework
	cp -R $(MOPRO_XCFRAMEWORK) $(APP_MODULES)/
	@echo "━━━ Copying generated TS + C++ bindings to app modules ━━━"
	cp -R $(MOPRO_SRC)/src/generated/* $(APP_MODULES)/src/generated/
	cp -R $(MOPRO_SRC)/cpp/generated/* $(APP_MODULES)/cpp/generated/
	@echo "✅ iOS framework + bindings copied to $(APP_MODULES)/"

# ─── Mopro Android (stub — adjust if you have Android set up) ─────────
android: ## Build Mopro Rust FFI for Android
	@echo "━━━ Building Mopro Android ━━━"
	cd $(MOPRO_SRC) && uniffi-bindgen-react-native build android --config ubrn.config.yaml --release
	@echo "✅ Android library built"

# ─── Barretenberg (bb) Commands ───────────────────────────────────────
# bb CLI must match the C++ barretenberg version that `barretenberg-rs` (the Rust crate
# Mopro statically links) is built against. Mopro's noir-rs pins barretenberg-rs = "=4.2.0-aztecnr-rc.2",
# so bb CLI must also be 4.2.0-aztecnr-rc.2. Mismatch => proof/verifier disagree on
# PAIRING_POINTS_SIZE / PROOF_SIZE => ProofLengthWrong revert.
#
# `bbup` is NOT correct here: it pairs bb to nargo, not to barretenberg-rs.
# Run `make install-bb` to install the matching bb to ~/.bb-4.2/. Override via BB=...
BB ?= $(HOME)/.bb-4.2/bb

# `-t evm` = "Ethereum/Solidity verification (keccak transcript, ZK)". Replaces the legacy
# `-s ultra_honk --oracle_hash keccak` flag combination.
BB_TARGET = -t evm

install-bb: ## Install bb 4.2.0-aztecnr-rc.2 (matches barretenberg-rs used by Mopro) to ~/.bb-4.2/
	@echo "━━━ Installing bb 4.2.0-aztecnr-rc.2 to ~/.bb-4.2/ ━━━"
	@mkdir -p $(HOME)/.bb-4.2
	@curl -sL -o /tmp/bb-4.2.tar.gz https://github.com/AztecProtocol/aztec-packages/releases/download/v4.2.0-aztecnr-rc.2/barretenberg-arm64-darwin.tar.gz
	@tar -xzf /tmp/bb-4.2.tar.gz -C $(HOME)/.bb-4.2
	@chmod +x $(HOME)/.bb-4.2/bb
	@rm /tmp/bb-4.2.tar.gz
	@echo "✅ Installed: $$($(HOME)/.bb-4.2/bb --version)"

bb-vk: circuits ## Generate verification keys from compiled circuits
	@echo "━━━ Writing base VK ━━━"
	$(BB) write_vk $(BB_TARGET) -b $(CIRCUITS_TARGET)/passport_base.json -o $(CIRCUITS_TARGET)/vk_base
	@echo "━━━ Writing primary VK ━━━"
	$(BB) write_vk $(BB_TARGET) -b $(CIRCUITS_TARGET)/passport_primary.json -o $(CIRCUITS_TARGET)/vk_primary
	@echo "✅ VKs written to $(CIRCUITS_TARGET)/vk_base and vk_primary"

bb-verifier: bb-vk ## Generate self-contained Solidity verifier contracts from VKs (one per circuit)
	@echo "━━━ Generating base Solidity verifier ━━━"
	rm -rf /tmp/bb-out-base && mkdir -p /tmp/bb-out-base
	$(BB) write_solidity_verifier $(BB_TARGET) -k $(CIRCUITS_TARGET)/vk_base/vk -o /tmp/bb-out-base/Verifier.sol
	sed 's/contract HonkVerifier /contract BaseUltraHonkVerifier /' /tmp/bb-out-base/Verifier.sol > $(CONTRACTS)/src/verifiers/BaseUltraHonkVerifier.sol
	@echo "━━━ Generating primary Solidity verifier ━━━"
	rm -rf /tmp/bb-out-primary && mkdir -p /tmp/bb-out-primary
	$(BB) write_solidity_verifier $(BB_TARGET) -k $(CIRCUITS_TARGET)/vk_primary/vk -o /tmp/bb-out-primary/Verifier.sol
	sed 's/contract HonkVerifier /contract PrimaryUltraHonkVerifier /' /tmp/bb-out-primary/Verifier.sol > $(CONTRACTS)/src/verifiers/PrimaryUltraHonkVerifier.sol
	@echo "✅ Verifiers regenerated in $(CONTRACTS)/src/verifiers/"

bb-prove-base: circuits ## Generate a base proof locally (requires witness file)
	@echo "━━━ Generating base proof with bb ━━━"
	$(BB) prove $(BB_TARGET) \
		-b $(CIRCUITS_TARGET)/passport_base.json \
		-w $(CIRCUITS_TARGET)/passport_base.gz \
		-o $(CIRCUITS_TARGET)/proof_base
	@echo "✅ Base proof written to $(CIRCUITS_TARGET)/proof_base"

bb-prove-primary: circuits ## Generate a primary proof locally (requires witness file)
	@echo "━━━ Generating primary proof with bb ━━━"
	$(BB) prove $(BB_TARGET) \
		-b $(CIRCUITS_TARGET)/passport_primary.json \
		-w $(CIRCUITS_TARGET)/passport_primary.gz \
		-o $(CIRCUITS_TARGET)/proof_primary
	@echo "✅ Primary proof written to $(CIRCUITS_TARGET)/proof_primary"

bb-verify-base: ## Verify a base proof locally
	@echo "━━━ Verifying base proof ━━━"
	$(BB) verify $(BB_TARGET) \
		-k $(CIRCUITS_TARGET)/vk_base \
		-p $(CIRCUITS_TARGET)/proof_base
	@echo "✅ Base proof verification complete"

bb-verify-primary: ## Verify a primary proof locally
	@echo "━━━ Verifying primary proof ━━━"
	$(BB) verify $(BB_TARGET) \
		-k $(CIRCUITS_TARGET)/vk_primary \
		-p $(CIRCUITS_TARGET)/proof_primary
	@echo "✅ Primary proof verification complete"

bb-gate-count: circuits ## Print gate counts for both circuits
	@echo "━━━ Base circuit gate count ━━━"
	$(BB) gates $(BB_TARGET) -b $(CIRCUITS_TARGET)/passport_base.json
	@echo "━━━ Primary circuit gate count ━━━"
	$(BB) gates $(BB_TARGET) -b $(CIRCUITS_TARGET)/passport_primary.json
	@echo "✅ Gate counts printed"

# ─── Smart Contracts ──────────────────────────────────────────────────
contracts: ## Build contracts and sync ABI to mobile app
	@echo "━━━ Building contracts ━━━"
	cd $(CONTRACTS) && forge build
	@echo "━━━ Syncing ABI to mobile app ━━━"
	pnpm contracts:sync-abi
	@echo "✅ Contracts built and ABI synced"

# ─── Testing ──────────────────────────────────────────────────────────
test: ## Run mobile app tests (single file or directory)
	@echo "━━━ Running tests ━━━"
	cd apps/mobile && npx jest --no-cache

test-all: test circuits-test contracts-test ## Run all tests

circuits-test: ## Run Noir circuit tests
	@echo "━━━ Testing circuits (workspace) ━━━"
	cd $(CIRCUITS_SRC) && nargo test --workspace
	@echo "✅ Circuit tests passed"

contracts-test: ## Run contract tests
	@echo "━━━ Testing contracts ━━━"
	cd $(CONTRACTS) && forge test -vvv
	@echo "✅ Contract tests passed"

# ─── Type Checking ────────────────────────────────────────────────────
typecheck: ## Run TypeScript type checks
	@echo "━━━ Type checking ━━━"
	pnpm typecheck
	@echo "✅ Type check passed"

# ─── Full Build Pipeline ──────────────────────────────────────────────
build-all: circuits bb-verifier ios contracts test-all typecheck ## Full rebuild: circuits + verifiers + iOS + contracts + tests + typecheck
	@echo "✅ Full build pipeline complete"

# ─── Anvil Dev Environment ─────────────────────────────────────────────
anvil-env: ## Auto-detect LAN IP and update .env files for anvil testing
	@IP=$$(ipconfig getifaddr en0) && \
	echo "━━━ Detected LAN IP: $$IP ━━━" && \
	sed -i '' "s|EXPO_PUBLIC_ANVIL_RPC_URL=.*|EXPO_PUBLIC_ANVIL_RPC_URL=http://$$IP:8545|" .env apps/mobile/.env && \
	echo "✅ Updated EXPO_PUBLIC_ANVIL_RPC_URL in .env and apps/mobile/.env"

ANVIL_KEY := 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ANVIL_DEPLOYER := 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

anvil-update-env: ## Internal: extract VerificationRegistry address from latest broadcast and write to both .env files. Pass SCRIPT=Deploy.s.sol or SCRIPT=DeployDev.s.sol
	@if [ -z "$(SCRIPT)" ]; then echo "❌ SCRIPT must be set (e.g. SCRIPT=Deploy.s.sol)"; exit 1; fi
	@ADDR=$$(python3 -c "import json; d=json.load(open('$(CONTRACTS)/broadcast/$(SCRIPT)/31337/run-latest.json')); txs=[t for t in d['transactions'] if t.get('contractName')=='VerificationRegistry']; print(txs[-1]['contractAddress'] if txs else '')") && \
	if [ -z "$$ADDR" ]; then echo "❌ Could not find VerificationRegistry in broadcast/$(SCRIPT)/31337/run-latest.json"; exit 1; fi && \
	echo "━━━ Registry deployed at: $$ADDR ━━━" && \
	sed -i '' "s|EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS=.*|EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS=$$ADDR|" .env apps/mobile/.env && \
	echo "✅ Updated EXPO_PUBLIC_ANVIL_REGISTRY_ADDRESS in .env and apps/mobile/.env"

anvil-deploy: anvil-env contracts ## Deploy with MockProofVerifier to local anvil
	@echo "━━━ Deploying (mock verifier) to anvil ━━━"
	cd $(CONTRACTS) && forge script script/DeployDev.s.sol:DeployDev \
		--rpc-url http://127.0.0.1:8545 --broadcast \
		--private-key $(ANVIL_KEY) -vvv
	@$(MAKE) anvil-update-env SCRIPT=DeployDev.s.sol

anvil-deploy-real: anvil-env bb-verifier contracts ## Deploy with real UltraHonk verifiers to local anvil
	@echo "━━━ Deploying (real verifier) to anvil ━━━"
	cd $(CONTRACTS) && DEPLOYER_ADDRESS=$(ANVIL_DEPLOYER) forge script script/Deploy.s.sol:Deploy \
		--rpc-url http://127.0.0.1:8545 --broadcast \
		--private-key $(ANVIL_KEY) -vvv
	@$(MAKE) anvil-update-env SCRIPT=Deploy.s.sol

# ─── Dev Server ────────────────────────────────────────────────────────
dev: ## Start Expo dev server
	pnpm mobile

# ─── iOS Quick Rebuild (most common after Rust changes) ───────────────
rebuild-ios: ios clean-xcode-cache ## Rebuild iOS framework and clear Xcode cache
	@echo "✅ iOS rebuilt — open Xcode and build (Cmd+B)"

clean-xcode-cache: ## Clear Xcode DerivedData
	rm -rf ~/Library/Developer/Xcode/DerivedData/mobile-*
	@echo "✅ Xcode DerivedData cleared"

# ─── Clean ────────────────────────────────────────────────────────────
clean-circuits: ## Clean compiled circuits
	rm -rf $(CIRCUITS_TARGET)/
	rm -rf $(APP_ASSETS)/passport_base.json $(APP_ASSETS)/passport_primary.json
	@echo "✅ Circuits cleaned"

clean-ios: ## Clean iOS framework copy
	rm -rf $(APP_MODULES)/MoproFfiFramework.xcframework
	@echo "✅ iOS framework copy cleaned"

clean-contracts: ## Clean contract build artifacts
	cd $(CONTRACTS) && forge clean
	@echo "✅ Contracts cleaned"

clean-rust: ## Clean Rust build artifacts
	cd packages/mopro-circuits && cargo clean
	@echo "✅ Rust artifacts cleaned"

clean-nargo: ## Clean nargo cached dependencies
	rm -rf ~/Library/Caches/noir
	rm -rf ~/.nargo/
	@echo "✅ Nargo cache cleaned"

clean: clean-circuits clean-ios clean-contracts clean-rust clean-nargo clean-xcode-cache ## Clean everything
	@echo "✅ Everything cleaned"

# ─── Verification ─────────────────────────────────────────────────────
verify-sync: ## Verify that circuit JSON and xcframework are in sync with sources
	@echo "━━━ Verifying circuit sync ━━━"
	@if [ -f "$(CIRCUITS_TARGET)/passport_base.json" ] && [ -f "$(APP_ASSETS)/passport_base.json" ]; then \
		SRC_HASH=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(CIRCUITS_TARGET)/passport_base.json')).hash)"); \
		DST_HASH=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(APP_ASSETS)/passport_base.json')).hash)"); \
		if [ "$$SRC_HASH" != "$$DST_HASH" ]; then \
			echo "❌ Circuit JSON out of sync! Run 'make circuits'"; \
			exit 1; \
		fi; \
		echo "✅ Base circuit in sync (hash: $$SRC_HASH)"; \
	else \
		echo "⚠️  Circuit JSON not found — run 'make circuits'"; \
	fi
	@echo "━━━ Verifying iOS framework ━━━"
	@if [ -d "$(MOPRO_XCFRAMEWORK)" ] && [ -d "$(APP_MODULES)/MoproFfiFramework.xcframework" ]; then \
		SRC_SIZE=$$(du -sm "$(MOPRO_XCFRAMEWORK)/ios-arm64" | awk '{print $$1}'); \
		DST_SIZE=$$(du -sm "$(APP_MODULES)/MoproFfiFramework.xcframework/ios-arm64" | awk '{print $$1}'); \
		if [ "$$SRC_SIZE" != "$$DST_SIZE" ]; then \
			echo "❌ iOS framework out of sync! Run 'make ios'"; \
			exit 1; \
		fi; \
		echo "✅ iOS framework in sync ($$SRC_SIZE MB)"; \
	else \
		echo "⚠️  iOS framework not found — run 'make ios'"; \
	fi
	@echo "━━━ Verification complete ━━━"
