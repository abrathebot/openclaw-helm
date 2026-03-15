const BASE = window.BASE_PATH || '';
const TOTAL_STEPS = 6;
let currentStep = 0;

const MODELS = [
  { value: 'anthropic/claude-opus-4-6',            label: 'Claude Opus 4.6',              tag: 'most capable',  alias: 'opus' },
  { value: 'anthropic/claude-sonnet-4-6',           label: 'Claude Sonnet 4.6',            tag: 'recommended',   alias: 'sonnet' },
  { value: 'anthropic/claude-3-7-sonnet-20250219',  label: 'Claude Sonnet 3.7',            tag: 'latest 3.x',    alias: 'sonnet37' },
  { value: 'anthropic/claude-haiku-3-5',            label: 'Claude Haiku 3.5',             tag: 'fast / cheap',  alias: 'haiku' },
  { value: 'anthropic/claude-haiku-4-5',            label: 'Claude Haiku 4.5',             tag: 'fast 4.x',      alias: 'haiku4' },
  { value: 'google/gemini-2.5-pro',                 label: 'Gemini 2.5 Pro',               tag: 'Google',        alias: null },
  { value: 'openai/gpt-4o',                         label: 'GPT-4o',                       tag: 'OpenAI',        alias: null },
];

const formData = {
  claudeAuthMode:     'api-key',      // 'api-key' | 'claude-code'
  anthropicApiKey:    '',
  geminiApiKey:       '',
  openaiApiKey:       '',
  model:              'anthropic/claude-sonnet-4-6',
  fallbackModels:     [],
  contextTokens:      80000,
  telegramEnabled:    true,
  telegramBotToken:   '',
  telegramAllowFrom:  '',
  whatsappEnabled:    false,
  whatsappAllowFrom:  '',
  gatewayPort:        18789,
  workspace:          '/data/workspace',
  gatewayToken:       ''
};

// ── Modal System ──────────────────────────────────────────────────────────────

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
  }
});

