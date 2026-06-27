// Zero runtime dependencies is a hard guarantee of the engine (spec §12, §14.1):
// the browser's Web Audio API is the only thing it leans on. This fails CI the
// moment a `dependencies` (or `peerDependencies`) entry sneaks into package.json.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const offenders = [];
for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
  const names = Object.keys(pkg[field] ?? {});
  if (names.length > 0) {
    offenders.push(`${field}: ${names.join(", ")}`);
  }
}

if (offenders.length > 0) {
  process.stderr.write(
    `@simpllyf/ditty must have zero runtime dependencies, but found:\n` +
      offenders.map((line) => `  ${line}\n`).join("") +
      `Web Audio is the only runtime dependency allowed.\n`,
  );
  process.exit(1);
}

process.stdout.write("zero runtime dependencies — ok\n");
