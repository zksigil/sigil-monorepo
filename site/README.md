# site/

Static landing page for zksigil.xyz. Pure HTML + CSS, no build step, no JS.

## Local preview

```bash
cd site && python3 -m http.server 8080
# open http://localhost:8080
```

Or open `index.html` directly in a browser.

## Deploy (Cloudflare Pages)

1. In the Cloudflare dashboard: Pages → "Create a project" → connect this repo.
2. Build settings:
   - Build command: *(leave blank)*
   - Build output directory: `site`
3. Add custom domain `zksigil.xyz` (and `www.zksigil.xyz`).

That's it. Every push to `master` redeploys; PRs get preview URLs.

## Updating the placeholder links

Four placeholder links to fill in once accounts/listings exist. Search for `href="#"` in `index.html` — they map to:

- `.cta--twitter` → Twitter handle URL
- `.cta--github` → GitHub repo URL
- `.store--ios` → App Store URL (also remove the "Coming soon to" small text)
- `.store--android` → Play Store URL (also remove the "Coming soon to" small text)

The Basescan contract link in the hero note and footer is real.

## Assets

- `assets/sigil-mark.svg` — holographic gradient mark (primary)
- `assets/sigil-mark-solid.svg` — solid `currentColor` version, for spots that should match surrounding text
- `assets/icon.png` — used for `apple-touch-icon` and OG image fallback

These are copied from `apps/mobile/assets/`. If the mark changes there, recopy.
