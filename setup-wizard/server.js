const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { spawn, execSync } = require('child_process');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const BASE_PATH = (process.env.BASE_PATH || '/openclaw').replace(/\/$/, '');
const HOME_DIR = process.env.HOME || '/root';
const CONFIG_DIR = process.env.CONFIG_DIR || path.join(HOME_DIR, '.openclaw');
const CONFIG_PATH = path.join(CONFIG_DIR, 'openclaw.json');
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || path.join(HOME_DIR, '.openclaw', 'workspace');

app.use(express.json());

// Inject BASE_PATH into index.html dynamically
app.get([BASE_PATH, BASE_PATH + '/'], (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  html = html
    .replace('<head>', `<head>\n  <base href="${BASE_PATH}/">`)
    .replace('</head>', `<script>window.BASE_PATH = '${BASE_PATH}';</script>\n</head>`);
  res.send(html);
});

// Dashboard page
app.get(`${BASE_PATH}/dashboard`, (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, 'public', 'dashboard.html'), 'utf8');
  html = html
    .replace('<head>', `<head>\n  <base href="${BASE_PATH}/">`)
    .replace('</head>', `<script>window.BASE_PATH = '${BASE_PATH}';</script>\n</head>`);
  res.send(html);
});

// Gateway proxy — /{BASE_PATH}/gateway/* → localhost:{gatewayPort}/*
// Resolve gateway port dynamically from saved config
function getGatewayPort() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return cfg?.gateway?.port || 18789;
  } catch { return 18789; }
}

app.use(`${BASE_PATH}/gateway`, createProxyMiddleware({
  router: () => `http://localhost:${getGatewayPort()}`,
  pathRewrite: { [`^${BASE_PATH}/gateway`]: '' },
  changeOrigin: true,
  ws: true,  // proxy WebSocket too (for streaming)
  on: {
    error: (err, req, res) => {
      if (res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway not reachable', detail: err.message }));
      }
    }
  }
}));

// Static files
app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));

// Root redirect
app.get('/', (req, res) => res.redirect(BASE_PATH));

// ── API Routes ──────────────────────────────────────────────────────────────

app.get(`${BASE_PATH}/api/status`, (req, res) => {
  const configured = fs.existsSync(CONFIG_PATH);
  let gatewayPort = 18789;
  if (configured) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      gatewayPort = cfg?.gateway?.port || 18789;
    } catch {}
  }
  res.json({ configured, gatewayPort });
});

