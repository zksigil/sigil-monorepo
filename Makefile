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
	@echo "✅ Circuits built and copied to $(APP_ASSETS)/"

# ─── Mopro iOS Framework ──────────────────────────────────────────────
ios: ## Build Mopro Rust FFI for iOS and copy to app modules
	@echo "━━━ Building Mopro iOS xcframework ━━━"
	cd $(MOPRO_SRC) && uniffi-bindgen-react-native build ios --config ubrn.config.yaml --release
	@echo "━━━ Copying xcframework to app modules ━━━"
	rm -rf $(APP_MODULES)/MoproFfiFramework.xcframework
	cp -R $(MOPRO_XCFRAMEWORK) $(APP_MODULES)/
	@echo "✅ iOS framework built and copied to $(APP_MODULES)/"

# ─── Mopro Android (stub — adjust if you have Android set up) ─────────
android: ## Build Mopro Rust FFI for Android
	@echo "━━━ Building Mopro Android ━━━"
	cd $(MOPRO_SRC) && uniffi-bindgen-react-native build android --config ubrn.config.yaml --release
	@echo "✅ Android library built"

# ─── Barretenberg (bb) Commands ───────────────────────────────────────
# bb is the Barretenberg CLI tool. Install via: curl -sSfL https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
BB_FLAGS = --oracle_hash keccak

bb-vk: ## Generate verification keys for both circuits
	@echo "━━━ Writing base VK ━━━"
	bb write_vk $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_base.json -o $(CIRCUITS_TARGET)/
	@echo "━━━ Writing primary VK ━━━"
	bb write_vk $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_primary.json -o $(CIRCUITS_TARGET)/
	@echo "✅ VKs written to $(CIRCUITS_TARGET)/"

bb-verifier: circuits ## Generate Solidity verifier contracts from compiled circuits
	@echo "━━━ Generating base Solidity verifier ━━━"
	bb contract $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_base.json -o $(CIRCUITS_TARGET)/verifiers/
	@echo "━━━ Generating primary Solidity verifier ━━━"
	bb contract $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_primary.json -o $(CIRCUITS_TARGET)/verifiers/
	@echo "✅ Solidity verifiers written to $(CIRCUITS_TARGET)/verifiers/"

bb-prove-base: circuits ## Generate a base proof locally (requires witness file)
	@echo "━━━ Generating base proof with bb ━━━"
	bb prove $(BB_FLAGS) \
		-b $(CIRCUITS_TARGET)/passport_base.json \
		-w $(CIRCUITS_TARGET)/passport_base.gz \
		-o $(CIRCUITS_TARGET)/proof_base
	@echo "✅ Base proof written to $(CIRCUITS_TARGET)/proof_base"

bb-prove-primary: circuits ## Generate a primary proof locally (requires witness file)
	@echo "━━━ Generating primary proof with bb ━━━"
	bb prove $(BB_FLAGS) \
		-b $(CIRCUITS_TARGET)/passport_primary.json \
		-w $(CIRCUITS_TARGET)/passport_primary.gz \
		-o $(CIRCUITS_TARGET)/proof_primary
	@echo "✅ Primary proof written to $(CIRCUITS_TARGET)/proof_primary"

bb-verify-base: ## Verify a base proof locally
	@echo "━━━ Verifying base proof ━━━"
	bb verify $(BB_FLAGS) \
		-k $(CIRCUITS_TARGET)/vk_base \
		-p $(CIRCUITS_TARGET)/proof_base
	@echo "✅ Base proof verification complete"

bb-verify-primary: ## Verify a primary proof locally
	@echo "━━━ Verifying primary proof ━━━"
	bb verify $(BB_FLAGS) \
		-k $(CIRCUITS_TARGET)/vk_primary \
		-p $(CIRCUITS_TARGET)/proof_primary
	@echo "✅ Primary proof verification complete"

bb-gate-count: circuits ## Print gate counts for both circuits
	@echo "━━━ Base circuit gate count ━━━"
	bb gates $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_base.json
	@echo "━━━ Primary circuit gate count ━━━"
	bb gates $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_primary.json
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
build-all: circuits ios contracts test-all typecheck ## Full rebuild: circuits + iOS + contracts + tests + typecheck
	@echo "✅ Full build pipeline complete"

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
