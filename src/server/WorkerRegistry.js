import config from '../common/Config.js';

class WorkerRegistry {
  constructor() {
    this.waitingWorkers = [];
  }

  add(res, jobManager) {
    const waiter = { res, timeout: null };
    
    waiter.timeout = setTimeout(() => {
      const index = this.waitingWorkers.indexOf(waiter);
      if (index >= 0) {
        this.waitingWorkers.splice(index, 1);
      }

      if (!res.writableEnded) {
        res.writeHead(204, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        });
        res.end(JSON.stringify({ ok: false, message: 'No job available.' }));
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
      const job = await jobManager.claimNextJob();
      if (!waiter.res.writableEnded) {
        if (job) {
          waiter.res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          });
          waiter.res.end(JSON.stringify(job));
        } else {
          waiter.res.writeHead(204, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          });
          waiter.res.end(JSON.stringify({ ok: false, message: 'No job available.' }));
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
