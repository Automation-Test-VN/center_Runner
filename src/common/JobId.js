export const ALIVE_DAILY_TOOL = 'aliveDaily';
export const ALIVE_DAILY_JOB_ID_PATTERN = /^AL-\d{8}-\d{6}-[a-z0-9-]+-[A-Z0-9]{2}$/;
export const ALIVE_DAILY_JOB_ID_FORMAT = 'AL-YYYYMMDD-HHMMSS-brand-XX';

export const JOB_RESULT_PATH_PATTERN = /^\/api\/jobs\/([^/]+)\/result$/;

// Add new tools here with their own pattern, format label, and id generator.
const JOB_ID_CONFIG_BY_TOOL = new Map([
  [ALIVE_DAILY_TOOL, {
    pattern: ALIVE_DAILY_JOB_ID_PATTERN,
    format: ALIVE_DAILY_JOB_ID_FORMAT,
    create({ brand, date = new Date() }) {
      const normalizedBrand = String(brand || '').trim().toLowerCase();
      const suffix = Math.random().toString(36).slice(2, 4).toUpperCase();
      return `AL-${formatJobStamp(date)}-${normalizedBrand}-${suffix}`;
    }
  }]
]);

const JOB_ID_CONFIGS = [...JOB_ID_CONFIG_BY_TOOL.values()];

export function isValidJobId(jobId) {
  const value = String(jobId || '');
  return JOB_ID_CONFIGS.some((config) => config.pattern.test(value));
}

export function isValidJobIdForTool(tool, jobId) {
  return getJobIdConfig(tool).pattern.test(String(jobId || ''));
}

export function isValidJobFileName(fileName) {
  const value = String(fileName || '');
  return value.endsWith('.json') && isValidJobId(value.slice(0, -'.json'.length));
}

export function createJobIdForTool(tool, options) {
  return getJobIdConfig(tool).create(options);
}

export function getJobIdFormatForTool(tool) {
  return getJobIdConfig(tool).format;
}

export function resolveReportUrl(command, jobId = '') {
  const brand = String(command?.brand || '').trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(brand)) {
    return null;
  }

  if (isValidJobId(jobId)) {
    return `/reports/${brand}/${jobId}/report.html`;
  }

  return `/reports/${brand}/report.html`;
}

export function formatJobStamp(date) {
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

function getJobIdConfig(tool) {
  const config = JOB_ID_CONFIG_BY_TOOL.get(String(tool || '').trim());

  if (!config) {
    throw new Error(`Unsupported job id tool: ${tool}`);
  }

  return config;
}
