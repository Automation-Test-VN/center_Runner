export const ALIVE_DAILY_TOOL = 'aliveDaily';
export const CHECK_ACCESS_TOOL = 'checkAccess';
export const ALIVE_DAILY_JOB_ID_PATTERN = /^AL-\d{8}-\d{6}-[a-z0-9-]+-[A-Z0-9]{2}$/;
export const ALIVE_DAILY_JOB_ID_FORMAT = 'AL-YYYYMMDD-HHMMSS-brand-XX';
// checkAccess queue ids now carry the target worker ISP as a suffix, chosen when the job is
// created (one job per selected ISP). The base id (without ISP) is shared across the ISPs picked
// in the same Start so they group together; the full queue/report id includes the ISP.
export const CHECK_ACCESS_JOB_ID_BASE_PATTERN = /^CA-\d{8}-\d{6}-[A-Z0-9]{2}$/;
export const CHECK_ACCESS_JOB_ID_PATTERN = /^CA-\d{8}-\d{6}-[A-Z0-9]{2}(-[A-Z0-9]+)?$/;
export const CHECK_ACCESS_JOB_ID_FORMAT = 'CA-YYYYMMDD-HHMMSS-XX-ISP';
// A checkAccess id that includes the ISP suffix (used for report path/URL derivation).
export const CHECK_ACCESS_REPORT_JOB_ID_PATTERN = /^CA-\d{8}-\d{6}-[A-Z0-9]{2}-[A-Z0-9]+$/;

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
  }],
  [CHECK_ACCESS_TOOL, {
    pattern: CHECK_ACCESS_JOB_ID_PATTERN,
    format: CHECK_ACCESS_JOB_ID_FORMAT,
    create({ isp, date = new Date() } = {}) {
      const base = createCheckAccessBaseId(date);
      return isp ? appendIspTag(base, isp) : base;
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

export function normalizeIspTag(isp) {
  return String(isp || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// The base checkAccess id (without ISP). Generate this once per Start and append each selected
// ISP with appendIspTag, so all ISP jobs of one Start share the same base id.
export function createCheckAccessBaseId(date = new Date()) {
  const suffix = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `CA-${formatJobStamp(date)}-${suffix}`;
}

export function appendIspTag(baseId, isp) {
  const ispTag = normalizeIspTag(isp);

  if (!ispTag) {
    throw new Error('A checkAccess job id requires a non-empty ISP tag.');
  }

  return `${baseId}-${ispTag}`;
}

// Accepts either a canonical job id or a checkAccess id with an ISP suffix appended,
// for use anywhere a report path/URL is derived instead of a queue/result file lookup.
export function isValidReportJobId(jobId) {
  const value = String(jobId || '');
  return isValidJobId(value) || CHECK_ACCESS_REPORT_JOB_ID_PATTERN.test(value);
}

export function createJobIdForTool(tool, options) {
  return getJobIdConfig(tool).create(options);
}

export function getJobIdFormatForTool(tool) {
  return getJobIdConfig(tool).format;
}

export function resolveReportUrl(command, jobId = '') {
  const reportNamespace = resolveReportNamespace(command);

  if (!reportNamespace) {
    return null;
  }

  if (isValidReportJobId(jobId)) {
    return `/reports/${reportNamespace}/${jobId}/report.html`;
  }

  return `/reports/${reportNamespace}/report.html`;
}

export function resolveReportNamespace(command) {
  if (String(command?.tool || '').trim() === CHECK_ACCESS_TOOL) {
    return CHECK_ACCESS_TOOL;
  }

  const brand = String(command?.brand || '').trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(brand) ? brand : null;
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
