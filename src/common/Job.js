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

  static fromPayload(payload, defaultTag = '@smoke') {
    const tool = String(payload.tool || '').trim();
    const group = String(payload.group || '').trim().toLowerCase();
    const brand = String(payload.brand || '').trim().toLowerCase();
    const tag = String(payload.tag || defaultTag).trim() || defaultTag;
    const domainUrl = String(payload.domainUrl || '').trim();
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');

    if (tool !== 'aliveDaily') {
      throw new Error('Unsupported tool. Currently only aliveDaily is available.');
    }

    if (!/^fbc\d+$/.test(group)) {
      throw new Error('Group must use the fbc number format, for example fbc1.');
    }

    if (!/^[a-z0-9-]+$/.test(brand)) {
      throw new Error('Brand must contain only lowercase letters, numbers, and hyphens.');
    }

    if (!/^@[A-Za-z0-9_-]+$/.test(tag)) {
      throw new Error('Tag must start with @ and contain only letters, numbers, underscore, or hyphen.');
    }

    if (tool !== 'aliveDaily' && (!domainUrl || !username || !password)) {
      throw new Error('Domain URL, username, and password are required for manual tools.');
    }

    const now = new Date();
    const jobId = `CR-${Job.formatJobStamp(now)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    return new Job({
      jobId,
      createdAt: now.toISOString(),
      status: 'QUEUED',
      command: {
        tool,
        group,
        brand,
        tag
      }
    });
  }

  static formatJobStamp(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      '-',
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds())
    ].join('');
  }

  static resolveReportUrl(command) {
    const brand = String(command?.brand || '').trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(brand)) {
      return null;
    }
    return `/reports/${brand}/report.html`;
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
      reportUrl: this.reportUrl || Job.resolveReportUrl(this.command)
    };
  }
}

export default Job;
