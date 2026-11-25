import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://ai17hub.ro',
  output: 'static',
  // Astro 7 compression drops spaces between words and inline elements
  // (visible in innerText); keep the markup whitespace as authored.
  compressHTML: false,
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Never inline scripts into HTML: keeps own code in files (scanned by semgrep-dist, CSP-friendly).
    build: { assetsInlineLimit: 0 },
  },
});
