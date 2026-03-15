'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');

// ── Config ──────────────────────────────────────────────────────────────────
const app       = express();
const PORT      = parseInt(process.env.PORT || '3000');
// BASE_PATH injected by Helm as /{releaseName} — e.g. /openclaw-alice
const BASE_PATH = (process.env.BASE_PATH || '/openclaw').replace(/\/$/, '');
// All state lives under /data inside the container (HOME=/data via entrypoint)
const HOME_DIR      = process.env.HOME || '/data';
const CONFIG_DIR    = process.env.CONFIG_DIR    || path.join(HOME_DIR, '.openclaw');
const CONFIG_PATH   = path.join(CONFIG_DIR, 'openclaw.json');
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(CONFIG_DIR, 'workspace');
const INGRESS_HOST  = process.env.INGRESS_HOST  || '';
const GATEWAY_PORT  = parseInt(process.env.GATEWAY_PORT || '18789');

// Find openclaw binary — installed via npm inside container
function findOpenClaw() {
  const candidates = [
    '/usr/local/bin/openclaw',   // npm -g in Alpine
    '/usr/bin/openclaw',
    path.join(HOME_DIR, '.npm-global', 'bin', 'openclaw'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'openclaw'; // fallback to PATH
}
const OPENCLAW_BIN = findOpenClaw();

// ── Gateway process management ──────────────────────────────────────────────
let gatewayProc = null;
let gatewayStatus = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'

function spawnGateway() {
  if (gatewayProc) {
    try { gatewayProc.kill('SIGTERM'); } catch {}
    gatewayProc = null;
  }
  gatewayStatus = 'starting';
  console.log(`[gateway] spawning: ${OPENCLAW_BIN} gateway start`);

  const proc = spawn(OPENCLAW_BIN, ['gateway', 'start'], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: HOME_DIR,
      OPENCLAW_CONFIG: CONFIG_PATH,
      PATH: process.env.PATH,
    }
  });

  proc.stdout.on('data', d => process.stdout.write(`[gw] ${d}`));
  proc.stderr.on('data', d => process.stderr.write(`[gw] ${d}`));
  proc.on('exit', (code, sig) => {
    console.log(`[gateway] exited code=${code} sig=${sig}`);
    gatewayStatus = 'stopped';
    gatewayProc = null;
  });
  proc.on('error', err => {
    console.error('[gateway] spawn error:', err.message);
    gatewayStatus = 'error';
    gatewayProc = null;
  });

  gatewayProc = proc;
  // Give it a moment then mark as running
  setTimeout(() => {
    if (gatewayProc && !gatewayProc.exitCode) gatewayStatus = 'running';
  }, 3000);
}

// Auto-start gateway if config already exists
if (fs.existsSync(CONFIG_PATH)) {
  console.log(`[startup] Config found at ${CONFIG_PATH} — auto-starting gateway`);
  setTimeout(spawnGateway, 1000);
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── HTML pages (inject BASE_PATH) ────────────────────────────────────────────
function serveHtml(file, req, res) {
  let html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf8');
  html = html
    .replace('<head>', `<head>\n  <base href="${BASE_PATH}/">`)
    .replace('</head>', `<script>window.BASE_PATH = '${BASE_PATH}';</script>\n</head>`);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

app.get([BASE_PATH, BASE_PATH + '/'], (req, res) => serveHtml('index.html', req, res));
app.get(`${BASE_PATH}/dashboard`, (req, res) => serveHtml('dashboard.html', req, res));

// ── Gateway proxy ─────────────────────────────────────────────────────────────
// Redirect /gateway → /gateway/ (trailing slash required for base href)
app.get(`${BASE_PATH}/gateway`, (req, res) => {
  if (!req.path.endsWith('/')) return res.redirect(301, `${BASE_PATH}/gateway/`);
});

// Inject <base href> into gateway HTML root
app.get(`${BASE_PATH}/gateway/`, async (req, res) => {
  try {
    const r = await fetch(`http://localhost:${GATEWAY_PORT}/`, {
      signal: AbortSignal.timeout(3000)
    });
    let html = await r.text();
    html = html.replace('<head>', `<head>\n  <base href="${BASE_PATH}/gateway/">`);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(502).send(`<html><body style="font:16px sans-serif;background:#0a0a12;color:#f87171;padding:40px">
      <h2>⚠️ Gateway not reachable</h2>
      <p>OpenClaw gateway is not running (port ${GATEWAY_PORT}).</p>
      <p>Complete wizard setup first, or restart from dashboard.</p>
      <p><a href="${BASE_PATH}/dashboard" style="color:#818cf8">← Dashboard</a></p>
    </body></html>`);
  }
});

// All other /gateway/* routes — pass through to internal gateway
app.use(`${BASE_PATH}/gateway`, createProxyMiddleware({
  router: () => `http://localhost:${GATEWAY_PORT}`,
  pathRewrite: { [`^${BASE_PATH}/gateway`]: '' },
  changeOrigin: true,
  ws: true,
  on: {
    error: (err, req, res) => {
      if (res && res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway not reachable', detail: err.message }));
      }
    }
  }
}));

// Static files
app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));

