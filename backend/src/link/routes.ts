import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/routes.js';
import { issueDiscordLinkCode } from '../auth/discord-link.js';

export const linkPlugin: FastifyPluginAsync = async (app): Promise<void> => {
  app.get('/api/link/discord/code', async (req, reply) => {
    const user = await requireAuth(req, reply);
    const issued = await issueDiscordLinkCode(user.id);
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.type('text/html; charset=utf-8');
    return reply.send(renderLinkCodeHtml(issued.code));
  });
};

function renderLinkCodeHtml(code: string): string {
  const escapedCode = escapeHtml(code);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DigiWorld Discord Link</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#e5e7eb;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
    main{max-width:44rem;padding:2rem;border:1px solid #334155;border-radius:1rem;background:#111827;box-shadow:0 24px 80px #0008}
    code{display:block;margin:1rem 0;padding:1rem;border-radius:.75rem;background:#020617;color:#67e8f9;font-size:clamp(1.4rem,5vw,2.4rem);font-weight:800;letter-spacing:.08em;text-align:center}
    p{line-height:1.55} strong{color:#fff}
  </style>
</head>
<body>
  <main>
    <h1>Link Discord / Vincular Discord</h1>
    <p><strong>EN:</strong> In Discord, run <strong>/link code:${escapedCode}</strong> within 5 minutes.</p>
    <p><strong>PT:</strong> No Discord, use <strong>/link code:${escapedCode}</strong> em até 5 minutos.</p>
    <code>${escapedCode}</code>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
