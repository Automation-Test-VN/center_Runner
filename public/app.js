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

let brandGroups = [];
let resultPollTimer = null;

loadBrandGroups();
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
  startButton.disabled = true;
  aliveNote.textContent = '';
  clearReportFrame();
  stopResultPolling();

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
    aliveNote.textContent = 'Saved latest-command.json';
    startResultPolling(job.jobId);
  } catch (error) {
    setStatus('FAILED');
    aliveNote.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    startButton.disabled = false;
  }
}

function startResultPolling(jobId) {
  resultPollTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/api/jobs/${jobId}/result`);
      if (response.status === 404) {
        return;
      }

      const result = await response.json();
      const status = result.status || 'DONE';
      setStatus(status);

      if (!['DONE', 'FAILED'].includes(status)) {
        aliveNote.textContent = status === 'RUNNING' ? 'Worker is running this job' : 'Waiting for worker';
        return;
      }

      aliveNote.textContent = `Finished with exitCode=${result.exitCode}`;

      if (result.reportUrl) {
        reportFrame.src = `${result.reportUrl}?jobId=${encodeURIComponent(jobId)}`;
      }

      stopResultPolling();
    } catch (error) {
      setStatus('FAILED');
      aliveNote.textContent = error instanceof Error ? error.message : String(error);
      stopResultPolling();
    }
  }, 3000);
}

function stopResultPolling() {
  if (resultPollTimer) {
    window.clearInterval(resultPollTimer);
    resultPollTimer = null;
  }
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

function clearReportFrame() {
  reportFrame.removeAttribute('src');
}

function setStatus(status) {
  statusLabel.textContent = status;
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
