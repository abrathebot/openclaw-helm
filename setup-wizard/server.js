const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = 3000;
const CONFIG_DIR = '/data/.openclaw';
const CONFIG_PATH = path.join(CONFIG_DIR, 'openclaw.json');
const WORKSPACE_DIR = '/data/workspace';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({ configured: fs.existsSync(CONFIG_PATH) });
});

app.post('/api/validate-claude', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    return res.json({ valid: false, error: 'Invalid API key format. Must start with sk-ant-' });
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
    if (response.ok || response.status === 400) {
      return res.json({ valid: true });
    }
    const data = await response.json().catch(() => ({}));
    return res.json({ valid: false, error: data.error?.message || 'API key validation failed' });
  } catch (err) {
    return res.json({ valid: false, error: 'Could not reach Anthropic API: ' + err.message });
  }
});

app.post('/api/install', (req, res) => {
  const config = req.body;

  try {
    const openclawConfig = buildConfig(config);

    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(openclawConfig, null, 2), 'utf8');

    res.json({ success: true, message: 'Configuration saved. OpenClaw is starting...' });

    // Give the response time to send, then exit so entrypoint restarts with openclaw
    setTimeout(() => {
      console.log('Configuration written. Exiting wizard so entrypoint can start OpenClaw...');
      process.exit(0);
    }, 1500);
  } catch (err) {
    console.error('Install error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

function buildConfig(form) {
  const gatewayToken = form.gatewayToken || generateToken();

  const config = {
    auth: {
      profiles: {
        'anthropic:default': {
          provider: 'anthropic',
          mode: 'token'
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: form.model || 'anthropic/claude-sonnet-4-6',
          fallbacks: []
        },
        workspace: form.workspace || '/data/workspace',
        contextTokens: 80000
      }
    },
    tools: {
      web: {
        search: {
          enabled: !!form.geminiApiKey,
          provider: 'gemini',
          gemini: {
            apiKey: form.geminiApiKey || ''
          }
        }
      }
    },
    channels: {
      telegram: {
        enabled: !!form.telegramEnabled,
        dmPolicy: 'allowlist',
        botToken: form.telegramBotToken || '',
        allowFrom: parseAllowFrom(form.telegramAllowFrom),
        groupPolicy: 'allowlist',
        streaming: 'off'
      },
      whatsapp: {
        enabled: !!form.whatsappEnabled,
        dmPolicy: 'allowlist',
        allowFrom: parseWhatsAppNumbers(form.whatsappAllowFrom),
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
        token: gatewayToken
      }
    },
    plugins: {
      entries: {
        telegram: { enabled: !!form.telegramEnabled },
        whatsapp: { enabled: !!form.whatsappEnabled }
      }
    }
  };

  // Write the Anthropic API key to environment file for openclaw
  const envContent = `ANTHROPIC_API_KEY=${form.anthropicApiKey}\n`;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(CONFIG_DIR, '.env'), envContent, 'utf8');

  return config;
}

function parseAllowFrom(value) {
  if (!value) return [];
  return value.toString().split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s)
    .map(s => parseInt(s))
    .filter(n => !isNaN(n));
}

function parseWhatsAppNumbers(value) {
  if (!value) return [];
  return value.toString().split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s);
}

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'oc_';
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenClaw Setup Wizard running at http://0.0.0.0:${PORT}`);
});
