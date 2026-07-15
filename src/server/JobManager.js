import { promises as fs } from 'node:fs';
import path from 'node:path';
import config from '../common/Config.js';
import { ALIVE_DAILY_TOOL, CHECK_ACCESS_TOOL, appendIspTag, createCheckAccessBaseId, createJobIdForTool, formatJobStamp, isValidJobFileName, isValidJobId, isValidReportJobId, normalizeIspTag, resolveReportNamespace, resolveReportUrl } from '../common/JobId.js';

class JobManager {
  async addJob(payload) {
    await this.ensureJobDirs();

    // One Start may create several jobs: aliveDaily -> 1 job; checkAccess -> one job per selected
    // ISP (all sharing a base id). Reject the whole batch if any of the jobs duplicates an active one.
    const jobs = this.buildJobs(payload);

    for (const job of jobs) {
      const duplicateJob = await this.findActiveDuplicateJob(job.command);

      if (duplicateJob) {
        throw new Error(`${this.describeCommand(job.command)} is already ${duplicateJob.status}.`);
      }
    }

    for (const job of jobs) {
      await this.writeJsonFile(this.queueJobPath(job), job);
      await this.writeJobStatus(job);
    }

    const latest = jobs[jobs.length - 1];
    await this.writeJsonFile(config.latestCommandFile, latest.command);
    await this.writeJsonFile(config.latestJobFile, latest);

    return jobs;
  }

  buildJobs(payload) {
    const tool = String(payload.tool || '').trim();

    if (![ALIVE_DAILY_TOOL, CHECK_ACCESS_TOOL].includes(tool)) {
      throw new Error('Unsupported tool.');
    }

    const now = new Date();

    if (tool === CHECK_ACCESS_TOOL) {
      return this.buildCheckAccessJobs(payload, now);
    }

    return [this.buildAliveDailyJob(payload, now)];
  }

  buildCheckAccessJobs(payload, now) {
    const isps = this.normalizeIspList(payload.isps ?? payload.isp);

    if (isps.length === 0) {
      throw new Error('Select at least one ISP (nhà mạng) for Check Access.');
    }

    const baseId = createCheckAccessBaseId(now);

    return isps.map((isp) => ({
      jobId: appendIspTag(baseId, isp),
      createdAt: now.toISOString(),
      status: 'QUEUED',
      command: { tool: CHECK_ACCESS_TOOL, tag: '@checkAccess', isp }
    }));
  }

  buildAliveDailyJob(payload, now) {
    const group = String(payload.group || '').trim().toLowerCase();
    const brand = String(payload.brand || '').trim().toLowerCase();

    if (!/^fbc\d+$/.test(group)) {
      throw new Error('Group must use the fbc number format, for example fbc1.');
    }

    if (!/^[a-z0-9-]+$/.test(brand)) {
      throw new Error('Brand must contain only lowercase letters, numbers, and hyphens.');
    }

    return {
      jobId: createJobIdForTool(ALIVE_DAILY_TOOL, { brand, date: now }),
      createdAt: now.toISOString(),
      status: 'QUEUED',
      command: { tool: ALIVE_DAILY_TOOL, group, brand, tag: '@smoke' }
    };
  }

  normalizeIspList(raw) {
    const values = Array.isArray(raw) ? raw : (raw != null ? [raw] : []);
    const seen = new Set();
    const isps = [];

    for (const value of values) {
      const isp = normalizeIspTag(value);

      if (!isp || seen.has(isp)) {
        continue;
      }

      seen.add(isp);
      isps.push(isp);
    }

    return isps;
  }

  describeCommand(command) {
    if (command.tool === CHECK_ACCESS_TOOL) {
      return `Check Access (${normalizeIspTag(command.isp) || '?'})`;
    }

    return `${command.group}/${command.brand}`;
  }

