import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  REFERENCE_NAMES,
  SKILL_PATH,
  hashReference,
} from "./references.mjs";
import { readRelease } from "./release.mjs";
import { getReleaseUpdateStatus } from "./update-status.mjs";

const FULL_GIT_COMMIT = /#[0-9a-f]{40}$/iu;

export async function getStatus(consumerRoot, { listRemoteTags } = {}) {
  const release = await readRelease();
  const [localPair, xuiSource] = await Promise.all([
    getLocalPair(consumerRoot),
    readXuiSource(consumerRoot, release.name),
  ]);
  const updateStatus = await getReleaseUpdateStatus(
    {
      currentVersion: release.version,
      xuiSource,
    },
    { listRemoteTags },
  );

  return { localPair, updateStatus };
}

export async function getLocalPair(consumerRoot) {
  const release = await readRelease();
  const installedDesignSystemRoot = join(
    consumerRoot,
    "node_modules",
    ...release.designSystem.name.split("/"),
  );
  const snapshotRoot = join(consumerRoot, ...SKILL_PATH, "references");

  const [
    consumerPackage,
    installedDesignSystem,
    catalog,
    ...referenceFiles
  ] = await Promise.all([
    readJson(join(consumerRoot, "package.json")),
    readJson(join(installedDesignSystemRoot, "package.json")),
    readJson(join(snapshotRoot, "catalog.json")),
    ...REFERENCE_NAMES.map((name) => readBinary(join(snapshotRoot, name))),
    ...REFERENCE_NAMES.map((name) =>
      readBinary(join(installedDesignSystemRoot, name)),
    ),
  ]);

  if (
    consumerPackage.kind === "missing" ||
    installedDesignSystem.kind === "missing" ||
    catalog.kind === "missing" ||
    referenceFiles.some((file) => file.kind === "missing")
  ) {
    return "missing";
  }

  if (
    consumerPackage.kind === "invalid" ||
    installedDesignSystem.kind === "invalid" ||
    catalog.kind === "invalid"
  ) {
    return "mismatch";
  }

  const xuiSource = consumerPackage.value.dependencies?.[release.name];
  const declaredDesignSystemVersion =
    consumerPackage.value.dependencies?.[release.designSystem.name];
  const catalogXuiVersion = catalog.value.xui?.version;
  const catalogXuiSource = catalog.value.xui?.source;
  const catalogDesignSystemName = catalog.value.designSystem?.name;
  const catalogDesignSystemVersion = catalog.value.designSystem?.version;
  const installedDesignSystemName = installedDesignSystem.value.name;
  const installedDesignSystemVersion = installedDesignSystem.value.version;
  const catalogReferenceHashes = REFERENCE_NAMES.map(
    (name) => catalog.value.references?.[name]?.sha256,
  );

  const requiredPairValues = [
    xuiSource,
    declaredDesignSystemVersion,
    catalog.value.managedBy,
    catalogXuiVersion,
    catalogXuiSource,
    catalogDesignSystemName,
    catalogDesignSystemVersion,
    installedDesignSystemName,
    installedDesignSystemVersion,
    ...catalogReferenceHashes,
  ];

  if (requiredPairValues.some((value) => !isNonEmptyString(value))) {
    return "missing";
  }

  const matchesRelease =
    FULL_GIT_COMMIT.test(xuiSource) &&
    declaredDesignSystemVersion === release.designSystem.version &&
    catalog.value.managedBy === release.name &&
    catalogXuiVersion === release.version &&
    catalogXuiSource === xuiSource &&
    catalogDesignSystemName === release.designSystem.name &&
    catalogDesignSystemVersion === release.designSystem.version &&
    installedDesignSystemName === release.designSystem.name &&
    installedDesignSystemVersion === release.designSystem.version &&
    REFERENCE_NAMES.every((_, index) => {
      const expectedHash = catalogReferenceHashes[index];
      const snapshot = referenceFiles[index].value;
      const installed = referenceFiles[index + REFERENCE_NAMES.length].value;

      return (
        hashReference(snapshot) === expectedHash &&
        hashReference(installed) === expectedHash
      );
    });

  return matchesRelease ? "valid" : "mismatch";
}

async function readJson(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));

    if (!isRecord(value)) {
      return { kind: "invalid" };
    }

    return {
      kind: "value",
      value,
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { kind: "missing" };
    }

    if (error instanceof SyntaxError) {
      return { kind: "invalid" };
    }

    throw error;
  }
}

async function readBinary(path) {
  try {
    return {
      kind: "value",
      value: await readFile(path),
    };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { kind: "missing" };
    }

    throw error;
  }
}

async function readXuiSource(consumerRoot, packageName) {
  try {
    const consumerPackage = JSON.parse(
      await readFile(join(consumerRoot, "package.json"), "utf8"),
    );
    return consumerPackage?.dependencies?.[packageName];
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
