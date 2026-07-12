import { ALIVE_DAILY_TOOL, CHECK_ACCESS_TOOL, createJobIdForTool, formatJobStamp, resolveReportUrl } from './JobId.js';

class Job {
  constructor(data) {
    this.jobId = data.jobId;
    this.createdAt = data.createdAt || new Date().toISOString();
    this.startedAt = data.startedAt || null;
    this.finishedAt = data.finishedAt || null;
    this.status = data.status || 'QUEUED';
    this.command = data.command;
    this.exitCode = data.exitCode !== undefined ? data.exitCode : null;
    this.reportUrl = data.reportUrl || null;
    this.workerIp = data.workerIp || null;
    this.workerName = data.workerName || null;
  }

  static fromPayload(payload) {
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

    return new Job({
      jobId,
      createdAt: now.toISOString(),
      status: 'QUEUED',
      command
    });
  }

  static formatJobStamp(date) {
    return formatJobStamp(date);
  }

  static resolveReportUrl(command, jobId = '') {
    return resolveReportUrl(command, jobId);
  }

  toActiveJSON() {
    return {
      jobId: this.jobId,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      status: this.status,
      command: this.command,
      workerIp: this.workerIp,
      workerName: this.workerName
    };
  }

  toResultJSON() {
    return {
      jobId: this.jobId,
      status: this.status,
      exitCode: this.exitCode,
      command: this.command,
      workerIp: this.workerIp,
      workerName: this.workerName,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      reportUrl: this.reportUrl || Job.resolveReportUrl(this.command, this.jobId)
    };
  }
}

export default Job;
