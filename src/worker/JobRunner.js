import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import config from '../common/Config.js';

const SUPPORTED_TOOLS = new Set(['aliveDaily', 'checkAccess']);

class JobRunner {
  validate(command) {
    if (!SUPPORTED_TOOLS.has(command.tool)) {
      throw new Error(`Unsupported tool: ${command.tool}`);
    }

    if (command.tool === 'aliveDaily' && !/^fbc\d+$/.test(command.group)) {
      throw new Error(`Invalid group: ${command.group}`);
    }

    if (command.tool === 'aliveDaily' && !/^[a-z0-9-]+$/.test(command.brand)) {
      throw new Error(`Invalid brand: ${command.brand}`);
    }

    if (!/^@[A-Za-z0-9_-]+$/.test(command.tag)) {
      throw new Error(`Invalid tag: ${command.tag}`);
    }

    const expectedTag = command.tool === 'checkAccess' ? '@checkAccess' : '@smoke';
    if (command.tag !== expectedTag) {
      throw new Error(`Invalid tag for ${command.tool}: ${command.tag}`);
    }

    if (command.tool === 'aliveDaily') {
      const testDir = path.join(config.testsDir, command.group, command.brand);
      if (!fs.existsSync(testDir)) {
        throw new Error(`Test path not found: ${path.relative(config.testRepoRoot, testDir)}`);
      }
    }
  }

  run(command, dryRun = false) {
    this.validate(command);

    const runnerCommand = command.tool === 'checkAccess'
      ? (process.platform === 'win32' ? 'npm.cmd' : 'npm')
      : process.execPath;

    const runnerArgs = command.tool === 'checkAccess'
      ? ['run', 'test', '--', '--grep', command.tag]
      : [config.testScriptPath, command.group, command.brand, '--grep', command.tag];

    if (dryRun) {
      console.log(`[JobRunner] [Dry Run] Would execute: ${runnerCommand} ${runnerArgs.join(' ')}`);
      return { status: 0 };
    }

    console.log(`[JobRunner] Executing: ${runnerCommand} ${runnerArgs.join(' ')}`);

    const result = spawnSync(runnerCommand, runnerArgs, {
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
