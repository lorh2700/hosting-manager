import { build } from 'esbuild';

const result = await build({
  entryPoints: ['services/api/main.ts'],
  outdir: 'dist/backend',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outExtension: { '.js': '.cjs' },
  packages: 'external',
  tsconfig: 'services/api/tsconfig.json',
  sourcemap: false,
  metafile: true,
});
const forbidden = Object.keys(result.metafile.inputs).filter(file => /(^|\/)app\//.test(file) || /(^|\/)lib\/(auth|core\/http)\.ts$/.test(file));
const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports).map(item => item.path);
if (forbidden.length || imports.some(value => /^next(?:\/|$)/.test(value))) throw new Error(`Backend imported Next.js: ${forbidden.join(', ')}`);
console.log('Standalone API built; no Next.js runtime imports.');