app.post(`${BASE_PATH}/api/reset`, (req, res) => {
  try {
    if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Dashboard API Routes ────────────────────────────────────────────────────

// Return saved config (scrub secrets)
app.get(`${BASE_PATH}/api/config`, (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    // Scrub API keys
    if (cfg.auth?.profiles) {
      Object.values(cfg.auth.profiles).forEach(p => {
        if (p.apiKey) p.apiKey = '***';
        if (p.token)  p.token  = '***';
      });
    }
    res.json(cfg);
  } catch {
    res.json({});
  }
});

// Gateway health check
app.get(`${BASE_PATH}/api/gateway-status`, async (req, res) => {
  let port = 18789;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    port = cfg?.gateway?.port || 18789;
  } catch {}
  try {
    const r = await fetch(`http://localhost:${port}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      const data = await r.json().catch(() => ({}));
      return res.json({ running: true, port, ...data });
    }
    return res.json({ running: false, port });
  } catch {
    // Try a raw TCP ping via another heuristic
    try {
      const { execFileSync } = require('child_process');
      execFileSync('nc', ['-z', 'localhost', String(port)], { timeout: 1000 });
      return res.json({ running: true, port });
    } catch {
      return res.json({ running: false, port });
    }
  }
});

// Gateway log tail
app.get(`${BASE_PATH}/api/gateway-log`, (req, res) => {
  const logPaths = [
    path.join(HOME_DIR, '.openclaw', 'gateway.log'),
    path.join(HOME_DIR, '.openclaw', 'openclaw.log'),
    '/tmp/openclaw.log'
  ];
  for (const p of logPaths) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const lines = raw.split('\n').filter(Boolean).slice(-60);
        return res.json({ lines });
      } catch {}
    }
  }
  // Try journalctl
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('journalctl', ['-u', 'openclaw', '-n', '50', '--no-pager', '--output=short'], { timeout: 2000 }).toString();
    return res.json({ lines: out.split('\n').filter(Boolean) });
  } catch {}
  res.json({ lines: ['(No log file found. Check ~/.openclaw/gateway.log)'] });
});

// Gateway start/stop/restart
app.post(`${BASE_PATH}/api/gateway-action`, (req, res) => {
  const { action } = req.body || {};
  const cmds = {
    start:   ['openclaw', ['gateway', 'start']],
    stop:    ['openclaw', ['gateway', 'stop']],
    restart: ['openclaw', ['gateway', 'restart']]
  };
  const cmd = cmds[action];
  if (!cmd) return res.status(400).json({ error: 'Unknown action' });
  try {
    const proc = spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', env: { ...process.env, HOME: HOME_DIR } });
    proc.unref();
    res.json({ success: true, action });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post(`${BASE_PATH}/api/validate-claude`, async (req, res) => {
  const { apiKey, mode } = req.body;

  if (mode === 'claude-code') {
    // Claude Code OAuth token — just check format (starts with sk- or is a long token)
    if (!apiKey || apiKey.length < 20) {
      return res.json({ valid: false, error: 'Token too short. Paste the full Claude Code token.' });
    }
    return res.json({ valid: true, note: 'Claude Code token format OK (not validated against API)' });
  }

  // Standard API key
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return res.json({ valid: false, error: 'Must start with sk-ant-' });
  }
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      })
    });
    if (response.ok || response.status === 400) return res.json({ valid: true });
    const data = await response.json().catch(() => ({}));
    return res.json({ valid: false, error: data.error?.message || 'Validation failed' });
  } catch (err) {
    return res.json({ valid: false, error: 'Cannot reach Anthropic API: ' + err.message });
  }
});

app.post(`${BASE_PATH}/api/install`, (req, res) => {
  const form = req.body;
  try {
    const config = buildConfig(form);
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');

    // Write credentials file
    const envLines = [];
    if (form.anthropicApiKey) envLines.push(`ANTHROPIC_API_KEY=${form.anthropicApiKey}`);
    if (form.geminiApiKey)    envLines.push(`GEMINI_API_KEY=${form.geminiApiKey}`);
    if (form.openaiApiKey)    envLines.push(`OPENAI_API_KEY=${form.openaiApiKey}`);
    fs.writeFileSync(path.join(CONFIG_DIR, '.env'), envLines.join('\n') + '\n', 'utf8');

    const gatewayPort = parseInt(form.gatewayPort) || 18789;

    // Try to start openclaw gateway in background
    let gatewayStarted = false;
    try {
      const { spawn } = require('child_process');
      const gw = spawn('openclaw', ['gateway', 'start'], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, HOME: HOME_DIR }
      });
      gw.unref();
      gatewayStarted = true;
      console.log('OpenClaw gateway spawned.');
    } catch (e) {
      console.log('Could not auto-start gateway:', e.message);
    }

    res.json({
      success: true,
      message: 'Configuration saved.',
      gatewayPort,
      gatewayStarted,
      configPath: CONFIG_PATH,
      dashboardUrl: `${BASE_PATH}/dashboard`
    });
  } catch (err) {
    console.error('Install error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Config Builder ──────────────────────────────────────────────────────────

function buildConfig(form) {
  // Determine which providers have keys configured
  const hasAnthropic = !!(form.anthropicApiKey);
  const hasGemini    = !!(form.geminiApiKey);
  const hasOpenAI    = !!(form.openaiApiKey);

  function providerOf(model) {
    if (model.startsWith('anthropic/')) return 'anthropic';
    if (model.startsWith('google/'))    return 'google';
    if (model.startsWith('openai/'))    return 'openai';
    return 'unknown';
  }

  function hasKeyFor(model) {
    const p = providerOf(model);
    if (p === 'anthropic') return hasAnthropic;
    if (p === 'google')    return hasGemini;
    if (p === 'openai')    return hasOpenAI;
    return false;
  }

  // Build model list — only include models whose provider has a key
  const primaryModel = form.model || 'anthropic/claude-sonnet-4-6';
  const fallbackModels = (form.fallbackModels || [])
    .filter(m => m && m !== primaryModel && hasKeyFor(m));

  // Build models map
  const modelsMap = {};
  [primaryModel, ...fallbackModels].forEach(m => {
    modelsMap[m] = {};
  });
  if (modelsMap['anthropic/claude-opus-4-6'])   modelsMap['anthropic/claude-opus-4-6']   = { alias: 'opus' };
  if (modelsMap['anthropic/claude-sonnet-4-6'])  modelsMap['anthropic/claude-sonnet-4-6']  = { alias: 'sonnet' };
  if (modelsMap['anthropic/claude-haiku-3-5'])   modelsMap['anthropic/claude-haiku-3-5']   = { alias: 'haiku' };

  const authProfile = form.claudeAuthMode === 'claude-code'
    ? { provider: 'anthropic', mode: 'token',   token:  form.anthropicApiKey }
    : { provider: 'anthropic', mode: 'api-key', apiKey: form.anthropicApiKey };

  const additionalProfiles = {};
  if (hasGemini) {
    additionalProfiles['google:default'] = { provider: 'google', mode: 'api-key', apiKey: form.geminiApiKey };
  }
  if (hasOpenAI) {
    additionalProfiles['openai:default'] = { provider: 'openai', mode: 'api-key', apiKey: form.openaiApiKey };
  }

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
        workspace: form.workspace || '/data/workspace',
        contextTokens: parseInt(form.contextTokens) || 80000,
        contextPruning: {
          mode: 'cache-ttl',
          ttl: '2h',
          keepLastAssistants: 3
        },
        compaction: { mode: 'safeguard' },
        maxConcurrent: 4,
        subagents: { maxConcurrent: 8 }
      }
    },
    tools: {
      web: {
        search: {
          enabled: !!(form.geminiApiKey),
          provider: 'gemini',
          gemini: { apiKey: form.geminiApiKey || '' }
        }
      }
    },
    browser: { headless: true, noSandbox: true },
    messages: { ackReactionScope: 'group-mentions' },
    commands: { native: 'auto', nativeSkills: 'auto', restart: true },
    channels: {
      telegram: {
        enabled: !!form.telegramEnabled,
        dmPolicy: 'allowlist',
        botToken: form.telegramBotToken || '',
        allowFrom: parseTelegramIds(form.telegramAllowFrom),
        groupPolicy: 'allowlist',
        streaming: 'off'
      },
      whatsapp: {
        enabled: !!form.whatsappEnabled,
        dmPolicy: 'allowlist',
        allowFrom: parsePhoneNumbers(form.whatsappAllowFrom),
        groupPolicy: 'allowlist',
        debounceMs: 0,
        mediaMaxMb: 50
      }
    },
    gateway: {
      port: parseInt(form.gatewayPort) || 18789,
      mode: 'local',
      bind: '0.0.0.0',
      auth: {
        mode: 'token',
        token: form.gatewayToken || generateToken()
      }
    },
    plugins: {
      entries: {
        telegram:  { enabled: !!form.telegramEnabled },
        whatsapp:  { enabled: !!form.whatsappEnabled }
      }
    }
  };
}

function parseTelegramIds(value) {
  if (!value) return [];
  return String(value).split(/[\n,\s]+/)
    .map(s => s.trim()).filter(Boolean)
    .map(s => parseInt(s)).filter(n => !isNaN(n));
}

function parsePhoneNumbers(value) {
  if (!value) return [];
  return String(value).split(/[\n,]+/)
    .map(s => s.trim()).filter(Boolean);
}

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let t = 'oc_';
  for (let i = 0; i < 32; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenClaw Setup Wizard → http://0.0.0.0:${PORT}${BASE_PATH}`);
});
