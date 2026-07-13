import { promises as fs } from 'node:fs';
import path from 'node:path';
import config from '../common/Config.js';
import { ALIVE_DAILY_TOOL, CHECK_ACCESS_TOOL, createJobIdForTool, formatJobStamp, isValidJobFileName, isValidJobId, resolveReportUrl } from '../common/JobId.js';

class JobManager {
  async addJob(payload) {
    await this.ensureJobDirs();

    const job = this.buildJob(payload);
    const duplicateJob = await this.findActiveDuplicateJob(job.command);

    if (duplicateJob) {
      const commandName = job.command.tool === CHECK_ACCESS_TOOL
        ? 'Check Access'
        : `${job.command.group}/${job.command.brand}`;
      throw new Error(`${commandName} is already ${duplicateJob.status}.`);
    }

    await this.writeJsonFile(this.queueJobPath(job), job);
    await this.writeJsonFile(config.latestCommandFile, job.command);
    await this.writeJsonFile(config.latestJobFile, job);
    await this.writeJobStatus(job);

    return job;
  }

  buildJob(payload) {
    const tool = String(payload.tool || '').trim();
    const group = String(payload.group || '').trim().toLowerCase();
    const brand = String(payload.brand || '').trim().toLowerCase();
    const tag = tool === CHECK_ACCESS_TOOL ? '@checkAccess' : '@smoke';

    if (![ALIVE_DAILY_TOOL, CHECK_ACCESS_TOOL].includes(tool)) {
      throw new Error('Unsupported tool.');
    }

    if (tool === ALIVE_DAILY_TOOL && !/^fbc\d+$/.test(group)) {
      throw new Error('Group must use the fbc number format, for example fbc1.');
    }

    if (tool === ALIVE_DAILY_TOOL && !/^[a-z0-9-]+$/.test(brand)) {
      throw new Error('Brand must contain only lowercase letters, numbers, and hyphens.');
    }

    if (!/^@[A-Za-z0-9_-]+$/.test(tag)) {
      throw new Error('Tag must start with @ and contain only letters, numbers, underscore, or hyphen.');
    }

    const now = new Date();
    const jobId = createJobIdForTool(tool, { brand, date: now });
    const command = tool === CHECK_ACCESS_TOOL
      ? { tool, tag }
      : { tool, group, brand, tag };

    return {
      jobId,
      createdAt: now.toISOString(),
      status: 'QUEUED',
      command
    };
  }

  async claimNextJob(workerIp, workerName) {
    await this.ensureJobDirs();

    const entries = await fs.readdir(config.queuedJobsDir, { withFileTypes: true }).catch(() => []);

    const queuedFiles = entries
      .filter((entry) => entry.isFile() && isValidJobFileName(entry.name))
      .map((entry) => entry.name)
      .sort();

    if (queuedFiles.length === 0) {
      return null;
    }

    for (const fileName of queuedFiles) {
      const queuedPath = path.join(config.queuedJobsDir, fileName);
      const runningPath = path.join(config.runningJobsDir, fileName);

      try {
        await fs.rename(queuedPath, runningPath);
      } catch (error) {
        if (['ENOENT', 'EEXIST', 'EPERM'].includes(error?.code)) {
          continue;
        }

        throw error;
      }

      const raw = await fs.readFile(runningPath, 'utf8');
      const job = JSON.parse(raw);

      const runningJob = {
        ...job,
        status: 'RUNNING',
        workerIp: workerIp || job.workerIp || null,
        workerName: workerName || job.workerName || null,
        startedAt: new Date().toISOString()
      };

      await this.writeJsonFile(runningPath, runningJob);
      await this.writeJsonFile(config.latestJobFile, runningJob);
      await this.writeJsonFile(config.latestCommandFile, runningJob.command);
      await this.writeJobStatus(runningJob);

      return runningJob;
    }

    return null;
  }