// Root redirect
app.get('/', (req, res) => res.redirect(BASE_PATH + '/'));
app.get('/health', (req, res) => res.json({ ok: true, base: BASE_PATH }));

// ── API: Status ──────────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/status`, (req, res) => {
  const configured = fs.existsSync(CONFIG_PATH);
  res.json({ configured, gatewayPort: GATEWAY_PORT, basePath: BASE_PATH });
});

// ── API: Gateway status ──────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/gateway-status`, async (req, res) => {
  for (const ep of ['/health', '/api/health', '/']) {
    try {
      const r = await fetch(`http://localhost:${GATEWAY_PORT}${ep}`, {
        signal: AbortSignal.timeout(2000)
      });
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        const data = ct.includes('json') ? await r.json().catch(() => ({})) : {};
        return res.json({ running: true, port: GATEWAY_PORT, endpoint: ep, procStatus: gatewayStatus, ...data });
      }
    } catch {}
  }
  res.json({ running: false, port: GATEWAY_PORT, procStatus: gatewayStatus });
});

// ── API: Start/restart gateway ───────────────────────────────────────────────
app.post(`${BASE_PATH}/api/start-gateway`, (req, res) => {
  if (!fs.existsSync(CONFIG_PATH)) {
    return res.status(400).json({ success: false, error: 'No config found. Complete wizard first.' });
  }
  spawnGateway();
  res.json({ success: true, message: 'Gateway starting...' });
});

// ── API: Config (scrubbed) ───────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/config`, (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (cfg.auth?.profiles) {
      Object.values(cfg.auth.profiles).forEach(p => {
        if (p.key)   p.key   = '***';
        if (p.token) p.token = '***';
      });
    }
    res.json(cfg);
  } catch { res.json({}); }
});

// ── API: Reset config ────────────────────────────────────────────────────────
app.post(`${BASE_PATH}/api/reset`, (req, res) => {
  try {
    if (gatewayProc) { try { gatewayProc.kill('SIGTERM'); } catch {} gatewayProc = null; }
    gatewayStatus = 'stopped';
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── API: Validate Anthropic key ──────────────────────────────────────────────
app.post(`${BASE_PATH}/api/validate/anthropic`, async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || apiKey.length < 20) {
    return res.json({ valid: false, error: 'API key too short' });
  }
  if (!/^sk-ant-/.test(apiKey)) {
    return res.json({ valid: false, error: 'Should start with sk-ant-' });
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-3-5-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    res.json({ valid: r.status !== 401 && r.status !== 403, status: r.status });
  } catch (e) {
    res.json({ valid: false, error: e.message });
  }
});

// ── API: Gateway log ─────────────────────────────────────────────────────────
app.get(`${BASE_PATH}/api/gateway-log`, (req, res) => {
  const logCandidates = [
    path.join(CONFIG_DIR, 'gateway.log'),
    path.join(CONFIG_DIR, 'openclaw.log'),
    '/tmp/openclaw.log',
  ];
  for (const p of logCandidates) {
    if (fs.existsSync(p)) {
      try {
        const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).slice(-60);
        return res.json({ lines });
      } catch {}
    }
  }
  res.json({ lines: [] });
});

