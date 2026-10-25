import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");
const SETTINGS_PATH = path.join(PROJECT_DIR, "settings.json");
const PACKAGE_PATH = path.join(PROJECT_DIR, "package.json");
const BACKUP_RETENTION = 5;
const PROCESS_TIMEOUT_MS = 5 * 60 * 1000;

const PREFIX = {
  INFO: "[INFO]",
  WARN: "[WARN]",
  ERROR: "[ERROR]",
};

function log(level, message) {
  console.log(`${PREFIX[level] ?? PREFIX.INFO} ${message}`);
}

function redact(value, repository = "") {
  let text = String(value ?? "");
  if (repository) text = text.split(repository).join("[repository]");
  return text.replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[credentials]@");
}

function run(command, args, {
  cwd = PROJECT_DIR,
  timeout = PROCESS_TIMEOUT_MS,
  allowFailure = false,
  repository = "",
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error || (result.status !== 0 && !allowFailure)) {
    const output = redact(result.stderr || result.stdout || result.error?.message, repository)
      .trim()
      .slice(-1600);
    const reason = result.error?.message || output || `exit code ${result.status}`;
    throw new Error(`${command} failed: ${reason}`);
  }

  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function readConfiguration() {
  let packageJson;
  let settings;

  try {
    packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Could not read package.json/settings.json: ${error.message}`);
  }

  const updater = settings.updater;
  if (!updater || typeof updater !== "object" || Array.isArray(updater)) {
    throw new Error("Missing or invalid 'updater' configuration in settings.json.");
  }
  if (typeof updater.repository !== "string" || !updater.repository.trim()) {
    throw new Error("Missing or invalid 'updater.repository' in settings.json.");
  }
  if (typeof updater.branch !== "string" || !updater.branch.trim()) {
    throw new Error("Missing or invalid 'updater.branch' in settings.json.");
  }
  if (!Array.isArray(updater.preserve) ||
      updater.preserve.some((entry) => typeof entry !== "string")) {
    throw new Error("'updater.preserve' must be an array of relative paths.");
  }
  if (typeof updater.backup !== "string" || !updater.backup.trim()) {
    throw new Error("Missing or invalid 'updater.backup' in settings.json.");
  }

  const repository = updater.repository.trim();
  if (!/^https?:\/\/\S+$/i.test(repository) &&
      !/^ssh:\/\/\S+$/i.test(repository) &&
      !/^git@[^:\s]+:\S+$/i.test(repository)) {
    throw new Error("'updater.repository' must be an HTTPS, SSH, or git@ repository URL.");
  }

  const resolveProjectPath = (entry, label) => {
    if (path.isAbsolute(entry) || !entry.trim()) {
      throw new Error(`'${label}' paths must be non-empty and relative to the project.`);
    }
    const resolved = path.resolve(PROJECT_DIR, entry);
    if (resolved === PROJECT_DIR || !resolved.startsWith(`${PROJECT_DIR}${path.sep}`)) {
      throw new Error(`'${label}' path escapes the project directory: ${entry}`);
    }
    return resolved;
  };

  const preservePaths = [...new Set(updater.preserve.map((entry) => {
    resolveProjectPath(entry, "updater.preserve");
    return entry;
  }))];
  const backupDir = resolveProjectPath(updater.backup, "updater.backup");
  const retention = updater.keepBackups ?? BACKUP_RETENTION;
  if (!Number.isInteger(retention) || retention < 1 || retention > 50) {
    throw new Error("'updater.keepBackups' must be an integer between 1 and 50.");
  }

  return {
    name: packageJson.name || "bot-updater",
    version: packageJson.version || "unknown",
    repository,
    branch: updater.branch.trim(),
    preservePaths,
    backupDir,
    retention,
  };
}

function validateGitRepository(repository, branch) {
  const root = run("git", ["rev-parse", "--show-toplevel"]).stdout.trim();
  if (path.resolve(root) !== PROJECT_DIR) {
    throw new Error(`Run the updater from the project Git root (${PROJECT_DIR}).`);
  }
  run("git", ["check-ref-format", "--branch", branch]);
  return run("git", ["rev-parse", "HEAD"]).stdout.trim();
}

function isInsideOrSame(relativePath, allowedPath) {
  const normalizedPath = path.normalize(relativePath);
  const normalizedAllowed = path.normalize(allowedPath);
  return normalizedPath === normalizedAllowed ||
    normalizedPath.startsWith(`${normalizedAllowed}${path.sep}`);
}

function getDirtyPaths() {
  const status = run("git", [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]).stdout;
  const entries = status.split("\0").filter(Boolean);
  const paths = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    paths.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2)) && entries[index + 1]) {
      paths.push(entries[index + 1]);
      index += 1;
    }
  }
  return paths;
}

function assertSafeWorkingTree(config) {
  const preserve = config.preservePaths.map((entry) => path.normalize(entry));
  const backupRelative = path.normalize(path.relative(PROJECT_DIR, config.backupDir));
  const unsafePaths = getDirtyPaths().filter((entry) => {
    const relativePath = path.normalize(entry);
    return !preserve.some((allowed) => isInsideOrSame(relativePath, allowed)) &&
      !isInsideOrSame(relativePath, backupRelative);
  });

  if (unsafePaths.length) {
    const shown = unsafePaths.slice(0, 8).join(", ");
    const remaining = unsafePaths.length > 8 ? ` and ${unsafePaths.length - 8} more` : "";
    throw new Error(
      `Update stopped to protect local changes: ${shown}${remaining}. ` +
      "Commit or move these changes, then try again."
    );
  }
}

function makeBackup(config, fromCommit, toCommit) {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(config.backupDir, `update-${timestamp}-${fromCommit.slice(0, 7)}`);
  fs.mkdirSync(backupPath, { recursive: false });

  const preserved = [];
  for (const entry of config.preservePaths) {
    const source = path.resolve(PROJECT_DIR, entry);
    if (!fs.existsSync(source)) continue;

    const destination = path.join(backupPath, entry);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    preserved.push(entry);
    log("INFO", `Saved local ${entry} in the update backup.`);
  }

  fs.writeFileSync(path.join(backupPath, "manifest.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    fromCommit,
    toCommit,
    preservedPaths: preserved,
  }, null, 2) + "\n", "utf8");

  return { backupPath, preserved };
}

function restorePreserved(backupPath, preserved) {
  for (const entry of preserved) {
    const source = path.join(backupPath, entry);
    const destination = path.resolve(PROJECT_DIR, entry);
    if (!fs.existsSync(source)) continue;

    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    log("INFO", `Restored local ${entry}.`);
  }
}

function pruneBackups(config) {
  const directories = fs.readdirSync(config.backupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("update-"))
    .map((entry) => ({
      name: entry.name,
      path: path.join(config.backupDir, entry.name),
      modifiedAt: fs.statSync(path.join(config.backupDir, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  for (const outdated of directories.slice(config.retention)) {
    fs.rmSync(outdated.path, { recursive: true, force: true });
    log("INFO", `Removed expired backup ${outdated.name}.`);
  }
}

export async function updateBot({ dryRun = false } = {}) {
  const config = readConfiguration();
  log("INFO", `Starting ${config.name} updater (version ${config.version}).`);

  const previousCommit = validateGitRepository(config.repository, config.branch);
  assertSafeWorkingTree(config);
  log("INFO", `Fetching ${config.branch} from the configured repository...`);

  run("git", ["fetch", "--no-tags", config.repository, config.branch], {
    repository: config.repository,
  });
  const targetCommit = run("git", ["rev-parse", "FETCH_HEAD"]).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(targetCommit)) {
    throw new Error("Could not identify the fetched commit.");
  }

  if (targetCommit === previousCommit) {
    log("INFO", "The project is already up to date.");
    return { updated: false, from: previousCommit, to: targetCommit };
  }

  const changes = run("git", [
    "log",
    "--oneline",
    "--no-decorate",
    `${previousCommit}..${targetCommit}`,
  ]).stdout.trim();
  log("INFO", `New remote commit: ${targetCommit.slice(0, 12)}.`);
  if (changes) log("INFO", `Incoming changes:\n${changes}`);
  if (dryRun) {
    log("INFO", "Dry run complete; no project files were changed.");
    return { updated: false, dryRun: true, from: previousCommit, to: targetCommit };
  }

  const backup = makeBackup(config, previousCommit, targetCommit);
  let resetStarted = false;
  let dependenciesChanged = false;

  try {
    resetStarted = true;
    run("git", ["reset", "--hard", targetCommit]);
    restorePreserved(backup.backupPath, backup.preserved);

    const dependencyFiles = run("git", [
      "diff",
      "--name-only",
      previousCommit,
      targetCommit,
      "--",
      "package.json",
    ]).stdout.trim();
    dependenciesChanged = Boolean(dependencyFiles);

    if (dependenciesChanged) {
      log("INFO", "Dependency manifests changed; installing dependencies...");
      run("npm", [
        "install",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
      ], { timeout: PROCESS_TIMEOUT_MS });
    } else {
      log("INFO", "Dependency manifests are unchanged; skipping npm install.");
    }

    try {
      pruneBackups(config);
    } catch (error) {
      log("WARN", `Could not clean old backups: ${error.message}`);
    }

    log("INFO", `Update completed successfully. Backup: ${path.relative(PROJECT_DIR, backup.backupPath)}`);
    return { updated: true, from: previousCommit, to: targetCommit, backup: backup.backupPath };
  } catch (error) {
    log("ERROR", `Update failed: ${error.message}`);
    if (resetStarted) {
      try {
        log("WARN", "Rolling back to the previous commit...");
        run("git", ["reset", "--hard", previousCommit]);
        restorePreserved(backup.backupPath, backup.preserved);
        if (dependenciesChanged) {
          run("npm", [
            "install",
            "--no-audit",
            "--no-fund",
            "--package-lock=false",
          ], { timeout: PROCESS_TIMEOUT_MS });
        }
        log("INFO", "Rollback completed.");
      } catch (rollbackError) {
        log("ERROR", `Rollback also failed: ${rollbackError.message}`);
        throw new Error(`${error.message}; rollback failed: ${rollbackError.message}`);
      }
    }
    throw error;
  }
}

function printHelp() {
  console.log([
    "Usage: node core/update.js [--dry-run]",
    "",
    "Options:",
    "  --dry-run  Fetch and show incoming commits without changing project files",
    "  --help     Show this help",
  ].join("\n"));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    printHelp();
  } else if (args.some((argument) => argument !== "--dry-run")) {
    printHelp();
    process.exitCode = 2;
  } else {
    updateBot({ dryRun: args.includes("--dry-run") }).catch((error) => {
      log("ERROR", error.message);
      process.exitCode = 1;
    });
  }
}