function renderModals() {
  const existing = document.getElementById('modalsRoot');
  if (existing) return; // already rendered

  const root = document.createElement('div');
  root.id = 'modalsRoot';
  root.innerHTML = `

    <!-- Modal: Anthropic API Key -->
    <div class="modal-overlay" id="modal-claude-key" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">🔑 Get Anthropic API Key</div>
          <button class="modal-close" onclick="closeModal('modal-claude-key')">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">Your API key lets OpenClaw call Claude models. Billed per token — no subscription needed.</p>
          <div class="guide-steps">
            <div class="guide-step">
              <div class="guide-step-num">1</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Open Anthropic Console</div>
                <div class="guide-step-desc">Go to <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a> and sign in or create a free account.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">2</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Go to API Keys</div>
                <div class="guide-step-desc">Click your profile icon (top-right) → <strong>API Keys</strong>, or open the left sidebar → <strong>Get API Keys</strong>.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">3</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Create a new key</div>
                <div class="guide-step-desc">Click <strong>+ Create Key</strong>. Give it a name like <code>openclaw</code>. Copy the key immediately — it won't be shown again.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">4</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Add billing (optional)</div>
                <div class="guide-step-desc">You get some free credits. Add a card in <strong>Billing</strong> when ready. Claude Sonnet costs ~$3/million tokens.</div>
              </div>
            </div>
          </div>
          <div class="guide-tip">💡 <strong>Tip:</strong> Key starts with <code>sk-ant-api03-</code></div>
          <div class="guide-cta">
            <a class="btn-link" href="https://console.anthropic.com/settings/keys" target="_blank">Open Anthropic Console →</a>
            <button class="btn-link secondary" onclick="closeModal('modal-claude-key')">Got it, close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Claude Code Token -->
    <div class="modal-overlay" id="modal-claude-code" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">⚡ Get Claude Code Token</div>
          <button class="modal-close" onclick="closeModal('modal-claude-code')">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">Use your existing Claude subscription (Pro/Max) — no API billing. Requires Claude Code CLI installed on the host.</p>
          <div class="guide-steps">
            <div class="guide-step">
              <div class="guide-step-num">1</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Install Claude Code</div>
                <div class="guide-step-desc">Run: <code>npm install -g @anthropic-ai/claude-code</code></div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">2</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Authenticate</div>
                <div class="guide-step-desc">Run <code>claude</code> in terminal and sign in with your Anthropic account. This creates credentials at <code>~/.claude/.credentials.json</code>.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">3</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Extract access token</div>
                <div class="guide-step-desc">Run in terminal:<br><code>cat ~/.claude/.credentials.json | python3 -m json.tool</code><br><br>Copy the value of <code>claudeAiOauth.accessToken</code>.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">4</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Paste the token here</div>
                <div class="guide-step-desc">Token starts with <code>sk-ant-oat01-</code>. Paste it in the field above.</div>
              </div>
            </div>
          </div>
          <div class="guide-tip">💡 <strong>Note:</strong> OAuth tokens expire. Re-login to Claude Code if validation fails.</div>
          <div class="guide-cta">
            <button class="btn-link secondary" onclick="closeModal('modal-claude-code')">Got it, close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Gemini API Key -->
    <div class="modal-overlay" id="modal-gemini" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">🔍 Get Gemini API Key</div>
          <button class="modal-close" onclick="closeModal('modal-gemini')">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">Gemini API key enables web search in OpenClaw. The free tier is very generous.</p>
          <div class="guide-steps">
            <div class="guide-step">
              <div class="guide-step-num">1</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Open Google AI Studio</div>
                <div class="guide-step-desc">Go to <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a> and sign in with your Google account.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">2</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Get API Key</div>
                <div class="guide-step-desc">Click <strong>Get API Key</strong> on the left sidebar → <strong>Create API key</strong>. Select any project or create a new one.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">3</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Copy and paste here</div>
                <div class="guide-step-desc">Key starts with <code>AIza</code>. Paste it in the Gemini API Key field.</div>
              </div>
            </div>
          </div>
          <div class="guide-tip">💡 <strong>Free tier:</strong> 1,500 requests/day at no cost. More than enough for personal use.</div>
          <div class="guide-cta">
            <a class="btn-link" href="https://aistudio.google.com/apikey" target="_blank">Open AI Studio →</a>
            <button class="btn-link secondary" onclick="closeModal('modal-gemini')">Got it, close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: OpenAI API Key -->
    <div class="modal-overlay" id="modal-openai" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">🤖 Get OpenAI API Key</div>
          <button class="modal-close" onclick="closeModal('modal-openai')">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">OpenAI API key enables GPT-4o as a fallback model. Pay-as-you-go billing.</p>
          <div class="guide-steps">
            <div class="guide-step">
              <div class="guide-step-num">1</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Open OpenAI Platform</div>
                <div class="guide-step-desc">Go to <a href="https://platform.openai.com" target="_blank">platform.openai.com</a> and sign in or create an account.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">2</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Go to API Keys</div>
                <div class="guide-step-desc">Click your profile icon → <strong>API Keys</strong>, or go to <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com/api-keys</a>.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">3</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Create a new key</div>
                <div class="guide-step-desc">Click <strong>+ Create new secret key</strong>. Copy it immediately — it won't be shown again.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">4</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Add billing credits</div>
                <div class="guide-step-desc">Go to <strong>Billing</strong> and add a payment method. GPT-4o costs ~$5/million input tokens.</div>
              </div>
            </div>
          </div>
          <div class="guide-tip">💡 <strong>Tip:</strong> Key starts with <code>sk-</code> (not <code>sk-ant-</code>)</div>
          <div class="guide-cta">
            <a class="btn-link" href="https://platform.openai.com/api-keys" target="_blank">Open OpenAI Platform →</a>
            <button class="btn-link secondary" onclick="closeModal('modal-openai')">Got it, close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Telegram Bot Token -->
    <div class="modal-overlay" id="modal-telegram" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">🤖 Create Telegram Bot</div>
          <button class="modal-close" onclick="closeModal('modal-telegram')">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">You need a Telegram bot to connect OpenClaw. Takes about 1 minute via BotFather.</p>
          <div class="guide-steps">
            <div class="guide-step">
              <div class="guide-step-num">1</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Open BotFather</div>
                <div class="guide-step-desc">Open Telegram and start a chat with <a href="https://t.me/BotFather" target="_blank">@BotFather</a> — Telegram's official bot manager.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">2</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Create a new bot</div>
                <div class="guide-step-desc">Send <code>/newbot</code>. BotFather will ask for a name (e.g. <em>My Assistant</em>) and a username ending in <code>_bot</code> (e.g. <em>myassistant_bot</em>).</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">3</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Copy the token</div>
                <div class="guide-step-desc">BotFather will reply with your bot token. It looks like:<br><code>123456789:ABCDefGhIJKlmno...</code></div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">4</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Paste it here</div>
                <div class="guide-step-desc">Paste the full token in the <strong>Bot Token</strong> field. Never share this token publicly.</div>
              </div>
            </div>
          </div>
          <div class="guide-tip">💡 <strong>Tip:</strong> You can disable privacy mode with <code>/setprivacy</code> → <em>Disable</em> if you want the bot to read all messages in groups.</div>
          <div class="guide-cta">
            <a class="btn-link" href="https://t.me/BotFather" target="_blank">Open BotFather →</a>
            <button class="btn-link secondary" onclick="closeModal('modal-telegram')">Got it, close</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal: Telegram User ID -->
    <div class="modal-overlay" id="modal-telegram-id" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">🪪 Find Your Telegram ID</div>
          <button class="modal-close" onclick="closeModal('modal-telegram-id')">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">OpenClaw uses your numeric Telegram user ID to allow only you (and authorized people) to use the bot.</p>
          <div class="guide-steps">
            <div class="guide-step">
              <div class="guide-step-num">1</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Open userinfobot</div>
                <div class="guide-step-desc">Start a chat with <a href="https://t.me/userinfobot" target="_blank">@userinfobot</a> on Telegram.</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">2</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Send /start or any message</div>
                <div class="guide-step-desc">The bot will instantly reply with your user info including your numeric <strong>Id</strong> (e.g. <code>123456789</code>).</div>
              </div>
            </div>
            <div class="guide-step">
              <div class="guide-step-num">3</div>
              <div class="guide-step-content">
                <div class="guide-step-title">Paste the ID here</div>
                <div class="guide-step-desc">Enter the numeric ID in the <strong>Allowed Telegram User IDs</strong> field. Add multiple IDs separated by commas.</div>
              </div>
            </div>
          </div>
          <div class="guide-tip">💡 <strong>Leave blank</strong> to allow anyone who messages your bot. Not recommended for public deployments.</div>
          <div class="guide-cta">
            <a class="btn-link" href="https://t.me/userinfobot" target="_blank">Open userinfobot →</a>
            <button class="btn-link secondary" onclick="closeModal('modal-telegram-id')">Got it, close</button>
          </div>
        </div>
      </div>
    </div>

  `;
  document.body.appendChild(root);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mask(key) {
  if (!key) return '(not set)';
  if (key.length <= 10) return '••••••••';
  return key.slice(0, 6) + '•••' + key.slice(-4);
}

function api(url, opts) {
  return fetch(`${BASE}${url}`, opts);
}

// ── Progress ──────────────────────────────────────────────────────────────────

function renderProgress() {
  const bar  = document.getElementById('progressBar');
  const ind  = document.getElementById('stepIndicator');
  bar.innerHTML = '';
  for (let i = 0; i < TOTAL_STEPS; i++) {
    const s = document.createElement('div');
    s.className = 'progress-segment' + (i <= currentStep ? ' active' : '');
    bar.appendChild(s);
  }
  ind.textContent = `Step ${currentStep + 1} of ${TOTAL_STEPS}`;
}

function goTo(step) { currentStep = step; renderProgress(); renderStep(); }
function next()      { if (currentStep < TOTAL_STEPS - 1) goTo(currentStep + 1); }
function prev()      { if (currentStep > 0) goTo(currentStep - 1); }

function toggleConditional(id, show) {
  const el = document.getElementById(id);
  if (el) show ? el.classList.add('open') : el.classList.remove('open');
}

// ── Steps ────────────────────────────────────────────────────────────────────

function renderStep() {
  const card = document.getElementById('wizardCard');
  switch (currentStep) {
    case 0: return renderWelcome(card);
    case 1: return renderAIProvider(card);
    case 2: return renderModels(card);
    case 3: return renderTelegram(card);
    case 4: return renderWhatsApp(card);
    case 5: return renderReview(card);
  }
}

// Step 0: Welcome
function renderWelcome(card) {
  card.innerHTML = `
    <div class="logo">
      <pre style="font-size:14px;line-height:1.2;color:#7c3aed;display:inline-block;text-align:left">
   ____                    ________
  / __ \\____  ___  ____  / ____/ /___ __      __
 / / / / __ \\/ _ \\/ __ \\/ /   / / __ \`/ | /| / /
/ /_/ / /_/ /  __/ / / / /___/ / /_/ /| |/ |/ /
\\____/ .___/\\___/_/ /_/\\____/_/\\__,_/ |__/|__/
    /_/
      </pre>
    </div>
    <h1>Welcome to OpenClaw</h1>
    <p class="subtitle">
      Your AI butler for Telegram, WhatsApp, and more.<br>
      This wizard will configure your OpenClaw deployment in a few simple steps.
    </p>
    <div class="feature-grid">
      <div class="feature-item">🤖 Multi-model AI</div>
      <div class="feature-item">📱 Telegram</div>
      <div class="feature-item">💬 WhatsApp</div>
      <div class="feature-item">🌐 Web Search</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary btn-full" onclick="next()">Get Started →</button>
    </div>
  `;
}

// Step 1: AI Provider (auth mode + API key/token)
function renderAIProvider(card) {
  const isApiKey = formData.claudeAuthMode === 'api-key';
  card.innerHTML = `
    <h2>AI Provider</h2>
    <p class="step-desc">Choose how OpenClaw authenticates with Claude.</p>

    <div class="auth-mode-tabs">
      <button class="auth-tab ${isApiKey ? 'active' : ''}" onclick="setAuthMode('api-key')">
        🔑 Anthropic API Key
      </button>
      <button class="auth-tab ${!isApiKey ? 'active' : ''}" onclick="setAuthMode('claude-code')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        Claude Code Token
      </button>
    </div>

    <div id="apiKeySection" style="display:${isApiKey ? 'block' : 'none'}">
      <div class="auth-info">
        Use your Anthropic API key. Billed per token.
      </div>
      <div class="form-group">
        <div class="label-row">
          <label>API Key <span class="required">*</span></label>
          <button class="help-btn" onclick="openModal('modal-claude-key')">❓ How to get?</button>
        </div>
        <input type="password" id="anthropicKey" value="${formData.anthropicApiKey}"
          placeholder="sk-ant-api03-..."
          oninput="formData.anthropicApiKey = this.value">
        <div class="error-msg" id="claudeError"></div>
      </div>
    </div>

    <div id="claudeCodeSection" style="display:${!isApiKey ? 'block' : 'none'}">
      <div class="auth-info">
        Use your Claude Code OAuth token. No API billing — uses your Claude subscription.
      </div>
      <div class="form-group">
        <div class="label-row">
          <label>Claude Code Token <span class="required">*</span></label>
          <button class="help-btn" onclick="openModal('modal-claude-code')">❓ How to get?</button>
        </div>
        <textarea id="claudeCodeToken" rows="3"
          placeholder="Paste your Claude Code access token here..."
          oninput="formData.anthropicApiKey = this.value"
          style="font-family:monospace;font-size:12px">${formData.claudeAuthMode === 'claude-code' ? formData.anthropicApiKey : ''}</textarea>
        <div class="hint">
          Find it in <code>~/.claude/.credentials.json</code> → <code>claudeAiOauth.accessToken</code>
        </div>
        <div class="error-msg" id="claudeError"></div>
      </div>
    </div>

    <button class="validate-btn" onclick="validateClaude()">✓ Validate Token</button>
    <div class="validate-result" id="claudeValidate"></div>

    <hr style="border:none;border-top:1px solid #2a2a3e;margin:20px 0">

    <div class="providers-section">
      <div class="providers-label">Optional Providers <span class="optional">— unlocks more models</span></div>
      <div class="form-group" style="margin-top:12px">
        <div class="label-row">
          <label>Gemini API Key</label>
          <button class="help-btn" onclick="openModal('modal-gemini')">❓ How to get?</button>
        </div>
        <input type="password" id="geminiKey" value="${formData.geminiApiKey}"
          placeholder="AIza..."
          oninput="formData.geminiApiKey = this.value">
        <div class="hint">Enables web search + Google models (Gemini 2.5 Pro). Free tier: 1,500 req/day.</div>
      </div>
      <div class="form-group">
        <div class="label-row">
          <label>OpenAI API Key</label>
          <button class="help-btn" onclick="openModal('modal-openai')">❓ How to get?</button>
        </div>
        <input type="password" id="openaiKey" value="${formData.openaiApiKey}"
          placeholder="sk-..."
          oninput="formData.openaiApiKey = this.value">
        <div class="hint">Enables GPT-4o and other OpenAI models as fallback.</div>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="validateAndNext()">Next →</button>
    </div>
  `;
}

function setAuthMode(mode) {
  formData.claudeAuthMode = mode;
  formData.anthropicApiKey = '';
  renderAIProvider(document.getElementById('wizardCard'));
}

async function validateClaude() {
  const el = document.getElementById('claudeValidate');
  const key = formData.anthropicApiKey;
  if (!key) { el.className='validate-result fail'; el.textContent='Please enter a key/token'; return; }
  el.className='validate-result'; el.textContent='Validating…';
  try {
    const res  = await api('/api/validate-claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, mode: formData.claudeAuthMode })
    });
    const data = await res.json();
    if (data.valid) {
      el.className = 'validate-result success';
      el.textContent = '✓ Valid' + (data.note ? ' — ' + data.note : '');
    } else {
      el.className = 'validate-result fail';
      el.textContent = '✗ ' + (data.error || 'Invalid');
    }
  } catch {
    el.className = 'validate-result fail';
    el.textContent = 'Could not reach server';
  }
}

