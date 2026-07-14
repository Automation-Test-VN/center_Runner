import path from 'node:path';
import { fileURLToPath } from 'node:url';

class WorkerConfig {
  constructor(rawArgs = []) {
    this.rootDir = this.resolveRootDir();
    this.jobsDir = path.join(this.rootDir, 'jobs');

    this.centerRunnerPort = process.env.CENTER_RUNNER_PORT || '4317';
    this.centerRunnerIp = process.env.CENTER_RUNNER_IP || '';

    this.centerRunnerBaseUrl = this.normalizeBaseUrl(
        process.env.CENTER_RUNNER_BASE_URL ||
        process.env.CENTER_RUNNER_URL ||
        (this.centerRunnerIp ? `http://${this.centerRunnerIp}:${this.centerRunnerPort}` : '')
    );

    this.workerIp = process.env.WORKER_IP || '127.0.0.1';
    this.workerName = process.env.WORKER_NAME || `worker-${this.workerIp.replaceAll('.', '-')}`;
    this.workerIsp = String(process.env.WORKER_ISP || '').trim();

    this.safeWorkerName = this.workerName.replace(/[^a-zA-Z0-9_-]/g, '-');

    this.defaultCommandFile = path.join(this.jobsDir, 'latest-command.json');
    this.defaultStateFile = path.join(this.jobsDir, `worker-state-${this.safeWorkerName}.json`);
    this.defaultResultFile = path.join(this.jobsDir, `latest-result-${this.safeWorkerName}.json`);

    this.defaultTestRepoRoot = path.resolve(this.rootDir, '..', 'TS_PW_FBC');
    this.testRepoRoot = path.resolve(
        process.env.CENTER_RUNNER_TEST_REPO ||
        process.env.TEST_REPO_ROOT ||
        this.defaultTestRepoRoot
    );

    this.source = process.env.CENTER_RUNNER_COMMAND_SOURCE || this.getDefaultCommandSource();
    this.stateFile = process.env.CENTER_RUNNER_STATE_FILE || this.defaultStateFile;
    this.resultFile = process.env.CENTER_RUNNER_RESULT_FILE || this.defaultResultFile;
    this.intervalMs = Number(process.env.CENTER_RUNNER_INTERVAL_MS || 5000);
    this.requestTimeoutMs = Number(process.env.CENTER_RUNNER_REQUEST_TIMEOUT_MS || 75000);

    this.once = false;
    this.dryRun = false;

    this.parseArgs(rawArgs);
    this.validate();
  }

  resolveRootDir() {
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFile);

    return path.resolve(currentDir, '..', '..');
  }

  getDefaultCommandSource() {
    if (this.centerRunnerBaseUrl) {
      return `${this.centerRunnerBaseUrl}/api/jobs/next`;
    }

    return this.defaultCommandFile;
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

      if (arg === '--source') {
        this.source = next();
        continue;
      }

      if (arg.startsWith('--source=')) {
        this.source = arg.slice('--source='.length);
        continue;
      }

      if (arg === '--interval-ms') {
        this.intervalMs = Number(next());
        continue;
      }

      if (arg.startsWith('--interval-ms=')) {
        this.intervalMs = Number(arg.slice('--interval-ms='.length));
        continue;
      }

      if (arg === '--request-timeout-ms') {
        this.requestTimeoutMs = Number(next());
        continue;
      }

      if (arg.startsWith('--request-timeout-ms=')) {
        this.requestTimeoutMs = Number(arg.slice('--request-timeout-ms='.length));
        continue;
      }

      if (arg === '--once') {
        this.once = true;
        continue;
      }

      if (arg === '--dry-run') {
        this.dryRun = true;
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
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 1000) {
      throw new Error('interval-ms must be at least 1000.');
    }

    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs < 5000) {
      throw new Error('request-timeout-ms must be at least 5000.');
    }

    if (!this.source) {
      throw new Error('Worker command source is empty.');
    }
  }

  normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  isHttpSource() {
    return /^https?:\/\//i.test(this.source);
  }

  printUsage() {
    console.log(`
Usage:
  npm run worker -- [--once] [--dry-run] [--source <file-or-url>] [--interval-ms 5000] [--request-timeout-ms 75000]

Examples:
  npm run worker -- --once --dry-run
  npm run worker -- --once
  npm run worker -- --source http://100.67.96.22:4317/api/jobs/next
`.trim());
  }
}

export default WorkerConfig;
