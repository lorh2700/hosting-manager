import { build } from 'esbuild';

await build({
  entryPoints: ['scripts/run-background-job.ts'],
  outfile: 'dist/backend/background-jobs.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  sourcemap: false,
});
console.log('Cloud Run background job runner built.');