  async claimNextJob(workerIp, workerName, workerIsp = '') {
    await this.ensureJobDirs();

    const entries = await fs.readdir(config.queuedJobsDir, { withFileTypes: true }).catch(() => []);

    const fileNames = entries
      .filter((entry) => entry.isFile() && isValidJobFileName(entry.name))
      .map((entry) => entry.name);

    if (fileNames.length === 0) {
      return null;
    }

    const queuedFiles = await this.sortQueuedFilesByCreatedAt(fileNames);

    for (const { fileName, command } of queuedFiles) {
      // ISP routing: aliveDaily runs on any worker; checkAccess only on the worker whose ISP matches.
      if (!this.workerCanRun(command, workerIsp)) {
        continue;
      }

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

  // aliveDaily (no ISP) may be claimed by any worker; a checkAccess job is bound to its ISP and can
  // only be claimed by a worker configured with the same WORKER_ISP. A worker with no ISP set can
  // therefore only run aliveDaily.
  workerCanRun(command, workerIsp) {
    if (command?.tool !== CHECK_ACCESS_TOOL) {
      return true;
    }

    const own = normalizeIspTag(workerIsp);
    return own !== '' && own === normalizeIspTag(command?.isp);
  }

  async sortQueuedFilesByCreatedAt(fileNames) {
    const withMeta = await Promise.all(fileNames.map(async (fileName) => {
      let createdAtMs = 0;
      let command = null;

      try {
        const parsed = JSON.parse(await fs.readFile(path.join(config.queuedJobsDir, fileName), 'utf8'));
        createdAtMs = Date.parse(parsed?.createdAt || '') || 0;
        command = parsed?.command || null;
      } catch {
        createdAtMs = 0;
      }

      return { fileName, createdAtMs, command };
    }));

    return withMeta
      .sort((a, b) => a.createdAtMs - b.createdAtMs || a.fileName.localeCompare(b.fileName));
  }

  async completeJob(payload) {
    const jobId = String(payload.jobId || payload.jobIdentity || '').trim();
    const status = String(payload.status || '').trim().toUpperCase();
    const exitCode = Number(payload.exitCode);

    if (!isValidJobId(jobId)) {
      throw new Error('Invalid jobId.');
    }

    // reportJobId may carry an ISP suffix (checkAccess only) appended by the worker that
    // ran the job. It is only ever used to locate/build the report; the canonical jobId
    // above remains the queue/running/result file identity.
    const rawReportJobId = String(payload.reportJobId || '').trim();
    const reportJobId = isValidReportJobId(rawReportJobId) ? rawReportJobId : jobId;

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
    const reportNamespace = resolveReportNamespace(command);

    if (payload.reportHtml && reportNamespace) {
      try {
        const reportDestDir = path.join(config.testResultsDir, reportNamespace, reportJobId);
        await fs.mkdir(reportDestDir, { recursive: true });
        const reportDestPath = path.join(reportDestDir, 'report.html');
        await fs.writeFile(reportDestPath, payload.reportHtml, 'utf8');
        console.log(`[JobManager] Saved uploaded report for job ${jobId} to ${reportDestPath} (${payload.reportHtml.length} bytes)`);
      } catch (error) {
        console.error(`[JobManager] Failed to save uploaded report: ${error.message}`);
      }
    }

    const result = {
      ...existingResult,
      jobId,
      reportJobId,
      status,
      exitCode,
      command,
      workerIp: payload.workerIp || existingJob.workerIp || existingResult?.workerIp || null,
      workerName: payload.workerName || existingJob.workerName || existingResult?.workerName || null,
      testRepoRoot: payload.testRepoRoot || existingResult?.testRepoRoot || null,
      createdAt: existingJob.createdAt || existingResult?.createdAt || null,
      startedAt: payload.startedAt || existingJob.startedAt || existingResult?.startedAt || null,
      finishedAt: payload.finishedAt || new Date().toISOString(),
      reportUrl: this.resolveReportUrl(command, reportJobId)
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

  async listRunningWorkerNames() {
    const activeJobs = await this.listActiveJobs();
    const names = new Set();

    for (const job of activeJobs) {
      if (job.status === 'RUNNING' && job.workerName) {
        names.add(job.workerName);
      }
    }

    return names;
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

    if (left.tool === CHECK_ACCESS_TOOL) {
      return normalizeIspTag(left?.isp) === normalizeIspTag(right?.isp);
    }

    return left?.group === right?.group && left?.brand === right?.brand;
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

  // Sweep the queue and terminate jobs that have waited longer than ttlMs (for example a checkAccess
  // ISP with no matching worker online). Claiming is the same atomic fs.rename used by workers, so a
  // job a worker grabs at the same instant is never double-handled.
  async expireStaleQueuedJobs(ttlMs) {
    await this.ensureJobDirs();

    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      return { expiredCount: 0 };
    }

    const now = Date.now();
    const entries = await fs.readdir(config.queuedJobsDir, { withFileTypes: true }).catch(() => []);
    let expiredCount = 0;

    for (const entry of entries) {
      if (!entry.isFile() || !isValidJobFileName(entry.name)) {
        continue;
      }

      const queuedPath = path.join(config.queuedJobsDir, entry.name);
      const body = await fs.readFile(queuedPath, 'utf8').catch(() => null);

      if (!body) {
        continue;
      }

      const job = JSON.parse(body);
      const createdAtMs = Date.parse(job?.createdAt || '') || 0;

      if (createdAtMs === 0 || now - createdAtMs <= ttlMs) {
        continue;
      }

      const runningPath = path.join(config.runningJobsDir, entry.name);

      try {
        await fs.rename(queuedPath, runningPath);
      } catch (error) {
        if (['ENOENT', 'EEXIST', 'EPERM'].includes(error?.code)) {
          continue;
        }

        throw error;
      }

      await this.expireOwnedJob(job, runningPath);
      expiredCount += 1;
    }

    if (expiredCount > 0) {
      await this.syncLatestActiveJob();
    }

    return { expiredCount };
  }

  async expireOwnedJob(job, ownedPath) {
    const jobId = job.jobId;

    const result = {
      jobId,
      reportJobId: jobId,
      status: 'EXPIRED',
      exitCode: null,
      command: job.command || null,
      workerIp: null,
      workerName: null,
      testRepoRoot: null,
      createdAt: job.createdAt || null,
      startedAt: null,
      finishedAt: new Date().toISOString(),
      reportUrl: null
    };

    await this.writeJsonFile(config.latestResultFile, result);
    await this.writeJsonFile(path.join(config.jobResultsDir, `${jobId}.json`), result);
    await this.removeIfExists(ownedPath);
    await this.removeIfExists(path.join(config.queuedJobsDir, `${jobId}.json`));

    console.log(`[JobManager] Expired queued job ${jobId} after exceeding queue TTL.`);
  }

  formatJobStamp(date) {
    return formatJobStamp(date);
  }
}

export default JobManager;
