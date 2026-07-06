import { promises as fsp } from 'node:fs';
import path from 'node:path';
import JobFetcher from './JobFetcher.js';
import JobRunner from './JobRunner.js';

class Worker {
  constructor(workerConfig) {
    this.config = workerConfig;
    this.fetcher = new JobFetcher();
    this.runner = new JobRunner();
  }

  async start() {
    if (this.config.once) {
      const processed = await this.processLatestJob();
      process.exit(processed ? 0 : 2);
    }

    console.log(`[CenterWorker] Waiting for jobs from ${this.config.source}`);

    for (;;) {
      try {
        await this.processLatestJob();
      } catch (error) {
        console.error(`[CenterWorker] Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.delay(this.config.intervalMs);
    }
  }

  async processLatestJob() {
    const job = await this.fetcher.fetchJob(this.config.source);
    if (!job) {
      console.log('[CenterWorker] No queued job.');
      return false;
    }

    const previousIdentity = await this.readPreviousIdentity();
    if (previousIdentity === job.identity) {
      console.log('[CenterWorker] No new command.');
      return false;
    }

    if (this.config.dryRun) {
      this.runner.run(job.command, true);
      console.log(`[CenterWorker] Dry run: job=${job.identity} command=${JSON.stringify(job.command)}`);
      return true;
    }

    const startedAt = new Date().toISOString();
    let exitCode = 1;
    let status = 'FAILED';

    try {
      const runResult = this.runner.run(job.command, false);
      exitCode = runResult.status;
      status = exitCode === 0 ? 'DONE' : 'FAILED';
    } catch (error) {
      console.error(`[CenterWorker] Execution failed: ${error.message}`);
      status = 'FAILED';
    }

    const finishedAt = new Date().toISOString();
    const jobResult = {
      jobIdentity: job.identity,
      jobId: job.identity,
      command: job.command,
      status,
      exitCode,
      startedAt,
      finishedAt
    };

    await this.writeJson(this.config.resultFile, jobResult);
    await this.reportCompletion(jobResult);

    await this.writeJson(this.config.stateFile, {
      lastJobIdentity: job.identity,
      updatedAt: finishedAt
    });

    console.log(`[CenterWorker] ${status} exitCode=${exitCode}`);
    return true;
  }

  async readPreviousIdentity() {
    try {
      const state = JSON.parse(await fsp.readFile(this.config.stateFile, 'utf8'));
      return String(state.lastJobIdentity || state.lastCommandHash || '');
    } catch {
      return '';
    }
  }

  async writeJson(filePath, payload) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  async reportCompletion(result) {
    if (!/^https?:\/\//i.test(this.config.source)) {
      return;
    }

    const completeUrl = new URL('/api/jobs/complete', this.config.source).toString();
    const response = await fetch(completeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify(result)
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cannot report completion to ${completeUrl}: HTTP ${response.status} ${body}`);
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default Worker;
export { Worker };