function validateAndNext() {
  const errEl = document.getElementById('claudeError');
  if (!formData.anthropicApiKey) {
    errEl.textContent = formData.claudeAuthMode === 'api-key'
      ? 'Claude API key is required'
      : 'Claude Code token is required';
    errEl.classList.add('visible');
    return;
  }
  errEl.classList.remove('visible');
  next();
}

function providerAvailable(modelValue) {
  if (modelValue.startsWith('anthropic/')) return !!formData.anthropicApiKey;
  if (modelValue.startsWith('google/'))    return !!formData.geminiApiKey;
  if (modelValue.startsWith('openai/'))    return !!formData.openaiApiKey;
  return false;
}

// Step 2: Models
function renderModels(card) {
  const availableModels = MODELS.filter(m => providerAvailable(m.value));

  // If primary model's provider lost its key, reset to first available
  if (!providerAvailable(formData.model) && availableModels.length > 0) {
    formData.model = availableModels[0].value;
  }
  // Clean up fallbacks that no longer have keys
  formData.fallbackModels = formData.fallbackModels.filter(m => providerAvailable(m));

  const modelOptions = availableModels.map(m => `
    <option value="${m.value}" ${formData.model === m.value ? 'selected' : ''}>
      ${m.label} — ${m.tag}${m.alias ? ' (/' + m.alias + ')' : ''}
    </option>
  `).join('');

  const fallbackOptions = availableModels
    .filter(m => m.value !== formData.model)
    .map(m => {
      const checked = formData.fallbackModels.includes(m.value) ? 'checked' : '';
      return `
        <label class="checkbox-row">
          <input type="checkbox" value="${m.value}" ${checked}
            onchange="toggleFallback(this.value, this.checked)">
          <span>${m.label} <span class="tag">${m.tag}</span></span>
        </label>
      `;
    }).join('');

  card.innerHTML = `
    <h2>Model Configuration</h2>
    <p class="step-desc">Choose your primary model and optional fallbacks.</p>

    <div class="form-group">
      <label>Primary Model <span class="required">*</span></label>
      <select id="primaryModel" onchange="setPrimaryModel(this.value)">${modelOptions}</select>
      <div class="hint">This is the default model for all agent sessions.</div>
    </div>

    <div class="form-group">
      <label>Context Window (tokens)</label>
      <select onchange="formData.contextTokens = parseInt(this.value)">
        <option value="40000"  ${formData.contextTokens===40000  ? 'selected':''}>40K — lightweight</option>
        <option value="80000"  ${formData.contextTokens===80000  ? 'selected':''}>80K — recommended</option>
        <option value="120000" ${formData.contextTokens===120000 ? 'selected':''}>120K — large context</option>
        <option value="200000" ${formData.contextTokens===200000 ? 'selected':''}>200K — max (Opus)</option>
      </select>
    </div>

    <div class="form-group">
      <label>Fallback Models <span class="optional">(optional)</span></label>
      <p class="hint" style="margin-bottom:8px">OpenClaw falls back automatically if the primary model is unavailable. Only models with configured API keys are shown.</p>
      ${fallbackOptions
        ? `<div class="checkbox-group">${fallbackOptions}</div>`
        : `<div class="empty-note">No additional models available. Add Gemini or OpenAI API keys in the previous step to unlock more options.</div>`
      }
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="next()">Next →</button>
    </div>
  `;
}

