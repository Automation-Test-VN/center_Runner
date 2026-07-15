import config from '../common/Config.js';
import { normalizeIspTag } from '../common/JobId.js';

// In-memory roster of workers, updated reactively on every /api/jobs/next poll (the long-poll cycle
// is the heartbeat — no separate timer). online/offline is computed on read from lastSeen, so the
// status panel is always as fresh as the caller's poll, independent of the maintenance sweep.
class WorkerPresence {
  constructor() {
    this.workers = new Map();
  }

  touch({ name, ip, isp }) {
    const key = String(name || '').trim() || String(ip || '').trim();

    if (!key) {
      return;
    }

    this.workers.set(key, {
      name: key,
      ip: ip ? String(ip) : null,
      isp: normalizeIspTag(isp) || null,
      lastSeen: Date.now()
    });
  }

  prune(retentionMs = config.workerRetentionMs) {
    const now = Date.now();
    let removed = 0;

    for (const [key, worker] of this.workers) {
      if (now - worker.lastSeen > retentionMs) {
        this.workers.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  // busyWorkerNames: names of workers currently running a job. They stop polling while a job runs,
  // so treat them as online even though lastSeen has gone stale.
  list(busyWorkerNames = new Set()) {
    const now = Date.now();
    const windowMs = config.workerOnlineWindowMs;

    return [...this.workers.values()]
      .map((worker) => ({
        name: worker.name,
        ip: worker.ip,
        isp: worker.isp,
        lastSeen: new Date(worker.lastSeen).toISOString(),
        online: now - worker.lastSeen <= windowMs || busyWorkerNames.has(worker.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  onlineIsps(busyWorkerNames = new Set()) {
    const isps = this.list(busyWorkerNames)
      .filter((worker) => worker.online && worker.isp)
      .map((worker) => worker.isp);

    return [...new Set(isps)].sort();
  }
}

export default WorkerPresence;
