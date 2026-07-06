import path from 'node:path';
import config from '../common/Config.js';

class WorkerConfig {
  constructor(rawArgs = []) {
    this.source = process.env.CENTER_RUNNER_COMMAND_SOURCE || config.latestCommandFile;
    this.stateFile = process.env.CENTER_RUNNER_STATE_FILE || path.join(config.jobsDir, 'worker-state.json');
    this.resultFile = process.env.CENTER_RUNNER_RESULT_FILE || config.latestResultFile;
    this.intervalMs = Number(process.env.CENTER_RUNNER_INTERVAL_MS || 5000);
    this.once = false;
    this.dryRun = false;

    this.parse(rawArgs);
    this.validate();
  }

  parse(rawArgs) {
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
        this.source = next();
        continue;
      }

      if (arg.startsWith('--source=')) {
        this.source = arg.slice('--source='.length);
        continue;
      }

      if (arg === '--interval-ms') {
        this.intervalMs = Number(next());
        continue;
      }

      if (arg.startsWith('--interval-ms=')) {
        this.intervalMs = Number(arg.slice('--interval-ms='.length));
        continue;
      }

      if (arg === '--once') {
        this.once = true;
        continue;
      }

      if (arg === '--dry-run') {
        this.dryRun = true;
        continue;
      }

      if (arg === '--help' || arg === '-h') {
        this.printUsage();
        process.exit(0);
      }

      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  validate() {
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 1000) {
      throw new Error('interval-ms must be at least 1000.');
    }
  }

  printUsage() {
    console.log(`
Usage:
  npm run worker -- [--once] [--dry-run] [--source <file-or-url>] [--interval-ms 5000]

Examples:
  npm run worker -- --once --dry-run
  npm run worker -- --once
  npm run worker -- --source http://localhost:4317/api/jobs/next
    `.trim());
  }
}

export default WorkerConfig;
