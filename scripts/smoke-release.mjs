import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import semver from "semver";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const revision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot, encoding: "utf8",
}).trim();
assert.equal(execFileSync("git", ["status", "--porcelain"], {
  cwd: repoRoot, encoding: "utf8",
}).trim(), "", "Commit the release candidate before testing its Git dependency");

const { values: { tag, remote } } = parseArgs({
  options: { tag: { type: "string" }, remote: { type: "string" } },
});
assert.ok(tag || !remote, "--remote requires --tag");
let sourceRemote = pathToFileURL(repoRoot).href;
if (tag) {
  const release = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  assert.ok(semver.valid(tag), "Release tag must be a complete SemVer");
  assert.equal(semver.valid(tag), release.version, "Release tag must match package version");
  sourceRemote = remote ?? execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: repoRoot, encoding: "utf8",
  }).trim();
  assert.ok(["file:", "https:", "ssh:", "git:"].includes(new URL(sourceRemote).protocol),
    "Use a Git remote URL with an explicit protocol");
  const ref = `refs/tags/${tag}`;
  const refs = new Map(execFileSync("git", ["ls-remote", "--tags", sourceRemote, ref, `${ref}^{}`], {
    cwd: repoRoot, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim().split("\n").filter(Boolean).map((line) => {
    const [sha, name] = line.split("\t");
    return [name, sha];
  }));
  const taggedRevision = refs.get(`${ref}^{}`) ?? refs.get(ref);
  assert.match(taggedRevision ?? "", /^[0-9a-f]{40}$/u, "Remote release tag is missing or invalid");
  assert.equal(taggedRevision, revision, "Remote release tag must point to this reviewed commit");
  console.log(`Release: ${tag} -> ${taggedRevision}`);
}
const xuiSource = `git+${sourceRemote}#${revision}`;

const root = await mkdtemp(join(tmpdir(), "xui-release-"));
console.log(`Consumer: ${root}\nCandidate: ${revision}\nSource: ${xuiSource}`);
const run = (command, args) => execFileSync(command, args, {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = async (path, content) => {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
};
const json = (path, value) => put(path, `${JSON.stringify(value, null, 2)}\n`);
const readJson = async (path) => JSON.parse(await readFile(join(root, path), "utf8"));
const cli = (...args) => run(process.execPath, ["node_modules/xui/bin/xui.mjs", ...args]);

try {
  run("git", ["init", "--quiet"]);
  await json("package.json", {
    name: "xui-release-consumer", private: true, type: "module",
    scripts: { typecheck: "tsc --noEmit", build: "vite build", dev: "vite --host 127.0.0.1" },
    dependencies: {
      xui: xuiSource,
      react: "19.1.0", "react-dom": "19.1.0", "lucide-react": "0.577.0",
      clsx: "2.1.1",
    },
    devDependencies: {
      typescript: "5.8.3", "@types/react": "19.1.9", "@types/react-dom": "19.1.9",
      eslint: "9.39.5", "@typescript-eslint/parser": "8.39.0",
      tailwindcss: "4.0.17", "@tailwindcss/vite": "4.1.11", vite: "7.0.6",
    },
  });
  await json("tsconfig.json", {
    compilerOptions: {
      target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext", moduleResolution: "Bundler", jsx: "react-jsx",
      strict: true, noEmit: true, skipLibCheck: false,
    },
    include: ["src"],
  });
  await put("eslint.config.mjs", `import parser from '@typescript-eslint/parser';
export default [{ ignores: ['dist/**', '.agents/**'] }, {
  files: ['src/**/*.tsx'], languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
}];\n`);
  await put("vite.config.mjs", `import tailwindcss from '@tailwindcss/vite';
export default { plugins: [tailwindcss()], esbuild: { jsx: 'automatic' } };\n`);
  await put("index.html", '<html lang="zh-Hant"><meta charset="utf-8"><title>xui release smoke</title><div id="root"></div><script type="module" src="/src/main.tsx"></script></html>\n');
  await put("src/style.css", `@import 'tailwindcss';
@import '@qijenchen/design-system/styles/tokens';
@source '../node_modules/@qijenchen/design-system/src/**/*.{js,ts,jsx,tsx}';\n`);
  await put("src/main.tsx", `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@qijenchen/design-system/components/Button';
import { TooltipProvider } from '@qijenchen/design-system/components/Tooltip';
import { NumberInput } from '@qijenchen/design-system/components/NumberInput';
import { MOTION_DELAY_PLAIN_MS } from '@qijenchen/design-system/tokens/motion/motion';
import { ICON_SIZE } from '@qijenchen/design-system/tokens/uiSize/icon-size';
import { Plus } from 'lucide-react';
import './style.css';

function App() {
  const [count, setCount] = useState(0);
  const [amount, setAmount] = useState<number | null>(1250);
  return <TooltipProvider delayDuration={MOTION_DELAY_PLAIN_MS} skipDelayDuration={300}>
    <main className="p-[var(--layout-space-loose)] flex flex-col items-start gap-[var(--layout-space-tight)]">
      <h1>xui release smoke</h1>
      <Button variant="primary" onClick={() => setCount(count + 1)}>增加 {count}</Button>
      <Button iconOnly startIcon={Plus} aria-label="新增" onClick={() => setCount(count + 1)} />
      <Button asChild><a href="#destination">前往內容</a></Button>
      <Button asChild disabled><a href="#disabled" onClick={() => setCount(count + 1)}>停用連結</a></Button>
      <Button asChild loading><a href="#loading" onClick={() => setCount(count + 1)}>載入中連結</a></Button>
      <Button loading>儲存中</Button>
      <label htmlFor="amount">金額</label>
      <NumberInput id="amount" value={amount} onChange={setAmount} prefix="$" precision={2} />
      <span id="destination">內容 <Plus size={ICON_SIZE.sm} aria-hidden="true" /></span>
    </main>
  </TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);\n`);
  const otherHooks = { hooks: { Stop: [{ hooks: [{ type: "command", command: "echo consumer-stop" }] }] } };
  await json(".claude/settings.json", otherHooks);
  await json(".codex/hooks.json", otherHooks);
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);

  const paths = ["package.json", "package-lock.json", ".claude/settings.json", ".codex/hooks.json"];
  const snapshot = () => Promise.all(paths.map((path) => readFile(join(root, path), "utf8")));
  const before = await snapshot();
  assert.throws(() => cli("init"), (error) => {
    assert.match(error.stderr, /Tailwind CSS 4\.1\+.*unsupported: 4\.0\.17/u);
    return true;
  });
  assert.deepEqual(await snapshot(), before);
  await assert.rejects(readFile(join(root, ".agents/skills/xui/SKILL.md")), { code: "ENOENT" });
  console.log("PASS: Tailwind 4.0 rejected before consumer changes");

  run("npm", ["install", "--save-dev", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", "tailwindcss@4.1.11"]);
  console.log(cli("init"));
  const catalog = await readJson(".agents/skills/xui/references/catalog.json");
  const release = await readJson("node_modules/xui/package.json");
  const lock = await readJson("package-lock.json");
  assert.equal(release.name, "xui");
  assert.equal((await readJson("package.json")).dependencies.xui, xuiSource);
  assert.equal(lock.packages[""].dependencies.xui, xuiSource);
  const npmGithubSource = xuiSource.replace(/^git\+https:\/\/github\.com\//u, "git+ssh://git@github.com/");
  assert.ok([xuiSource, npmGithubSource].includes(lock.packages["node_modules/xui"].resolved),
    "Lockfile must preserve the xui repository and complete commit SHA");
  assert.equal(catalog.xui.source, xuiSource);
  assert.equal(catalog.xui.version, release.version);
  if (tag) assert.equal(release.version, semver.valid(tag));
  assert.equal(catalog.designSystem.version, release.xuiRelease.designSystem.version);
  assert.equal((await readJson("package.json")).dependencies[catalog.designSystem.name], catalog.designSystem.version);
  for (const name of ["llms.txt", "llms-full.txt"]) {
    assert.deepEqual(
      await readFile(join(root, ".agents/skills/xui/references", name)),
      await readFile(join(root, "node_modules/@qijenchen/design-system", name)),
    );
  }
  const { getLocalPair } = await import(pathToFileURL(join(root, "node_modules/xui/src/status.mjs")));
  assert.equal(await getLocalPair(root), "valid");
  const status = JSON.parse(cli("status", "--json"));
  assert.equal(status.localPair, "valid");
  assert.ok(["current", "available"].includes(status.updateStatus), "Release update query must succeed");
  console.log(`PASS: pinned SHA in package, lock and catalog; status ${JSON.stringify(status)}`);
  console.log("PASS: exact package, original references, Guard data and consumer typecheck");

  const initialized = await snapshot();
  console.log(cli("init"));
  assert.deepEqual(await snapshot(), initialized);
  for (const path of paths.slice(2)) {
    const handlers = (await readJson(path)).hooks.Stop.flatMap((entry) => entry.hooks);
    assert.equal(handlers.filter((hook) => hook.command === "echo consumer-stop").length, 1);
    assert.equal(handlers.length, 2);
  }
  console.log("PASS: repeated init preserves hooks without duplicates");
  console.log(cli("check"));
  await put("src/guard-probe.tsx", `import clsx from 'clsx';
export function Probe({ on, gap }: { on: boolean; gap: number }) {
  return <div className={clsx(
    'bg-popover', on && 'gap-[var(--layout-space-wide)]',
    on ? 'w-[37px]' : 'flex', \`gap-\${gap}\`,
  )} />;
}\n`);
  assert.throws(() => cli("check"), (error) => {
    assert.match(error.stderr, /src\/guard-probe\.tsx/u);
    for (const rule of ["no-shadcn-alias", "no-unknown-layout-token", "no-unreasoned-arbitrary-value", "no-dynamic-tailwind-class"]) {
      assert.ok(error.stderr.includes(`xui/${rule}`), `missing ${rule}`);
    }
    return true;
  });
  await put("src/guard-probe.tsx", `import clsx from 'clsx';
export function Probe({ on }: { on: boolean }) {
  return <div className={clsx('bg-surface-raised', on && 'gap-[var(--layout-space-tight)]', on ? 'grid' : 'flex')} />;
}\n`);
  console.log(cli("check"));
  await unlink(join(root, "src/guard-probe.tsx"));
  console.log("PASS: real class helpers report violations and pass after correction");
  console.log(run("npm", ["run", "build"]));
  console.log(`PASS: release smoke\nBrowser follow-up: npm run dev --prefix ${root}`);
} catch (error) {
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  console.error(`Consumer retained for inspection: ${root}`);
  console.error(error.message);
  process.exitCode = 1;
}
