import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import config from '../common/Config.js';

class JobRunner {
  validate(command) {
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

    const testDir = path.join(config.testsDir, command.group, command.brand);
    if (!fs.existsSync(testDir)) {
      throw new Error(`Test path not found: ${path.relative(config.testRepoRoot, testDir)}`);
    }
  }

  run(command, dryRun = false) {
    this.validate(command);

    const runnerArgs = [
      config.testScriptPath,
      command.group,
      command.brand,
      '--grep',
      command.tag
    ];

    if (dryRun) {
      console.log(`[JobRunner] [Dry Run] Would execute: ${process.execPath} ${runnerArgs.join(' ')}`);
      return { status: 0 };
    }

    console.log(`[JobRunner] Executing: ${process.execPath} ${runnerArgs.join(' ')}`);

    const result = spawnSync(process.execPath, runnerArgs, {
      cwd: config.testRepoRoot,
      env: process.env,
      shell: false,
      stdio: 'inherit'
    });

    if (result.error) {
      throw new Error(`Failed to start runner: ${result.error.message}`);
    }

    return {
      status: result.status ?? 1
    };
  }
}

export default JobRunner;
