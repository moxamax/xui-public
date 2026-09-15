import { lstat, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import semver from "semver";

const FLAT_CONFIG_NAMES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
];
const OTHER_LOCKFILES = [
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];
const REQUIRED_PACKAGES = [
  { name: "react", label: "React" },
  { name: "react-dom", label: "React DOM" },
  { name: "typescript", label: "TypeScript" },
  {
    name: "tailwindcss",
    label: "Tailwind CSS 4.1+ (4.x)",
    supported: ">=4.1.0 <5.0.0",
  },
  {
    name: "eslint",
    label: "ESLint 9",
    supported: ">=9.0.0 <10.0.0",
  },
];

export async function assertSupportedConsumer(
  consumerRoot,
  consumerPackage,
  { platform = process.platform } = {},
) {
  const issues = [];

  if (platform !== "darwin") {
    issues.push(`xui supports macOS only; detected ${platform}`);
  }

  if (consumerPackage.workspaces !== undefined) {
    issues.push("npm workspaces and monorepos are not supported");
  }

  if (
    consumerPackage.packageManager !== undefined &&
    (typeof consumerPackage.packageManager !== "string" ||
      !consumerPackage.packageManager.startsWith("npm@"))
  ) {
    issues.push("consumer packageManager must use npm");
  }

  const typecheckScript = consumerPackage.scripts?.typecheck;

  if (typeof typecheckScript !== "string" || typecheckScript.trim() === "") {
    issues.push(
      "consumer package.json must define a non-empty `typecheck` script before `xui init`",
    );
  }

  await inspectRootPaths(consumerRoot, issues);
  await inspectRequiredPackages(consumerRoot, consumerPackage, issues);

  if (!(await hasRegularFile(consumerRoot, FLAT_CONFIG_NAMES))) {
    issues.push(
      "consumer must provide an ESLint 9 flat config named `eslint.config.*`",
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `xui init preflight failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
    );
  }
}

async function inspectRootPaths(consumerRoot, issues) {
  const gitPath = join(consumerRoot, ".git");
  const gitStat = await lstatOrMissing(gitPath);

  if (gitStat === undefined || (!gitStat.isDirectory() && !gitStat.isFile())) {
    issues.push("consumer root must also be the Git root");
  }

  if (!(await isRegularFile(join(consumerRoot, "package.json")))) {
    issues.push("consumer package.json must be a regular file");
  }

  if (!(await isRegularFile(join(consumerRoot, "package-lock.json")))) {
    issues.push("consumer must use npm with a package-lock.json");
  }

  for (const name of OTHER_LOCKFILES) {
    if ((await lstatOrMissing(join(consumerRoot, name))) !== undefined) {
      issues.push(`mixed package-manager lockfile is not supported: ${name}`);
    }
  }

  for (const relativePath of [[".agents"], [".agents", "skills"]]) {
    const path = join(consumerRoot, ...relativePath);
    const pathStat = await lstatOrMissing(path);

    if (pathStat !== undefined && !pathStat.isDirectory()) {
      issues.push(
        `existing ${relativePath.join("/")} path ownership is unclear`,
      );
    }
  }
}

async function inspectRequiredPackages(consumerRoot, consumerPackage, issues) {
  const dependencies = {
    ...(isRecord(consumerPackage.dependencies)
      ? consumerPackage.dependencies
      : {}),
    ...(isRecord(consumerPackage.devDependencies)
      ? consumerPackage.devDependencies
      : {}),
  };

  for (const requirement of REQUIRED_PACKAGES) {
    if (
      typeof dependencies[requirement.name] !== "string" ||
      dependencies[requirement.name].trim() === ""
    ) {
      issues.push(`consumer must directly declare ${requirement.label}`);
      continue;
    }

    const installedPackage = await readInstalledPackage(
      consumerRoot,
      requirement.name,
    );

    if (installedPackage === undefined) {
      issues.push(
        `installed ${requirement.label} package is unavailable; run npm install before \`xui init\``,
      );
      continue;
    }

    if (
      requirement.supported !== undefined &&
      !semver.satisfies(installedPackage.version, requirement.supported)
    ) {
      issues.push(
        `installed ${requirement.label} version is unsupported: ${installedPackage.version}`,
      );
    }
  }
}

async function readInstalledPackage(consumerRoot, name) {
  try {
    const value = JSON.parse(
      await readFile(
        join(consumerRoot, "node_modules", ...name.split("/"), "package.json"),
        "utf8",
      ),
    );

    if (
      !isRecord(value) ||
      value.name !== name ||
      typeof value.version !== "string" ||
      semver.valid(value.version) === null
    ) {
      return undefined;
    }

    return value;
  } catch {
    return undefined;
  }
}

async function hasRegularFile(root, names) {
  for (const name of names) {
    try {
      if ((await stat(join(root, name))).isFile()) {
        return true;
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  return false;
}

async function isRegularFile(path) {
  const pathStat = await lstatOrMissing(path);
  return pathStat?.isFile() === true;
}

async function lstatOrMissing(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }
}

function isMissing(error) {
  return (
    error &&
    typeof error === "object" &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
