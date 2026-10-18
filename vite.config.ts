/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SITE = 'https://' + readFileSync(resolve(import.meta.dirname, 'public/CNAME'), 'utf8').trim();
const ROUTES = ['help', 'about'];

/**
 * Google Analytics is injected only when GA_ID is set. Only the GitHub Pages deploy workflow sets it,
 * so local dev, local builds and forks stay free of tracking.
 */
function analytics(): Plugin {
  const id = process.env.GA_ID?.trim();
  return {
    name: 'curvesmith-analytics',
    apply: 'build',
    transformIndexHtml(html) {
      if (!id) return html;
      if (!/^G-[A-Z0-9]{4,20}$/.test(id)) throw new Error(`GA_ID "${id}" is not a GA4 measurement id`);
      const tag = `<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${id}');
</script>`;
      return html.replace('<head>', `<head>\n${tag}`);
    },
  };
}

/** Static copies of the app shell for /help and /about (so they answer 200 on GitHub Pages), plus robots and sitemap. */
function staticRoutes(): Plugin {
  return {
    name: 'curvesmith-static-routes',
    apply: 'build',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist');
      const indexPath = resolve(dist, 'index.html');
      if (!existsSync(indexPath)) return;
      const index = readFileSync(indexPath, 'utf8');
      const meta: Record<string, { title: string; description: string }> = {
        help: {
          title: 'Help · Curvesmith',
          description:
            'Tools, shortcuts, file formats and answers for Curvesmith, the vector editor that runs in your browser.',
        },
        about: {
          title: 'About · Curvesmith',
          description:
            'Curvesmith is a professional vector editor that runs in a browser tab. Free, open source and local-first.',
        },
      };
      for (const route of ROUTES) {
        const m = meta[route];
        const html = index
          .replace(/<title>[^<]*<\/title>/, `<title>${m.title}</title>`)
          .replace(/(<meta name="description" content=")[^"]*/, `$1${m.description}`)
          .replace(/(<meta property="og:title" content=")[^"]*/, `$1${m.title}`)
          .replace(/(<meta property="og:description" content=")[^"]*/, `$1${m.description}`)
          .replace(/(<meta name="twitter:title" content=")[^"]*/, `$1${m.title}`)
          .replace(/(<meta name="twitter:description" content=")[^"]*/, `$1${m.description}`)
          .replace(/(<link rel="canonical" href=")[^"]*/, `$1${SITE}/${route}`)
          .replace(/(<meta property="og:url" content=")[^"]*/, `$1${SITE}/${route}`);
        mkdirSync(resolve(dist, route), { recursive: true });
        writeFileSync(resolve(dist, route, 'index.html'), html);
      }
      writeFileSync(resolve(dist, '404.html'), index);
      writeFileSync(resolve(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
      const urls = ['', ...ROUTES].map((r) => `  <url><loc>${SITE}/${r}</loc></url>`).join('\n');
      writeFileSync(
        resolve(dist, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      );
      writeFileSync(resolve(dist, '.nojekyll'), '');
    },
  };
}

export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
  },
  server: { port: 5186, strictPort: true },
  preview: { port: 5186, strictPort: true },
  plugins: [
    react(),
    analytics(),
    staticRoutes(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'fonts/*.woff2', 'icons/*.png', 'brand/*.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern:
              /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net\/fontsource)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'fonts',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
