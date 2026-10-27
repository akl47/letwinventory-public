/**
 * Wrap a lazy-route dynamic import so a transient network failure retries
 * instead of hard-failing with "error loading dynamically imported module".
 *
 * Large lazy chunks (notably the ~2.7 MB CAD editor) are served with
 * `Cache-Control: no-cache`, so the browser re-downloads them on every
 * navigation; on a slow or flaky connection the fetch can drop mid-stream and
 * reject the `import()`. A couple of backed-off retries recover the load.
 *
 * Usage in a route:
 *   loadComponent: lazyRetry(() =>
 *     import('./x.component').then((m) => m.XComponent))
 */
export function lazyRetry<T>(factory: () => Promise<T>, retries = 2, delayMs = 800): () => Promise<T> {
  return async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await factory();
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
    throw lastErr;
  };
}
