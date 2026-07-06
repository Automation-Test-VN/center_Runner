import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaultTestRepoRoot = path.resolve(__dirname, '..', 'TS_PW_FBC');
const testRepoRoot = path.resolve(process.env.CENTER_RUNNER_TEST_REPO || defaultTestRepoRoot);

const jobsDir = path.join(__dirname, 'jobs');
const defaultCommandFile = path.join(jobsDir, 'latest-command.json');
const defaultStateFile = path.join(jobsDir, 'worker-state.json');
const defaultResultFile = path.join(jobsDir, 'latest-result.json');

const centerRunnerPort = process.env.CENTER_RUNNER_PORT || '4317';
const centerRunnerIp = process.env.CENTER_RUNNER_IP || '';
const centerRunnerBaseUrl = normalizeBaseUrl(
    process.env.CENTER_RUNNER_BASE_URL ||
    (centerRunnerIp ? `http://${centerRunnerIp}:${centerRunnerPort}` : '')
);

const workerIp = process.env.WORKER_IP || '127.0.0.1';
const workerName = process.env.WORKER_NAME || `worker-${workerIp.replaceAll('.', '-')}`;

const options = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(`[CenterWorker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

async function main() {
  await fsp.mkdir(jobsDir, { recursive: true });

  console.log(`[CenterWorker] Worker name: ${workerName}`);
  console.log(`[CenterWorker] Worker IP: ${workerIp}`);
  console.log(`[CenterWorker] Test repo: ${testRepoRoot}`);
  console.log(`[CenterWorker] Source: ${options.source}`);

  if (options.once) {
    const processed = await processLatestCommand();
    process.exit(processed ? 0 : 2);
  }

  console.log(`[CenterWorker] Waiting for jobs from ${options.source}`);

  for (;;) {
    await processLatestCommand();
    await delay(options.intervalMs);
  }
}

async function processLatestCommand() {
  const job = await readJob(options.source);

  if (!job) {
    console.log('[CenterWorker] No queued job.');
    return false;
  }

  const previousIdentity = await readPreviousIdentity(options.stateFile);

  if (previousIdentity === job.identity) {
    console.log('[CenterWorker] No new command.');
    return false;
  }

  const runner = buildRunner(job.command);

  if (options.dryRun) {
    console.log(`[CenterWorker] Dry run: ${runner.command} ${runner.args.join(' ')}`);
    console.log(`[CenterWorker] Job: ${job.identity}`);
    console.log(`[CenterWorker] Command: ${JSON.stringify(job.command)}`);
    return true;
  }

  const startedAt = new Date().toISOString();

  console.log(`[CenterWorker] Running ${runner.command} ${runner.args.join(' ')}`);

  const result = spawnSync(runner.command, runner.args, {
    cwd: testRepoRoot,
    env: process.env,
    shell: false,
    stdio: 'inherit'
  });

  const exitCode = result.status ?? 1;
  const status = exitCode === 0 ? 'DONE' : 'FAILED';
  const finishedAt = new Date().toISOString();

  const jobResult = {
    jobIdentity: job.identity,
    jobId: job.identity,
    workerIp,
    workerName,
    testRepoRoot,
    command: job.command,
    status,
    exitCode,
    startedAt,
    finishedAt
  };

  await writeJson(options.resultFile, jobResult);
  await reportCompletion(options.source, jobResult);

  await writeJson(options.stateFile, {
    lastJobIdentity: job.identity,
    workerIp,
    workerName,
    updatedAt: finishedAt
  });

  if (result.error) {
    throw new Error(`Failed to start runner: ${result.error.message}`);
  }

  console.log(`[CenterWorker] ${status} exitCode=${exitCode}`);
  return true;
}

async function readJob(source) {
  if (/^https?:\/\//i.test(source)) {
    const requestUrl = buildNextJobUrl(source);

    const response = await fetch(requestUrl, {
      headers: {
        accept: 'application/json'
      }
    });

    if (response.status === 204 || response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Cannot read command from ${requestUrl}: HTTP ${response.status} ${body}`);
    }

    const rawJob = await response.json();
    const command = normalizeCommand(rawJob);

    return {
      identity: String(rawJob?.jobId || rawJob?.id || hashCommand(command)),
      command
    };
  }

  const sourcePath = path.resolve(__dirname, source);

  if (!fs.existsSync(sourcePath)) {
    return null;
  }

  const [raw, stats] = await Promise.all([
    fsp.readFile(sourcePath, 'utf8'),
    fsp.stat(sourcePath)
  ]);

  const rawJob = JSON.parse(raw);
  const command = normalizeCommand(rawJob);

  return {
    identity: String(rawJob?.jobId || `${sourcePath}:${stats.mtimeMs}`),
    command
  };
}

