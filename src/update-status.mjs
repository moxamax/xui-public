import { execFile } from "node:child_process";
import { promisify } from "node:util";

import semver from "semver";

const execFileAsync = promisify(execFile);
const FULL_GIT_COMMIT = /#[0-9a-f]{40}$/iu;
const REMOTE_TIMEOUT_MS = 5_000;
const SUPPORTED_PROTOCOLS = new Set(["file:", "git:", "https:", "ssh:"]);

export async function getReleaseUpdateStatus(
  { currentVersion, xuiSource },
  { listRemoteTags = queryRemoteTags } = {},
) {
  try {
    const remote = getRemoteFromSource(xuiSource);
    const tags = await listRemoteTags(remote);

    return tags.some((tag) => {
      const version = semver.valid(tag);
      return version !== null && semver.gt(version, currentVersion);
    })
      ? "available"
      : "current";
  } catch {
    return "unknown";
  }
}

async function queryRemoteTags(remote) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-remote", "--tags", "--refs", remote],
    {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
      maxBuffer: 1024 * 1024,
      timeout: REMOTE_TIMEOUT_MS,
    },
  );

  return stdout
    .split("\n")
    .map((line) => line.match(/\trefs\/tags\/(.+)$/u)?.[1])
    .filter((tag) => tag !== undefined);
}

function getRemoteFromSource(source) {
  if (typeof source !== "string" || !FULL_GIT_COMMIT.test(source)) {
    throw new Error("xui Git source is unavailable");
  }

  const sourceWithoutCommit = source.slice(0, source.lastIndexOf("#"));

  if (sourceWithoutCommit.startsWith("github:")) {
    const repository = sourceWithoutCommit.slice("github:".length);

    if (!/^[0-9A-Za-z_.-]+\/[0-9A-Za-z_.-]+(?:\.git)?$/u.test(repository)) {
      throw new Error("xui GitHub source is invalid");
    }

    const repositoryPath = repository.endsWith(".git")
      ? repository.slice(0, -4)
      : repository;
    return `https://github.com/${repositoryPath}.git`;
  }

  const remote = sourceWithoutCommit.startsWith("git+")
    ? sourceWithoutCommit.slice("git+".length)
    : sourceWithoutCommit;
  const protocol = new URL(remote).protocol;

  if (!SUPPORTED_PROTOCOLS.has(protocol)) {
    throw new Error("xui Git source protocol is unsupported");
  }

  return remote;
}
