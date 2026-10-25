import * as esbuild from 'esbuild';
const M = new URL('../../apps/mobile/node_modules', import.meta.url).pathname;
const R = new URL('../../node_modules', import.meta.url).pathname;
const stub = (filtro, destino) => ({
  name: 'stub-' + destino,
  setup(b) { b.onResolve({ filter: filtro }, () => ({ path: new URL(destino, import.meta.url).pathname })); },
});
await esbuild.build({
  entryPoints: ['entry.tsx'],
  bundle: true, outfile: 'out.js', format: 'iife',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'jsx' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
  alias: { 'react-native': 'react-native-web' },
  nodePaths: [R, M],
  plugins: [
    stub(/state\/branding-context$/, './stubs/branding.tsx'),
    stub(/^expo-router$/, './stubs/router.tsx'),
    stub(/^@expo\/vector-icons$/, './stubs/icons.tsx'),
    stub(/^expo-image$/, './stubs/image.tsx'),
  ],
});
console.log('bundle listo');
