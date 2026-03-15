const express = require('express');
const fs = require('fs');
const path = require('path');

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

// Static files
app.use(BASE_PATH, express.static(path.join(__dirname, 'public')));

// Root redirect
app.get('/', (req, res) => res.redirect(BASE_PATH));

// ── API Routes ──────────────────────────────────────────────────────────────

app.get(`${BASE_PATH}/api/status`, (req, res) => {
  res.json({ configured: fs.existsSync(CONFIG_PATH) });
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

    res.json({ success: true, message: 'Configuration saved. OpenClaw is starting...' });
    setTimeout(() => {
      console.log('Config written. Restarting into OpenClaw...');
      process.exit(0);
    }, 1500);
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