async function reportCompletion(source, result) {
  if (!/^https?:\/\//i.test(source)) {
    return;
  }

  const completeUrl = new URL('/api/jobs/complete', source).toString();

  const response = await fetch(completeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(result)
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Cannot report completion to ${completeUrl}: HTTP ${response.status} ${body}`);
  }
}

function normalizeCommand(rawCommand) {
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

function buildRunner(command) {
  validateCommand(command);

  return {
    command: process.execPath,
    args: [
      path.join(testRepoRoot, 'scripts', 'run-domain-test.mjs'),
      command.group,
      command.brand,
      '--grep',
      command.tag
    ]
  };
}

function validateCommand(command) {
  if (command.tool !== 'aliveDaily') {
    throw new Error(`Unsupported tool: ${command.tool}`);
  }

  if (!/^fbc\d+$/.test(command.group)) {
    throw new Error(`Invalid group: ${command.group}`);
  }

  if (!/^[a-z0-9-]+$/.test(command.brand)) {
    throw new Error(`Invalid brand: ${command.brand}`);
  }

  if (!/^@[A-Za-z0-9_-]+$/.test(command.tag)) {
    throw new Error(`Invalid tag: ${command.tag}`);
  }

  const testDir = path.join(testRepoRoot, 'tests', command.group, command.brand);

  if (!fs.existsSync(testDir)) {
    throw new Error(`Test path not found: ${path.relative(testRepoRoot, testDir)}`);
  }
}

function buildNextJobUrl(source) {
  const url = new URL(source);

  if (!url.searchParams.has('workerIp')) {
    url.searchParams.set('workerIp', workerIp);
  }

  if (!url.searchParams.has('workerName')) {
    url.searchParams.set('workerName', workerName);
  }

  return url.toString();
}

function getDefaultCommandSource() {
  if (centerRunnerBaseUrl) {
    return `${centerRunnerBaseUrl}/api/jobs/next`;
  }

  return defaultCommandFile;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function readPreviousIdentity(stateFile) {
  try {
    const state = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
    return String(state.lastJobIdentity || state.lastCommandHash || '');
  } catch {
    return '';
  }
}

async function writeJson(filePath, payload) {
  await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function hashCommand(command) {
  return createHash('sha256')
      .update(JSON.stringify(command))
      .digest('hex');
}

function parseArgs(rawArgs) {
  const parsed = {
    source: process.env.CENTER_RUNNER_COMMAND_SOURCE || getDefaultCommandSource(),
    stateFile: process.env.CENTER_RUNNER_STATE_FILE || defaultStateFile,
    resultFile: process.env.CENTER_RUNNER_RESULT_FILE || defaultResultFile,
    intervalMs: Number(process.env.CENTER_RUNNER_INTERVAL_MS || 5000),
    once: false,
    dryRun: false
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    const next = () => {
      const value = rawArgs[index + 1];

      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }

      index += 1;
      return value;
    };

    if (arg === '--source') {
      parsed.source = next();
      continue;
    }

    if (arg.startsWith('--source=')) {
      parsed.source = arg.slice('--source='.length);
      continue;
    }

    if (arg === '--interval-ms') {
      parsed.intervalMs = Number(next());
      continue;
    }

    if (arg.startsWith('--interval-ms=')) {
      parsed.intervalMs = Number(arg.slice('--interval-ms='.length));
      continue;
    }

    if (arg === '--once') {
      parsed.once = true;
      continue;
    }

    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(parsed.intervalMs) || parsed.intervalMs < 1000) {
    throw new Error('interval-ms must be at least 1000.');
  }

  return parsed;
}

function printUsage() {
  console.log(`
Usage:
  npm run worker -- [--once] [--dry-run] [--source <file-or-url>] [--interval-ms 5000]

Examples:
  npm run worker -- --once --dry-run
  npm run worker -- --once
  npm run worker -- --source http://100.67.96.22:4317/api/jobs/next
`.trim());
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}