// ── API: Install ─────────────────────────────────────────────────────────────
function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return 'oc_' + Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function parsePhoneNumbers(raw) {
  if (!raw) return [];
  return raw.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
}

function parseTelegramIds(raw) {
  if (!raw) return [];
  return raw.split(/[\s,;]+/)
    .map(s => s.trim()).filter(Boolean)
    .map(id => /^\d+$/.test(id) ? `tg:${id}` : id);
}

function buildConfig(form) {
  const hasAnthropic = !!(form.anthropicApiKey || form.claudeCodeToken);
  const hasGemini    = !!form.geminiApiKey;
  const hasOpenAI    = !!form.openaiApiKey;

  function providerOf(m) {
    if (m.startsWith('anthropic/')) return 'anthropic';
    if (m.startsWith('google/'))    return 'google';
    if (m.startsWith('openai/'))    return 'openai';
    return 'unknown';
  }
  function hasKeyFor(m) {
    const p = providerOf(m);
    if (p === 'anthropic') return hasAnthropic;
    if (p === 'google')    return hasGemini;
    if (p === 'openai')    return hasOpenAI;
    return false;
  }

  const primaryModel   = form.model || 'anthropic/claude-sonnet-4-6';
  const fallbackModels = (form.fallbackModels || [])
    .filter(m => m && m !== primaryModel && hasKeyFor(m));

  const modelsMap = {};
  [primaryModel, ...fallbackModels].forEach(m => { modelsMap[m] = {}; });
  if (modelsMap['anthropic/claude-opus-4-6'])  modelsMap['anthropic/claude-opus-4-6']  = { alias: 'opus'   };
  if (modelsMap['anthropic/claude-sonnet-4-6']) modelsMap['anthropic/claude-sonnet-4-6'] = { alias: 'sonnet' };
  if (modelsMap['anthropic/claude-haiku-3-5']) modelsMap['anthropic/claude-haiku-3-5'] = { alias: 'haiku'  };

  // Profile metadata only — secrets written to auth-profiles.json
  const isClaudeCode = form.anthropicAuthMode === 'claude-code';
  const authProfile  = isClaudeCode
    ? { provider: 'anthropic', mode: 'token'   }
    : { provider: 'anthropic', mode: 'api_key' };

  const additionalProfiles = {};
  if (hasGemini) additionalProfiles['google:default'] = { provider: 'google', mode: 'api_key' };
  if (hasOpenAI) additionalProfiles['openai:default'] = { provider: 'openai', mode: 'api_key' };

  // whatsapp allowFrom
  const waAllowFrom = parsePhoneNumbers(form.whatsappAllowFrom);
  const waDmPolicy  = waAllowFrom.length > 0 ? 'allowlist' : 'open';

  // Telegram allowFrom
  const tgAllowFrom = parseTelegramIds(form.telegramUserId);

  // Gateway token
  const gatewayToken = form.gatewayToken || generateToken();
  const gatewayPort  = parseInt(form.gatewayPort) || GATEWAY_PORT;

  // controlUi allowedOrigins — use INGRESS_HOST env or form field
  const ingressHost = INGRESS_HOST || form.publicDomain || '';
  const allowedOrigins = ingressHost ? [`https://${ingressHost}`] : [];

  return {
    auth: {
      profiles: {
        'anthropic:default': authProfile,
        ...additionalProfiles
      }
    },
    agents: {
      defaults: {
        model: {
          primary: primaryModel,
          fallbacks: fallbackModels
        },
        models: modelsMap,
        workspace: WORKSPACE_DIR,
        contextTokens: parseInt(form.contextTokens) || 80000,
        contextPruning: { mode: 'cache-ttl', ttl: '2h', keepLastAssistants: 3 },
        compaction: { mode: 'safeguard' },
        maxConcurrent: 4,
        subagents: { maxConcurrent: 8 }
      }
    },
    tools: {
      web: {
        search: {
          enabled: hasGemini,
          provider: hasGemini ? 'gemini' : 'none'
        }
      }
    },
    browser: { headless: true, noSandbox: true },
    messages: { ackReactionScope: 'group-mentions' },
    commands: { native: 'auto', nativeSkills: 'auto', restart: true },
    channels: {
      telegram: {
        enabled: !!form.telegramEnabled,
        botToken: form.telegramBotToken || '',
        dmPolicy: tgAllowFrom.length > 0 ? 'allowlist' : 'pairing',
        allowFrom: tgAllowFrom,
        groups: {}
      },
      whatsapp: {
        enabled: !!form.whatsappEnabled,
        dmPolicy: waDmPolicy,
        allowFrom: waDmPolicy === 'allowlist' ? waAllowFrom : ['*'],
        groupPolicy: 'allowlist',
        debounceMs: 0,
        mediaMaxMb: 50
      }
    },
    gateway: {
      port: gatewayPort,
      mode: 'local',
      bind: 'lan',
      auth: {
        mode: 'token',
        token: gatewayToken
      },
      controlUi: {
        allowedOrigins
      }
    }
  };
}

