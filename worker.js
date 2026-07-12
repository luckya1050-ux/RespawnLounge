export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/state') {
      // GET → return saved state (or empty object if nothing saved yet)
      if (request.method === 'GET') {
        const data = await env.SITE_KV.get('site-state');
        return new Response(data || '{}', {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      // POST → save the whole state object
      if (request.method === 'POST') {
        const body = await request.text();
        try {
          JSON.parse(body); // validate it's real JSON before saving
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        // Cloudflare KV has a 25MB limit per value. Catch that here with
        // a clear response instead of letting it fail as an opaque 500.
        try {
          await env.SITE_KV.put('site-state', body);
        } catch (err) {
          return new Response(JSON.stringify({ error: 'Too large to save', detail: String(err) }), {
            status: 413,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('Method not allowed', { status: 405 });
    }

    // Everything else: serve the static site files (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};
