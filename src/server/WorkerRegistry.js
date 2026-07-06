import config from '../common/Config.js';

class WorkerRegistry {
  constructor() {
    this.waitingWorkers = [];
  }

  add(res, jobManager, workerIp = null, workerName = null) {
    const waiter = { res, timeout: null, workerIp, workerName };
    
    waiter.timeout = setTimeout(() => {
      const index = this.waitingWorkers.indexOf(waiter);
      if (index >= 0) {
        this.waitingWorkers.splice(index, 1);
      }

      if (!res.writableEnded) {
        res.writeHead(204, {
          'cache-control': 'no-store'
        });
        res.end();
      }
    }, config.workerWaitTimeoutMs);

    this.waitingWorkers.push(waiter);
  }

  async notify(jobManager) {
    const waiter = this.waitingWorkers.shift();
    if (!waiter) {
      return;
    }

    clearTimeout(waiter.timeout);
    
    try {
      const job = await jobManager.claimNextJob(waiter.workerIp, waiter.workerName);
      if (!waiter.res.writableEnded) {
        if (job) {
          waiter.res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          });
          waiter.res.end(JSON.stringify(job));
        } else {
          waiter.res.writeHead(204, {
            'cache-control': 'no-store'
          });
          waiter.res.end();
        }
      }
    } catch (error) {
      if (!waiter.res.writableEnded) {
        waiter.res.writeHead(500, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        });
        waiter.res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    }
  }
}

export default WorkerRegistry;
