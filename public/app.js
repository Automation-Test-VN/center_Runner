const form = document.querySelector('#runner-form');
const toolInput = document.querySelector('#tool-name');
const groupInput = document.querySelector('#group-name');
const brandInput = document.querySelector('#brand-name');
const domainInput = document.querySelector('#domain-url');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const reportFrame = document.querySelector('#report-frame');
const jobIdLabel = document.querySelector('#job-id');
const groupLabel = document.querySelector('#group-label');
const brandLabel = document.querySelector('#brand-label');
const statusLabel = document.querySelector('#status-label');
const aliveNote = document.querySelector('#alive-note');
const startButton = document.querySelector('.start-button');
const jobList = document.querySelector('#job-list');

let brandGroups = [];
let jobPollTimer = null;

loadBrandGroups();
loadJobs();
startJobPolling();
syncToolState();
clearReportFrame();

toolInput.addEventListener('change', syncToolState);
groupInput.addEventListener('change', syncBrandOptions);
brandInput.addEventListener('change', syncLabels);

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await startJob();
});

async function startJob() {
  setStatus('QUEUING');
  setStartButtonState('QUEUING');
  aliveNote.textContent = '';

  try {
    const job = await postJson('/api/jobs', {
      tool: toolInput.value,
      group: groupInput.value,
      brand: brandInput.value,
      tag: '@smoke',
      domainUrl: domainInput.value,
      username: usernameInput.value,
      password: passwordInput.value
    });

    jobIdLabel.textContent = job.jobId;
    groupLabel.textContent = job.command.group;
    brandLabel.textContent = job.command.brand;
    setStatus(job.status);
    aliveNote.textContent = `Queued ${job.command.group}/${job.command.brand}`;
    await loadJobs();
  } catch (error) {
    setStatus('FAILED');
    aliveNote.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setStartButtonState('IDLE');
  }
}

function startJobPolling() {
  stopJobPolling();
  jobPollTimer = window.setInterval(loadJobs, 3000);
}

function stopJobPolling() {
  if (jobPollTimer) {
    window.clearInterval(jobPollTimer);
    jobPollTimer = null;
  }
}

async function loadJobs() {
  try {
    const response = await fetch('/api/jobs');
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}.`);
    }

    const data = await response.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    renderJobs(jobs);
    syncJobSummary(jobs);
  } catch (error) {
    aliveNote.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderJobs(jobs) {
  jobList.innerHTML = '';

  if (jobs.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 7;
    cell.textContent = 'No jobs yet.';
    row.append(cell);
    jobList.append(row);
    return;
  }

  for (const job of jobs) {
    const row = document.createElement('tr');
    row.dataset.status = job.status || 'IDLE';

    row.append(
      tableCell(job.jobId || '-'),
      tableCell(job.command?.group || '-'),
      tableCell(job.command?.brand || '-'),
      statusCell(job.status || '-'),
      tableCell(Number.isInteger(job.exitCode) ? String(job.exitCode) : '-'),
      tableCell(formatTime(job.createdAt || job.startedAt || job.finishedAt)),
      reportCell(job)
    );

    jobList.append(row);
  }
}

function syncJobSummary(jobs) {
  const activeJobs = jobs.filter((job) => job.active && ['QUEUED', 'RUNNING'].includes(job.status));

  if (activeJobs.length === 0) {
    if (statusLabel.textContent === 'QUEUED' || statusLabel.textContent === 'RUNNING') {
      setStatus('IDLE');
    }

    return;
  }

  const runningCount = activeJobs.filter((job) => job.status === 'RUNNING').length;
  const queuedCount = activeJobs.filter((job) => job.status === 'QUEUED').length;
  const newest = activeJobs[0];

  jobIdLabel.textContent = newest.jobId || '-';
  groupLabel.textContent = newest.command?.group || '-';
  brandLabel.textContent = newest.command?.brand || '-';
  setStatus(runningCount > 0 ? 'RUNNING' : 'QUEUED');
  aliveNote.textContent = `Running: ${runningCount} | Queued: ${queuedCount}`;
}

async function loadBrandGroups() {
  try {
    const response = await fetch('/api/brands');
    const data = await response.json();
    brandGroups = Array.isArray(data.groups) ? data.groups : [];
    renderGroupOptions();
    syncBrandOptions();
  } catch (error) {
    aliveNote.textContent = error instanceof Error ? error.message : String(error);
  }
}

function renderGroupOptions() {
  groupInput.innerHTML = '';

  for (const group of brandGroups) {
    const option = document.createElement('option');
    option.value = group.name;
    option.textContent = group.name;
    groupInput.append(option);
  }

  if (brandGroups.some((group) => group.name === 'fbc1')) {
    groupInput.value = 'fbc1';
  }
}

function syncBrandOptions() {
  const selectedGroup = brandGroups.find((group) => group.name === groupInput.value);
  brandInput.innerHTML = '';

  for (const brand of selectedGroup?.brands || []) {
    const option = document.createElement('option');
    option.value = brand;
    option.textContent = brand;
    brandInput.append(option);
  }

  if (selectedGroup?.brands.includes('mayman')) {
    brandInput.value = 'mayman';
  }

  syncLabels();
}

function syncToolState() {
  const usesFrameworkConfig = toolInput.value === 'aliveDaily';
  domainInput.disabled = usesFrameworkConfig;
  usernameInput.disabled = usesFrameworkConfig;
  passwordInput.disabled = usesFrameworkConfig;
  domainInput.value = usesFrameworkConfig ? '' : domainInput.value;
  usernameInput.value = usesFrameworkConfig ? '' : usernameInput.value;
  passwordInput.value = usesFrameworkConfig ? '' : passwordInput.value;
}

function syncLabels() {
  groupLabel.textContent = groupInput.value || '-';
  brandLabel.textContent = brandInput.value || '-';
}

function tableCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  return cell;
}

function statusCell(status) {
  const cell = tableCell(status);
  cell.className = `status-${String(status).toLowerCase()}`;
  return cell;
}

function reportCell(job) {
  const cell = document.createElement('td');

  if (!job.reportUrl || !['DONE', 'FAILED'].includes(job.status)) {
    cell.textContent = '-';
    return cell;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'report-button';
  button.textContent = 'Open';
  button.addEventListener('click', () => {
    reportFrame.src = `${job.reportUrl}?jobId=${encodeURIComponent(job.jobId)}`;
  });
  cell.append(button);
  return cell;
}

function formatTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString();
}

function clearReportFrame() {
  reportFrame.removeAttribute('src');
}

function setStatus(status) {
  statusLabel.textContent = status;
}

function setStartButtonState(status) {
  const normalizedStatus = String(status || '').toUpperCase();
  const isBusy = normalizedStatus === 'QUEUING';

  startButton.disabled = isBusy;
  startButton.textContent = isBusy ? 'Adding...' : 'Start';
  startButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
  }

  return data;
}
