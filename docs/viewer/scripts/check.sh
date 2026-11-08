#!/usr/bin/env bash
# Equivalence check: the JS tree generator (docs/viewer/src) against the plugin's Java code.
#
#   docs/viewer/scripts/check.sh            quick run (all bundled trees, 2 seeds, 1 ref point,
#                                                  7 wood styles), ~30 s
#   docs/viewer/scripts/check.sh --full     3 seeds x 2 ref points, every bundled file
#   docs/viewer/scripts/check.sh <args>     extra args go to scripts/equivalence.mjs
#
# Builds what is missing (plugin classes via mvn, the harness), then exits non-zero when any job's
# mismatched blocks exceed the tolerance (see scripts/equivalence.mjs for why there is one).
# Needs: node >= 18, a JDK 21+ (JAVA_HOME or on PATH), maven.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
BUILD="$HERE/harness/build"

command -v node >/dev/null || { echo "tree-preview check: node not found" >&2; exit 2; }

# 1. plugin classes
if [ ! -f "$REPO/target/classes/com/ryanmichela/trees/rendering/WoodStyler.class" ] \
   || [ -n "$(find "$REPO/src/main/java" "$REPO/src/arbaro/java" -name '*.java' -newer "$REPO/target/classes/com/ryanmichela/trees/rendering/WoodStyler.class" -print -quit)" ]; then
  echo "tree-preview check: compiling the plugin (mvn -B -q compile)" >&2
  (cd "$REPO" && mvn -B -q compile)
fi

# 2. harness (rebuilt when its sources, the plugin classes or the pom changed)
STAMP="$BUILD/run-classpath.txt"
if [ ! -f "$STAMP" ] \
   || [ -n "$(find "$HERE/harness/src" "$REPO/target/classes" "$REPO/pom.xml" -newer "$STAMP" \( -name '*.java' -o -name '*.class' -o -name pom.xml \) -print -quit)" ]; then
  "$HERE/harness/build.sh" >&2
fi

# 3. run
cd "$HERE"
status=0
EQ_ARGS=(--quick)
if [ "${1:-}" = "--full" ]; then EQ_ARGS=(--all-aliases); shift; fi
if [ $# -gt 0 ]; then EQ_ARGS=("$@"); fi
node scripts/equivalence.mjs "${EQ_ARGS[@]}" || status=1
if [ $status -eq 0 ]; then echo "tree-preview check: OK"; else echo "tree-preview check: FAILED" >&2; fi
exit $status
