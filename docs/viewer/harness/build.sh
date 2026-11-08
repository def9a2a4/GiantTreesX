#!/usr/bin/env bash
# Compiles the Java equivalence harness against the plugin's compiled classes.
# Prerequisite: `mvn -B -q package` (or at least `mvn -B -q compile`) in the repo root.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
if [ -n "${JAVA_HOME:-}" ]; then
  JAVAC="$JAVA_HOME/bin/javac"
elif [ -x /usr/lib/jvm/java-21-openjdk-amd64/bin/javac ]; then
  JAVAC=/usr/lib/jvm/java-21-openjdk-amd64/bin/javac
else
  JAVAC=javac
fi
mkdir -p "$HERE/build"
if [ ! -d "$REPO/target/classes/com/ryanmichela/trees/rendering" ]; then
  echo "target/classes missing - run 'mvn -B -q package' in $REPO first" >&2
  exit 1
fi
CP_FILE="$HERE/build/deps-classpath.txt"
if [ ! -s "$CP_FILE" ] || [ "$REPO/pom.xml" -nt "$CP_FILE" ]; then
  (cd "$REPO" && mvn -B -q dependency:build-classpath -Dmdep.includeScope=provided -Dmdep.outputFile="$CP_FILE")
fi
rm -rf "$HERE/build/classes"
"$JAVAC" -nowarn --release 21 -d "$HERE/build/classes" \
  -cp "$REPO/target/classes:$(cat "$CP_FILE")" \
  "$HERE"/src/com/ryanmichela/trees/rendering/*.java
echo "$REPO/target/classes:$HERE/build/classes:$(cat "$CP_FILE")" > "$HERE/build/run-classpath.txt"
echo "harness built: $HERE/build/classes"