  async completeJob(payload) {
    const jobId = String(payload.jobId || payload.jobIdentity || '').trim();
    const status = String(payload.status || '').trim().toUpperCase();
    const exitCode = Number(payload.exitCode);

    if (!isValidJobId(jobId)) {
      throw new Error('Invalid jobId.');
    }

    if (!['DONE', 'FAILED'].includes(status)) {
      throw new Error('Invalid job status.');
    }

    if (!Number.isInteger(exitCode)) {
      throw new Error('Invalid exitCode.');
    }

    const existingResult = await this.readJobResult(jobId);
    const runningJob = await this.readJobFile(config.runningJobsDir, jobId);
    const queuedJob = await this.readJobFile(config.queuedJobsDir, jobId);
    const existingJob = runningJob || queuedJob || existingResult || {};

    const command = payload.command || existingJob.command || null;

    if (payload.reportHtml && command?.brand) {
      try {
        const brand = String(command.brand).trim().toLowerCase();
        if (/^[a-z0-9-]+$/.test(brand)) {
          const reportDestDir = path.join(config.testResultsDir, brand, jobId);
          await fs.mkdir(reportDestDir, { recursive: true });
          const reportDestPath = path.join(reportDestDir, 'report.html');
          await fs.writeFile(reportDestPath, payload.reportHtml, 'utf8');
          console.log(`[JobManager] Saved uploaded report for job ${jobId} to ${reportDestPath} (${payload.reportHtml.length} bytes)`);
        }
      } catch (error) {
        console.error(`[JobManager] Failed to save uploaded report: ${error.message}`);
      }
    }

    const result = {
      ...existingResult,
      jobId,
      status,
      exitCode,
      command,
      workerIp: payload.workerIp || existingJob.workerIp || existingResult?.workerIp || null,
      workerName: payload.workerName || existingJob.workerName || existingResult?.workerName || null,
      testRepoRoot: payload.testRepoRoot || existingResult?.testRepoRoot || null,
      createdAt: existingJob.createdAt || existingResult?.createdAt || null,
      startedAt: payload.startedAt || existingJob.startedAt || existingResult?.startedAt || null,
      finishedAt: payload.finishedAt || new Date().toISOString(),
      reportUrl: this.resolveReportUrl(command, jobId)
    };

    await this.ensureJobDirs();
    await this.writeJsonFile(config.latestResultFile, result);
    await this.writeJsonFile(path.join(config.jobResultsDir, `${jobId}.json`), result);
    await this.removeIfExists(path.join(config.runningJobsDir, `${jobId}.json`));
    await this.removeIfExists(path.join(config.queuedJobsDir, `${jobId}.json`));
    await this.syncLatestActiveJob();

    return {
      ok: true,
      result,
      cleared: true
    };
  }

  async abortJob(payload) {
    const jobId = String(payload.jobId || payload.jobIdentity || '').trim();

    if (!isValidJobId(jobId)) {
      throw new Error('Invalid jobId.');
    }

    const existingResult = await this.readJobResult(jobId);
    const runningJob = await this.readJobFile(config.runningJobsDir, jobId);
    const queuedJob = await this.readJobFile(config.queuedJobsDir, jobId);
    const existingJob = runningJob || queuedJob || existingResult || {};

    const command = existingJob.command || null;

    const result = {
      ...existingResult,
      jobId,
      status: 'ABORTED',
      exitCode: null,
      command,
      workerIp: existingJob.workerIp || existingResult?.workerIp || null,
      workerName: existingJob.workerName || existingResult?.workerName || null,
      testRepoRoot: existingJob.testRepoRoot || existingResult?.testRepoRoot || null,
      createdAt: existingJob.createdAt || existingResult?.createdAt || null,
      startedAt: existingJob.startedAt || existingResult?.startedAt || null,
      finishedAt: new Date().toISOString(),
      reportUrl: null
    };

    await this.ensureJobDirs();
    await this.writeJsonFile(config.latestResultFile, result);
    await this.writeJsonFile(path.join(config.jobResultsDir, `${jobId}.json`), result);
    await this.removeIfExists(path.join(config.runningJobsDir, `${jobId}.json`));
    await this.removeIfExists(path.join(config.queuedJobsDir, `${jobId}.json`));
    await this.syncLatestActiveJob();

    return {
      ok: true,
      result,
      cleared: true
    };
  }

  async writeJobStatus(job) {
    const result = {
      jobId: job.jobId,
      status: job.status,
      exitCode: null,
      command: job.command,
      workerIp: job.workerIp || null,
      workerName: job.workerName || null,
      createdAt: job.createdAt || null,
      startedAt: job.startedAt || null,
      finishedAt: null,
      reportUrl: null
    };

    await this.ensureJobDirs();
    await this.writeJsonFile(path.join(config.jobResultsDir, `${job.jobId}.json`), result);
  }

  async readJobResult(jobId) {
    const body = await fs.readFile(path.join(config.jobResultsDir, `${jobId}.json`), 'utf8').catch(() => null);
    return body ? JSON.parse(body) : null;
  }

  async readJobFile(dir, jobId) {
    const body = await fs.readFile(path.join(dir, `${jobId}.json`), 'utf8').catch(() => null);
    return body ? JSON.parse(body) : null;
  }

