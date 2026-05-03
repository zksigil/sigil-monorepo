# Sigil — Build & Development Makefile
# Prevents the manual copy mistakes that caused the redc_param debug loop.

SHELL := /bin/bash
.PHONY: help circuits circuits-all refresh-mopro-bindings ios android contracts test test-all typecheck clean clean-ios clean-circuits clean-contracts deps build-all install-dev

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
circuits: ## Compile Noir circuit and copy to app assets
	@echo "━━━ Compiling Noir circuit (workspace) ━━━"
	cd $(CIRCUITS_SRC) && nargo compile --workspace
	@echo "━━━ Copying circuit JSON to app assets ━━━"
	mkdir -p $(APP_ASSETS)
	cp -f $(CIRCUITS_TARGET)/passport_sigil.json $(APP_ASSETS)/
	cp -f certs/tree-data.json $(APP_ASSETS)/
	@echo "✅ Circuit built and copied to $(APP_ASSETS)/"

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

bb-vk: circuits ## Generate verification key from compiled circuit
	@echo "━━━ Writing sigil VK ━━━"
	$(BB) write_vk $(BB_TARGET) -b $(CIRCUITS_TARGET)/passport_sigil.json -o $(CIRCUITS_TARGET)/vk_sigil
	@echo "✅ VK written to $(CIRCUITS_TARGET)/vk_sigil"

bb-verifier: bb-vk ## Generate self-contained Solidity verifier contract from VK
	@echo "━━━ Generating sigil Solidity verifier ━━━"
	rm -rf /tmp/bb-out-sigil && mkdir -p /tmp/bb-out-sigil
	$(BB) write_solidity_verifier $(BB_TARGET) -k $(CIRCUITS_TARGET)/vk_sigil/vk -o /tmp/bb-out-sigil/Verifier.sol
	sed 's/contract HonkVerifier /contract SigilUltraHonkVerifier /' /tmp/bb-out-sigil/Verifier.sol > $(CONTRACTS)/src/verifiers/SigilUltraHonkVerifier.sol
	@echo "✅ Verifier regenerated at $(CONTRACTS)/src/verifiers/SigilUltraHonkVerifier.sol"

bb-prove: circuits ## Generate a sigil proof locally (requires witness file)
	@echo "━━━ Generating sigil proof with bb ━━━"
	$(BB) prove $(BB_TARGET) \
		-b $(CIRCUITS_TARGET)/passport_sigil.json \
		-w $(CIRCUITS_TARGET)/passport_sigil.gz \
		-o $(CIRCUITS_TARGET)/proof_sigil
	@echo "✅ Sigil proof written to $(CIRCUITS_TARGET)/proof_sigil"

bb-verify: ## Verify a sigil proof locally
	@echo "━━━ Verifying sigil proof ━━━"
	$(BB) verify $(BB_TARGET) \
		-k $(CIRCUITS_TARGET)/vk_sigil \
		-p $(CIRCUITS_TARGET)/proof_sigil
	@echo "✅ Sigil proof verification complete"

bb-gate-count: circuits ## Print gate count for the sigil circuit
	@echo "━━━ Sigil circuit gate count ━━━"
	$(BB) gates $(BB_TARGET) -b $(CIRCUITS_TARGET)/passport_sigil.json
	@echo "✅ Gate count printed"

# ─── Refresh node_modules/mopro-ffi from local source ─────────────────
# pnpm copies `file:` deps into node_modules instead of symlinking, so
# changes to apps/mobile/modules/mopro/ don't reach the JS bundle until
# the cached copy is busted. Without this, a stale TS binding signature
# meets the freshly built Rust binary and you get a UniFFI BufferOverflow
# in the next proof attempt.
refresh-mopro-bindings: ## Force pnpm to re-copy apps/mobile/modules/mopro into node_modules/mopro-ffi
	@echo "━━━ Refreshing node_modules/mopro-ffi ━━━"
	rm -rf node_modules/mopro-ffi
	pnpm install
	@echo "✅ node_modules/mopro-ffi refreshed"

# ─── Full Circuit Pipeline (the one to run after touching the circuit) ─
# Order matters:
#   circuits        regenerates passport_sigil.json (the new ACIR + witness shape)
#   bb-verifier     regenerates SigilUltraHonkVerifier.sol from the new VK
#   ios             rebuilds the Mopro Rust FFI + uniffi-generated TS/C++ bindings
#                   (Rust binary is what consumes the new witness shape)
#   refresh-mopro-bindings  ensures the freshly generated TS bindings actually
#                           reach the JS bundle (see note above)
# Skip any one of these and proof generation fails silently or with a buffer
# underrun, depending on which artifact is stale.
circuits-all: circuits bb-verifier ios refresh-mopro-bindings ## Full circuit pipeline: circuits + verifier + Mopro iOS + JS bindings refresh
	@echo "✅ Circuit pipeline complete — rebuild the iOS app in Xcode (or 'pnpm mobile:ios') to pick up the new bundle"

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

anvil-deploy-real: anvil-env bb-verifier contracts ## Deploy with real UltraHonk verifier to local anvil
	@echo "━━━ Deploying (real verifier) to anvil ━━━"
	# Forge resolves msg.sender from --private-key, so no DEPLOYER_ADDRESS env var is needed
	# (Deploy.s.sol reads `address deployer = msg.sender`).
	cd $(CONTRACTS) && forge script script/Deploy.s.sol:Deploy \
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
	rm -f $(APP_ASSETS)/passport_sigil.json
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
	@if [ -f "$(CIRCUITS_TARGET)/passport_sigil.json" ] && [ -f "$(APP_ASSETS)/passport_sigil.json" ]; then \
		SRC_HASH=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(CIRCUITS_TARGET)/passport_sigil.json')).hash)"); \
		DST_HASH=$$(node -e "console.log(JSON.parse(require('fs').readFileSync('$(APP_ASSETS)/passport_sigil.json')).hash)"); \
		if [ "$$SRC_HASH" != "$$DST_HASH" ]; then \
			echo "❌ Circuit JSON out of sync! Run 'make circuits'"; \
			exit 1; \
		fi; \
		echo "✅ Sigil circuit in sync (hash: $$SRC_HASH)"; \
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
