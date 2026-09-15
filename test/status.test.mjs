import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after } from "node:test";

import { getReleaseUpdateStatus } from "../src/update-status.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../bin/xui.mjs", import.meta.url));
const RELEASE = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const XUI_COMMIT = "a".repeat(40);
const XUI_SOURCE = `github:moxamax/xui-public#${XUI_COMMIT}`;
const REFERENCES = {
  "llms.txt": "# Design system\n",
  "llms-full.txt": "# Complete design system reference\n",
};
const GIT_FIXTURE_ROOT = await mkdtemp(join(tmpdir(), "xui-status-git-"));
after(() => rm(GIT_FIXTURE_ROOT, { recursive: true, force: true }));
await writeFile(
  join(GIT_FIXTURE_ROOT, "git"),
  `#!/bin/sh
if [ "$XUI_TEST_GIT_MODE" = "unknown" ]; then
  exit 1
fi
if [ "$XUI_TEST_GIT_MODE" = "available" ]; then
  printf 'b\\trefs/tags/0.2.0-beta.1\\n'
fi
printf 'a\\trefs/tags/0.1.0-beta.1\\n'
printf 'd\\trefs/tags/v0.1.0\\n'
printf 'c\\trefs/tags/release-notes\\n'
`,
);
await chmod(join(GIT_FIXTURE_ROOT, "git"), 0o755);

test("update lookup uses the pinned GitHub source and ignores non-newer tags", async () => {
  let requestedRemote;
  const updateStatus = await getReleaseUpdateStatus(
    {
      currentVersion: RELEASE.version,
      xuiSource: `github:moxamax/xui-public#${XUI_COMMIT}`,
    },
    {
      listRemoteTags: async (remote) => {
        requestedRemote = remote;
        return ["0.1.0-beta.1", `v${RELEASE.version}`, "release-notes"];
      },
    },
  );

  assert.equal(requestedRemote, "https://github.com/moxamax/xui-public.git");
  assert.equal(updateStatus, "current");
});

test("status reports a complete pair as valid without modifying the consumer", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const before = await snapshotFiles(consumerRoot);

  assert.deepEqual(await runStatus(consumerRoot), {
    localPair: "valid",
    updateStatus: "current",
  });
  assert.deepEqual(await snapshotFiles(consumerRoot), before);
});

test("status reports a newer prerelease as available", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  assert.deepEqual(await runStatus(consumerRoot, "available"), {
    localPair: "valid",
    updateStatus: "available",
  });
});

test(
  "status reports an unavailable remote as unknown without changing the local pair",
  async (t) => {
    const consumerRoot = await createConsumer();
    t.after(() => rm(consumerRoot, { recursive: true, force: true }));

    assert.deepEqual(await runStatus(consumerRoot, "unknown"), {
      localPair: "valid",
      updateStatus: "unknown",
    });
  },
);

test("status reports contradictory pair information as mismatch", async (t) => {
  const consumerRoot = await createConsumer({
    installedDesignSystemVersion: "0.1.0-beta.74",
  });
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  assert.deepEqual(await runStatus(consumerRoot), {
    localPair: "mismatch",
    updateStatus: "current",
  });
});

test("status reports a missing catalog as missing", async (t) => {
  const consumerRoot = await createConsumer({ includeCatalog: false });
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  assert.deepEqual(await runStatus(consumerRoot), {
    localPair: "missing",
    updateStatus: "current",
  });
});

test("status reports a missing installation as missing", async (t) => {
  const consumerRoot = await createConsumer({
    includeInstalledDesignSystem: false,
  });
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  assert.deepEqual(await runStatus(consumerRoot), {
    localPair: "missing",
    updateStatus: "current",
  });
});

test("status reports a changed snapshot as mismatch", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  await writeFile(
    join(
      consumerRoot,
      ".agents",
      "skills",
      "xui",
      "references",
      "llms.txt",
    ),
    "changed",
  );

  assert.deepEqual(await runStatus(consumerRoot), {
    localPair: "mismatch",
    updateStatus: "current",
  });
});

