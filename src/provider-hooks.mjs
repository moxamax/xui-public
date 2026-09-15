import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const XUI_STOP_COMMAND =
  'node "$(git rev-parse --show-toplevel)/node_modules/xui/bin/xui-stop.mjs"';
export const CLAUDE_SETTINGS_PATH = [".claude", "settings.json"];
export const CODEX_HOOKS_PATH = [".codex", "hooks.json"];

const MANAGED_STOP_SCRIPT = "node_modules/xui/bin/xui-stop.mjs";
const PROVIDERS = [
  { label: "Claude Code", path: CLAUDE_SETTINGS_PATH },
  { label: "Codex", path: CODEX_HOOKS_PATH },
];

export async function prepareProviderHookFiles(consumerRoot) {
  return Promise.all(
    PROVIDERS.map(async (provider) => {
      const path = join(consumerRoot, ...provider.path);
      const config = await readHookConfig(path, provider.label);
      const merged = mergeStopHook(config, provider.label);

      return {
        path,
        content: `${JSON.stringify(merged, null, 2)}\n`,
      };
    }),
  );
}

export async function writeProviderHookFiles(files) {
  await Promise.all(
    files.map(async ({ path, content }) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }),
  );
}

function mergeStopHook(config, providerLabel) {
  let hooks = config.hooks;

  if (hooks === undefined) {
    hooks = {};
    config.hooks = hooks;
  } else if (!isRecord(hooks)) {
    throw conflict(providerLabel);
  }

  let stopGroups = hooks.Stop;

  if (stopGroups === undefined) {
    stopGroups = [];
    hooks.Stop = stopGroups;
  } else if (!Array.isArray(stopGroups)) {
    throw conflict(providerLabel);
  }

  const ownedHandlers = [];

  stopGroups.forEach((group, groupIndex) => {
    if (!isRecord(group) || !Array.isArray(group.hooks)) {
      throw conflict(providerLabel);
    }

    group.hooks.forEach((handler, handlerIndex) => {
      if (!isRecord(handler)) {
        throw conflict(providerLabel);
      }

      const command = handler.command;

      if (handler.type === "command" && typeof command !== "string") {
        throw conflict(providerLabel);
      }

      if (command === XUI_STOP_COMMAND && handler.type === "command") {
        ownedHandlers.push({ groupIndex, handlerIndex });
        return;
      }

      if (
        typeof command === "string" &&
        command.includes(MANAGED_STOP_SCRIPT)
      ) {
        throw new Error(
          `existing ${providerLabel} xui Stop hook ownership is unclear`,
        );
      }
    });
  });

  if (ownedHandlers.length > 1) {
    throw conflict(providerLabel);
  }

  if (ownedHandlers.length === 1) {
    const [{ groupIndex, handlerIndex }] = ownedHandlers;
    stopGroups[groupIndex].hooks[handlerIndex] = canonicalStopHandler();
  } else {
    stopGroups.push({ hooks: [canonicalStopHandler()] });
  }

  return config;
}

async function readHookConfig(path, providerLabel) {
  await assertRealDirectoryOrMissing(dirname(path), providerLabel);

  let pathStat;

  try {
    pathStat = await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      return {};
    }

    throw error;
  }

  if (!pathStat.isFile()) {
    throw new Error(
      `existing ${providerLabel} hook settings path ownership is unclear`,
    );
  }

  try {
    const config = JSON.parse(await readFile(path, "utf8"));

    if (!isRecord(config)) {
      throw new Error();
    }

    return config;
  } catch {
    throw new Error(`existing ${providerLabel} hook settings are invalid`);
  }
}

async function assertRealDirectoryOrMissing(path, providerLabel) {
  try {
    const pathStat = await lstat(path);

    if (!pathStat.isDirectory()) {
      throw new Error(
        `existing ${providerLabel} hook settings path ownership is unclear`,
      );
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
}

function canonicalStopHandler() {
  return {
    type: "command",
    command: XUI_STOP_COMMAND,
  };
}

function conflict(providerLabel) {
  return new Error(
    `existing ${providerLabel} Stop hook configuration conflicts with xui`,
  );
}

function isMissing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
