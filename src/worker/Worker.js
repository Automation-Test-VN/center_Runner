import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

class Worker {
  constructor(config) {
    this.config = config;
  }

  async start() {
    await fsp.mkdir(this.config.jobsDir, { recursive: true });

    this.logStartupInfo();

    if (this.config.once) {
      const processed = await this.processLatestCommand();
      process.exit(processed ? 0 : 2);
    }

    console.log('[CenterWorker] Waiting for jobs...');

    for (;;) {
      try {
        await this.processLatestCommand();
      } catch (error) {
        console.error(`[CenterWorker] ${error instanceof Error ? error.message : String(error)}`);
      }

      await this.delay(this.config.intervalMs);
    }
  }

  logStartupInfo() {
    console.log(`[CenterWorker] Worker name: ${this.config.workerName}`);
    console.log(`[CenterWorker] Worker IP: ${this.config.workerIp}`);
    console.log(`[CenterWorker] Test repo: ${this.config.testRepoRoot}`);
    console.log(`[CenterWorker] Source: ${this.config.source}`);
    console.log(`[CenterWorker] State file: ${this.config.stateFile}`);
    console.log(`[CenterWorker] Result file: ${this.config.resultFile}`);
    console.log(`[CenterWorker] Interval: ${this.config.intervalMs}ms`);
  }

  async processLatestCommand() {
    const job = await this.readJob(this.config.source);

    if (!job) {
      console.log('[CenterWorker] No queued job.');
      return false;
    }

    const previousIdentity = await this.readPreviousIdentity(this.config.stateFile);

    if (previousIdentity === job.identity) {
      console.log(`[CenterWorker] Skip already processed job: ${job.identity}`);
      return false;
    }

    if (this.config.dryRun) {
      const runner = this.buildRunner(job.command);
      console.log(`[CenterWorker] Dry run: ${runner.command} ${runner.args.join(' ')}`);
      console.log(`[CenterWorker] Job: ${job.identity}`);
      console.log(`[CenterWorker] Command: ${JSON.stringify(job.command)}`);
      return true;
    }

    return this.runJob(job);
  }

  async runJob(job) {
    const startedAt = new Date().toISOString();

    let runner = null;

    try {
      runner = this.buildRunner(job.command);
    } catch (error) {
      const failedResult = {
        jobIdentity: job.identity,
        jobId: job.identity,
        workerIp: this.config.workerIp,
        workerName: this.config.workerName,
        testRepoRoot: this.config.testRepoRoot,
        command: job.command,
        status: 'FAILED',
        exitCode: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      };

      await this.writeJson(this.config.resultFile, failedResult);
      await this.reportCompletion(this.config.source, failedResult);
      await this.writeState(job.identity, failedResult.finishedAt);

      throw error;
    }

    console.log(`[CenterWorker] Claimed job: ${job.identity}`);
    console.log(`[CenterWorker] Running: ${runner.command} ${runner.args.join(' ')}`);

    const result = spawnSync(runner.command, runner.args, {
      cwd: this.config.testRepoRoot,
      env: process.env,
      shell: false,
      stdio: 'inherit'
    });

    const exitCode = result.status ?? 1;
    const status = exitCode === 0 ? 'DONE' : 'FAILED';
    const finishedAt = new Date().toISOString();

    let reportHtml = null;
    try {
      const reportHtmlPath = path.join(this.config.testRepoRoot, 'test-results', job.command.brand, 'report.html');
      if (fs.existsSync(reportHtmlPath)) {
        reportHtml = await fsp.readFile(reportHtmlPath, 'utf8');
        console.log(`[CenterWorker] Successfully read report file: ${reportHtmlPath} (${reportHtml.length} bytes)`);
      } else {
        console.log(`[CenterWorker] Report file not found at: ${reportHtmlPath}`);
      }
    } catch (error) {
      console.error(`[CenterWorker] Error reading report file: ${error.message}`);
    }

    const jobResult = {
      jobIdentity: job.identity,
      jobId: job.identity,
      workerIp: this.config.workerIp,
      workerName: this.config.workerName,
      testRepoRoot: this.config.testRepoRoot,
      command: job.command,
      status,
      exitCode,
      startedAt,
      finishedAt,
      reportHtml
    };

    if (result.error) {
      jobResult.error = result.error.message;
    }

    await this.writeJson(this.config.resultFile, jobResult);
    await this.reportCompletion(this.config.source, jobResult);

    await this.writeState(job.identity, finishedAt);

    if (result.error) {
      throw new Error(`Failed to start runner: ${result.error.message}`);
    }

    console.log(`[CenterWorker] ${status} exitCode=${exitCode}`);
    return true;
  }