function setPrimaryModel(val) {
  formData.model = val;
  // Remove from fallbacks if selected as primary
  formData.fallbackModels = formData.fallbackModels.filter(m => m !== val);
  renderModels(document.getElementById('wizardCard'));
}

function toggleFallback(val, checked) {
  if (checked) {
    if (!formData.fallbackModels.includes(val)) formData.fallbackModels.push(val);
  } else {
    formData.fallbackModels = formData.fallbackModels.filter(m => m !== val);
  }
}

// Step 3: Telegram
function renderTelegram(card) {
  const open = formData.telegramEnabled;
  card.innerHTML = `
    <h2>Telegram</h2>
    <p class="step-desc">Connect OpenClaw to a Telegram bot.</p>
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Enable Telegram</div>
        <div class="toggle-sub">Receive and respond to Telegram messages</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="tgEnabled" ${open ? 'checked' : ''}
          onchange="formData.telegramEnabled = this.checked; toggleConditional('tgFields', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="conditional-fields ${open ? 'open' : ''}" id="tgFields">
      <div class="form-group">
        <div class="label-row">
          <label>Bot Token</label>
          <button class="help-btn" onclick="openModal('modal-telegram')">❓ Create bot</button>
        </div>
        <input type="password" id="tgToken" value="${formData.telegramBotToken}"
          placeholder="123456789:ABC-DEF1234ghIkl-zyx57W2v..."
          oninput="formData.telegramBotToken = this.value">
        <div class="hint">Create via @BotFather · takes ~1 minute</div>
      </div>
      <div class="form-group">
        <div class="label-row">
          <label>Allowed Telegram User IDs</label>
          <button class="help-btn" onclick="openModal('modal-telegram-id')">❓ Find my ID</button>
        </div>
        <input type="text" value="${formData.telegramAllowFrom}"
          placeholder="123456789, 987654321"
          oninput="formData.telegramAllowFrom = this.value">
        <div class="hint">Comma-separated numeric IDs. Leave blank to allow anyone (not recommended).</div>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="next()">Next →</button>
    </div>
  `;
}

