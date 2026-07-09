import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

class JobFetcher {
  constructor() {
    this.urlPattern = /^https?:\/\//i;
  }

  async fetchJob(source, workerIp = null, workerName = null) {
    if (this.urlPattern.test(source)) {
      return this.fetchFromUrl(source, workerIp, workerName);
    }
    return this.fetchFromFile(source);
  }

  async fetchFromUrl(source, workerIp = null, workerName = null) {
    let requestUrl = source;
    if (workerIp || workerName) {
      const url = new URL(source);
      if (workerIp && !url.searchParams.has('workerIp')) {
        url.searchParams.set('workerIp', workerIp);
      }
      if (workerName && !url.searchParams.has('workerName')) {
        url.searchParams.set('workerName', workerName);
      }
      requestUrl = url.toString();
    }

    const response = await fetch(requestUrl, { headers: { accept: 'application/json' } });
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
      command
    };
  }

  async fetchFromFile(source) {
    const sourcePath = path.resolve(source);
    try {
      const [raw, stats] = await Promise.all([
        fsp.readFile(sourcePath, 'utf8'),
        fsp.stat(sourcePath)
      ]);
      const rawJob = JSON.parse(raw);
      const command = this.normalizeCommand(rawJob);

      return {
        identity: String(rawJob?.jobId || `${sourcePath}:${stats.mtimeMs}`),
        command
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
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

  hashCommand(command) {
    return createHash('sha256')
      .update(JSON.stringify(command))
      .digest('hex');
  }
}

export default JobFetcher;
