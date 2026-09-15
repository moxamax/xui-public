import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import semver from "semver";

const RELEASE_PACKAGE_PATH = fileURLToPath(
  new URL("../package.json", import.meta.url),
);

export async function readRelease() {
  let value;

  try {
    value = JSON.parse(await readFile(RELEASE_PACKAGE_PATH, "utf8"));
  } catch {
    throw new Error("xui release declaration is unavailable");
  }

  const release = {
    name: value?.name,
    version: value?.version,
    designSystem: {
      name: value?.xuiRelease?.designSystem?.name,
      version: value?.xuiRelease?.designSystem?.version,
    },
  };

  if (
    !isNonEmptyString(release.name) ||
    !isNonEmptyString(release.version) ||
    !isNonEmptyString(release.designSystem.name) ||
    !isNonEmptyString(release.designSystem.version) ||
    semver.valid(release.version) === null ||
    semver.valid(release.designSystem.version) === null
  ) {
    throw new Error("xui release declaration is invalid");
  }

  return release;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