// Step 4: WhatsApp
function renderWhatsApp(card) {
  const open = formData.whatsappEnabled;
  card.innerHTML = `
    <h2>WhatsApp</h2>
    <p class="step-desc">Optionally connect OpenClaw to WhatsApp.</p>
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Enable WhatsApp</div>
        <div class="toggle-sub">Scans a QR code on first run</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${open ? 'checked' : ''}
          onchange="formData.whatsappEnabled = this.checked; toggleConditional('waFields', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="conditional-fields ${open ? 'open' : ''}" id="waFields">
      <div class="form-group">
        <label>Allowed Phone Numbers</label>
        <textarea placeholder="+628123456789&#10;+1234567890"
          oninput="formData.whatsappAllowFrom = this.value"
          rows="3">${formData.whatsappAllowFrom}</textarea>
        <div class="hint">One number per line with country code (e.g. +628xxx)</div>
      </div>
    </div>
    <div class="form-group" style="margin-top:16px">
      <label>Gateway Port</label>
      <input type="number" value="${formData.gatewayPort}"
        oninput="formData.gatewayPort = parseInt(this.value) || 18789">
      <div class="hint">Default: 18789</div>
    </div>
    <div class="form-group">
      <label>Workspace Path</label>
      <input type="text" value="${formData.workspace}"
        oninput="formData.workspace = this.value">
      <div class="hint">Agent workspace directory inside the container</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="next()">Next →</button>
    </div>
  `;
}

