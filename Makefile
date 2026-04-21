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
# bb is the Barretenberg CLI tool. Install via: curl -sSfL https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash
BB_FLAGS = --oracle_hash keccak

bb-vk: circuits ## Generate verification keys from compiled circuits
	@echo "━━━ Writing base VK ━━━"
	bb write_vk -s ultra_honk $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_base.json -o $(CIRCUITS_TARGET)/vk_base
	@echo "━━━ Writing primary VK ━━━"
	bb write_vk -s ultra_honk $(BB_FLAGS) -b $(CIRCUITS_TARGET)/passport_primary.json -o $(CIRCUITS_TARGET)/vk_primary
	@echo "✅ VKs written to $(CIRCUITS_TARGET)/vk_base and vk_primary"

bb-verifier: bb-vk ## Generate Solidity verifier contracts from VKs, splice zkmopro body, extract VK
	@echo "━━━ Generating base Solidity verifier (bb → VK library only; body replaced below) ━━━"
	bb write_solidity_verifier -s ultra_honk --zk -k $(CIRCUITS_TARGET)/vk_base/vk -o $(CIRCUITS_TARGET)/BaseUltraHonkVerifier.sol
	@echo "━━━ Splicing zkmopro/aztec-packages template body (PROOF_SIZE=508, NUMBER_OF_ENTITIES=41) ━━━"
	node scripts/splice-zkmopro-verifier.mjs $(CIRCUITS_TARGET)/BaseUltraHonkVerifier.sol BaseUltraHonkVerifier
	@echo "━━━ Generating primary Solidity verifier ━━━"
	bb write_solidity_verifier -s ultra_honk --zk -k $(CIRCUITS_TARGET)/vk_primary/vk -o $(CIRCUITS_TARGET)/PrimaryUltraHonkVerifier.sol
	node scripts/splice-zkmopro-verifier.mjs $(CIRCUITS_TARGET)/PrimaryUltraHonkVerifier.sol PrimaryUltraHonkVerifier
	@echo "━━━ Extracting VKs into SSTORE2 data contracts (24KB size fix) ━━━"
	node scripts/extract-vk.mjs $(CIRCUITS_TARGET)/BaseUltraHonkVerifier.sol BaseUltraHonkVerifier BaseVerificationKey $(CONTRACTS)/src/verifiers
	node scripts/extract-vk.mjs $(CIRCUITS_TARGET)/PrimaryUltraHonkVerifier.sol PrimaryUltraHonkVerifier PrimaryVerificationKey $(CONTRACTS)/src/verifiers
	@echo "✅ Solidity verifiers + VK data contracts generated in $(CONTRACTS)/src/verifiers/"

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

anvil-deploy: anvil-env contracts ## Deploy with MockProofVerifier to local anvil
	@echo "━━━ Deploying (mock verifier) to anvil ━━━"
	cd $(CONTRACTS) && forge script script/DeployDev.s.sol:DeployDev \
		--rpc-url http://127.0.0.1:8545 --broadcast \
		--private-key $(ANVIL_KEY) -vvv
	@echo "━━━ Update .env with deployed address (check output above) ━━━"

anvil-deploy-real: anvil-env bb-verifier contracts ## Deploy with real UltraHonk verifiers to local anvil
	@echo "━━━ Deploying (real verifier) to anvil ━━━"
	cd $(CONTRACTS) && DEPLOYER_ADDRESS=$(ANVIL_DEPLOYER) forge script script/Deploy.s.sol:Deploy \
		--rpc-url http://127.0.0.1:8545 --broadcast \
		--private-key $(ANVIL_KEY) -vvv
	@echo "━━━ Update .env with deployed address (check output above) ━━━"

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