  async listJobs() {
    await this.ensureJobDirs();

    const entries = await fs.readdir(config.jobResultsDir, { withFileTypes: true }).catch(() => []);
    const activeJobs = await this.listActiveJobs();
    const activeJobIds = new Set(activeJobs.map((job) => job.jobId));
    const jobs = [];

    for (const entry of entries) {
      if (!entry.isFile() || !isValidJobFileName(entry.name)) {
        continue;
      }

      const body = await fs.readFile(path.join(config.jobResultsDir, entry.name), 'utf8').catch(() => null);
      if (!body) {
        continue;
      }

      const job = JSON.parse(body);

      jobs.push({
        ...job,
        active: activeJobIds.has(job.jobId)
      });
    }

    return jobs.sort((a, b) => {
      const left = Date.parse(a.finishedAt || a.startedAt || a.createdAt || '') || 0;
      const right = Date.parse(b.finishedAt || b.startedAt || b.createdAt || '') || 0;
      return right - left;
    });
  }

  async readLatestActiveJob() {
    const activeJobs = await this.listActiveJobs();
    return activeJobs[0] || null;
  }

  async syncLatestActiveJob() {
    const activeJob = await this.readLatestActiveJob();

    if (!activeJob) {
      await this.removeIfExists(config.latestJobFile);
      await this.removeIfExists(config.latestCommandFile);
      return;
    }

    await this.writeJsonFile(config.latestJobFile, {
      jobId: activeJob.jobId,
      createdAt: activeJob.createdAt || null,
      startedAt: activeJob.startedAt || null,
      status: activeJob.status,
      command: activeJob.command,
      workerIp: activeJob.workerIp || null,
      workerName: activeJob.workerName || null
    });

    await this.writeJsonFile(config.latestCommandFile, activeJob.command);
  }

  async findActiveDuplicateJob(command) {
    const activeJobs = await this.listActiveJobs();
    return activeJobs.find((job) => this.commandsEqual(job.command, command)) || null;
  }

  async listActiveJobs() {
    await this.ensureJobDirs();

    const jobs = [];

    for (const dir of [config.runningJobsDir, config.queuedJobsDir]) {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        if (!entry.isFile() || !isValidJobFileName(entry.name)) {
          continue;
        }

        const body = await fs.readFile(path.join(dir, entry.name), 'utf8').catch(() => null);
        if (!body) {
          continue;
        }

        jobs.push(JSON.parse(body));
      }
    }

    return jobs.sort((a, b) => {
      const left = Date.parse(a.startedAt || a.createdAt || '') || 0;
      const right = Date.parse(b.startedAt || b.createdAt || '') || 0;
      return right - left;
    });
  }

  commandsEqual(left, right) {
    if (left?.tool !== right?.tool || left?.tag !== right?.tag) {
      return false;
    }

    return left.tool === CHECK_ACCESS_TOOL
      || (left?.group === right?.group && left?.brand === right?.brand);
  }

  queueJobPath(job) {
    return path.join(config.queuedJobsDir, `${job.jobId}.json`);
  }

  async ensureJobDirs() {
    await Promise.all([
      fs.mkdir(config.jobsDir, { recursive: true }),
      fs.mkdir(config.queuedJobsDir, { recursive: true }),
      fs.mkdir(config.runningJobsDir, { recursive: true }),
      fs.mkdir(config.jobResultsDir, { recursive: true })
    ]);
  }

  async writeJsonFile(filePath, payload) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  }

  async removeIfExists(filePath) {
    await fs.unlink(filePath).catch((error) => {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    });
  }

  resolveReportUrl(command, jobId = '') {
    return resolveReportUrl(command, jobId);
  }

  async clearHistory() {
    await this.ensureJobDirs();

    const activeJobs = await this.listActiveJobs();
    const activeJobIds = new Set(activeJobs.map((job) => job.jobId));

    const entries = await fs.readdir(config.jobResultsDir, { withFileTypes: true }).catch(() => []);
    let deletedCount = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !isValidJobFileName(entry.name)) {
        continue;
      }

      const jobId = entry.name.replace('.json', '');

      // Skip jobs that are still active (QUEUED or RUNNING)
      if (activeJobIds.has(jobId)) {
        continue;
      }

      await this.removeIfExists(path.join(config.jobResultsDir, entry.name));
      deletedCount++;
    }

    return { ok: true, deletedCount };
  }

  formatJobStamp(date) {
    return formatJobStamp(date);
  }
}

export default JobManager;
