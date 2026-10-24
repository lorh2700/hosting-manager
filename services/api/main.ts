import { backendConfig } from './config';
import { createBackendDatabase } from '../../packages/data/backend-client';
import { createBackendApplication } from './application';
import { createBackendDependencies } from './runtime';

async function main() {
  const config = backendConfig();
  if ((process.env.BACKEND_COMMAND_SECRET || '').length < 32) throw new Error('BACKEND_COMMAND_SECRET must contain at least 32 characters.');
  const database = createBackendDatabase();
  const dependencies = createBackendDependencies(database, config, process.env.BACKEND_COMMAND_SECRET!);
  const app = await createBackendApplication(dependencies, config);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await dependencies.close?.();
  };
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  await app.listen(config.port, config.host);
  console.log(JSON.stringify({ component: 'staff-api', event: 'listening', host: config.host, port: config.port }));
}

main().catch(error => {
  console.error(JSON.stringify({ component: 'staff-api', event: 'startup-failed', reason: error instanceof Error && /required|must|Invalid|Explicit|cannot/.test(error.message) ? error.message : 'Check server configuration and dependency compatibility.' }));
  process.exitCode = 1;
});
