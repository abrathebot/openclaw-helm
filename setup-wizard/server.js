'use strict';
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');

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
const LOG_PATH = path.join(CONFIG_DIR, 'gateway.log');
const MAX_LOG_LINES = 200;
let logBuffer = []; // in-memory ring buffer

function appendLog(line) {
  const ts = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
  const entry = `[${ts}] ${line.trimEnd()}`;
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  // Also write to file (best effort)
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.appendFileSync(LOG_PATH, entry + '\n');
  } catch {}
}

function spawnGateway(force = false) {
  if (gatewayProc && !force) {
    console.log('[gateway] already running, skip spawn');
    return;
  }
  if (gatewayProc) {
    try { gatewayProc.kill('SIGTERM'); } catch {}
    gatewayProc = null;
  }
  gatewayStatus = 'starting';
  console.log(`[gateway] spawning: ${OPENCLAW_BIN} gateway`);

  const proc = spawn(OPENCLAW_BIN, ['gateway'], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOME: HOME_DIR,
      OPENCLAW_CONFIG: CONFIG_PATH,
      PATH: process.env.PATH,
    }
  });

  const onData = (d) => {
    const text = d.toString();
    process.stdout.write(`[gw] ${text}`);
    text.split('\n').filter(l => l.trim()).forEach(appendLog);
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('exit', (code, sig) => {
    const msg = `[gateway] exited code=${code} sig=${sig}`;
    console.log(msg);
    appendLog(msg);
    gatewayStatus = 'stopped';
    gatewayProc = null;
  });
  proc.on('error', err => {
    const msg = `[gateway] spawn error: ${err.message}`;
    console.error(msg);
    appendLog(msg);
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
// NOTE: Only safe inside container (HOME=/data isolated). Skip on host to avoid conflicts.
const IS_CONTAINER = (HOME_DIR === '/data' || process.env.CONTAINER === '1');
if (IS_CONTAINER && fs.existsSync(CONFIG_PATH)) {
  console.log(`[startup] Config found at ${CONFIG_PATH} — auto-starting gateway`);
  setTimeout(spawnGateway, 1000);
} else if (fs.existsSync(CONFIG_PATH)) {
  console.log(`[startup] Config found — skipping gateway auto-start (not in container)`);
  gatewayStatus = 'external'; // gateway may be running externally
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
// ── Gateway proxy (all /gateway/* routes) ──────────────────────────────────
// All /gateway/* — proxy to internal gateway with base href injection on root HTML
app.use(`${BASE_PATH}/gateway`, (req, res) => {
  const http = require('http');
  // /gateway → treat as /gateway/ (root)
  const isRoot = (req.path === '/' || req.path === '' || req.path === undefined);
  const upstreamPath = req.path || '/';
  const options = {
    host: '127.0.0.1',
    port: GATEWAY_PORT,
    path: upstreamPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : ''),
    method: req.method,
    headers: { ...req.headers, host: `localhost:${GATEWAY_PORT}` }
  };
  const proxyReq = http.request(options, (proxyRes) => {
    const isHtml = (proxyRes.headers['content-type'] || '').includes('text/html');
    if (isRoot && isHtml) {
      let body = '';
      proxyRes.on('data', c => body += c);
      proxyRes.on('end', () => {
        body = body.replace('<head>', `<head>\n  <base href="${BASE_PATH}/gateway/">`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
      });
    } else {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  });
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.status(502).send(`<html><body style="font:16px sans-serif;background:#0a0a12;color:#f87171;padding:40px">
        <h2>⚠️ Gateway not reachable</h2>
        <p>OpenClaw gateway is not running (port ${GATEWAY_PORT}).</p>
        <p><a href="${BASE_PATH}/dashboard" style="color:#818cf8">← Dashboard</a></p>
      </body></html>`);
    }
  });
  proxyReq.setTimeout(8000, () => proxyReq.destroy());
  if (req.body && req.method !== 'GET') {
    const body = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Length', Buffer.byteLength(body));
    proxyReq.write(body);
  } else {
    req.pipe(proxyReq);
    return; // pipe handles end
  }
  proxyReq.end();
});

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

// ── API: Start/restart/stop gateway ─────────────────────────────────────────
// Supports both /api/start-gateway and /api/gateway-action (dashboard compat)
function handleGatewayAction(action, res) {
  if (!fs.existsSync(CONFIG_PATH)) {
    return res.status(400).json({ success: false, error: 'No config found. Complete wizard setup first.' });
  }
  if (!IS_CONTAINER) {
    return res.status(403).json({ success: false, error: 'Gateway management only available inside container.' });
  }
  if (action === 'stop') {
    if (gatewayProc) {
      try { gatewayProc.kill('SIGTERM'); } catch {}
      gatewayProc = null;
      gatewayStatus = 'stopped';
    }
    return res.json({ success: true, message: 'Gateway stopped.' });
  }
  // start or restart (force=true on restart to kill existing)
  spawnGateway(action === 'restart');
  res.json({ success: true, message: action === 'restart' ? 'Gateway restarting...' : 'Gateway starting...' });
}

app.post(`${BASE_PATH}/api/start-gateway`, (req, res) => handleGatewayAction('start', res));
app.post(`${BASE_PATH}/api/gateway-action`, (req, res) => {
  const { action } = req.body || {};
  handleGatewayAction(action || 'start', res);
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
  // Prefer in-memory buffer (always fresh), fallback to file
  if (logBuffer.length > 0) {
    return res.json({ lines: logBuffer.slice(-60) });
  }
  try {
    if (fs.existsSync(LOG_PATH)) {
      const lines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean).slice(-60);
      return res.json({ lines });
    }
  } catch {}
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
