/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** Cheia publică a widgetului Cloudflare Turnstile (la build; local de test: 1x00000000000000000000AA). */
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
}
