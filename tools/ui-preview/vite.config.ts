import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Your plugin's repo root, relative to this folder. Edit it to match where you
 * put the preview.
 *
 *   '../..'         inside your plugin repo, as tools/ui-preview/
 *   '../my-plugin'  cloned beside your plugin
 *
 * It is the one directory outside this root that Vite may read, so your source
 * has to be under it. See `server.fs.allow` below.
 */
const PLUGIN_ROOT = path.resolve(here, '../..');

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: {
    /**
     * The substitutions that let device code run in a browser. Your own
     * source is imported as it is, so what you see here is the code that ships.
     *
     * The array form, with anchored patterns, because the object form matches
     * by PREFIX: a bare 'react-native' key would also capture 'react-native-fs'
     * and '@react-native-async-storage/...', and whichever entry Vite reached
     * first would win.
     */
    alias: [
      // Not straight to react-native-web: a thin file re-exports it and adds
      // the Android-only APIs it lacks. See src/mocks/react-native.ts.
      { find: /^react-native$/, replacement: path.resolve(here, 'src/mocks/react-native.ts') },
      { find: /^sn-plugin-lib$/, replacement: path.resolve(here, 'src/mocks/sn-plugin-lib.ts') },
      { find: /^react-native-fs$/, replacement: path.resolve(here, 'src/mocks/react-native-fs.ts') },
      {
        find: /^@react-native-async-storage\/async-storage$/,
        replacement: path.resolve(here, 'src/mocks/async-storage.ts'),
      },
      {
        find: /^react-native-view-shot$/,
        replacement: path.resolve(here, 'src/mocks/react-native-view-shot.ts'),
      },
    ],
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.json'],
  },
  define: {
    // react-native-web reads both; without them its modules throw on load.
    __DEV__: 'true',
    'process.env.NODE_ENV': JSON.stringify('development'),
    global: 'globalThis',
  },
  server: {
    port: 5178,
    /**
     * Bind to every interface. `true` means 0.0.0.0, which covers loopback, so
     * http://localhost:5178 works as usual and the preview is also reachable by
     * IP from a tablet or a second machine. It serves a dev page with fixture
     * data and no write path to anything, but if you would rather it stayed on
     * this machine, set a specific address here.
     */
    host: true,
    /**
     * Vite rejects requests whose Host header it does not recognise (DNS
     * rebinding protection), answering "Blocked request", which reads like the
     * server not running. Bare IP addresses are always accepted, so reaching
     * the preview from another machine needs nothing here. Add an entry only
     * for a NAME, such as a `.ts.net` MagicDNS address or a local hostname.
     */
    allowedHosts: ['localhost'],
    fs: {
      // Your plugin's source lives outside this root, so Vite has to be told
      // it may read it.
      allow: [here, PLUGIN_ROOT],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(here, 'index.html'),
        device: path.resolve(here, 'device.html'),
      },
    },
  },
});
