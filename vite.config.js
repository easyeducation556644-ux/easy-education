import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function learningSkeletonPlugin() {
  const targets = new Map([
    ['/src/pages/CourseSubjects.jsx', 'list'],
    ['/src/pages/CourseChapters.jsx', 'list'],
    ['/src/pages/CourseClasses.jsx', 'classes'],
    ['/src/pages/CourseWatch.jsx', 'watch'],
  ])

  const loadingSpinnerPattern = /if\s*\(loading\)\s*\{\s*return\s*\(\s*<div className="min-h-screen flex items-center justify-center">\s*<div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"><\/div>\s*<\/div>\s*\)\s*\}/m

  return {
    name: 'easy-education-learning-skeletons',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?')[0]
      const matchedTarget = [...targets.entries()].find(([suffix]) => normalizedId.endsWith(suffix))
      if (!matchedTarget) return null

      const [, variant] = matchedTarget
      if (!loadingSpinnerPattern.test(code)) return null

      const importLine = 'import LearningPageSkeleton from "../components/LearningPageSkeleton.jsx"\n'
      const transformed = `${importLine}${code.replace(
        loadingSpinnerPattern,
        `if (loading) {\n    return <LearningPageSkeleton variant="${variant}" />\n  }`,
      )}`

      return { code: transformed, map: null }
    },
  }
}

function firestoreReadTrackerPlugin() {
  // Cache V2 is the global Firestore facade. It serves previously server-primed
  // documents/queries from persistent cache and relies on the tiny sync feeds to
  // fetch only changed documents. trackedFirestore remains underneath it for
  // read accounting and mutation sync hints.
  const trackedModule = '/src/lib/cacheV2Firestore.js'

  return {
    name: 'easy-education-firestore-cache-v2',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/src/')) return null
      if (
        id.endsWith('/src/lib/trackedFirestore.js') ||
        id.endsWith('/src/lib/nativeCachedFirestore.js') ||
        id.endsWith('/src/lib/cacheV2Firestore.js')
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
  plugins: [learningSkeletonPlugin(), firestoreReadTrackerPlugin(), react()],
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
