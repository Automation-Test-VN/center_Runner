import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const startWorkersBatPath = path.join(__dirname, 'jenkins', 'start-workers.bat');

const defaultTestRepoRoot = path.resolve(__dirname, '..', 'TS_PW_FBC');
const testRepoRoot = path.resolve(process.env.CENTER_RUNNER_TEST_REPO || defaultTestRepoRoot);
const publicDir = path.join(__dirname, 'public');
const jobsDir = path.join(__dirname, 'jobs');
const queuedJobsDir = path.join(jobsDir, 'queue');
const runningJobsDir = path.join(jobsDir, 'running');
const testsDir = path.join(testRepoRoot, 'tests');
const testResultsDir = path.join(testRepoRoot, 'test-results');
const jobResultsDir = path.join(jobsDir, 'results');
const latestCommandFile = path.join(jobsDir, 'latest-command.json');
const latestJobFile = path.join(jobsDir, 'latest-job.json');
const latestResultFile = path.join(jobsDir, 'latest-result.json');
const port = Number(process.env.CENTER_RUNNER_PORT || process.env.PORT || 4317);
const host = process.env.CENTER_RUNNER_HOST || '0.0.0.0';
const workerWaitTimeoutMs = 60000;
const waitingWorkers = [];

const contentTypes = new Map([
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

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && url.pathname === '/api/workers/start') {
      const result = await startWorkersBat();
      return sendJson(res, result.statusCode, result.body);
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const payload = await readJson(req);
      const job = buildJob(payload);
      await ensureJobDirs();

      const duplicateJob = await findActiveDuplicateJob(job.command);
      if (duplicateJob) {
        return sendJson(res, 409, {
          error: `${job.command.group}/${job.command.brand} is already ${duplicateJob.status}.`
        });
      }

      await writeJsonFile(queueJobPath(job), job);
      await writeJsonFile(latestCommandFile, job.command);
      await writeJsonFile(latestJobFile, job);
      await writeJobStatus(job);
      await notifyWaitingWorker();

      return sendJson(res, 201, job);
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs/complete') {
      const payload = await readJson(req);
      const result = await completeJob(payload);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/api/check-domain') {
      const payload = await readJson(req);
      const result = await checkDomain(payload.domainUrl);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/latest') {
      const body = await fs.readFile(latestCommandFile, 'utf8').catch(() => null);
      return body
        ? send(res, 200, body, 'application/json; charset=utf-8')
        : sendJson(res, 404, { error: 'No command has been saved yet.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/latest-job') {
      const job = await readLatestActiveJob();
      return job
        ? sendJson(res, 200, job)
        : sendJson(res, 404, { error: 'No active job has been saved yet.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/next') {
      const claimedJob = await claimNextJob();
      if (claimedJob) {
        return sendJson(res, 200, claimedJob);
      }

      return waitForNextJob(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs/latest-result') {
      const body = await fs.readFile(latestResultFile, 'utf8').catch(() => null);
      return body
        ? send(res, 200, body, 'application/json; charset=utf-8')
        : sendJson(res, 404, { error: 'No result has been saved yet.' });
    }

    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    if (url.pathname === '/api/jobs') {
      const jobs = await listJobs();
      return sendJson(res, 200, { jobs });
    }

    if (url.pathname === '/api/brands') {
      const groups = await collectBrandGroups();
      return sendJson(res, 200, { groups });
    }

    const jobResultMatch = url.pathname.match(/^\/api\/jobs\/(CR-\d{8}-\d{6}-[A-Z0-9]{4})\/result$/);
    if (jobResultMatch) {
      const result = await readJobResult(jobResultMatch[1]);
      return result
        ? sendJson(res, 200, result)
        : sendJson(res, 404, { error: 'No result found for job.' });
    }

    if (url.pathname.startsWith('/reports/')) {
      const reportPath = resolveReportPath(url.pathname);
      if (!reportPath) {
        return sendJson(res, 404, { error: 'Report not found.' });
      }

      const body = await fs.readFile(reportPath);
      return send(
        res,
        200,
        body,
        contentTypes.get(path.extname(reportPath).toLowerCase()) || 'application/octet-stream'
      );
    }

    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
      return sendJson(res, 404, { error: 'Not found.' });
    }

    const body = await fs.readFile(filePath);
    return send(res, 200, body, contentTypes.get(path.extname(filePath)) || 'application/octet-stream');
  } catch (error) {
    return sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`Center Runner listening on http://localhost:${port}`);
  console.log(`Center Runner host binding: ${host}:${port}`);
  console.log(`Test repo root: ${testRepoRoot}`);
  console.log(`Start workers BAT: ${startWorkersBatPath}`);
});

function resolveStaticPath(requestPath) {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const normalized = path.normalize(decodeURIComponent(safePath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, normalized);
  return filePath.startsWith(publicDir) ? filePath : null;
}

async function readJson(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function collectBrandGroups() {
  const entries = await fs.readdir(testsDir, { withFileTypes: true }).catch(() => []);
  const groups = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !/^fbc\d+$/.test(entry.name)) {
      continue;
    }

    const groupPath = path.join(testsDir, entry.name);
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

function buildJob(payload) {
  const tool = String(payload.tool || '').trim();
  const group = String(payload.group || '').trim().toLowerCase();
  const brand = String(payload.brand || '').trim().toLowerCase();
  const tag = String(payload.tag || '@smoke').trim() || '@smoke';
  const domainUrl = normalizeUrl(String(payload.domainUrl || ''));
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
  const jobId = `CR-${formatJobStamp(now)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  return {
    jobId,
    createdAt: now.toISOString(),
    status: 'QUEUED',
    command: {
      tool,
      group,
      brand,
      tag
    }
  };
}

async function completeJob(payload) {
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

  const existingResult = await readJobResult(jobId);
  const command = payload.command || existingResult?.command || null;

  const result = {
    ...(existingResult || {}),
    jobId,
    status,
    exitCode,
    command,
    workerIp: payload.workerIp || existingResult?.workerIp || null,
    workerName: payload.workerName || existingResult?.workerName || null,
    createdAt: existingResult?.createdAt || null,
    startedAt: payload.startedAt || existingResult?.startedAt || null,
    finishedAt: payload.finishedAt || new Date().toISOString(),
    reportUrl: resolveReportUrl(command)
  };

  await ensureJobDirs();
  await writeJsonFile(latestResultFile, result);
  await writeJsonFile(path.join(jobResultsDir, `${jobId}.json`), result);
  await removeIfExists(path.join(runningJobsDir, `${jobId}.json`));
  await removeIfExists(path.join(queuedJobsDir, `${jobId}.json`));
  await syncLatestActiveJob();

  return {
    ok: true,
    result,
    cleared: true
  };
}

async function claimNextJob() {
  await ensureJobDirs();

  const entries = await fs.readdir(queuedJobsDir, { withFileTypes: true }).catch(() => []);

  const queuedFiles = entries
    .filter((entry) => entry.isFile() && /^CR-\d{8}-\d{6}-[A-Z0-9]{4}\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (queuedFiles.length === 0) {
    return null;
  }

  for (const fileName of queuedFiles) {
    const queuedPath = path.join(queuedJobsDir, fileName);
    const runningPath = path.join(runningJobsDir, fileName);

    try {
      await fs.rename(queuedPath, runningPath);
    } catch (error) {
      if (['ENOENT', 'EEXIST', 'EPERM'].includes(error?.code)) {
        continue;
      }

      throw error;
    }

    const raw = await fs.readFile(runningPath, 'utf8');
    const job = JSON.parse(raw);

    const runningJob = {
      ...job,
      status: 'RUNNING',
      startedAt: new Date().toISOString()
    };

    await writeJsonFile(runningPath, runningJob);
    await writeJsonFile(latestJobFile, runningJob);
    await writeJsonFile(latestCommandFile, runningJob.command);
    await writeJobStatus(runningJob);

    return runningJob;
  }

  return null;
}

function waitForNextJob(res) {
  const waiter = {
    res,
    timeout: null
  };

  waiter.timeout = setTimeout(() => {
    const index = waitingWorkers.indexOf(waiter);
    if (index >= 0) {
      waitingWorkers.splice(index, 1);
    }

    if (!res.writableEnded) {
      sendNoContent(res);
    }
  }, workerWaitTimeoutMs);

  waitingWorkers.push(waiter);
}

async function notifyWaitingWorker() {
  const waiter = waitingWorkers.shift();

  if (!waiter) {
    return;
  }

  clearTimeout(waiter.timeout);

  const job = await claimNextJob();

  if (!waiter.res.writableEnded) {
    if (job) {
      sendJson(waiter.res, 200, job);
    } else {
      sendNoContent(waiter.res);
    }
  }
}

async function writeJobStatus(job) {
  const result = {
    jobId: job.jobId,
    status: job.status,
    exitCode: null,
    command: job.command,
    workerIp: job.workerIp || null,
    workerName: job.workerName || null,
    createdAt: job.createdAt || null,
    startedAt: job.startedAt || null,
    finishedAt: null,
    reportUrl: null
  };

  await ensureJobDirs();
  await writeJsonFile(path.join(jobResultsDir, `${job.jobId}.json`), result);
}

async function readJobResult(jobId) {
  const body = await fs.readFile(path.join(jobResultsDir, `${jobId}.json`), 'utf8').catch(() => null);
  return body ? JSON.parse(body) : null;
}

async function listJobs() {
  await ensureJobDirs();

  const entries = await fs.readdir(jobResultsDir, { withFileTypes: true }).catch(() => []);
  const activeJobs = await listActiveJobs();
  const activeJobIds = new Set(activeJobs.map((job) => job.jobId));
  const jobs = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/^CR-\d{8}-\d{6}-[A-Z0-9]{4}\.json$/.test(entry.name)) {
      continue;
    }

    const body = await fs.readFile(path.join(jobResultsDir, entry.name), 'utf8').catch(() => null);
    if (!body) {
      continue;
    }

    const job = JSON.parse(body);

    jobs.push({
      ...job,
      active: activeJobIds.has(job.jobId)
    });
  }

  return jobs.sort((a, b) => {
    const left = Date.parse(a.finishedAt || a.startedAt || a.createdAt || '') || 0;
    const right = Date.parse(b.finishedAt || b.startedAt || b.createdAt || '') || 0;
    return right - left;
  });
}

async function readLatestActiveJob() {
  const activeJobs = await listActiveJobs();
  return activeJobs[0] || null;
}

async function syncLatestActiveJob() {
  const activeJob = await readLatestActiveJob();

  if (!activeJob) {
    await removeIfExists(latestJobFile);
    await removeIfExists(latestCommandFile);
    return;
  }

  await writeJsonFile(latestJobFile, {
    jobId: activeJob.jobId,
    createdAt: activeJob.createdAt || null,
    startedAt: activeJob.startedAt || null,
    status: activeJob.status,
    command: activeJob.command
  });

  await writeJsonFile(latestCommandFile, activeJob.command);
}

async function findActiveDuplicateJob(command) {
  const activeJobs = await listActiveJobs();
  return activeJobs.find((job) => commandsEqual(job.command, command)) || null;
}

async function listActiveJobs() {
  await ensureJobDirs();

  const jobs = [];

  for (const dir of [runningJobsDir, queuedJobsDir]) {
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

function commandsEqual(left, right) {
  return left?.tool === right?.tool
    && left?.group === right?.group
    && left?.brand === right?.brand
    && left?.tag === right?.tag;
}

async function checkDomain(domainUrl) {
  const url = normalizeUrl(String(domainUrl || ''));

  if (!/^https?:\/\/[^ "]+$/i.test(url)) {
    return {
      ok: false,
      status: 0,
      message: 'Invalid URL.'
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal
    });

    if ([405, 403].includes(response.status)) {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal
      });
    }

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      message: response.ok ? 'Domain reachable.' : `Domain returned HTTP ${response.status}.`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUrl(value) {
  return value.trim();
}

function resolveReportUrl(command) {
  const brand = String(command?.brand || '').trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(brand)) {
    return null;
  }

  return `/reports/${brand}/report.html`;
}

function resolveReportPath(requestPath) {
  const relativePath = decodeURIComponent(requestPath.replace(/^\/reports\//, ''));
  const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const reportPath = path.join(testResultsDir, normalized);
  return reportPath.startsWith(testResultsDir) ? reportPath : null;
}

function queueJobPath(job) {
  return path.join(queuedJobsDir, `${job.jobId}.json`);
}

async function ensureJobDirs() {
  await Promise.all([
    fs.mkdir(jobsDir, { recursive: true }),
    fs.mkdir(queuedJobsDir, { recursive: true }),
    fs.mkdir(runningJobsDir, { recursive: true }),
    fs.mkdir(jobResultsDir, { recursive: true })
  ]);
}

async function startWorkersBat() {
  try {
    await fs.access(startWorkersBatPath);
  } catch {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error: `BAT file not found: ${startWorkersBatPath}`
      }
    };
  }

  try {
    const child = spawn('cmd.exe', ['/c', startWorkersBatPath], {
      cwd: path.dirname(startWorkersBatPath),
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
        file: startWorkersBatPath
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

async function writeJsonFile(filePath, payload) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function removeIfExists(filePath) {
  await fs.unlink(filePath).catch((error) => {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  });
}

function formatJobStamp(date) {
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

function sendJson(res, status, payload) {
  return send(res, status, JSON.stringify(payload), 'application/json; charset=utf-8');
}

function sendNoContent(res) {
  res.writeHead(204, {
    'cache-control': 'no-store'
  });
  res.end();
}

function send(res, status, body, contentType) {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store'
  });
  res.end(body);
}
