import config from '../common/Config.js';

class WorkerRegistry {
  constructor() {
    this.waitingWorkers = [];
    this.workerWaitTimeoutMs = config.workerWaitTimeoutMs;
  }

  add(res, jobManager, workerIp, workerName, workerIsp = '') {
    const waiter = {
      res,
      workerIp,
      workerName,
      workerIsp,
      createdAt: new Date().toISOString(),
      timeout: null
    };

    waiter.timeout = setTimeout(() => {
      this.remove(waiter);

      if (!res.writableEnded) {
        this.sendNoContent(res);
      }
    }, this.workerWaitTimeoutMs);

    res.on('close', () => {
      clearTimeout(waiter.timeout);
      this.remove(waiter);
    });

    this.waitingWorkers.push(waiter);
  }

  async notifyAll(jobManager) {
    // Try to hand a job to each waiter using ITS OWN ISP filter. A waiter with no matching job is
    // left waiting (its own timeout will 204 it) instead of ending the loop — otherwise one ISP's
    // idle waiter would starve the others of a fresh job.
    const waiters = [...this.waitingWorkers];

    for (const waiter of waiters) {
      if (waiter.res.writableEnded) {
        this.remove(waiter);
        clearTimeout(waiter.timeout);
        continue;
      }

      const job = await jobManager.claimNextJob(waiter.workerIp, waiter.workerName, waiter.workerIsp);

      if (!job) {
        continue;
      }

      clearTimeout(waiter.timeout);
      this.remove(waiter);
      this.sendJson(waiter.res, 200, job);
    }
  }

  async notify(jobManager) {
    return this.notifyAll(jobManager);
  }

  remove(waiter) {
    const index = this.waitingWorkers.indexOf(waiter);

    if (index >= 0) {
      this.waitingWorkers.splice(index, 1);
    }
  }

  sendJson(res, status, payload) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    });

    res.end(JSON.stringify(payload));
  }

  sendNoContent(res) {
    res.writeHead(204, {
      'cache-control': 'no-store'
    });

    res.end();
  }
}

export default WorkerRegistry;
