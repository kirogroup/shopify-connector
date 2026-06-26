import 'dotenv/config';
import express from 'express';

const SHOP = process.env.SHOP;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.API_KEY || '';

for (const [k, v] of Object.entries({ SHOP, CLIENT_ID, CLIENT_SECRET })) {
  if (!v) {
    console.error(`\n  Missing ${k} in .env — see .env.example\n`);
    process.exit(1);
  }
}

const app = express();
app.use(express.json());

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 - 60 * 1000;

let cachedToken = null;
let cachedAt = 0;

async function fetchNewToken() {
  const res = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed ${res.status}: ${text}`);
  }
  const { access_token, scope, expires_in } = await res.json();
  return { access_token, scope, expires_in, fetchedAt: Date.now() };
}

async function getToken() {
  if (cachedToken && Date.now() - cachedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }
  cachedToken = await fetchNewToken();
  cachedAt = Date.now();
  console.log(`[token] refreshed, expires in ${cachedToken.expires_in}s`);
  return cachedToken;
}

getToken().catch((e) => console.error('[token] initial fetch failed:', e.message));

function requireKey(req, res, next) {
  if (!API_KEY) return next();
  const got = req.header('x-api-key');
  if (got !== API_KEY) return res.status(401).json({ error: 'bad api key' });
  next();
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    shop: `${SHOP}.myshopify.com`,
    tokenCached: !!cachedToken,
    cacheAgeSec: cachedAt ? Math.floor((Date.now() - cachedAt) / 1000) : null,
  });
});

app.get('/token', requireKey, async (_req, res) => {
  try {
    const t = await getToken();
    res.json({
      access_token: t.access_token,
      scope: t.scope,
      expires_in: t.expires_in,
      expires_at: new Date(t.fetchedAt + t.expires_in * 1000).toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/shopify', requireKey, async (req, res) => {
  try {
    const t = await getToken();
    const upstream = await fetch(`https://${SHOP}.myshopify.com${req.originalUrl.replace(/^\/shopify/, '')}`, {
      method: req.method,
      headers: {
        'X-Shopify-Access-Token': t.access_token,
        'Content-Type': req.header('content-type') || 'application/json',
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const body = await upstream.text();
    res.status(upstream.status);
    res.set('content-type', upstream.headers.get('content-type') || 'application/json');
    res.send(body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Shopify connector up on http://localhost:${PORT}`);
  console.log(`    GET /token                → fresh access token`);
  console.log(`    GET /shopify/admin/...    → proxied API call`);
  console.log(`    GET /health               → status`);
  console.log(`    API key auth: ${API_KEY ? 'ON' : 'OFF (set API_KEY in .env to enable)'}\n`);
});
