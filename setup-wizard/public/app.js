const TOTAL_STEPS = 6;
let currentStep = 0;

const formData = {
  anthropicApiKey: '',
  model: 'anthropic/claude-sonnet-4-6',
  geminiApiKey: '',
  telegramEnabled: true,
  telegramBotToken: '',
  telegramAllowFrom: '',
  whatsappEnabled: false,
  whatsappAllowFrom: '',
  gatewayPort: 18789,
  workspace: '/data/workspace',
  gatewayToken: ''
};

function maskKey(key) {
  if (!key) return '(not set)';
  if (key.length <= 10) return '****';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

function renderProgress() {
  const bar = document.getElementById('progressBar');
  const indicator = document.getElementById('stepIndicator');
  bar.innerHTML = '';
  for (let i = 0; i < TOTAL_STEPS; i++) {
    const seg = document.createElement('div');
    seg.className = 'progress-segment' + (i <= currentStep ? ' active' : '');
    bar.appendChild(seg);
  }
  indicator.textContent = `Step ${currentStep + 1} of ${TOTAL_STEPS}`;
}

function goTo(step) {
  currentStep = step;
  renderProgress();
  renderStep();
}

function next() {
  if (currentStep < TOTAL_STEPS - 1) goTo(currentStep + 1);
}

function prev() {
  if (currentStep > 0) goTo(currentStep - 1);
}

function saveField(name, value) {
  formData[name] = value;
}

function renderStep() {
  const card = document.getElementById('wizardCard');
  switch (currentStep) {
    case 0: return renderWelcome(card);
    case 1: return renderAIProvider(card);
    case 2: return renderTelegram(card);
    case 3: return renderWhatsApp(card);
    case 4: return renderGateway(card);
    case 5: return renderReview(card);
  }
}

function renderWelcome(card) {
  card.innerHTML = `
    <div class="logo">
      <pre style="font-size:16px;line-height:1.2;color:#7c3aed;display:inline-block;text-align:left">
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
    <div class="btn-row">
      <button class="btn btn-primary btn-full" onclick="next()">Get Started</button>
    </div>
  `;
}

function renderAIProvider(card) {
  card.innerHTML = `
    <h2>AI Provider</h2>
    <p class="step-desc">Configure your Claude API access and optional web search.</p>
    <div class="form-group">
      <label>Claude API Key *</label>
      <input type="password" id="anthropicKey" value="${formData.anthropicApiKey}" placeholder="sk-ant-..." oninput="saveField('anthropicApiKey', this.value)">
      <div class="hint">Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a></div>
      <div class="error-msg" id="claudeError"></div>
      <button class="validate-btn" onclick="validateClaude()">Validate Key</button>
      <div class="validate-result" id="claudeValidate"></div>
    </div>
    <div class="form-group">
      <label>Default Model</label>
      <select id="model" onchange="saveField('model', this.value)">
        <option value="anthropic/claude-sonnet-4-6" ${formData.model === 'anthropic/claude-sonnet-4-6' ? 'selected' : ''}>Claude Sonnet 4.6 (recommended)</option>
        <option value="anthropic/claude-opus-4-6" ${formData.model === 'anthropic/claude-opus-4-6' ? 'selected' : ''}>Claude Opus 4.6</option>
        <option value="anthropic/claude-haiku-4-5" ${formData.model === 'anthropic/claude-haiku-4-5' ? 'selected' : ''}>Claude Haiku 4.5 (fast/cheap)</option>
      </select>
    </div>
    <div class="form-group">
      <label>Gemini API Key (optional)</label>
      <input type="password" id="geminiKey" value="${formData.geminiApiKey}" placeholder="AI..." oninput="saveField('geminiApiKey', this.value)">
      <div class="hint">For web search. Get key at <a href="https://aistudio.google.com" target="_blank">aistudio.google.com</a></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="validateAndNext()">Next</button>
    </div>
  `;
}

async function validateClaude() {
  const el = document.getElementById('claudeValidate');
  const key = formData.anthropicApiKey;
  if (!key) { el.className = 'validate-result fail'; el.textContent = 'Please enter an API key'; return; }
  el.className = 'validate-result'; el.textContent = 'Validating...';
  try {
    const res = await fetch('/api/validate-claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key })
    });
    const data = await res.json();
    if (data.valid) {
      el.className = 'validate-result success';
      el.textContent = 'Valid API key';
    } else {
      el.className = 'validate-result fail';
      el.textContent = data.error || 'Invalid key';
    }
  } catch {
    el.className = 'validate-result fail';
    el.textContent = 'Validation request failed';
  }
}

