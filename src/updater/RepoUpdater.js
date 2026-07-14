import { spawn } from 'node:child_process';
import { promises as fsp } from 'node:fs';

class RepoUpdater {
  constructor(config) {
    this.config = config;
  }

  async start() {
    await fsp.mkdir(this.config.jobsDir, { recursive: true });

    console.log(`[RepoUpdater] Test repo: ${this.config.testRepoRoot}`);
    console.log(`[RepoUpdater] Poll interval: ${this.config.pollIntervalMs}ms`);

    if (this.config.once) {
      await this.tick();
      return;
    }

    console.log('[RepoUpdater] Watching for idle windows to pull...');

    for (;;) {
      try {
        await this.tick();
      } catch (error) {
        console.error(`[RepoUpdater] ${error instanceof Error ? error.message : String(error)}`);
      }

      await this.delay(this.config.pollIntervalMs);
    }
  }

  async tick() {
    const hasRunningJobs = await this.hasRunningJobs();

    if (hasRunningJobs) {
      console.log('[RepoUpdater] Jobs are running, skipping this cycle.');
      return;
    }

    const lock = await this.acquireUpdaterLock();

    if (!lock) {
      console.log('[RepoUpdater] Another updater instance holds the lock, skipping.');
      return;
    }

    try {
      // Re-check after acquiring the lock in case a job started while we waited.
      if (await this.hasRunningJobs()) {
        console.log('[RepoUpdater] Job started while acquiring lock, skipping this cycle.');
        return;
      }

      await this.pullTestRepo();
    } finally {
      await this.releaseUpdaterLock(lock);
    }
  }

  async hasRunningJobs() {
    try {
      const entries = await fsp.readdir(this.config.runningJobsDir);
      return entries.some((entry) => entry.endsWith('.json'));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return false;
      }

      throw error;
    }
  }

  async acquireUpdaterLock() {
    try {
      const handle = await fsp.open(this.config.lockPath, 'wx');
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        acquiredAt: new Date().toISOString()
      }));
      return { handle, lockPath: this.config.lockPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw new Error(`Cannot acquire updater lock: ${error.message}`);
      }

      if (await this.clearStaleUpdaterLock()) {
        return this.acquireUpdaterLock();
      }

      return null;
    }
  }

  async clearStaleUpdaterLock() {
    try {
      const raw = await fsp.readFile(this.config.lockPath, 'utf8');
      const lock = JSON.parse(raw);
      const ownerPid = Number(lock.pid);

      if (Number.isInteger(ownerPid) && ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);
          return false;
        } catch (error) {
          if (error?.code === 'EPERM') {
            return false;
          }
        }
      }

      await fsp.unlink(this.config.lockPath);
      console.log(`[RepoUpdater] Removed stale updater lock from PID ${lock.pid || 'unknown'}.`);
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return true;
      }

      return false;
    }
  }

  async releaseUpdaterLock(lock) {
    if (!lock) {
      return;
    }

    try {
      await lock.handle.close();
    } finally {
      await fsp.unlink(lock.lockPath).catch((error) => {
        if (error?.code !== 'ENOENT') {
          console.error(`[RepoUpdater] Cannot remove updater lock: ${error.message}`);
        }
      });
    }
  }

  async pullTestRepo() {
    console.log(`[RepoUpdater] Updating test repo: git pull --ff-only (${this.config.testRepoRoot})`);

    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn('git', ['pull', '--ff-only'], {
        cwd: this.config.testRepoRoot,
        shell: false,
        stdio: 'inherit'
      });

      child.on('close', (code) => resolve(code ?? 1));
      child.on('error', reject);
    });

    if (exitCode !== 0) {
      console.error(`[RepoUpdater] git pull --ff-only failed with exit code ${exitCode}.`);
      return;
    }

    console.log('[RepoUpdater] Test repo updated successfully.');
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default RepoUpdater;
