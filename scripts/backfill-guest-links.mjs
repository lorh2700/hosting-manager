import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--apply') || args.length > 1) {
  console.error('Usage: node scripts/backfill-guest-links.mjs [--apply]');
  process.exitCode = 1;
} else {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await build({ absWorkingDir: root, entryPoints: ['scripts/backfill-guest-links.ts'],
    outfile: 'dist/backend/guest-link-backfill.cjs', bundle: true, platform: 'node', target: 'node22',
    format: 'cjs', packages: 'external', tsconfig: 'tsconfig.json', sourcemap: false });
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--env-file-if-exists=.env.local',
    'dist/backend/guest-link-backfill.cjs', ...args], { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('error', () => { console.error('GUEST_LINK_BACKFILL_START_FAILED'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
