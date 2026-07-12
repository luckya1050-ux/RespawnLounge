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

    if (url.pathname === '/api/send-otp' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }
      const email = (body.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) {
        return json({ error: 'Invalid email' }, 400);
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      // Store the code for 10 minutes, keyed by email.
      await env.SITE_KV.put(`otp:${email}`, code, { expirationTtl: 600 });

      if (!env.RESEND_API_KEY) {
        return json({ error: 'Email service not configured yet' }, 500);
      }

      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: env.RESEND_FROM || 'Respawn Lounge <onboarding@resend.dev>',
            to: [email],
            subject: 'Your Respawn Lounge verification code',
            html: `<p>Your tournament registration code is:</p><h2 style="letter-spacing:4px;">${code}</h2><p>This code expires in 10 minutes.</p>`
          })
        });
        if (!resendRes.ok) {
          const detail = await resendRes.text();
          return json({ error: 'Failed to send email', detail }, 502);
        }
      } catch (err) {
        return json({ error: 'Failed to send email', detail: String(err) }, 502);
      }

      return json({ ok: true });
    }

    if (url.pathname === '/api/verify-otp' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON' }, 400);
      }
      const email = (body.email || '').trim().toLowerCase();
      const code = (body.code || '').trim();
      if (!email || !code) {
        return json({ verified: false, error: 'Missing email or code' }, 400);
      }

      const saved = await env.SITE_KV.get(`otp:${email}`);
      if (saved && saved === code) {
        await env.SITE_KV.delete(`otp:${email}`);
        return json({ verified: true });
      }
      return json({ verified: false });
    }

    // Everything else: serve the static site files (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
