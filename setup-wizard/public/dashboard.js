/* OpenClaw Dashboard — dashboard.js */
'use strict';

const BASE = window.BASE_PATH || '';
const INSTANCE = BASE.replace(/^\//, '') || 'openclaw';

let gwStatus = null;
let config   = null;
let pollTimer = null;

// ── API helpers ──────────────────────────────────────────────────────────────
async function api(path, opts) {
  const r = await fetch(`${BASE}${path}`, opts);
  return r.json();
}

// ── Render ───────────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  const gw  = gwStatus || {};
  const cfg = config   || {};

  const running = gw.running === true;
  const channels = cfg.channels || {};
  const tg = channels.telegram || {};
  const wa = channels.whatsapp || {};
  const agents = cfg.agents?.defaults || {};
  const primaryModel = agents.model?.primary || '—';
  const fallbacks    = (agents.model?.fallbacks || []);

  const badgeClass = running ? 'running' : gw.running === undefined ? 'loading' : 'stopped';
  const badgeText  = gw.running === undefined ? '⋯ Checking…' : running ? '● Running' : '○ Stopped';

  app.innerHTML = `
    <!-- Header -->
    <div class="dash-header">
      <div>
        <div class="dash-logo">🎩 OpenClaw<span>${INSTANCE}</span></div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div class="status-badge ${badgeClass}">
          <div class="status-dot"></div>
          ${badgeText}
        </div>
        <a href="${BASE}/" class="btn btn-secondary" style="font-size:12px;padding:6px 14px;min-height:32px;text-decoration:none;display:inline-flex;align-items:center">
          ⚙️ Wizard
        </a>
      </div>
    </div>

    ${!running ? `
    <div class="dash-alert">
      ⚠️ OpenClaw gateway is not running. Start it manually:<br>
      <code style="font-size:12px">openclaw gateway start</code>
      &nbsp;&nbsp;
      <button onclick="startGateway()" style="background:#7c3aed;border:none;color:white;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;margin-top:8px">▶ Start Now</button>
    </div>` : ''}

    <!-- Stats grid -->
    <div class="dash-grid">

      <!-- Channels -->
      <div class="dash-card">
        <div class="dash-card-title">📡 Channels</div>
        <div class="channel-row">
          <div class="channel-name"><span class="channel-icon">✈️</span> Telegram</div>
          ${channelBadge(tg.enabled)}
        </div>
        <div class="channel-row">
          <div class="channel-name"><span class="channel-icon">💬</span> WhatsApp</div>
          ${channelBadge(wa.enabled)}
        </div>
      </div>

      <!-- Model -->
      <div class="dash-card">
        <div class="dash-card-title">🤖 AI Model</div>
        <div class="stat-row">
          <span class="stat-label">Primary</span>
          <span class="stat-value">${shortModel(primaryModel)}</span>
        </div>
        ${fallbacks.length ? `
        <div class="stat-row">
          <span class="stat-label">Fallbacks</span>
          <span class="stat-value">${fallbacks.map(shortModel).join(', ')}</span>
        </div>` : ''}
        <div class="stat-row">
          <span class="stat-label">Context</span>
          <span class="stat-value">${(agents.contextTokens||80000).toLocaleString()} tokens</span>
        </div>
      </div>

      <!-- Gateway -->
      <div class="dash-card">
        <div class="dash-card-title">🔌 Gateway</div>
        <div class="stat-row">
          <span class="stat-label">Port</span>
          <span class="stat-value">${gw.port || cfg.gateway?.port || 18789}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Mode</span>
          <span class="stat-value">${cfg.gateway?.mode || 'local'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Uptime</span>
          <span class="stat-value">${gw.uptime || '—'}</span>
        </div>
      </div>

      <!-- Actions — full width -->
      <div class="dash-card full">
        <div class="dash-card-title">⚡ Quick Actions</div>
        <div class="action-grid">
          <button class="action-btn" onclick="restartGateway()">
            <span class="action-icon">🔄</span>Restart Gateway
          </button>
          <button class="action-btn" onclick="location.href='${BASE}/'">
            <span class="action-icon">⚙️</span>Reconfigure
          </button>
          <button class="action-btn" onclick="refreshStatus()">
            <span class="action-icon">📊</span>Refresh Status
          </button>
          <button class="action-btn danger" onclick="confirmStop()">
            <span class="action-icon">⏹</span>Stop Gateway
          </button>
        </div>
      </div>

      <!-- Log viewer — full width -->
      <div class="dash-card full" id="logCard">
        <div class="dash-card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>📋 Live Log</span>
          <button onclick="fetchLog()" style="font-size:11px;background:none;border:1px solid #2a2a3e;color:#6b7280;padding:2px 10px;border-radius:6px;cursor:pointer">Refresh</button>
        </div>
        <div class="log-box" id="logBox">Loading…</div>
      </div>

    </div>

    <p style="text-align:center;font-size:11px;color:#374151;padding-bottom:16px">
      OpenClaw · <a href="https://github.com/abrathebot/openclaw-helm" target="_blank" style="color:#4c1d95;text-decoration:none">openclaw-helm</a>
    </p>
  `;

  fetchLog();
}

function channelBadge(enabled) {
  if (enabled) return `<span class="status-badge running"><span class="status-dot"></span>Enabled</span>`;
  return `<span class="status-badge stopped"><span class="status-dot"></span>Disabled</span>`;
}

function shortModel(m) {
  if (!m) return '—';
  return m.split('/').pop().replace(/-\d{8}$/, '');
}

function renderLoading() {
  document.getElementById('app').innerHTML = `
    <div class="loading-screen">
      <div class="spinner" style="width:32px;height:32px;border-width:3px"></div>
      <div>Loading dashboard…</div>
    </div>
  `;
}

// ── Data Fetching ────────────────────────────────────────────────────────────
async function refreshStatus() {
  try {
    const [gw, cfg] = await Promise.all([
      api('/api/gateway-status'),
      api('/api/config')
    ]);
    gwStatus = gw;
    config   = cfg;
    render();
  } catch (e) {
    console.error(e);
  }
}

async function fetchLog() {
  const box = document.getElementById('logBox');
  if (!box) return;
  try {
    const data = await api('/api/gateway-log');
    box.innerHTML = (data.lines || ['(no logs yet)']).map(l => {
      const cls = l.includes('ERR') || l.includes('error') ? 'log-error'
                : l.includes('WARN') || l.includes('warn')  ? 'log-warn'
                : 'log-info';
      return `<span class="${cls}">${escHtml(l)}</span>`;
    }).join('\n');
    box.scrollTop = box.scrollHeight;
  } catch {
    if (box) box.textContent = '(logs unavailable)';
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function startGateway() {
  await api('/api/gateway-action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'start'}) });
  setTimeout(refreshStatus, 2000);
}

async function restartGateway() {
  await api('/api/gateway-action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'restart'}) });
  setTimeout(refreshStatus, 3000);
}

async function confirmStop() {
  if (confirm('Stop the OpenClaw gateway?')) {
    await api('/api/gateway-action', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({action:'stop'}) });
    setTimeout(refreshStatus, 2000);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
renderLoading();
refreshStatus();
pollTimer = setInterval(refreshStatus, 15000); // auto-refresh every 15s
