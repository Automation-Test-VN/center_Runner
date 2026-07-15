import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');

const defaultTestRepoRoot = path.resolve(rootDir, '..', 'TS_PW_FBC');
const testRepoRoot = path.resolve(process.env.CENTER_RUNNER_TEST_REPO || process.env.TEST_REPO_ROOT || defaultTestRepoRoot);

const jobsDir = path.join(rootDir, 'jobs');

const config = {
  rootDir,
  port: Number(process.env.CENTER_RUNNER_PORT || process.env.PORT || 4317),
  host: process.env.CENTER_RUNNER_HOST || '0.0.0.0',

  publicDir: path.join(rootDir, 'public'),

  testRepoRoot,
  testsDir: path.join(testRepoRoot, 'tests'),
  testResultsDir: path.join(testRepoRoot, 'test-results'),

  jobsDir,
  queuedJobsDir: path.join(jobsDir, 'queue'),
  runningJobsDir: path.join(jobsDir, 'running'),
  jobResultsDir: path.join(jobsDir, 'results'),

  latestCommandFile: path.join(jobsDir, 'latest-command.json'),
  latestJobFile: path.join(jobsDir, 'latest-job.json'),
  latestResultFile: path.join(jobsDir, 'latest-result.json'),

  startWorkersBatPath: path.join(rootDir, 'start-workers.bat'),

  workerWaitTimeoutMs: Number(process.env.CENTER_RUNNER_WORKER_WAIT_TIMEOUT_MS || 60000),

  // A QUEUED job that waits longer than this is marked EXPIRED by the maintenance sweep (for example
  // a checkAccess ISP with no matching worker online). Default 10 minutes.
  queueTtlMs: Number(process.env.CENTER_RUNNER_QUEUE_TTL_MS || 600000),
  // How often the maintenance sweep runs (expire stale queued jobs + prune dead workers). Keep this
  // finer than queueTtlMs so expiry latency stays small.
  maintenanceIntervalMs: Number(process.env.CENTER_RUNNER_MAINTENANCE_INTERVAL_MS || 60000),
  // A worker counts as online if it polled within this window. Must exceed the long-poll hold time
  // so a healthy worker mid-poll is not flagged offline. Default ~2x the 60s poll cycle.
  workerOnlineWindowMs: Number(process.env.CENTER_RUNNER_WORKER_ONLINE_WINDOW_MS || 130000),
  // Drop a worker from the roster entirely after it has been silent this long. Default 1 day.
  workerRetentionMs: Number(process.env.CENTER_RUNNER_WORKER_RETENTION_MS || 86400000)
};

export default config;
