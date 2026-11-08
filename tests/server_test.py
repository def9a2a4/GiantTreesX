#!/usr/bin/env python3
"""Server integration test for GiantTrees.

Runs a real Paper server (already set up by `make server-setup`) twice:

1. natural: treeGrowthPercentChance=100 for a while, then checks that trees were generated and
   nothing went wrong (no errors, exceptions, or legacy-material warnings).
2. placement: grows trees from the console at known spots and inspects the placed blocks with
   vanilla `execute if block`: planted on the soil surface, bark on the outside, the configured
   core block, a hollow trunk, a malformed wood setting only warns, and a small tree
   (tree.OAK_SMALL) stays small.

Exit status is non-zero on any failure; every problem is printed.
"""

import argparse
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path

FORBIDDEN = [
    re.compile(r"\bERROR\]"),
    re.compile(r"Exception"),
    re.compile(r"Legacy Material Support"),
    re.compile(r"Error rendering tree"),
]
# Paper/Mojang noise that is not ours and not actionable.
ALLOWED = [
    re.compile(r"Advanced terminal features are not available"),
]


class Server:
    def __init__(self, server_dir: Path, jar: Path, java: str, log: Path):
        self.log = log.open("w")
        self.lines: "queue.Queue[str]" = queue.Queue()
        self.all_lines: list[str] = []
        self.proc = subprocess.Popen(
            [java, "-Xmx2G", "-jar", str(jar.resolve()), "--nogui"],
            cwd=server_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in self.proc.stdout:
            line = line.rstrip("\n")
            self.log.write(line + "\n")
            self.log.flush()
            self.all_lines.append(line)
            self.lines.put(line)
        self.lines.put(None)

    def send(self, command: str):
        self.proc.stdin.write(command + "\n")
        self.proc.stdin.flush()

    def wait_for(self, pattern: str, timeout: float) -> "re.Match | None":
        regex = re.compile(pattern)
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                line = self.lines.get(timeout=max(0.1, deadline - time.time()))
            except queue.Empty:
                break
            if line is None:
                return None
            match = regex.search(line)
            if match:
                return match
        return None

    def drain(self):
        while True:
            try:
                self.lines.get_nowait()
            except queue.Empty:
                return

    def test_block(self, x: int, y: int, z: int, block: str) -> bool:
        self.drain()
        self.send(f"execute if block {x} {y} {z} {block}")
        match = self.wait_for(r"Test (passed|failed)|not loaded|Unknown block", 20)
        return bool(match) and match.group(0).startswith("Test passed")

    def stop(self):
        if self.proc.poll() is None:
            self.send("stop")
            try:
                self.proc.wait(timeout=120)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.log.close()


def write_config(server_dir: Path, source: Path, chance: float, overrides: str = ""):
    """The bundled config with the given natural-growth chance, verbose logging, and the wood
    sections replaced by `overrides`."""
    cfg_dir = server_dir / "plugins" / "GiantTrees"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    text = source.read_text()
    text = re.sub(r"(?m)^treeGrowthPercentChance:.*$", f"treeGrowthPercentChance: {chance}", text)
    text = re.sub(r"(?m)^wood_types:.*$", "", text)
    text = re.sub(r"(?m)^wood:\n(  .*\n)+", "", text)
    (cfg_dir / "config.yml").write_text(text + "\nverbose-logging: true\n" + overrides)


def scan_problems(lines: list[str]) -> list[str]:
    problems = []
    for line in lines:
        if any(a.search(line) for a in ALLOWED):
            continue
        if any(f.search(line) for f in FORBIDDEN):
            problems.append(line)
    return problems


def phase_natural(args) -> list[str]:
    write_config(args.server_dir, args.config, 100)

    server = Server(args.server_dir, args.server_jar, args.java, args.server_dir / "natural.log")
    failures = []
    try:
        if not server.wait_for(r"Done \(", args.startup_timeout):
            failures.append("natural: server did not finish starting")
            return failures
        time.sleep(args.natural_seconds)
    finally:
        server.stop()

    lines = server.all_lines
    if not any("Enabling GiantTrees" in l for l in lines):
        failures.append("natural: GiantTrees was not enabled")
    rendered = sum("Rendering tree" in l for l in lines)
    placed = sum("Placed tree at" in l for l in lines)
    small = sum(bool(re.search(r"Rendering tree biome\.\S+_SMALL\.xml", l)) for l in lines)
    print(f"natural: {rendered} trees rendered ({small} small), {placed} placed")
    if placed == 0:
        failures.append("natural: no trees were placed")
    # natural-tree-weights makes small trees 3x as likely as giants; with 10+ trees, none small
    # is a ~1e-6 fluke, so it means the weights or the biome.*_SMALL files are not being used
    if rendered >= 10 and small == 0:
        failures.append(f"natural: {rendered} trees rendered but none was a small variant")
    failures += [f"natural: {p}" for p in scan_problems(lines)]
    return failures


def trunk_checks(server: Server, x: int, y: int, z: int, wood: str, core: str) -> list[str]:
    """Checks one block deep inside the trunk and the outermost trunk block along +x."""
    failures = []
    probe_y = y + 3
    if not server.test_block(x, probe_y, z, core):
        failures.append(f"expected {core} in the trunk core at {x} {probe_y} {z}")
    family = f"#minecraft:{wood}_logs"
    # walk inward from outside the trunk; the first wood block hit is the outer layer
    outer = None
    for dx in range(16, -1, -1):
        if server.test_block(x + dx, probe_y, z, family):
            outer = dx
            break
    if outer is None:
        failures.append(f"no {wood} trunk found at {x} {probe_y} {z}")
    elif not server.test_block(x + outer, probe_y, z, f"minecraft:{wood}_wood"):
        failures.append(f"expected {wood}_wood bark at {x + outer} {probe_y} {z}")
    return failures


def soil_check(server: Server, x: int, y: int, z: int) -> bool:
    """Whether the block is soil a tree is planted on (and the one above it is not)."""
    soil = ("#minecraft:dirt", "#minecraft:sand", "#minecraft:terracotta")
    return (any(server.test_block(x, y, z, tag) for tag in soil)
            and not any(server.test_block(x, y + 1, z, tag) for tag in soil))


def phase_placement(args) -> list[str]:
    write_config(
        args.server_dir,
        args.config,
        0,
        "wood:\n  style: mixed_stripped\n  hollow_chance: 0\n  hollow_wall_thickness: 2\n"
        "wood_types:\n  Dark Oak:\n    style: mixed\n    hollow_chance: 100\n"
        # a malformed number must fall back to the default with a warning, not stop the tree
        "  Oak:\n    hollow_wall_thickness: thick\n",
    )
    server = Server(args.server_dir, args.server_jar, args.java, args.server_dir / "placement.log")
    failures = []
    try:
        if not server.wait_for(r"Done \(", args.startup_timeout):
            return ["placement: server did not finish starting"]

        # (species, x, z, wood, trunk core block, max height above the base or None)
        trees = [
            ("tree.OAK", 3000, 3000, "oak", "minecraft:stripped_oak_log", None),
            ("tree.DARK_OAK", 3400, 3000, "dark_oak", "minecraft:air", None),
            ("tree.PALE_OAK", 3800, 3000, "pale_oak", "minecraft:stripped_pale_oak_log", None),
            # mushroom stems have no bark or stripped variant: the core stays a stem
            ("tree.RED_MUSHROOM", 4200, 3000, None, "minecraft:mushroom_stem", None),
            # poplar blocks exist from 26.3 on; older servers grow the poplar file as a birch
            ("tree.POPLAR", 4600, 3000, "poplar", "minecraft:stripped_poplar_log", None),
            ("tree.OAK_SMALL", 5000, 3000, "oak", "minecraft:stripped_oak_log", 40),
        ]
        for species, x, z, wood, core, max_height in trees:
            server.drain()
            server.send(f"tree-create {species} world {x} {z}")
            grow = server.wait_for(rf"Growing {re.escape(species)} at world (-?\d+) (-?\d+) (-?\d+)", 60)
            if not grow:
                failures.append(f"placement: tree-create {species} did not start")
                continue
            bx, by, bz = map(int, grow.groups())
            # the tree's base must be the soil surface (not leaves, plants, snow or air). Checked
            # before the tree is placed (generation-delay is 3 s) since it then covers the spot.
            server.send(f"forceload add {bx - 32} {bz - 32} {bx + 32} {bz + 32}")
            if not soil_check(server, bx, by, bz):
                failures.append(f"placement: {species}: base {bx} {by} {bz} is not soil")
            placed = server.wait_for(rf"Placed tree at {bx} {by} {bz}:", 180)
            if not placed:
                failures.append(f"placement: {species} was never placed")
                continue
            time.sleep(2)
            if species == "tree.POPLAR" and any(
                    "Poplar blocks are not available" in l for l in server.all_lines):
                print("placement: no poplar blocks on this version, expecting a birch")
                wood, core = "birch", "minecraft:stripped_birch_log"
            if wood is None:
                if not server.test_block(bx, by + 3, bz, core):
                    failures.append(f"placement: {species}: expected {core} at {bx} {by + 3} {bz}")
                continue
            failures += [f"placement: {species}: {f}" for f in
                         trunk_checks(server, bx, by, bz, wood, core)]
            if max_height is not None:
                # a small tree: trunk still there well above the ground, nothing above max_height
                family = f"#minecraft:{wood}_logs"
                if not server.test_block(bx, by + 10, bz, family):
                    failures.append(f"placement: {species}: no trunk at {bx} {by + 10} {bz}")
                for dy in (max_height, max_height + 5):
                    if not server.test_block(bx, by + dy, bz, "minecraft:air"):
                        failures.append(f"placement: {species}: taller than {max_height} "
                                        f"(block at {bx} {by + dy} {bz})")
                        break
    finally:
        server.stop()
    if not any("Invalid hollow_wall_thickness 'thick'" in l for l in server.all_lines):
        failures.append("placement: no warning for the malformed hollow_wall_thickness")
    failures += [f"placement: {p}" for p in scan_problems(server.all_lines)]
    return failures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-dir", type=Path, required=True)
    parser.add_argument("--server-jar", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=Path("src/main/resources/config.yml"))
    parser.add_argument("--java", default="java")
    parser.add_argument("--startup-timeout", type=float, default=240)
    parser.add_argument("--natural-seconds", type=float, default=45)
    args = parser.parse_args()

    failures = phase_natural(args) + phase_placement(args)
    if failures:
        print(f"\n{len(failures)} problem(s):")
        for f in failures:
            print("  " + f)
        sys.exit(1)
    print("all server checks passed")


if __name__ == "__main__":
    main()
