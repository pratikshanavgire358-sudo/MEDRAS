(() => {
  "use strict";
  const api = window.MedraAPI;
  const $ = (id) => document.getElementById(id);
  const devices = new Map();
  const messages = [];
  let ws;
  let retryTimer;
  let count = 0;
  const token = api?.getToken();
  const user = api?.getCurrentUser();
  if (!token || !user) {
    $('message').className = 'alert alert-warning';
    $('message').textContent = 'Please log in through MEDRA first.';
    setTimeout(() => { window.location.href = '../auth/login.html'; }, 1200);
    return;
  }
  if (!['admin', 'hospital', 'ambulance'].includes(user.role)) {
    $('message').className = 'alert alert-danger';
    $('message').textContent = 'This account role cannot access IoT telemetry.';
    return;
  }
  $('logout').addEventListener('click', () => window.logoutMedra ? window.logoutMedra() : api.clearAuthSession());
  $('refresh').addEventListener('click', loadLatest);
  function fmtTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
  }
  function addMessage(item) {
    if (!item || !item.device_id) return;
    count++;
    devices.set(item.device_id, item);
    messages.unshift(item);
    if (messages.length > 100) messages.length = 100;
    $('deviceCount').textContent = devices.size;
    $('messageCount').textContent = count;
    $('latestTransport').textContent = item.transport || '—';
    $('lastUpdate').textContent = fmtTime(item.received_at);
    renderDevices(); renderMessages();
  }
  function renderDevices() {
    const rows = [...devices.values()].sort((a,b) => String(a.device_id).localeCompare(String(b.device_id)));
    $('devices').innerHTML = rows.length ? rows.map(item => {
      const p = item.payload || {};
      const connected = p.wifi_connected !== false && p.mqtt_connected !== false;
      return `<div class="device"><div class="d-flex justify-content-between gap-2"><strong>${esc(item.device_id)}</strong><span class="pill ${connected?'online':'offline'}">${connected?'Reporting':'Check connection'}</span></div><div class="small muted mt-1">${esc(item.topic || '')} · ${esc(item.transport || '')}</div><div class="small muted">Last seen: ${esc(fmtTime(item.received_at))}</div></div>`;
    }).join('') : '<p class="muted">Waiting for device telemetry…</p>';
  }
  function renderMessages() {
    $('stream').innerHTML = messages.length ? messages.map(item => `<article class="border rounded-3 p-3 mb-2"><div class="d-flex flex-wrap justify-content-between gap-2"><strong>${esc(item.device_id)}</strong><span class="small muted">${esc(fmtTime(item.received_at))}</span></div><div class="small text-primary mt-1">${esc(item.transport || '')} · ${esc(item.topic || '')}</div><pre class="payload mt-2 mb-0">${esc(JSON.stringify(item.payload || {}, null, 2))}</pre></article>`).join('') : '<p class="muted">No messages received yet. Check that the MQTT broker and ESP32 are running.</p>';
  }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  async function loadLatest() {
    try {
      const result = await api.get('/api/iot/telemetry/latest?limit=100');
      const rows = (result.items || []).slice().reverse();
      rows.forEach(item => { if (!messages.some(m => m.id && m.id === item.id)) addMessage(item); });
      $('message').className = 'alert alert-success';
      $('message').textContent = 'Connected to MEDRA API. Live updates will appear when ESP32 or MQTT messages arrive.';
    } catch (error) {
      $('message').className = 'alert alert-danger';
      $('message').textContent = `Could not load telemetry: ${error.message}. Confirm backend is running and this account has permission.`;
    }
  }
  function connectWS() {
    clearTimeout(retryTimer);
    const base = new URL(api.baseUrl);
    const scheme = base.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${scheme}//${base.host}/ws/iot?token=${encodeURIComponent(token)}`);
    ws.onopen = () => { $('wsState').className='pill online'; $('wsState').textContent='WebSocket connected'; };
    ws.onmessage = event => { try { const data = JSON.parse(event.data); if (data.type === 'telemetry') addMessage(data); } catch (_) {} };
    ws.onclose = () => { $('wsState').className='pill offline'; $('wsState').textContent='WebSocket reconnecting'; retryTimer = setTimeout(connectWS, 3000); };
    ws.onerror = () => ws.close();
  }
  loadLatest(); connectWS();
})();