  async readJob(source) {
    if (/^https?:\/\//i.test(source)) {
      return this.readRemoteJob(source);
    }

    return this.readLocalJob(source);
  }

  async readRemoteJob(source) {
    const requestUrl = this.buildNextJobUrl(source);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(requestUrl, {
        headers: {
          accept: 'application/json'
        },
        signal: controller.signal
      });

      if (response.status === 204 || response.status === 404) {
        return null;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Cannot read command from ${requestUrl}: HTTP ${response.status} ${body}`);
      }

      const rawJob = await response.json();
      const command = this.normalizeCommand(rawJob);

      return {
        identity: String(rawJob?.jobId || rawJob?.id || this.hashCommand(command)),
        command,
        rawJob
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        return null;
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async readLocalJob(source) {
    const sourcePath = path.resolve(this.config.rootDir, source);

    if (!fs.existsSync(sourcePath)) {
      return null;
    }

    const [raw, stats] = await Promise.all([
      fsp.readFile(sourcePath, 'utf8'),
      fsp.stat(sourcePath)
    ]);

    const rawJob = JSON.parse(raw);
    const command = this.normalizeCommand(rawJob);

    return {
      identity: String(rawJob?.jobId || `${sourcePath}:${stats.mtimeMs}`),
      command,
      rawJob
    };
  }

  async reportCompletion(source, result) {
    if (!/^https?:\/\//i.test(source)) {
      return;
    }

    const completeUrl = new URL('/api/jobs/complete', source).toString();

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

  normalizeCommand(rawCommand) {
    const command = rawCommand?.command && typeof rawCommand.command === 'object'
        ? rawCommand.command
        : rawCommand;

    return {
      tool: String(command?.tool || '').trim(),
      group: String(command?.group || '').trim().toLowerCase(),
      brand: String(command?.brand || '').trim().toLowerCase(),
      tag: String(command?.tag || '@smoke').trim() || '@smoke'
    };
  }

  buildRunner(command) {
    this.validateCommand(command);

    return {
      command: process.execPath,
      args: [
        path.join(this.config.testRepoRoot, 'scripts', 'run-domain-test.mjs'),
        command.group,
        command.brand,
        '--grep',
        command.tag
      ]
    };
  }

  validateCommand(command) {
    if (command.tool !== 'aliveDaily') {
      throw new Error(`Unsupported tool: ${command.tool}`);
    }

    if (!/^fbc\d+$/.test(command.group)) {
      throw new Error(`Invalid group: ${command.group}`);
    }

    if (!/^[a-z0-9-]+$/.test(command.brand)) {
      throw new Error(`Invalid brand: ${command.brand}`);
    }

    if (!/^@[A-Za-z0-9_-]+$/.test(command.tag)) {
      throw new Error(`Invalid tag: ${command.tag}`);
    }

    const testDir = path.join(this.config.testRepoRoot, 'tests', command.group, command.brand);

    if (!fs.existsSync(testDir)) {
      throw new Error(`Test path not found: ${path.relative(this.config.testRepoRoot, testDir)}`);
    }

    const runnerFile = path.join(this.config.testRepoRoot, 'scripts', 'run-domain-test.mjs');

    if (!fs.existsSync(runnerFile)) {
      throw new Error(`Runner file not found: ${path.relative(this.config.testRepoRoot, runnerFile)}`);
    }
  }

  buildNextJobUrl(source) {
    const url = new URL(source);

    if (!url.searchParams.has('workerIp')) {
      url.searchParams.set('workerIp', this.config.workerIp);
    }

    if (!url.searchParams.has('workerName')) {
      url.searchParams.set('workerName', this.config.workerName);
    }

    return url.toString();
  }

  async readPreviousIdentity(stateFile) {
    try {
      const state = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
      return String(state.lastJobIdentity || state.lastCommandHash || '');
    } catch {
      return '';
    }
  }

  async writeState(jobIdentity, updatedAt) {
    await this.writeJson(this.config.stateFile, {
      lastJobIdentity: jobIdentity,
      workerIp: this.config.workerIp,
      workerName: this.config.workerName,
      updatedAt
    });
  }

  async writeJson(filePath, payload) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  hashCommand(command) {
    return createHash('sha256')
        .update(JSON.stringify(command))
        .digest('hex');
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default Worker;
