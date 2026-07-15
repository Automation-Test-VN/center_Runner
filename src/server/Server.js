import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import config from '../common/Config.js';
import { JOB_RESULT_PATH_PATTERN, isValidJobId } from '../common/JobId.js';
import JobManager from './JobManager.js';
import DomainChecker from './DomainChecker.js';
import WorkerRegistry from './WorkerRegistry.js';
import WorkerPresence from './WorkerPresence.js';

class Server {
  constructor() {
    this.jobManager = new JobManager();
    this.domainChecker = new DomainChecker();
    this.workerRegistry = new WorkerRegistry();
    this.workerPresence = new WorkerPresence();
    this.maintenanceTimer = null;
    this.server = null;

    this.contentTypes = new Map([
      ['.html', 'text/html; charset=utf-8'],
      ['.css', 'text/css; charset=utf-8'],
      ['.js', 'text/javascript; charset=utf-8'],
      ['.json', 'application/json; charset=utf-8'],
      ['.zip', 'application/zip'],
      ['.png', 'image/png'],
      ['.jpg', 'image/jpeg'],
      ['.jpeg', 'image/jpeg'],
      ['.webp', 'image/webp']
    ]);
  }

  start() {
    this.server = createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res);
      } catch (error) {
        this.sendJson(res, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    this.server.listen(config.port, config.host, () => {
      const displayHost = config.host === '0.0.0.0' ? 'localhost' : config.host;
      console.log(`Center Runner listening on http://${displayHost}:${config.port}`);
      console.log(`Center Runner host binding: ${config.host}:${config.port}`);
      console.log(`Center Runner root: ${config.rootDir}`);
      console.log(`Test repo root: ${config.testRepoRoot}`);
      console.log(`Jobs queue dir: ${config.queuedJobsDir}`);
      console.log(`Jobs running dir: ${config.runningJobsDir}`);
      console.log(`Jobs results dir: ${config.jobResultsDir}`);
      console.log(`Queue TTL: ${config.queueTtlMs}ms, maintenance every ${config.maintenanceIntervalMs}ms`);
    });

    this.startMaintenanceLoop();
  }

  // One periodic sweep does both cleanup jobs: expire QUEUED jobs past the TTL (e.g. a checkAccess
  // ISP with no matching worker) and drop long-dead workers from the roster. Worker online/offline
  // status is NOT computed here — it is derived reactively on each /api/workers read.
  startMaintenanceLoop() {
    if (this.maintenanceTimer) {
      return;
    }

    this.maintenanceTimer = setInterval(async () => {
      try {
        await this.jobManager.expireStaleQueuedJobs(config.queueTtlMs);
        this.workerPresence.prune();
      } catch (error) {
        console.error(`[Server] Maintenance sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, config.maintenanceIntervalMs);

    this.maintenanceTimer.unref?.();
  }

  async handleRequest(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/api/workers/start') {
      const result = await this.startWorkersBat();
      return this.sendJson(res, result.statusCode, result.body);
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const payload = await this.readJson(req);

      try {
        const jobs = await this.jobManager.addJob(payload);

        await this.workerRegistry.notifyAll(this.jobManager);

        return this.sendJson(res, 201, { jobs });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.toLowerCase().includes('already')) {
          return this.sendJson(res, 409, { error: message });
        }

        return this.sendJson(res, 400, { error: message });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs/complete') {
      const payload = await this.readJson(req);
      const result = await this.jobManager.completeJob(payload);
      return this.sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs/abort') {
      const payload = await this.readJson(req);
      const result = await this.jobManager.abortJob(payload);
      return this.sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs/clear-history') {
      const result = await this.jobManager.clearHistory();
      return this.sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/check-domain') {
      const payload = await this.readJson(req);
      const result = await this.domainChecker.check(payload.domainUrl);
      return this.sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/latest') {
      const body = await fs.readFile(config.latestCommandFile, 'utf8').catch(() => null);
      return body
        ? this.send(res, 200, body, 'application/json; charset=utf-8')
        : this.sendJson(res, 404, { error: 'No command has been saved yet.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/latest-job') {
      const job = await this.jobManager.readLatestActiveJob();
      return job
        ? this.sendJson(res, 200, job)
        : this.sendJson(res, 404, { error: 'No active job has been saved yet.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/next') {
      const workerIp = url.searchParams.get('workerIp') || req.socket.remoteAddress || null;
      const workerName = url.searchParams.get('workerName') || null;
      const workerIsp = url.searchParams.get('isp') || '';

      // The poll itself is the worker heartbeat — record presence on every claim attempt.
      this.workerPresence.touch({ name: workerName, ip: workerIp, isp: workerIsp });

      const claimedJob = await this.jobManager.claimNextJob(workerIp, workerName, workerIsp);

      if (claimedJob) {
        return this.sendJson(res, 200, claimedJob);
      }

      return this.workerRegistry.add(res, this.jobManager, workerIp, workerName, workerIsp);
    }

    if (req.method === 'GET' && url.pathname === '/api/workers') {
      const busyWorkerNames = await this.jobManager.listRunningWorkerNames();
      return this.sendJson(res, 200, { workers: this.workerPresence.list(busyWorkerNames) });
    }

    if (req.method === 'GET' && url.pathname === '/api/isps') {
      const busyWorkerNames = await this.jobManager.listRunningWorkerNames();
      return this.sendJson(res, 200, { isps: this.workerPresence.onlineIsps(busyWorkerNames) });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/latest-result') {
      const body = await fs.readFile(config.latestResultFile, 'utf8').catch(() => null);
      return body
        ? this.send(res, 200, body, 'application/json; charset=utf-8')
        : this.sendJson(res, 404, { error: 'No result has been saved yet.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const jobs = await this.jobManager.listJobs();
      return this.sendJson(res, 200, { jobs });
    }

    if (req.method === 'GET' && url.pathname === '/api/brands') {
      const groups = await this.collectBrandGroups();
      return this.sendJson(res, 200, { groups });
    }

    const jobResultMatch = url.pathname.match(JOB_RESULT_PATH_PATTERN);
    if (req.method === 'GET' && jobResultMatch) {
      if (!isValidJobId(jobResultMatch[1])) {
        return this.sendJson(res, 404, { error: 'No result found for job.' });
      }

      const result = await this.jobManager.readJobResult(jobResultMatch[1]);
      return result
        ? this.sendJson(res, 200, result)
        : this.sendJson(res, 404, { error: 'No result found for job.' });
    }

    if (req.method !== 'GET') {
      return this.sendJson(res, 405, { error: 'Method not allowed.' });
    }

    if (url.pathname.startsWith('/reports/')) {
      const reportPath = this.resolveReportPath(url.pathname);
      if (!reportPath) {
        return this.sendJson(res, 404, { error: 'Report not found.' });
      }

      const body = await fs.readFile(reportPath).catch(() => null);
      if (!body) {
        return this.sendJson(res, 404, { error: 'Report file read error.' });
      }

      return this.send(
        res,
        200,
        body,
        this.contentTypes.get(path.extname(reportPath).toLowerCase()) || 'application/octet-stream'
      );
    }

    const filePath = this.resolveStaticPath(url.pathname);
    if (!filePath) {
      return this.sendJson(res, 404, { error: 'Not found.' });
    }

    const body = await fs.readFile(filePath).catch(() => null);
    if (!body) {
      return this.sendJson(res, 404, { error: 'Static file read error.' });
    }

    return this.send(
      res,
      200,
      body,
      this.contentTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream'
    );
  }

  async readJson(req) {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
  }

  async collectBrandGroups() {
    const entries = await fs.readdir(config.testsDir, { withFileTypes: true }).catch(() => []);
    const groups = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || !/^fbc\d+$/.test(entry.name)) {
        continue;
      }

      const groupPath = path.join(config.testsDir, entry.name);
      const brandEntries = await fs.readdir(groupPath, { withFileTypes: true }).catch(() => []);

      const brands = brandEntries
        .filter((brandEntry) => brandEntry.isDirectory() && /^[a-z0-9-]+$/.test(brandEntry.name))
        .map((brandEntry) => brandEntry.name)
        .sort((a, b) => a.localeCompare(b));

      groups.push({
        name: entry.name,
        brands
      });
    }

    return groups.sort((a, b) => a.name.localeCompare(b.name));
  }

  resolveReportPath(requestPath) {
    const relativePath = decodeURIComponent(requestPath.replace(/^\/reports\//, ''));
    const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
    const reportPath = path.join(config.testResultsDir, normalized);
    return reportPath.startsWith(config.testResultsDir) ? reportPath : null;
  }

  resolveStaticPath(requestPath) {
    const safePath = requestPath === '/' ? '/index.html' : requestPath;
    const normalized = path.normalize(decodeURIComponent(safePath)).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(config.publicDir, normalized);
    return filePath.startsWith(config.publicDir) ? filePath : null;
  }

  async startWorkersBat() {
    try {
      await fs.access(config.startWorkersBatPath);
    } catch {
      return {
        statusCode: 404,
        body: {
          ok: false,
          error: `BAT file not found: ${config.startWorkersBatPath}`,
          note: 'Remote workers should normally be started directly on worker machines using start-workers.bat.'
        }
      };
    }

    try {
      const child = spawn('cmd.exe', ['/c', config.startWorkersBatPath], {
        cwd: path.dirname(config.startWorkersBatPath),
        detached: true,
        windowsHide: false,
        stdio: 'ignore'
      });

      child.unref();

      return {
        statusCode: 200,
        body: {
          ok: true,
          message: 'start-workers.bat started',
          file: config.startWorkersBatPath
        }
      };
    } catch (error) {
      return {
        statusCode: 500,
        body: {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  sendJson(res, status, payload) {
    return this.send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
  }

  send(res, status, body, contentType) {
    res.writeHead(status, {
      'content-type': contentType,
      'cache-control': 'no-store'
    });

    res.end(body);
  }
}

export default Server;
