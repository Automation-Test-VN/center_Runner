import { promises as fs } from 'node:fs';
import path from 'node:path';
import config from '../common/Config.js';
import Job from '../common/Job.js';

class JobManager {
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

  queueJobPath(job) {
    return path.join(config.queuedJobsDir, `${job.jobId}.json`);
  }

  runningJobPath(jobId) {
    return path.join(config.runningJobsDir, `${jobId}.json`);
  }

  resultJobPath(jobId) {
    return path.join(config.jobResultsDir, `${jobId}.json`);
  }

  commandsEqual(left, right) {
    return left?.tool === right?.tool
      && left?.group === right?.group
      && left?.brand === right?.brand
      && left?.tag === right?.tag;
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
        if (!entry.isFile() || !/^CR-\d{8}-\d{6}-[A-Z0-9]{4}\.json$/.test(entry.name)) {
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

  async addJob(payload) {
    const job = Job.fromPayload(payload, config.defaultTag);
    await this.ensureJobDirs();

    const duplicateJob = await this.findActiveDuplicateJob(job.command);
    if (duplicateJob) {
      throw new Error(`${job.command.group}/${job.command.brand} is already ${duplicateJob.status}.`);
    }

    await this.writeJsonFile(this.queueJobPath(job), job.toActiveJSON());
    await this.writeJsonFile(config.latestCommandFile, job.command);
    await this.writeJsonFile(config.latestJobFile, job.toActiveJSON());
    await this.writeJobStatus(job);

    return job;
  }

  async writeJobStatus(job) {
    const result = job.toResultJSON();
    await this.ensureJobDirs();
    await this.writeJsonFile(this.resultJobPath(job.jobId), result);
  }

  async claimNextJob() {
    await this.ensureJobDirs();
    const entries = await fs.readdir(config.queuedJobsDir, { withFileTypes: true }).catch(() => []);
    const queuedFiles = entries
      .filter((entry) => entry.isFile() && /^CR-\d{8}-\d{6}-[A-Z0-9]{4}\.json$/.test(entry.name))
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
      const jobData = JSON.parse(raw);
      
      const job = new Job({
        ...jobData,
        status: 'RUNNING',
        startedAt: new Date().toISOString()
      });

      const activeJSON = job.toActiveJSON();
      await this.writeJsonFile(runningPath, activeJSON);
      await this.writeJsonFile(config.latestJobFile, activeJSON);
      await this.writeJsonFile(config.latestCommandFile, job.command);
      await this.writeJobStatus(job);

      return activeJSON;
    }

    return null;
  }

  async completeJob(payload) {
    const jobId = String(payload.jobId || payload.jobIdentity || '').trim();
    const status = String(payload.status || '').trim().toUpperCase();
    const exitCode = Number(payload.exitCode);

    if (!/^CR-\d{8}-\d{6}-[A-Z0-9]{4}$/.test(jobId)) {
      throw new Error('Invalid jobId.');
    }

    if (!['DONE', 'FAILED'].includes(status)) {
      throw new Error('Invalid job status.');
    }

    if (!Number.isInteger(exitCode)) {
      throw new Error('Invalid exitCode.');
    }

    const existingResult = await this.readJobResult(jobId);
    const command = payload.command || existingResult?.command || null;
    
    const job = new Job({
      jobId,
      status,
      exitCode,
      command,
      createdAt: existingResult?.createdAt || null,
      startedAt: payload.startedAt || existingResult?.startedAt || null,
      finishedAt: payload.finishedAt || new Date().toISOString(),
      reportUrl: Job.resolveReportUrl(command)
    });

    const resultJSON = job.toResultJSON();

    await this.ensureJobDirs();
    await this.writeJsonFile(config.latestResultFile, resultJSON);
    await this.writeJsonFile(this.resultJobPath(jobId), resultJSON);
    await this.removeIfExists(this.runningJobPath(jobId));
    await this.removeIfExists(this.queueJobPath({ jobId }));
    await this.syncLatestActiveJob();

    return {
      ok: true,
      result: resultJSON,
      cleared: true
    };
  }

  async readJobResult(jobId) {
    const body = await fs.readFile(this.resultJobPath(jobId), 'utf8').catch(() => null);
    return body ? JSON.parse(body) : null;
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
      command: activeJob.command
    });
    await this.writeJsonFile(config.latestCommandFile, activeJob.command);
  }

  async listJobs() {
    await this.ensureJobDirs();
    const entries = await fs.readdir(config.jobResultsDir, { withFileTypes: true }).catch(() => []);
    const activeJobs = await this.listActiveJobs();
    const activeJobIds = new Set(activeJobs.map((job) => job.jobId));
    const jobs = [];

    for (const entry of entries) {
      if (!entry.isFile() || !/^CR-\d{8}-\d{6}-[A-Z0-9]{4}\.json$/.test(entry.name)) {
        continue;
      }

      const body = await fs.readFile(path.join(config.jobResultsDir, entry.name), 'utf8').catch(() => null);
      if (!body) {
        continue;
      }

      const jobData = JSON.parse(body);
      jobs.push({
        ...jobData,
        active: activeJobIds.has(jobData.jobId)
      });
    }

    return jobs.sort((a, b) => {
      const left = Date.parse(a.finishedAt || a.startedAt || a.createdAt || '') || 0;
      const right = Date.parse(b.finishedAt || b.startedAt || b.createdAt || '') || 0;
      return right - left;
    });
  }
}

export default JobManager;
