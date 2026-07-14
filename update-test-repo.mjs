import RepoUpdaterConfig from './src/updater/RepoUpdaterConfig.js';
import RepoUpdater from './src/updater/RepoUpdater.js';

try {
  const config = new RepoUpdaterConfig(process.argv.slice(2));
  const updater = new RepoUpdater(config);
  await updater.start();
} catch (error) {
  console.error(`[RepoUpdater] Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