// Step 5: Review & Install
function renderReview(card) {
  const modelLabel = MODELS.find(m => m.value === formData.model)?.label || formData.model;
  const fallbackLabels = formData.fallbackModels.map(v =>
    MODELS.find(m => m.value === v)?.label || v
  ).join(', ') || 'None';

  const authLabel = formData.claudeAuthMode === 'claude-code'
    ? '🔐 Claude Code Token'
    : '🔑 Anthropic API Key';

  card.innerHTML = `
    <h2>Review & Install</h2>
    <p class="step-desc">Verify your settings before installing.</p>

    <div class="summary-section">
      <h3>AI Provider</h3>
      <div class="summary-row"><span class="label">Auth Mode</span><span class="value">${authLabel}</span></div>
      <div class="summary-row"><span class="label">Token / Key</span><span class="value">${mask(formData.anthropicApiKey)}</span></div>
      <div class="summary-row"><span class="label">Gemini (search)</span><span class="value">${formData.geminiApiKey ? mask(formData.geminiApiKey) : 'Disabled'}</span></div>
    </div>

    <div class="summary-section">
      <h3>Models</h3>
      <div class="summary-row"><span class="label">Primary</span><span class="value">${modelLabel}</span></div>
      <div class="summary-row"><span class="label">Fallbacks</span><span class="value">${fallbackLabels}</span></div>
      <div class="summary-row"><span class="label">Context</span><span class="value">${(formData.contextTokens/1000).toFixed(0)}K tokens</span></div>
    </div>

    <div class="summary-section">
      <h3>Channels</h3>
      <div class="summary-row"><span class="label">Telegram</span><span class="value">${formData.telegramEnabled ? '✓ Enabled' : '✗ Disabled'}</span></div>
      ${formData.telegramEnabled ? `
        <div class="summary-row"><span class="label">Bot Token</span><span class="value">${mask(formData.telegramBotToken)}</span></div>
        <div class="summary-row"><span class="label">Allow From</span><span class="value">${formData.telegramAllowFrom || '(none)'}</span></div>
      ` : ''}
      <div class="summary-row"><span class="label">WhatsApp</span><span class="value">${formData.whatsappEnabled ? '✓ Enabled' : '✗ Disabled'}</span></div>
    </div>

    <div class="summary-section">
      <h3>Gateway</h3>
      <div class="summary-row"><span class="label">Port</span><span class="value">${formData.gatewayPort}</span></div>
      <div class="summary-row"><span class="label">Workspace</span><span class="value">${formData.workspace}</span></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" id="installBtn" onclick="doInstall()">🚀 Install OpenClaw</button>
    </div>
  `;
}

