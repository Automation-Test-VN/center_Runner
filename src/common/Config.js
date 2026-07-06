import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class Config {
  constructor() {
    this.host = process.env.CENTER_RUNNER_HOST || '0.0.0.0';
    this.port = Number(process.env.CENTER_RUNNER_PORT || process.env.PORT || 4317);
    
    // Test repo path setup
    const defaultTestRepoRoot = path.resolve(__dirname, '..', '..', '..', 'TS_PW_FBC');
    this.testRepoRoot = path.resolve(process.env.CENTER_RUNNER_TEST_REPO || defaultTestRepoRoot);
    
    // Directories for jobs & results
    const defaultJobsDir = path.resolve(__dirname, '..', '..', 'jobs');
    this.jobsDir = path.resolve(process.env.CENTER_RUNNER_JOBS_DIR || defaultJobsDir);
    this.publicDir = path.resolve(__dirname, '..', '..', 'public');
    
    this.queuedJobsDir = path.join(this.jobsDir, 'queue');
    this.runningJobsDir = path.join(this.jobsDir, 'running');
    this.jobResultsDir = path.join(this.jobsDir, 'results');
    
    // File paths
    this.latestCommandFile = path.join(this.jobsDir, 'latest-command.json');
    this.latestJobFile = path.join(this.jobsDir, 'latest-job.json');
    this.latestResultFile = path.join(this.jobsDir, 'latest-result.json');
    
    // Target test directories
    this.testsDir = path.join(this.testRepoRoot, 'tests');
    this.testResultsDir = path.join(this.testRepoRoot, 'test-results');
    
    // Other settings
    this.workerWaitTimeoutMs = Number(process.env.CENTER_RUNNER_WORKER_TIMEOUT_MS || 60000);
    this.testScriptRelativePath = process.env.CENTER_RUNNER_TEST_SCRIPT || 'scripts/run-domain-test.mjs';
    this.defaultTag = process.env.CENTER_RUNNER_DEFAULT_TAG || '@smoke';
  }

  get testScriptPath() {
    return path.join(this.testRepoRoot, this.testScriptRelativePath);
  }
}

// Singleton instance
const config = new Config();
export default config;
export { Config };