test("status reports a changed catalog hash as mismatch", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));
  const catalogPath = join(
    consumerRoot,
    ".agents",
    "skills",
    "xui",
    "references",
    "catalog.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  catalog.references["llms.txt"].sha256 = "0".repeat(64);
  await writeJson(catalogPath, catalog);

  assert.deepEqual(await runStatus(consumerRoot), {
    localPair: "mismatch",
    updateStatus: "current",
  });
});

test("status reports a changed installed reference as mismatch", async (t) => {
  const consumerRoot = await createConsumer();
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  await writeFile(
    join(
      consumerRoot,
      "node_modules",
      ...RELEASE.xuiRelease.designSystem.name.split("/"),
      "llms-full.txt",
    ),
    "changed",
  );

  assert.deepEqual(await runStatus(consumerRoot), {
    localPair: "mismatch",
    updateStatus: "current",
  });
});

async function createConsumer({
  includeCatalog = true,
  includeInstalledDesignSystem = true,
  installedDesignSystemVersion = RELEASE.xuiRelease.designSystem.version,
} = {}) {
  const consumerRoot = await mkdtemp(join(tmpdir(), "xui-status-"));
  const designSystem = RELEASE.xuiRelease.designSystem;

  await writeJson(join(consumerRoot, "package.json"), {
    name: "consumer",
    private: true,
    scripts: {
      lint: "node -e \"require('node:fs').writeFileSync('lint-ran', '')\"",
      typecheck:
        "node -e \"require('node:fs').writeFileSync('typecheck-ran', '')\"",
      build: "node -e \"require('node:fs').writeFileSync('build-ran', '')\"",
      test: "node -e \"require('node:fs').writeFileSync('test-ran', '')\"",
    },
    dependencies: {
      [RELEASE.name]: XUI_SOURCE,
      [designSystem.name]: designSystem.version,
    },
  });

  if (includeInstalledDesignSystem) {
    const installedRoot = join(
      consumerRoot,
      "node_modules",
      ...designSystem.name.split("/"),
    );

    await writeJson(join(installedRoot, "package.json"), {
      name: designSystem.name,
      version: installedDesignSystemVersion,
    });
    await Promise.all(
      Object.entries(REFERENCES).map(([name, content]) =>
        writeFile(join(installedRoot, name), content),
      ),
    );
  }

  if (includeCatalog) {
    const snapshotRoot = join(
      consumerRoot,
      ".agents",
      "skills",
      "xui",
      "references",
    );

    await writeJson(join(snapshotRoot, "catalog.json"), {
      managedBy: RELEASE.name,
      xui: {
        version: RELEASE.version,
        source: XUI_SOURCE,
      },
      designSystem: {
        name: designSystem.name,
        version: designSystem.version,
      },
      references: Object.fromEntries(
        Object.entries(REFERENCES).map(([name, content]) => [
          name,
          { sha256: sha256(content) },
        ]),
      ),
    });
    await Promise.all(
      Object.entries(REFERENCES).map(([name, content]) =>
        writeFile(join(snapshotRoot, name), content),
      ),
    );
  }

  return consumerRoot;
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function runStatus(consumerRoot, gitMode = "current") {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [CLI_PATH, "status", "--json"],
    {
      cwd: consumerRoot,
      env: {
        ...process.env,
        PATH: `${GIT_FIXTURE_ROOT}${delimiter}${process.env.PATH}`,
        XUI_TEST_GIT_MODE: gitMode,
      },
    },
  );

  assert.equal(stderr, "");
  return JSON.parse(stdout);
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function snapshotFiles(root) {
  const paths = await walk(root);
  const entries = await Promise.all(
    paths.map(async (path) => [
      relative(root, path),
      await readFile(path, "utf8"),
    ]),
  );

  return Object.fromEntries(entries);
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nestedPaths = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );

  return nestedPaths.flat().sort();
}
