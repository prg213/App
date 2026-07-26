import { Router } from "express";

const router: Router = Router();

const adminHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StreamVault Admin Panel</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0A0A0F;
      --surface: #13131E;
      --surface2: #1A1A28;
      --border: #252538;
      --primary: #3B82F6;
      --primary-hover: #2563EB;
      --text: #F2F2F2;
      --muted: #6B7280;
      --danger: #EF4444;
      --success: #22C55E;
      --radius: 10px;
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      min-height: 100vh;
    }
    .header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      display: flex;
      align-items: center;
      height: 64px;
      gap: 12px;
    }
    .logo { font-size: 20px; font-weight: 700; color: var(--primary); }
    .logo span { color: var(--text); }
    .badge {
      background: var(--primary);
      color: white;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 99px;
    }
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      margin-bottom: 6px;
    }
    input, select {
      width: 100%;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      padding: 10px 12px;
      font-size: 14px;
      margin-bottom: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus { border-color: var(--primary); }
    input::placeholder { color: var(--muted); }
    select option { background: var(--surface2); }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: var(--primary); color: white; width: 100%; justify-content: center; }
    .btn-danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); padding: 5px 12px; font-size: 12px; }
    .type-fields { transition: opacity 0.2s; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th {
      text-align: left;
      padding: 10px 12px;
      color: var(--muted);
      font-weight: 500;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    td { padding: 12px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .mac {
      font-family: 'Courier New', monospace;
      background: var(--surface2);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
    }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 600;
    }
    .pill-xtream { background: rgba(59,130,246,0.2); color: #60A5FA; }
    .pill-m3u { background: rgba(34,197,94,0.2); color: #4ADE80; }
    .empty { text-align: center; padding: 40px; color: var(--muted); }
    .toast {
      position: fixed; bottom: 24px; right: 24px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 20px;
      font-size: 14px;
      display: none;
      animation: slide-up 0.3s ease;
      z-index: 99;
    }
    .toast.show { display: block; }
    .toast.success { border-color: var(--success); color: var(--success); }
    .toast.error { border-color: var(--danger); color: var(--danger); }
    @keyframes slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .count { color: var(--muted); font-size: 13px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Stream<span>Vault</span></div>
    <span class="badge">Admin</span>
  </div>

  <div class="container">
    <div class="grid">
      <!-- Add Device Form -->
      <div class="card">
        <h2>Activate Device</h2>
        <form id="deviceForm">
          <label>Device MAC Address *</label>
          <input id="macInput" type="text" placeholder="AA:BB:CC:DD:EE:FF" required
            pattern="([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}" maxlength="17" />

          <label>Device Name (optional)</label>
          <input id="nameInput" type="text" placeholder="Living Room TV" />

          <label>Connection Type *</label>
          <select id="typeSelect" required>
            <option value="xtream">Xtream Codes</option>
            <option value="m3u">M3U URL</option>
          </select>

          <div id="xtreamFields" class="type-fields">
            <label>Host / Panel URL *</label>
            <input id="hostInput" type="text" placeholder="http://your-provider.com:8080" />
            <label>Username *</label>
            <input id="usernameInput" type="text" placeholder="username" />
            <label>Password *</label>
            <input id="passwordInput" type="password" placeholder="password" />
          </div>

          <div id="m3uFields" class="type-fields" style="display:none">
            <label>M3U Playlist URL *</label>
            <input id="m3uInput" type="text" placeholder="http://your-provider.com/get.php?..." />
          </div>

          <button type="submit" class="btn btn-primary">Activate Device</button>
        </form>
      </div>

      <!-- Devices Table -->
      <div class="card">
        <div class="section-header">
          <h2>Registered Devices</h2>
          <span class="count" id="deviceCount"></span>
        </div>
        <div class="table-wrap">
          <table id="devicesTable">
            <thead>
              <tr>
                <th>MAC</th>
                <th>Name</th>
                <th>Type</th>
                <th>Host</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="devicesBody">
              <tr><td colspan="5" class="empty">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const BASE = '/api';

    const typeSelect = document.getElementById('typeSelect');
    const xtreamFields = document.getElementById('xtreamFields');
    const m3uFields = document.getElementById('m3uFields');

    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'xtream') {
        xtreamFields.style.display = '';
        m3uFields.style.display = 'none';
      } else {
        xtreamFields.style.display = 'none';
        m3uFields.style.display = '';
      }
    });

    function showToast(msg, type = 'success') {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'toast show ' + type;
      setTimeout(() => { t.className = 'toast'; }, 3000);
    }

    async function loadDevices() {
      const res = await fetch(BASE + '/devices');
      const devices = await res.json();
      const tbody = document.getElementById('devicesBody');
      document.getElementById('deviceCount').textContent = devices.length + ' device' + (devices.length !== 1 ? 's' : '');

      if (!devices.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty">No devices yet. Activate a device above.</td></tr>';
        return;
      }

      tbody.innerHTML = devices.map(d => \`
        <tr>
          <td><span class="mac">\${d.mac_address}</span></td>
          <td>\${d.name || '<span style="color:var(--muted)">—</span>'}</td>
          <td><span class="pill pill-\${d.type}">\${d.type || '?'}</span></td>
          <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${d.host || d.m3u_url || '—'}</td>
          <td><button class="btn btn-danger" onclick="deleteDevice(\${d.id})">Delete</button></td>
        </tr>
      \`).join('');
    }

    async function deleteDevice(id) {
      if (!confirm('Remove this device? It will need to be re-activated.')) return;
      await fetch(BASE + '/devices/' + id, { method: 'DELETE' });
      showToast('Device removed', 'success');
      loadDevices();
    }

    document.getElementById('deviceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const type = typeSelect.value;
      const body = {
        mac_address: document.getElementById('macInput').value.toUpperCase(),
        name: document.getElementById('nameInput').value || undefined,
        type,
        ...(type === 'xtream' ? {
          host: document.getElementById('hostInput').value,
          username: document.getElementById('usernameInput').value,
          password: document.getElementById('passwordInput').value,
        } : {
          m3u_url: document.getElementById('m3uInput').value,
        }),
      };

      const res = await fetch(BASE + '/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        showToast('Device activated successfully! ✓', 'success');
        document.getElementById('deviceForm').reset();
        xtreamFields.style.display = '';
        m3uFields.style.display = 'none';
        loadDevices();
      } else {
        const err = await res.json();
        showToast('Error: ' + err.error, 'error');
      }
    });

    // Format MAC input
    document.getElementById('macInput').addEventListener('input', function() {
      let val = this.value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
      val = val.match(/.{1,2}/g)?.join(':') || val;
      this.value = val.slice(0, 17);
    });

    loadDevices();
  </script>
</body>
</html>`;

router.get("/admin", (_req, res): void => {
  res.setHeader("Content-Type", "text/html");
  res.send(adminHtml);
});

export default router;
