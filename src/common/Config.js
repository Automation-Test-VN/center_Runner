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

  workerWaitTimeoutMs: Number(process.env.CENTER_RUNNER_WORKER_WAIT_TIMEOUT_MS || 60000)
};

export default config;
