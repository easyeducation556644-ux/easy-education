import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function firestoreReadTrackerPlugin() {
  // Keep the lightweight Firestore read/mutation tracker as the global wrapper.
  // The previous permanent-cache wrapper converted normal reads and realtime
  // listeners into cache-only behavior, allowing stale access/payment/course
  // state to survive indefinitely when a targeted sync event was missed.
  const trackedModule = '/src/lib/trackedFirestore.js'

  return {
    name: 'easy-education-firestore-read-tracker',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/src/')) return null
      if (
        id.endsWith('/src/lib/trackedFirestore.js') ||
        id.endsWith('/src/lib/nativeCachedFirestore.js')
      ) return null
      if (!code.includes('firebase/firestore')) return null

      const transformed = code
        .replace(/from\s+["']firebase\/firestore["']/g, `from "${trackedModule}"`)
        .replace(/import\s*\(\s*["']firebase\/firestore["']\s*\)/g, `import("${trackedModule}")`)

      return transformed === code ? null : { code: transformed, map: null }
    },
  }
}

export default defineConfig({
  base: '/', 
  plugins: [firestoreReadTrackerPlugin(), react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
    hmr: {
      clientPort: 443,
      protocol: 'wss',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
  },
});