function validateAndNext() {
  const errEl = document.getElementById('claudeError');
  if (!formData.anthropicApiKey) {
    errEl.textContent = 'Claude API key is required';
    errEl.classList.add('visible');
    document.getElementById('anthropicKey').classList.add('error');
    return;
  }
  errEl.classList.remove('visible');
  document.getElementById('anthropicKey').classList.remove('error');
  next();
}

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
        <input type="checkbox" id="tgEnabled" ${open ? 'checked' : ''} onchange="saveField('telegramEnabled', this.checked); toggleConditional('tgFields', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="conditional-fields ${open ? 'open' : ''}" id="tgFields">
      <div class="form-group">
        <label>Bot Token</label>
        <input type="password" id="tgToken" value="${formData.telegramBotToken}" placeholder="123456:ABC-DEF..." oninput="saveField('telegramBotToken', this.value)">
        <div class="hint">Create a bot via <a href="https://t.me/BotFather" target="_blank">@BotFather</a> on Telegram</div>
      </div>
      <div class="form-group">
        <label>Your Telegram User ID</label>
        <input type="text" id="tgUserId" value="${formData.telegramAllowFrom}" placeholder="123456789" oninput="saveField('telegramAllowFrom', this.value)">
        <div class="hint">Get your ID from <a href="https://t.me/userinfobot" target="_blank">@userinfobot</a> on Telegram</div>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="next()">Next</button>
    </div>
  `;
}

function toggleConditional(id, show) {
  const el = document.getElementById(id);
  if (show) el.classList.add('open');
  else el.classList.remove('open');
}

function renderWhatsApp(card) {
  const open = formData.whatsappEnabled;
  card.innerHTML = `
    <h2>WhatsApp</h2>
    <p class="step-desc">Optionally connect OpenClaw to WhatsApp.</p>
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Enable WhatsApp</div>
        <div class="toggle-sub">Receive and respond to WhatsApp messages</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="waEnabled" ${open ? 'checked' : ''} onchange="saveField('whatsappEnabled', this.checked); toggleConditional('waFields', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="conditional-fields ${open ? 'open' : ''}" id="waFields">
      <div class="form-group">
        <label>Allowed Phone Numbers</label>
        <textarea id="waNumbers" placeholder="+628123456789&#10;+1234567890" oninput="saveField('whatsappAllowFrom', this.value)">${formData.whatsappAllowFrom}</textarea>
        <div class="hint">One number per line, with country code (e.g., +628xxx)</div>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="next()">Next</button>
    </div>
  `;
}

function renderGateway(card) {
  card.innerHTML = `
    <h2>Gateway Settings</h2>
    <p class="step-desc">Configure the OpenClaw gateway server.</p>
    <div class="form-group">
      <label>Gateway Port</label>
      <input type="number" id="gwPort" value="${formData.gatewayPort}" oninput="saveField('gatewayPort', parseInt(this.value) || 18789)">
      <div class="hint">Default: 18789</div>
    </div>
    <div class="form-group">
      <label>Workspace Path</label>
      <input type="text" id="workspace" value="${formData.workspace}" oninput="saveField('workspace', this.value)">
      <div class="hint">Directory for agent workspaces inside the container</div>
    </div>
    <div class="form-group">
      <label>Gateway Token (optional)</label>
      <input type="text" id="gwToken" value="${formData.gatewayToken}" placeholder="Leave blank to auto-generate" oninput="saveField('gatewayToken', this.value)">
      <div class="hint">Authentication token for the gateway API. Auto-generated if left blank.</div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" onclick="next()">Next</button>
    </div>
  `;
}

function renderReview(card) {
  card.innerHTML = `
    <h2>Review & Install</h2>
    <p class="step-desc">Verify your settings before installing OpenClaw.</p>

    <div class="summary-section">
      <h3>AI Provider</h3>
      <div class="summary-row"><span class="label">Claude API Key</span><span class="value">${maskKey(formData.anthropicApiKey)}</span></div>
      <div class="summary-row"><span class="label">Model</span><span class="value">${formData.model.split('/')[1]}</span></div>
      <div class="summary-row"><span class="label">Gemini (Web Search)</span><span class="value">${formData.geminiApiKey ? maskKey(formData.geminiApiKey) : 'Disabled'}</span></div>
    </div>

    <div class="summary-section">
      <h3>Channels</h3>
      <div class="summary-row"><span class="label">Telegram</span><span class="value">${formData.telegramEnabled ? 'Enabled' : 'Disabled'}</span></div>
      ${formData.telegramEnabled ? `<div class="summary-row"><span class="label">Bot Token</span><span class="value">${maskKey(formData.telegramBotToken)}</span></div>
      <div class="summary-row"><span class="label">Allow From</span><span class="value">${formData.telegramAllowFrom || '(none)'}</span></div>` : ''}
      <div class="summary-row"><span class="label">WhatsApp</span><span class="value">${formData.whatsappEnabled ? 'Enabled' : 'Disabled'}</span></div>
    </div>

    <div class="summary-section">
      <h3>Gateway</h3>
      <div class="summary-row"><span class="label">Port</span><span class="value">${formData.gatewayPort}</span></div>
      <div class="summary-row"><span class="label">Workspace</span><span class="value">${formData.workspace}</span></div>
      <div class="summary-row"><span class="label">Token</span><span class="value">${formData.gatewayToken ? maskKey(formData.gatewayToken) : '(auto-generate)'}</span></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="prev()">Back</button>
      <button class="btn btn-primary" id="installBtn" onclick="doInstall()">Install OpenClaw</button>
    </div>
  `;
}

async function doInstall() {
  const btn = document.getElementById('installBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Installing...';

  try {
    const res = await fetch('/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    if (data.success) {
      renderSuccess();
    } else {
      btn.disabled = false;
      btn.textContent = 'Install OpenClaw';
      alert('Installation failed: ' + (data.error || 'Unknown error'));
    }
  } catch {
    renderSuccess();
  }
}

function renderSuccess() {
  const indicator = document.getElementById('stepIndicator');
  const bar = document.getElementById('progressBar');
  indicator.textContent = '';
  bar.innerHTML = '';

  const card = document.getElementById('wizardCard');
  card.innerHTML = `
    <div class="success-screen">
      <div class="success-icon">&#x2705;</div>
      <h2>Installation Complete!</h2>
      <p>
        OpenClaw has been configured and is starting up.<br>
        The container will restart with the OpenClaw gateway.
      </p>
      <p style="margin-top:16px;color:#7c3aed;font-weight:600;">
        Refreshing in <span id="countdown">5</span> seconds...
      </p>
    </div>
  `;

  let count = 5;
  const timer = setInterval(() => {
    count--;
    const el = document.getElementById('countdown');
    if (el) el.textContent = count;
    if (count <= 0) {
      clearInterval(timer);
      window.location.reload();
    }
  }, 1000);
}

// Init
goTo(0);
