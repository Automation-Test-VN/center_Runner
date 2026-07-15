/**
 * Page Object Model (POM) and Object-Oriented Programming (OOP) Refactored Frontend UI
 */

class RunnerForm {
  constructor(formSelector, onSubmit) {
    this.form = document.querySelector(formSelector);
    this.toolInput = this.form.querySelector('#tool-name');
    this.groupInput = this.form.querySelector('#group-name');
    this.brandInput = this.form.querySelector('#brand-name');
    this.startButton = this.form.querySelector('.start-button');

    this.ispField = document.getElementById('isp-field');
    this.ispOptions = document.getElementById('isp-options');
    this.ispEmpty = document.getElementById('isp-empty');

    this.brandGroups = [];
    this.onSubmit = onSubmit;
    this.onToolChange = null;

    this.initEvents();
  }

  initEvents() {
    this.groupInput.addEventListener('change', () => this.syncBrandOptions());
    this.toolInput.addEventListener('change', () => {
      this.syncToolFields();
      if (this.onToolChange) {
        this.onToolChange(this.toolInput.value);
      }
    });

    this.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (this.onSubmit) {
        await this.onSubmit(this.getValues());
      }
    });
  }

  syncToolFields() {
    const isCheckAccess = this.toolInput.value === 'checkAccess';
    this.groupInput.disabled = isCheckAccess;
    this.brandInput.disabled = isCheckAccess;
    this.ispField.hidden = !isCheckAccess;
  }

  isCheckAccess() {
    return this.toolInput.value === 'checkAccess';
  }

  // Render ISP checkboxes from the online-worker ISP list, preserving current selections.
  setIspOptions(isps) {
    const previous = new Set(this.getSelectedIsps());
    this.ispOptions.innerHTML = '';

    for (const isp of isps) {
      const label = document.createElement('label');
      label.className = 'isp-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = isp;
      checkbox.checked = previous.size === 0 ? true : previous.has(isp);

      const text = document.createElement('span');
      text.textContent = isp;

      label.append(checkbox, text);
      this.ispOptions.append(label);
    }

    this.ispEmpty.hidden = isps.length > 0;
  }

  getSelectedIsps() {
    return [...this.ispOptions.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
  }

  getValues() {
    const tool = this.toolInput.value;

    if (tool === 'checkAccess') {
      return { tool, isps: this.getSelectedIsps() };
    }

    return {
      tool,
      group: this.groupInput.value,
      brand: this.brandInput.value,
      tag: '@smoke'
    };
  }

  setBrandGroups(groups) {
    this.brandGroups = groups;
    this.renderGroupOptions();
    this.syncBrandOptions();
    this.syncToolFields();
  }

  renderGroupOptions() {
    this.groupInput.innerHTML = '';
    for (const group of this.brandGroups) {
      const option = document.createElement('option');
      option.value = group.name;
      option.textContent = group.name;
      this.groupInput.append(option);
    }

    if (this.brandGroups.some((group) => group.name === 'fbc1')) {
      this.groupInput.value = 'fbc1';
    }
  }

  syncBrandOptions() {
    const selectedGroup = this.brandGroups.find((group) => group.name === this.groupInput.value);
    this.brandInput.innerHTML = '';

    for (const brand of selectedGroup?.brands || []) {
      const option = document.createElement('option');
      option.value = brand;
      option.textContent = brand;
      this.brandInput.append(option);
    }

    if (selectedGroup?.brands.includes('mayman')) {
      this.brandInput.value = 'mayman';
    }

    // Trigger standard custom event to notify parent of changes
    this.brandInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setStartButtonState(status) {
    const normalizedStatus = String(status || '').toUpperCase();
    const isBusy = normalizedStatus === 'QUEUING';
    this.startButton.disabled = isBusy;
    this.startButton.textContent = isBusy ? 'Adding...' : 'Start';
    this.startButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }

  onBrandChange(callback) {
    this.brandInput.addEventListener('change', () => {
      callback(this.groupInput.value, this.brandInput.value);
    });
  }
}

class JobTable {
  constructor(tableBodySelector, paginationSelector) {
    this.tableBody = document.querySelector(tableBodySelector);
    this.pagination = document.querySelector(paginationSelector);
    this.maxJobs = 30;
    this.pageSize = 15;
    this.currentPage = 1;
  }

  render(jobs, onOpenReport, onAbortJob, onClearHistory) {
    const visibleJobs = jobs.slice(0, this.maxJobs);
    const pageCount = Math.max(1, Math.ceil(visibleJobs.length / this.pageSize));
    this.currentPage = Math.min(this.currentPage, pageCount);
    const pageStart = (this.currentPage - 1) * this.pageSize;
    const pageJobs = visibleJobs.slice(pageStart, pageStart + this.pageSize);

    this.tableBody.innerHTML = '';

    // Render Clear History button row when there are finished (non-active) jobs
    const finishedJobs = visibleJobs.filter((job) => !job.active);
    if (finishedJobs.length > 0 && onClearHistory) {
      const actionRow = document.createElement('tr');
      actionRow.className = 'history-action-row';
      const actionCell = document.createElement('td');
      actionCell.colSpan = 7;

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.id = 'clear-history-button';
      clearBtn.className = 'clear-history-button';
      clearBtn.textContent = `🗑 Xóa lịch sử (${finishedJobs.length})`;
      clearBtn.addEventListener('click', () => {
        if (onClearHistory) {
          onClearHistory(finishedJobs.length);
        }
      });

      actionCell.append(clearBtn);
      actionRow.append(actionCell);
      this.tableBody.append(actionRow);
    }

    if (visibleJobs.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = 'No jobs yet.';
      row.append(cell);
      this.tableBody.append(row);
      this.renderPagination(visibleJobs.length, pageCount);
      return;
    }

    for (const job of pageJobs) {
      const row = document.createElement('tr');
      row.dataset.status = job.status || 'IDLE';

      row.append(
        this.tableCell(job.reportJobId || job.jobId || '-'),
        this.tableCell(job.command?.group || '-'),
        this.tableCell(job.command?.brand || job.command?.isp || '-'),
        this.statusCell(job.status || '-'),
        this.tableCell(Number.isInteger(job.exitCode) ? String(job.exitCode) : '-'),
        this.tableCell(this.formatTime(job.createdAt || job.startedAt || job.finishedAt)),
        this.reportCell(job, onOpenReport, onAbortJob)
      );

      this.tableBody.append(row);
    }

    this.renderPagination(visibleJobs.length, pageCount);
  }

  renderPagination(totalJobs, pageCount) {
    if (!this.pagination) {
      return;
    }

    this.pagination.innerHTML = '';

    if (totalJobs === 0) {
      return;
    }

    const status = document.createElement('span');
    const pageStart = (this.currentPage - 1) * this.pageSize + 1;
    const pageEnd = Math.min(this.currentPage * this.pageSize, totalJobs);
    status.className = 'job-pagination-status';
    status.textContent = `${pageStart}-${pageEnd} / ${totalJobs} jobs`;
    this.pagination.append(status);

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'job-pagination-buttons';

    for (let page = 1; page <= pageCount; page += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'page-button';
      button.textContent = String(page);
      button.disabled = page === this.currentPage;
      button.setAttribute('aria-current', page === this.currentPage ? 'page' : 'false');
      button.addEventListener('click', () => {
        this.currentPage = page;
        this.onPageChange?.();
      });
      buttonGroup.append(button);
    }

    this.pagination.append(buttonGroup);
  }

  tableCell(value) {
    const cell = document.createElement('td');
    cell.textContent = value;
    return cell;
  }

  statusCell(status) {
    const cell = this.tableCell(status);
    cell.className = `status-${String(status).toLowerCase()}`;
    return cell;
  }

  reportCell(job, onOpenReport, onAbortJob) {
    const cell = document.createElement('td');

    if (['QUEUED', 'RUNNING'].includes(job.status)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stop-button';
      button.textContent = 'Stop';
      button.addEventListener('click', () => {
        if (onAbortJob) {
          onAbortJob(job);
        }
      });
      cell.append(button);
      return cell;
    }

    if (!job.reportUrl || !['DONE', 'FAILED'].includes(job.status)) {
      cell.textContent = '-';
      return cell;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'report-button';
    button.textContent = 'Open';
    button.addEventListener('click', () => {
      if (onOpenReport) {
        onOpenReport(job);
      }
    });
    cell.append(button);
    return cell;
  }

  formatTime(value) {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleString();
  }
}

class JobSummary {
  constructor({ jobIdId, groupId, brandId, statusId, aliveNoteId }) {
    this.jobIdLabel = document.getElementById(jobIdId);
    this.groupLabel = document.getElementById(groupId);
    this.brandLabel = document.getElementById(brandId);
    this.statusLabel = document.getElementById(statusId);
    this.aliveNoteLabel = document.getElementById(aliveNoteId);
  }

  update({ jobId, group, brand, status, note }) {
    if (jobId !== undefined) this.jobIdLabel.textContent = jobId;
    if (group !== undefined) this.groupLabel.textContent = group;
    if (brand !== undefined) this.brandLabel.textContent = brand;
    if (status !== undefined) this.statusLabel.textContent = status;
    if (note !== undefined) this.aliveNoteLabel.textContent = note;
  }

  setStatus(status) {
    this.statusLabel.textContent = status;
  }

  setAliveNote(note) {
    this.aliveNoteLabel.textContent = note;
  }
}

class ReportViewer {
  constructor(iframeSelector) {
    this.iframe = document.querySelector(iframeSelector);
  }

  load(url, jobId) {
    this.iframe.src = `${url}?jobId=${encodeURIComponent(jobId)}`;
  }

  clear() {
    this.iframe.removeAttribute('src');
  }
}

class WorkerPanel {
  constructor(listSelector) {
    this.list = document.querySelector(listSelector);
  }

  render(workers) {
    this.list.innerHTML = '';

    if (!workers.length) {
      const empty = document.createElement('li');
      empty.className = 'worker-empty';
      empty.textContent = 'Chưa có worker nào.';
      this.list.append(empty);
      return;
    }

    for (const worker of workers) {
      const item = document.createElement('li');
      item.className = `worker-item ${worker.online ? 'is-online' : 'is-offline'}`;

      const dot = document.createElement('span');
      dot.className = 'worker-dot';

      const info = document.createElement('span');
      info.className = 'worker-info';

      const name = document.createElement('span');
      name.className = 'worker-name';
      name.textContent = worker.name;

      const isp = document.createElement('span');
      isp.className = 'worker-isp';
      isp.textContent = worker.isp || 'no ISP';

      info.append(name, isp);
      item.append(info, dot);
      this.list.append(item);
    }
  }

  // Distinct ISPs of workers that are currently online — drives the checkAccess ISP checkboxes.
  onlineIsps(workers) {
    return [...new Set(workers.filter((worker) => worker.online && worker.isp).map((worker) => worker.isp))].sort();
  }
}

class AppController {
  constructor() {
    this.form = new RunnerForm('#runner-form', (values) => this.startJob(values));
    this.table = new JobTable('#job-list', '#job-pagination');
    this.table.onPageChange = () => this.loadJobs();
    this.summary = new JobSummary({
      jobIdId: 'job-id',
      groupId: 'group-label',
      brandId: 'brand-label',
      statusId: 'status-label',
      aliveNoteId: 'alive-note'
    });
    this.reportViewer = new ReportViewer('#report-frame');
    this.workerPanel = new WorkerPanel('#worker-list');
    this.jobPollTimer = null;
    this.workerPollTimer = null;
  }

  async initialize() {
    this.form.onBrandChange((group, brand) => {
      this.summary.update({ group, brand });
    });

    // Refresh the ISP checkboxes immediately when the user switches to Check Access.
    this.form.onToolChange = (tool) => {
      if (tool === 'checkAccess') {
        this.loadWorkers();
      }
    };

    await this.loadBrandGroups();
    await this.loadJobs();
    await this.loadWorkers();
    this.startJobPolling();
    this.startWorkerPolling();
  }

  // One poll of /api/workers both renders the status panel and refreshes the online-ISP checkboxes.
  async loadWorkers() {
    try {
      const response = await fetch('/api/workers');
      if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}.`);
      }

      const data = await response.json();
      const workers = Array.isArray(data.workers) ? data.workers : [];
      this.workerPanel.render(workers);
      this.form.setIspOptions(this.workerPanel.onlineIsps(workers));
    } catch (error) {
      this.summary.setAliveNote(`Workers Error: ${error.message}`);
    }
  }

  async loadBrandGroups() {
    try {
      const response = await fetch('/api/brands');
      if (!response.ok) throw new Error('Failed to load brands');
      const data = await response.json();
      const groups = Array.isArray(data.groups) ? data.groups : [];
      this.form.setBrandGroups(groups);
    } catch (error) {
      this.summary.setAliveNote(`Brands Error: ${error.message}`);
    }
  }

  async loadJobs() {
    try {
      const response = await fetch('/api/jobs');
      if (!response.ok) {
        throw new Error(`Request failed with HTTP ${response.status}.`);
      }

      const data = await response.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      
      this.table.render(
        jobs,
        (job) => {
          this.reportViewer.load(job.reportUrl, job.reportJobId || job.jobId);
        },
        (job) => {
          this.abortJob(job);
        },
        (count) => {
          this.clearHistory(count);
        }
      );

      this.syncJobSummary(jobs);
    } catch (error) {
      this.summary.setAliveNote(`Jobs Error: ${error.message}`);
    }
  }

  syncJobSummary(jobs) {
    const activeJobs = jobs.filter((job) => job.active && ['QUEUED', 'RUNNING'].includes(job.status));

    if (activeJobs.length === 0) {
      const currentStatus = document.getElementById('status-label').textContent;
      if (currentStatus === 'QUEUED' || currentStatus === 'RUNNING') {
        this.summary.setStatus('IDLE');
      }
      return;
    }

    const runningCount = activeJobs.filter((job) => job.status === 'RUNNING').length;
    const queuedCount = activeJobs.filter((job) => job.status === 'QUEUED').length;
    const newest = activeJobs[0];

    this.summary.update({
      jobId: newest.jobId || '-',
      group: newest.command?.group || '-',
      brand: newest.command?.brand || '-',
      status: runningCount > 0 ? 'RUNNING' : 'QUEUED',
      note: `Running: ${runningCount} | Queued: ${queuedCount}`
    });
  }

  async abortJob(job) {
    if (!confirm(`Bạn có chắc chắn muốn dừng Job ${job.jobId} không?`)) {
      return;
    }

    try {
      this.summary.setAliveNote(`Aborting ${job.jobId}...`);
      await this.postJson('/api/jobs/abort', { jobId: job.jobId });
      this.summary.setAliveNote(`Aborted ${job.jobId} successfully.`);
      await this.loadJobs();
    } catch (error) {
      this.summary.setAliveNote(`Abort Error: ${error.message}`);
    }
  }

  async clearHistory(count) {
    if (!confirm(`Bạn có chắc chắn muốn xóa ${count} lịch sử report không?\nHành động này không thể hoàn tác.`)) {
      return;
    }

    try {
      this.summary.setAliveNote('Đang xóa lịch sử...');
      const result = await this.postJson('/api/jobs/clear-history', {});
      this.summary.setAliveNote(`Đã xóa ${result.deletedCount} lịch sử report.`);
      this.reportViewer.clear();
      await this.loadJobs();
    } catch (error) {
      this.summary.setAliveNote(`Clear History Error: ${error.message}`);
    }
  }

  async startJob(values) {
    this.summary.setStatus('QUEUING');
    this.form.setStartButtonState('QUEUING');
    this.summary.setAliveNote('');

    try {
      const data = await this.postJson('/api/jobs', values);
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const first = jobs[0];

      if (first) {
        this.summary.update({
          jobId: first.jobId,
          group: first.command.group || '-',
          brand: first.command.brand || first.command.isp || '-',
          status: first.status,
          note: first.command.tool === 'checkAccess'
            ? `Queued Check Access: ${jobs.map((job) => job.command.isp).join(', ')}`
            : `Queued ${first.command.group}/${first.command.brand}`
        });
      }

      await this.loadJobs();
    } catch (error) {
      this.summary.setStatus('FAILED');
      this.summary.setAliveNote(error.message);
    } finally {
      this.form.setStartButtonState('IDLE');
    }
  }

  async postJson(url, payload) {
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

  startJobPolling() {
    this.stopJobPolling();
    this.jobPollTimer = window.setInterval(() => this.loadJobs(), 3000);
  }

  stopJobPolling() {
    if (this.jobPollTimer) {
      window.clearInterval(this.jobPollTimer);
      this.jobPollTimer = null;
    }
  }

  startWorkerPolling() {
    this.stopWorkerPolling();
    this.workerPollTimer = window.setInterval(() => this.loadWorkers(), 60000);
  }

  stopWorkerPolling() {
    if (this.workerPollTimer) {
      window.clearInterval(this.workerPollTimer);
      this.workerPollTimer = null;
    }
  }
}

// Instantiate and start the app
document.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  app.initialize();
});
