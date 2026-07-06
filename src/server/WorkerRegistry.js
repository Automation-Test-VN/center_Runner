import config from '../common/Config.js';

class WorkerRegistry {
  constructor() {
    this.waitingWorkers = [];
    this.workerWaitTimeoutMs = config.workerWaitTimeoutMs;
  }

  add(res, jobManager, workerIp, workerName) {
    const waiter = {
      res,
      workerIp,
      workerName,
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
    while (this.waitingWorkers.length > 0) {
      const waiter = this.waitingWorkers.shift();

      if (!waiter) {
        continue;
      }

      clearTimeout(waiter.timeout);

      if (waiter.res.writableEnded) {
        continue;
      }

      const job = await jobManager.claimNextJob(waiter.workerIp, waiter.workerName);

      if (!job) {
        this.sendNoContent(waiter.res);
        break;
      }

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
