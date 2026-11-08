# Local test server (gitignored, lives in test-server/).
#
#   make server                          build the plugin, then run Paper with it (default 26.3)
#   make server MINECRAFT_VERSION=1.21.11 JAVA=/usr/lib/jvm/java-21-openjdk-amd64/bin/java
#
# Each Minecraft version gets its own directory under test-server/, so a world is never opened by
# an older server after a newer one has upgraded it. The plugin's data folder is kept between runs;
# `make server-reset-config` wipes it so the bundled config and tree files are unpacked fresh.

MINECRAFT_VERSION ?= 26.3
JAVA              ?= java
SERVER_PORT       ?= 25565
SERVER_MEMORY     ?= 4G

TEST_SERVER_DIR := test-server
CACHE_DIR       := $(TEST_SERVER_DIR)/.cache
SERVER_DIR      := $(TEST_SERVER_DIR)/$(MINECRAFT_VERSION)
SERVER_JAR      := $(CACHE_DIR)/paper-$(MINECRAFT_VERSION).jar

.PHONY: build
build:
	mvn -B -q clean package

$(SERVER_JAR):
	mkdir -p $(CACHE_DIR)
	url=$$(curl -sf https://fill.papermc.io/v3/projects/paper/versions/$(MINECRAFT_VERSION)/builds/latest \
	        | jq -r '.downloads."server:default".url') \
	  && [ -n "$$url" ] && [ "$$url" != null ] \
	  && curl -sfo $@ "$$url" \
	  || { echo "could not download Paper $(MINECRAFT_VERSION)"; rm -f $@; exit 1; }

.PHONY: server-download
server-download: $(SERVER_JAR)

# Re-fetch the newest Paper build for MINECRAFT_VERSION.
.PHONY: server-update
server-update:
	rm -f $(SERVER_JAR)
	$(MAKE) server-download

.PHONY: server-setup
server-setup: $(SERVER_JAR)
	mkdir -p $(SERVER_DIR)/plugins
	echo "eula=true" > $(SERVER_DIR)/eula.txt
	[ -f $(SERVER_DIR)/server.properties ] || printf "server-port=$(SERVER_PORT)\nmotd=GiantTrees test ($(MINECRAFT_VERSION))\n" > $(SERVER_DIR)/server.properties
	rm -f $(SERVER_DIR)/plugins/GiantTrees*.jar
	cp target/GiantTrees-*.jar $(SERVER_DIR)/plugins/
	rm -f $(SERVER_DIR)/plugins/original-GiantTrees-*.jar

.PHONY: server-start
server-start:
	cd $(SERVER_DIR) && $(JAVA) -Xmx$(SERVER_MEMORY) -jar $(abspath $(SERVER_JAR)) --nogui

.PHONY: server
server: build server-setup server-start

.PHONY: server-reset-config
server-reset-config:
	rm -rf $(SERVER_DIR)/plugins/GiantTrees

# Delete the world(s) for MINECRAFT_VERSION so new chunks (and natural trees) generate again.
.PHONY: server-reset-world
server-reset-world:
	rm -rf $(SERVER_DIR)/world $(SERVER_DIR)/world_nether $(SERVER_DIR)/world_the_end

.PHONY: clean-test-server
clean-test-server:
	rm -rf $(TEST_SERVER_DIR)

# Integration test (what CI runs): a throwaway server in test-server/ci-<version>/ with a fresh
# world, natural generation plus console-grown trees whose blocks are checked. See
# tests/server_test.py. Needs a built jar (run `make build` first, or let CI provide it).
CI_SERVER_DIR := $(TEST_SERVER_DIR)/ci-$(MINECRAFT_VERSION)

.PHONY: server-test
server-test: $(SERVER_JAR)
	rm -rf $(CI_SERVER_DIR)
	mkdir -p $(CI_SERVER_DIR)/plugins
	echo "eula=true" > $(CI_SERVER_DIR)/eula.txt
	printf "server-port=25599\nonline-mode=false\nlevel-seed=gianttrees\n" > $(CI_SERVER_DIR)/server.properties
	cp $$(ls target/GiantTrees-*.jar | grep -v original) $(CI_SERVER_DIR)/plugins/
	python3 tests/server_test.py --server-dir $(CI_SERVER_DIR) --server-jar $(SERVER_JAR) --java $(JAVA)

# Website in docs/ (GitHub Pages serves it as is): the gallery (docs/index.html), the viewer
# (docs/viewer/) and copies of the plugin's tree files (docs/trees/).
PREVIEW_PORT ?= 8000
VIEWER := docs/viewer

# Copy src/main/resources/{tree,biome}.*.xml into docs/trees/ (CI checks they are in sync).
.PHONY: docs-trees
docs-trees:
	node $(VIEWER)/scripts/sync-trees.mjs

.PHONY: preview
preview: docs-trees
	@echo "Gallery: http://localhost:$(PREVIEW_PORT)/   Viewer: http://localhost:$(PREVIEW_PORT)/viewer/"
	cd docs && python3 -m http.server $(PREVIEW_PORT)

# Render docs/gallery/ (one card per tree file, i.e. per type and size: a hero shot, a cut
# through the middle and a view from above) with the viewer in headless Chromium.
# Installs Playwright into docs/viewer/node_modules on first run.
.PHONY: gallery
gallery: docs-trees
	[ -d $(VIEWER)/node_modules/playwright ] || npm install --prefix $(VIEWER) --no-audit --no-fund
	cd $(VIEWER) && npx playwright install chromium
	node $(VIEWER)/scripts/gallery.mjs

# The viewer's JS port must match the plugin's Java tree generation, docs/trees/ must match the
# plugin's tree files, and docs/gallery/ must have an up-to-date entry per tree (what CI runs).
.PHONY: preview-check
preview-check:
	node $(VIEWER)/scripts/sync-trees.mjs --check
	$(VIEWER)/scripts/check.sh
	node $(VIEWER)/scripts/gallery-check.mjs

# Tree tuning tools in scripts/ (see scripts/README.md). TREES is a comma-separated list of names
# in src/main/resources (OAK = tree.OAK, wildcards like 'tree.*_HUGE'), SEEDS e.g. 12345,7 or 1..10.
#   make tree-stats TREES=OAK,OAK_HUGE [SEEDS=1..10]       block counts and sizes over seeds
#   make tree-shots TREES=OAK [SEEDS=1..4] [VIEWS=hero,cut]  images + sheet.jpg in .temp/shots/
.PHONY: tree-stats
tree-stats:
	@[ -n "$(TREES)" ] || { echo "usage: make tree-stats TREES=OAK,OAK_HUGE [SEEDS=1..10]"; exit 1; }
	node scripts/tree-stats.mjs $(if $(SEEDS),--seeds '$(SEEDS)') '$(TREES)'

.PHONY: tree-shots
tree-shots:
	@[ -n "$(TREES)" ] || { echo "usage: make tree-shots TREES=OAK [SEEDS=1..4] [VIEWS=hero,cut]"; exit 1; }
	[ -d $(VIEWER)/node_modules/playwright ] || npm install --prefix $(VIEWER) --no-audit --no-fund
	cd $(VIEWER) && npx playwright install chromium
	node scripts/tree-shots.mjs $(if $(SEEDS),--seeds '$(SEEDS)') $(if $(VIEWS),--views '$(VIEWS)') --sheet .temp/shots/sheet.jpg '$(TREES)'