app.post(`${BASE_PATH}/api/install`, (req, res) => {
  const form = req.body;
  try {
    const config = buildConfig(form);

    // Ensure dirs
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    // Write openclaw.json
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    // Write credentials to auth-profiles.json
    const agentDir = path.join(CONFIG_DIR, 'agents', 'main', 'agent');
    fs.mkdirSync(agentDir, { recursive: true });
    const authProfilesPath = path.join(agentDir, 'auth-profiles.json');
    let authProfiles = { version: 1, profiles: {} };
    try { authProfiles = JSON.parse(fs.readFileSync(authProfilesPath, 'utf8')); } catch {}

    if (form.anthropicAuthMode === 'claude-code' && form.claudeCodeToken) {
      authProfiles.profiles['anthropic:default'] = {
        type: 'token', provider: 'anthropic', token: form.claudeCodeToken
      };
    } else if (form.anthropicApiKey) {
      authProfiles.profiles['anthropic:default'] = {
        type: 'api_key', provider: 'anthropic', key: form.anthropicApiKey
      };
    }
    if (form.geminiApiKey) {
      authProfiles.profiles['google:default'] = {
        type: 'api_key', provider: 'google', key: form.geminiApiKey
      };
    }
    if (form.openaiApiKey) {
      authProfiles.profiles['openai:default'] = {
        type: 'api_key', provider: 'openai', key: form.openaiApiKey
      };
    }
    fs.writeFileSync(authProfilesPath, JSON.stringify(authProfiles, null, 2), 'utf8');

    // Spawn gateway
    spawnGateway();

    res.json({
      success: true,
      gatewayPort: config.gateway.port,
      gatewayStarted: true,
      configPath: CONFIG_PATH,
      dashboardUrl: `${BASE_PATH}/dashboard`
    });
  } catch (err) {
    console.error('Install error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenClaw Setup Wizard → http://0.0.0.0:${PORT}${BASE_PATH}`);
  console.log(`  CONFIG_DIR  : ${CONFIG_DIR}`);
  console.log(`  CONFIG_PATH : ${CONFIG_PATH}`);
  console.log(`  HOME_DIR    : ${HOME_DIR}`);
  console.log(`  GATEWAY_PORT: ${GATEWAY_PORT}`);
  console.log(`  INGRESS_HOST: ${INGRESS_HOST || '(not set)'}`);
});