async function doInstall() {
  const btn = document.getElementById('installBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Installing…';
  try {
    const res  = await api('/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    if (data.success) {
      renderSuccess(data);
    } else {
      btn.disabled = false;
      btn.textContent = '🚀 Install OpenClaw';
      alert('Installation failed: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    renderSuccess({});
  }
}

function renderSuccess(data) {
  const port = (data && data.gatewayPort) || 18789;
  const started = data && data.gatewayStarted;
  const host = window.location.hostname;

  document.getElementById('stepIndicator').textContent = '';
  document.getElementById('progressBar').innerHTML = '';
  document.getElementById('wizardCard').innerHTML = `
    <div class="success-screen">
      <div class="success-icon">🎉</div>
      <h2>Installation Complete!</h2>
      <p>OpenClaw has been configured successfully.</p>

      <div class="summary-section" style="margin-top:24px;text-align:left">
        <h3>What's next</h3>
        <div class="summary-row">
          <span class="label">Config saved to</span>
          <span class="value" style="font-size:11px">${(data && data.configPath) || '~/.openclaw/openclaw.json'}</span>
        </div>
        <div class="summary-row">
          <span class="label">Gateway status</span>
          <span class="value" style="color:${started ? '#22c55e' : '#f59e0b'}">${started ? '✓ Starting…' : '⚠ Start manually'}</span>
        </div>
        <div class="summary-row">
          <span class="label">Gateway port</span>
          <span class="value">${port}</span>
        </div>
      </div>

      ${!started ? `
      <div class="guide-tip" style="margin-top:16px;text-align:left">
        <strong>Start OpenClaw manually:</strong><br>
        Run in terminal: <code>openclaw gateway start</code>
      </div>` : ''}

      <p style="margin-top:20px;font-size:13px;color:#6b7280">
        You can now close this wizard and use OpenClaw via your configured channels (Telegram/WhatsApp).
      </p>
    </div>
  `;
}

// Init
renderModals();
goTo(0);
