// Shared setup for the Node scripts that talk to the Java harness.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** java executable: $JAVA_HOME, else the Debian/Ubuntu JDK 21 path, else `java` on PATH. */
export function javaBin() {
  if (process.env.JAVA_HOME) return join(process.env.JAVA_HOME, 'bin', 'java');
  const deb = '/usr/lib/jvm/java-21-openjdk-amd64/bin/java';
  return existsSync(deb) ? deb : 'java';
}
