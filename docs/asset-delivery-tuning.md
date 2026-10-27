# Asset delivery tuning (gzip + caching)

Reverse-proxy configuration for the hosts that front the app (openresty/nginx on
`dev.letwin.co` and production). **These changes are applied on the host, not in this repo** — the
in-repo half (Express `compression()` + `express.static` cache headers) is already done in
`backend/index.js` under REQ 936.

## Why

Measured against `dev.letwin.co` before the fix:

| Measurement | Value |
|---|---|
| CAD editor chunk, actual download | **7.9 MB** |
| The same bytes, gzipped | **1.9 MB** (**4.3× smaller**) |
| `Content-Encoding` on `.js` | *absent* — served uncompressed |
| `Content-Encoding` on `index.html` | `gzip` |
| `Cache-Control` on content-hashed chunks | `no-cache` — full re-download every visit |

Two independent problems:

1. **JS was not compressed.** nginx's default `gzip_types` is `text/html` only. Angular chunks are
   served as `text/javascript`, so they fell outside the default and shipped raw. `index.html` being
   gzipped while JS was not is the fingerprint of exactly this.
2. **Hashed assets were not cached.** Every navigation re-downloaded the full bundle. On a slow or
   flaky link the fetch drops mid-stream and the dynamic `import()` rejects — the user-visible
   `TypeError: error loading dynamically imported module`.

## The configuration

Add to the `http` block (or the relevant `server` block):

```nginx
# ── Compression ────────────────────────────────────────────────────────────
# The default gzip_types is text/html ONLY. Without these explicit types the
# JS bundles ship uncompressed, which is what caused the 7.9 MB downloads.
gzip              on;
gzip_vary         on;          # emit `Vary: Accept-Encoding` for correct caching
gzip_min_length   1024;        # don't bother with tiny bodies
gzip_proxied      any;         # compress even when the response is proxied
gzip_comp_level   5;           # good ratio/CPU balance; 6+ has diminishing returns
gzip_types        application/javascript
                  text/javascript
                  application/json
                  text/css
                  image/svg+xml
                  application/manifest+json;
```

```nginx
# ── Caching ────────────────────────────────────────────────────────────────
# Angular builds with outputHashing: "all", so every JS/CSS filename contains a
# content hash. A rebuild produces NEW filenames, which makes the old ones safe
# to cache indefinitely — a stale file can never be silently served.
location ~* \.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$ {
    proxy_pass http://<upstream>;
    proxy_hide_header Cache-Control;   # drop the upstream's no-cache
    proxy_hide_header Pragma;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

# index.html keeps the SAME name across builds. It must revalidate, or clients
# pin themselves to a stale bundle and never see a deploy.
location / {
    proxy_pass http://<upstream>;
    proxy_hide_header Cache-Control;
    add_header Cache-Control "no-cache";
}
```

Replace `<upstream>` with the existing `proxy_pass` target.

Reload with `nginx -t && nginx -s reload` (or `openresty -t && openresty -s reload`) — `-t` first,
so a typo doesn't take the site down.

## Verify

```bash
# Expect: Content-Encoding: gzip  +  Cache-Control: public, max-age=31536000, immutable
curl -sI -H 'Accept-Encoding: gzip' https://<host>/<some-hashed-chunk>.js \
  | grep -iE 'content-encoding|cache-control'

# Expect a ~4x smaller number than before
curl -s -H 'Accept-Encoding: gzip' -o /dev/null \
  -w 'bytes=%{size_download}\n' https://<host>/<some-hashed-chunk>.js

# index.html must NOT be immutable
curl -sI https://<host>/ | grep -i cache-control     # expect: no-cache
```

Then hard-reload the app, open the CAD editor on a throttled connection, and confirm no
`error loading dynamically imported module`.

## Caveats

- **`dev.letwin.co` runs the Angular dev server** (`ng serve`, see `frontend/Dockerfile`), which is
  unminified, source-mapped, and `no-cache` by design. Compression will help a lot there, but the
  caching rules matter most in **production**, which serves a real `ng build --configuration
  production` via Express (`backend/Dockerfile.prod`). Judge the improvement against production.
- Do **not** apply `immutable` to any un-hashed asset. The `location` regex above is safe only
  because Angular hashes these filenames; anything hand-placed in `public/` with a stable name
  (e.g. `favicon.ico`) would get pinned in browser caches for a year.
- `gzip_vary on` matters when a CDN or intermediate cache sits in front — without it, a compressed
  response can be served to a client that did not ask for one.
- Brotli (`brotli on; brotli_types ...`) gains a further ~15-20% over gzip but needs the
  `ngx_brotli` module compiled in. Optional follow-up, not required.

## Related in-repo changes (already applied)

- `backend/index.js` — `app.use(compression())` ahead of the routes and the static handler.
  Verified: `GET /api/inventory/part` went from **593,841 → 39,530 bytes** (15×).
- `backend/index.js` — `express.static(..., { maxAge: '1y', immutable: true, index: false })`, with
  the SPA fallback setting `Cache-Control: no-cache` on `index.html`.
- `frontend/src/app/utils/lazy-retry.ts` — retries a dropped chunk import; a safety net that stays
  useful for genuinely flaky links even once the above is in place.
