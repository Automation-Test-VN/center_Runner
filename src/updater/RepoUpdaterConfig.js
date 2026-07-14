import path from 'node:path';
import { fileURLToPath } from 'node:url';

class RepoUpdaterConfig {
  constructor(rawArgs = []) {
    this.rootDir = this.resolveRootDir();
    this.jobsDir = path.join(this.rootDir, 'jobs');
    this.runningJobsDir = path.join(this.jobsDir, 'running');
    this.lockPath = path.join(this.jobsDir, 'repo-updater.lock');

    this.defaultTestRepoRoot = path.resolve(this.rootDir, '..', 'TS_PW_FBC');
    this.testRepoRoot = path.resolve(
        process.env.CENTER_RUNNER_TEST_REPO ||
        process.env.TEST_REPO_ROOT ||
        this.defaultTestRepoRoot
    );

    this.pollIntervalMs = Number(process.env.CENTER_RUNNER_UPDATE_POLL_MS || 30000);
    this.once = false;

    this.parseArgs(rawArgs);
    this.validate();
  }

  resolveRootDir() {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);

    return path.resolve(currentDir, '..', '..');
  }

  parseArgs(rawArgs) {
    for (let index = 0; index < rawArgs.length; index += 1) {
      const arg = rawArgs[index];

      const next = () => {
        const value = rawArgs[index + 1];

        if (!value || value.startsWith('--')) {
          throw new Error(`Missing value for ${arg}`);
        }

        index += 1;
        return value;
      };

      if (arg === '--poll-ms') {
        this.pollIntervalMs = Number(next());
        continue;
      }

      if (arg.startsWith('--poll-ms=')) {
        this.pollIntervalMs = Number(arg.slice('--poll-ms='.length));
        continue;
      }

      if (arg === '--once') {
        this.once = true;
        continue;
      }

      if (arg === '--help' || arg === '-h') {
        this.printUsage();
        process.exit(0);
      }

      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  validate() {
    if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 5000) {
      throw new Error('poll-ms must be at least 5000.');
    }
  }

  printUsage() {
    console.log(`
Usage:
  npm run update-test-repo -- [--once] [--poll-ms 30000]

Pulls the test repo (TEST_REPO_ROOT) with "git pull --ff-only" whenever no
job is currently running, so the checkout never changes underneath a
running Playwright test.
`.trim());
  }
}

export default RepoUpdaterConfig;
