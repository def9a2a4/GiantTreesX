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
# tools/ci/server_test.py. Needs a built jar (run `make build` first, or let CI provide it).
CI_SERVER_DIR := $(TEST_SERVER_DIR)/ci-$(MINECRAFT_VERSION)

.PHONY: server-test
server-test: $(SERVER_JAR)
	rm -rf $(CI_SERVER_DIR)
	mkdir -p $(CI_SERVER_DIR)/plugins
	echo "eula=true" > $(CI_SERVER_DIR)/eula.txt
	printf "server-port=25599\nonline-mode=false\nlevel-seed=gianttrees\n" > $(CI_SERVER_DIR)/server.properties
	cp $$(ls target/GiantTrees-*.jar | grep -v original) $(CI_SERVER_DIR)/plugins/
	python3 tools/ci/server_test.py --server-dir $(CI_SERVER_DIR) --server-jar $(SERVER_JAR) --java $(JAVA)
