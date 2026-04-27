import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import path from 'node:path';
import dotenv from 'dotenv';

// Pull EXPO_PUBLIC_* vars from the parent app's .env so the bundled
// api/client.ts ends up with the same backend URL as the host app.
const parentEnv =
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') }).parsed || {};

// Bundles the Lexical long-post editor (the same component web's HomeScreen
// uses) into a single inlined HTML file. The native app loads this HTML via
// `react-native-webview` so editing/rendering parity with web is automatic.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  define: {
    // api/client.ts reads `process.env.EXPO_PUBLIC_API_BASE_URL` etc. Vite
    // doesn't replace `process.env.*` automatically — define them here so
    // the bundle ships with the right values baked in.
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.EXPO_PUBLIC_API_BASE_URL': JSON.stringify(parentEnv.EXPO_PUBLIC_API_BASE_URL || ''),
    'process.env.EXPO_PUBLIC_MEDIA_BASE_URL': JSON.stringify(parentEnv.EXPO_PUBLIC_MEDIA_BASE_URL || ''),
    'process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID': JSON.stringify(parentEnv.EXPO_PUBLIC_GOOGLE_CLIENT_ID || ''),
    'process.env.EXPO_PUBLIC_APPLE_CLIENT_ID': JSON.stringify(parentEnv.EXPO_PUBLIC_APPLE_CLIENT_ID || ''),
    'process.env.EXPO_PUBLIC_SOCIAL_AUTH_REDIRECT_URI': JSON.stringify(parentEnv.EXPO_PUBLIC_SOCIAL_AUTH_REDIRECT_URI || ''),
  },
  resolve: {
    // Reuse the parent app's installed React/Lexical/etc. — avoids
    // duplicating large packages in this sub-project's node_modules.
    alias: {
      // Make sibling-app paths resolvable for relative imports inside
      // editor entry source.
      '@app': path.resolve(__dirname, '..', 'src'),
    },
    dedupe: ['react', 'react-dom', 'lexical', '@lexical/react'],
  },
  // Pull peer deps from the parent's node_modules (we don't install them
  // again here). Vite walks up via the default resolver, so as long as we
  // run `vite build` from this directory, the parent's `node_modules` is
  // picked up.
  server: { fs: { allow: [path.resolve(__dirname, '..')] } },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000, // inline everything
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
