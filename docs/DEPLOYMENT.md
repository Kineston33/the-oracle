# Deployment notes

THE ORACLE is a static single-page application. `npm run build` produces `dist/`,
which is the entire deployable artifact: no server, no database, no environment
variables and no API keys.

## The one requirement that matters

Every route must serve `index.html`, because routing happens in the browser.
Without this, `/predictions/ORC-2025-0007` returns a host-level 404 on reload or
when pasted into a new tab.

One config file is already committed, so pick the host that reads it:

| Host | File already present | Action needed |
|---|---|---|
| Netlify | `public/_redirects` | None — connect the repo, publish `dist` |
| Cloudflare Pages | `public/_redirects` | None — build command `npm run build`, output `dist` |
| Vercel | `public/vercel.json` | None — detected automatically |

Any other static host requires an equivalent rewrite rule:

```
/*  /index.html  200
```

## Free tier checks

- **Build**: static, no server runtime. Comfortably inside every free tier.
- **Bandwidth**: the bundle is ~1.1 MB total, of which ~400 kB is font files that
  are subset by `unicode-range` and only fetched when a character needs them.
  `og-image.png` is 148 kB and is fetched by social crawlers only.
- **No secrets**: the build reads no environment variables. There is nothing to
  configure and nothing to leak.

## Before the first public deploy

1. **Replace the placeholder origin** `https://the-oracle.example` in two places:
   `index.html` (canonical, `og:url`, `og:image`) and
   `src/components/layout/RouteMetadata.tsx` (`ORIGIN`). Open Graph images
   **must** be absolute URLs or previews silently break.
2. **Decide on indexing.** `index.html` currently sets
   `<meta name="robots" content="noindex, nofollow">` because the archive holds
   demonstration records only. Remove that tag once real records exist; leave it
   in place and search engines will ignore the site entirely.
3. **Verify the routes** against the deployed origin, not just locally. Reload
   each one directly rather than navigating to it.
4. **Replace the demonstration records** (`src/data/records.json`) or keep the
   DEMO labelling. Do not ship illustrative probabilities as real forecasts.

## Verifying a deployment

```bash
npm run build
npx vite preview --port 4173     # serves dist/ with SPA fallback

# Every route should return 200 and contain the app shell
for r in / /explore /predictions /predictions/ORC-2025-0007 /trends /about /nope; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:4173$r")" "$r"
done
```

`vite preview` applies the SPA fallback itself, so a 200 here does **not** prove
the host is configured. Always re-test against the real origin.
