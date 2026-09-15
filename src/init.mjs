import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { assertSupportedConsumer } from "./consumer-preflight.mjs";
import {
  prepareProviderHookFiles,
  writeProviderHookFiles,
} from "./provider-hooks.mjs";
import {
  CLAUDE_SKILL_PATH,
  CLAUDE_SKILL_TARGET,
  PROJECT_SKILL_CONTENT,
  PROJECT_SKILL_NAME,
} from "./project-skill.mjs";
import {
  REFERENCE_NAMES,
  SKILL_PATH,
  hashReference,
} from "./references.mjs";
import { readRelease } from "./release.mjs";

const FULL_GIT_COMMIT = /#[0-9a-f]{40}$/iu;

export async function initializeConsumer(
  consumerRoot,
  {
    installDesignSystem = installExactDesignSystem,
    platform = process.platform,
    runCheck,
  } = {},
) {
  const release = await readRelease();
  const skillRoot = join(consumerRoot, ...SKILL_PATH);
  const catalogPath = join(skillRoot, "references", "catalog.json");
  const claudeSkillPath = join(consumerRoot, ...CLAUDE_SKILL_PATH);
  const consumerPackagePath = join(consumerRoot, "package.json");
  const consumerPackage = await readRequiredJson(
    consumerPackagePath,
    "consumer package.json is unavailable",
  );
  const xuiSource = consumerPackage.dependencies?.[release.name];

  if (!isFullCommitSource(xuiSource)) {
    throw new Error(
      "consumer must declare xui as a Git dependency pinned to a full commit SHA",
    );
  }

  await assertSupportedConsumer(consumerRoot, consumerPackage, { platform });
  await assertManagedOrAbsent(skillRoot, catalogPath, release.name);
  const shouldCreateClaudeSkillLink = await shouldCreateClaudeSkillLinkAt(
    consumerRoot,
  );
  const providerHookFiles = await prepareProviderHookFiles(consumerRoot);
  await installDesignSystem({
    consumerRoot,
    name: release.designSystem.name,
    version: release.designSystem.version,
  });

  const installedRoot = join(
    consumerRoot,
    "node_modules",
    ...release.designSystem.name.split("/"),
  );
  const [updatedConsumerPackage, installedPackage, ...referenceContents] =
    await Promise.all([
      readRequiredJson(
        consumerPackagePath,
        "consumer package.json is unavailable after npm install",
      ),
      readRequiredJson(
        join(installedRoot, "package.json"),
        "installed design-system package.json is unavailable",
      ),
      ...REFERENCE_NAMES.map((name) =>
        readRequiredFile(
          join(installedRoot, name),
          `installed design-system is missing ${name}`,
        ),
      ),
    ]);
  const installedXuiSource =
    updatedConsumerPackage.dependencies?.[release.name];
  const declaredDesignSystemVersion =
    updatedConsumerPackage.dependencies?.[release.designSystem.name];

  if (
    installedXuiSource !== xuiSource ||
    declaredDesignSystemVersion !== release.designSystem.version ||
    installedPackage.name !== release.designSystem.name ||
    installedPackage.version !== release.designSystem.version
  ) {
    throw new Error(
      "npm install did not produce the design-system pair declared by this xui release",
    );
  }

  const references = Object.fromEntries(
    REFERENCE_NAMES.map((name, index) => [
      name,
      { sha256: hashReference(referenceContents[index]) },
    ]),
  );
  const catalog = {
    managedBy: release.name,
    xui: {
      version: release.version,
      source: xuiSource,
    },
    designSystem: {
      name: release.designSystem.name,
      version: release.designSystem.version,
    },
    references,
  };

  await mkdir(dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
  await Promise.all([
    ...REFERENCE_NAMES.map((name, index) =>
      writeFile(join(dirname(catalogPath), name), referenceContents[index]),
    ),
    writeFile(join(skillRoot, PROJECT_SKILL_NAME), PROJECT_SKILL_CONTENT),
    writeProviderHookFiles(providerHookFiles),
  ]);

  if (shouldCreateClaudeSkillLink) {
    await mkdir(dirname(claudeSkillPath), { recursive: true });
    await symlink(CLAUDE_SKILL_TARGET, claudeSkillPath);
  }

  // Load check after npm install so ESLint comes from the updated consumer tree.
  const executeCheck =
    runCheck ?? (await import("./check.mjs")).checkConsumer;
  await executeCheck(consumerRoot);

  return {
    designSystem: release.designSystem,
  };
}

async function assertManagedOrAbsent(skillRoot, catalogPath, owner) {
  try {
    const skillStat = await lstat(skillRoot);

    if (!skillStat.isDirectory()) {
      throw new Error("existing xui skill target is not managed by xui");
    }
  } catch (error) {
    if (isMissing(error)) {
      return;
    }

    throw error;
  }

  let catalog;

  try {
    catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  } catch {
    throw new Error("existing xui skill target is not managed by xui");
  }

  if (!isRecord(catalog) || catalog.managedBy !== owner) {
    throw new Error("existing xui skill target is not managed by xui");
  }

  await assertManagedSkillFiles(skillRoot);
}

async function assertManagedSkillFiles(skillRoot) {
  const paths = [
    join(skillRoot, PROJECT_SKILL_NAME),
    join(skillRoot, "references"),
    join(skillRoot, "references", "catalog.json"),
    ...REFERENCE_NAMES.map((name) => join(skillRoot, "references", name)),
  ];

  for (const path of paths) {
    const pathStat = await lstatOrMissing(path);

    if (pathStat === undefined) {
      continue;
    }

    const isReferencesDirectory = path === join(skillRoot, "references");

    if (
      (isReferencesDirectory && !pathStat.isDirectory()) ||
      (!isReferencesDirectory && !pathStat.isFile())
    ) {
      throw new Error("existing xui skill target is not managed by xui");
    }
  }
}

async function shouldCreateClaudeSkillLinkAt(consumerRoot) {
  const skillsRoot = join(consumerRoot, ".claude", "skills");
  const expectedSkillsRoot = resolve(consumerRoot, ".agents", "skills");
  const skillsRootStat = await lstatOrMissing(skillsRoot);

  if (skillsRootStat === undefined) {
    return true;
  }

  if (skillsRootStat.isSymbolicLink()) {
    const target = resolve(dirname(skillsRoot), await readlink(skillsRoot));

    if (target !== expectedSkillsRoot) {
      throw new Error("existing Claude skills directory is not managed by xui");
    }

    return false;
  }

  if (!skillsRootStat.isDirectory()) {
    throw new Error("existing Claude skills directory is not managed by xui");
  }

  return !(await hasExpectedSymlink(
    join(skillsRoot, "xui"),
    CLAUDE_SKILL_TARGET,
  ));
}

async function hasExpectedSymlink(path, expectedTarget) {
  let pathStat;

  try {
    pathStat = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }

    throw error;
  }

  if (!pathStat.isSymbolicLink()) {
    throw new Error("existing Claude xui skill link is not managed by xui");
  }

  if ((await readlink(path)) !== expectedTarget) {
    throw new Error("existing Claude xui skill link is not managed by xui");
  }

  return true;
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

async function installExactDesignSystem({ consumerRoot, name, version }) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "npm",
      buildDesignSystemInstallArguments(name, version),
      {
        cwd: consumerRoot,
        stdio: "inherit",
      },
    );

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `npm install was terminated by ${signal}`
            : `npm install failed with exit code ${code}`,
        ),
      );
    });
  });
}

export function buildDesignSystemInstallArguments(name, version) {
  return [
    "install",
    "--save-exact",
    "--ignore-scripts",
    "--",
    `${name}@${version}`,
  ];
}

async function readRequiredJson(path, message) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));

    if (!isRecord(value)) {
      throw new Error(message);
    }

    return value;
  } catch (error) {
    if (error instanceof Error && error.message === message) {
      throw error;
    }

    throw new Error(message);
  }
}

async function readRequiredFile(path, message) {
  try {
    return await readFile(path);
  } catch {
    throw new Error(message);
  }
}

function isFullCommitSource(value) {
  return typeof value === "string" && FULL_GIT_COMMIT.test(value);
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
