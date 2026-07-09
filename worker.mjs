import WorkerConfig from './src/worker/WorkerConfig.js';
import Worker from './src/worker/Worker.js';

try {
  const workerConfig = new WorkerConfig(process.argv.slice(2));
  const worker = new Worker(workerConfig);
  await worker.start();
} catch (error) {
  console.error(`[CenterWorker] Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}