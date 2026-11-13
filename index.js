const mineflayer = require('mineflayer');
const express = require('express');
const { SocksClient } = require('socks');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ÉP MÚI GIỜ VIỆT NAM TOÀN HỆ THỐNG
process.env.TZ = 'Asia/Ho_Chi_Minh';

let BOT_USERNAME = process.env.BOT_USERNAME || 'Kiru Đẹp Trai';
let BOT_PASSWORD = process.env.BOT_PASSWORD || 'YourPasswordHere';
let BOT_HOST = process.env.BOT_HOST || 'mc.example.com';
let BOT_PORT = parseInt(process.env.BOT_PORT) || 25565;
let BOT_PROXY = process.env.BOT_PROXY || ''; // Định dạng: host:port hoặc user:pass@host:port (SOCKS5)

// --- BẬT/TẮT CÁC TÍNH NĂNG TOGGLE ---
const toggles = {
  afkmode: false,
  thien: false,
  quylay: false,
  dinhthan: false,
  quanghao: false,
  ngoi: false,     // Nút ngồi (Sneak)
  attackLeft: false,
  attackRight: false,
  skill1: false,
  skill2: false,
  skill3: false
};

// Cấu hình tốc độ click chuột (tối thiểu 0.1s = 100ms)
let attackLeftIntervalMs = 500;
let attackRightIntervalMs = 500;

// CẤU HÌNH Ô CÔNG CỤ (HOTBAR 1 -> 9 tương ứng Index 0 -> 8)
let hotbarEnabled = [false, false, false, false, false, false, false, false, false];
let hotbarHoldDurationSec = 5;
let currentHotbarCycleIndex = 0;

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isManualStopped = false;
let isFirstSpawn = true;

let currentReconnectDelay = 10000;
let consecutiveFailures = 0; 

// TIMERS & INTERVALS
let actionTimeout = null;
let antiAfkTimeout = null;
let ramGcInterval = null;
let posCheckInterval = null;
let watchdogInterval = null;
let pingInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let respawnTimer = null;
let commandResponseTimer = null;

let quylayInterval = null;
let ngoiInterval = null;
let attackLeftInterval = null;
let attackRightInterval = null;
let skillLoopInterval = null;
let hotbarLoopInterval = null;

let isAwaitingResponse = false;
let isAutoActionRunning = false;
let lastActionTime = Date.now();
let currentCoords = 'Đang xác định...';
let currentPing = 0;

const startTime = Date.now();
const serverChatLogs = [];
const errorLogs = [];    
const pingLogs = [];     
const botMentionLogs = [];

let lastTimeAge = 0;
let lastTimeAgeUpdate = Date.now();

function getVNTime() {
  return new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function addChatLog(msg) {
  serverChatLogs.unshift(`[${getVNTime()}] ${msg}`);
  if (serverChatLogs.length > 30) serverChatLogs.pop();
}

function addErrorLog(type, details) {
  errorLogs.unshift({ time: getVNTime(), type: type, details: details });
  if (errorLogs.length > 30) errorLogs.pop();
}

function addPingLog(pingVal) {
  pingLogs.unshift({ time: getVNTime(), ping: pingVal });
  if (pingLogs.length > 15) pingLogs.pop();
}

function addBotMentionLog(msg) {
  botMentionLogs.unshift({ time: getVNTime(), text: msg });
  if (botMentionLogs.length > 20) botMentionLogs.pop();
}

function triggerChatWindow(durationMs = 8000) {
  isAwaitingResponse = true;
  if (commandResponseTimer) clearTimeout(commandResponseTimer);
  commandResponseTimer = setTimeout(() => { isAwaitingResponse = false; }, durationMs);
}

function getHeldItemName() {
  if (!bot || !bot.heldItem) return 'Tay không';
  const item = bot.heldItem;
  return item.customName || item.displayName || item.name || 'Vật phẩm không tên';
}

function safeChat(msg) {
  if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
    try {
      bot.chat(msg);
      addChatLog(`[TỰ ĐỘNG]: ${msg}`);
    } catch (e) {
      addErrorLog('Lỗi Chat', e.message);
    }
  }
}

app.get('/api/ping', (req, res) => res.send('PONG_OK'));

// ENDPOINT CẬP NHẬT CẤU HÌNH (USERNAME, PASSWORD, HOST, PROXY)
app.post('/api/update-config', (req, res) => {
  try {
    const { username, password, host, proxy } = req.body;
    
    if (username !== undefined && username.trim() !== '') BOT_USERNAME = username.trim();
    if (password !== undefined && password.trim() !== '') BOT_PASSWORD = password.trim();
    if (proxy !== undefined) BOT_PROXY = proxy.trim();
    
    if (host !== undefined && host.trim() !== '') {
      let cleanHost = host.trim();
      if (cleanHost.includes(':')) {
        const parts = cleanHost.split(':');
        BOT_HOST = parts[0];
        BOT_PORT = parseInt(parts[1]) || 25565;
      } else {
        BOT_HOST = cleanHost;
        BOT_PORT = 25565;
      }
    }

    addErrorLog('CẤU HÌNH', `Đã lưu cấu hình Bot [${BOT_USERNAME}]. Đang tái kết nối...`);
    consecutiveFailures = 0;
    isManualStopped = false;
    createBot();
  } catch (err) {
    addErrorLog('Lỗi Lưu Cấu Hình', err.message);
  }
  res.redirect('/');
});

app.post('/api/command', (req, res) => {
  if (isManualStopped) return res.send('Bot đang ở trạng thái TẮT thủ công!');
  const cmd = req.body.command;
  if (!bot || !bot._client) return res.send('Bot đang ngoại tuyến!');
  if (cmd) {
    bot.chat(cmd);
    addChatLog(`[WEB-ADMIN]: ${cmd}`);
    triggerChatWindow(8000);
  }
  res.redirect('/');
});

app.get('/api/toggle/:feature', (req, res) => {
  const feat = req.params.feature;
  if (toggles.hasOwnProperty(feat)) {
    toggles[feat] = !toggles[feat];
    addChatLog(`[CÀI ĐẶT] ${feat.toUpperCase()} ➔ ${toggles[feat] ? 'BẬT' : 'TẮT'}`);

    if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
      if (feat === 'afkmode') safeChat(toggles[feat] ? '/afkmode vao' : '/afkmode ra');
      if (feat === 'thien') safeChat('/thien');
      if (feat === 'quylay') safeChat('/quylay');
      if (feat === 'dinhthan') safeChat('/dinhthan');
      if (feat === 'quanghao') safeChat('/quanghao');
      if (feat === 'skill1') safeChat('/kinang_1');
      if (feat === 'skill2') safeChat('/kinang_2');
      if (feat === 'skill3') safeChat('/kinang_3');

      restartLoops();
    }
  }
  res.redirect('/');
});

app.post('/api/update-hotbar', (req, res) => {
  const duration = parseInt(req.body.duration);
  if (!isNaN(duration) && duration >= 1) hotbarHoldDurationSec = duration;

  for (let i = 0; i < 9; i++) {
    hotbarEnabled[i] = req.body[`slot_${i}`] === 'on';
  }

  addChatLog(`[HOTBAR] Cập nhật danh sách ô cầm vật phẩm (${hotbarHoldDurationSec}s)`);
  restartLoops();
  res.redirect('/');
});

app.post('/api/update-click-speed', (req, res) => {
  const leftSpeed = parseFloat(req.body.leftSpeed);
  const rightSpeed = parseFloat(req.body.rightSpeed);

  if (!isNaN(leftSpeed) && leftSpeed >= 0.1) attackLeftIntervalMs = Math.round(leftSpeed * 1000);
  if (!isNaN(rightSpeed) && rightSpeed >= 0.1) attackRightIntervalMs = Math.round(rightSpeed * 1000);

  restartLoops();
  res.redirect('/');
});

app.get('/api/inventory', (req, res) => {
  if (bot && bot._client && !isManualStopped) {
    bot.chat('[inv]');
    addChatLog('[WEB-ADMIN]: [inv]');
    triggerChatWindow(4000);
  }
  res.redirect('/');
});

app.get('/api/tusat', (req, res) => {
  if (bot && bot._client && !isManualStopped) {
    safeChat('/tusat');
    triggerChatWindow(4000);
  }
  res.redirect('/');
});

app.get('/api/toggle-bot', (req, res) => {
  isManualStopped = !isManualStopped;
  if (isManualStopped) {
    addErrorLog('THỦ CÔNG', 'Đã TẮT Bot từ Dashboard. Ngắt kết nối.');
    cleanupBot();
  } else {
    addErrorLog('THỦ CÔNG', 'Đã BẬT lại Bot từ Dashboard. Đang kết nối lại...');
    consecutiveFailures = 0;
    createBot();
  }
  res.redirect('/');
});

app.get('/api/clear-error-log', (req, res) => { errorLogs.length = 0; res.redirect('/'); });
app.get('/api/clear-mention-log', (req, res) => { botMentionLogs.length = 0; res.redirect('/'); });
app.get('/api/hard-restart', (req, res) => { process.exit(1); });

app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = getHeldItemName();

  let statusBadge = '<span class="badge-off">OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">ĐÃ TẮT THỦ CÔNG</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">ONLINE</span>';
  } else {
    statusBadge = `<span class="badge-off">RECONNECTING (${Math.round(currentReconnectDelay / 1000)}s)</span>`;
  }

  const renderToggleBtn = (key, label) => {
    const isON = toggles[key];
    return `<a href="/api/toggle/${key}" style="text-decoration: none;"><button type="button" class="${isON ? 'btn-start' : 'btn-stop'}" style="width: 100%;">${label}: ${isON ? 'BẬT' : 'TẮT'}</button></a>`;
  };

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>Kiru Đẹp Trai - Control Panel</title>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --card-bg: rgba(10, 14, 26, 0.82);
          --accent-cyan: #38bdf8;
          --accent-pink: #f43f5e;
          --accent-purple: #c084fc;
          --accent-green: #4ade80;
          --accent-yellow: #fbbf24;
          --border: rgba(56, 189, 248, 0.35);
          --glow: 0 0 15px rgba(56, 189, 248, 0.25);
        }
        * { box-sizing: border-box; }
        body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          margin: 0;
          padding: 16px;
          color: #f8fafc;
          min-height: 100vh;
          background: radial-gradient(circle at 50% 10%, #0f172a 0%, #020617 100%);
          background-attachment: fixed;
        }
        .toggle-ui-btn {
          position: fixed; bottom: 20px; right: 20px; z-index: 9999;
          padding: 12px 20px; background: linear-gradient(135deg, #0ea5e9, #38bdf8);
          color: #fff; font-weight: 800; border: 2px solid #38bdf8; border-radius: 30px;
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.6); cursor: pointer; font-size: 0.95rem;
          display: flex; align-items: center; gap: 8px; transition: transform 0.2s;
        }
        .toggle-ui-btn:hover { transform: scale(1.05); }
        .header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 2px solid var(--border); margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
        h1 {
          font-family: 'Orbitron', sans-serif; font-size: 1.8rem; margin: 0;
          background: linear-gradient(90deg, #38bdf8, #f43f5e, #c084fc);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          text-shadow: 0 0 15px rgba(244, 63, 94, 0.5);
        }
        .container { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
        .card { background: var(--card-bg); backdrop-filter: blur(14px); padding: 16px; border-radius: 16px; border: 1px solid var(--border); box-shadow: var(--glow); margin-bottom: 16px; }
        h3 { margin-top: 0; color: var(--accent-cyan); font-size: 1.05rem; display: flex; align-items: center; gap: 8px; }
        .badge-on { background: rgba(74, 222, 128, 0.25); color: #4ade80; border: 1px solid #22c55e; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; }
        .badge-off { background: rgba(244, 63, 94, 0.25); color: #f43f5e; border: 1px solid #f43f5e; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; }
        .badge-pause { background: rgba(251, 191, 36, 0.25); color: #fbbf24; border: 1px solid #f59e0b; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; }
        .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 12px 0; }
        .status-item { background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.12); padding: 8px 10px; border-radius: 10px; display: flex; flex-direction: column; gap: 2px; }
        .status-item .label { font-size: 0.68rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; }
        .status-item .value { font-size: 0.85rem; font-weight: 700; color: #f8fafc; word-break: break-all; }
        .chat-box { background: rgba(0, 0, 0, 0.7); padding: 10px; border-radius: 10px; font-family: monospace; height: 260px; overflow-y: auto; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 0.8rem; }
        .error-box { background: rgba(20, 5, 5, 0.75); padding: 10px; border-radius: 10px; font-family: monospace; height: 180px; overflow-y: auto; color: #f87171; border: 1px solid rgba(244, 63, 94, 0.4); font-size: 0.8rem; }
        .kiru-box { background: rgba(15, 23, 15, 0.75); padding: 10px; border-radius: 10px; font-family: monospace; height: 150px; overflow-y: auto; color: #facc15; border: 1px solid rgba(250, 204, 21, 0.4); font-size: 0.8rem; }
        .input-group { display: flex; gap: 8px; margin-top: 8px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        input[type="text"], input[type="password"], input[type="number"] {
          width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(0, 0, 0, 0.6); color: white; outline: none; font-size: 0.85rem;
        }
        input:focus { border-color: var(--accent-pink); box-shadow: 0 0 10px rgba(244, 63, 94, 0.5); }
        button { padding: 9px 15px; background: linear-gradient(135deg, #e11d48, #be123c); color: white; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.2s ease; white-space: nowrap; font-size: 0.85rem; }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(225, 29, 72, 0.5); }
        .btn-stop { background: linear-gradient(135deg, #dc2626, #991b1b) !important; }
        .btn-start { background: linear-gradient(135deg, #16a34a, #15803d) !important; }
        .btn-warning { background: linear-gradient(135deg, #d97706, #b45309) !important; }
        .btn-purple { background: linear-gradient(135deg, #9333ea, #6b21a8) !important; }
        .btn-save { background: linear-gradient(135deg, #0284c7, #0369a1) !important; width: 100%; margin-top: 8px; }
        label { font-size: 0.78rem; color: #cbd5e1; display: block; margin-bottom: 4px; font-weight: 600; }
        .btn-group-responsive { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin-top: 10px; }
        .hotbar-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 6px; margin-top: 10px; }
        .hotbar-item { background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); padding: 8px 4px; border-radius: 8px; text-align: center; }
        .hotbar-item input[type="checkbox"] { width: 16px; height: 16px; cursor: pointer; }
        @media (max-width: 1024px) { .container { grid-template-columns: 1fr; } .hotbar-grid { grid-template-columns: repeat(5, 1fr); } }
      </style>
      <script>
        function toggleDashboardView() {
          const container = document.getElementById('main-dashboard');
          const toggleBtn = document.getElementById('toggle-ui-text');
          if (container.style.display === 'none') {
            container.style.display = 'grid';
            toggleBtn.textContent = 'Thu Gọn Bảng Control';
            localStorage.setItem('ui_collapsed', 'false');
          } else {
            container.style.display = 'none';
            toggleBtn.textContent = 'Hiện Bảng Control';
            localStorage.setItem('ui_collapsed', 'true');
          }
        }
        window.addEventListener('DOMContentLoaded', () => {
          if (localStorage.getItem('ui_collapsed') === 'true') {
            document.getElementById('main-dashboard').style.display = 'none';
            document.getElementById('toggle-ui-text').textContent = 'Hiện Bảng Control';
          }
          setInterval(() => {
            const activeEl = document.activeElement;
            if (!activeEl || (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) {
              location.reload();
            }
          }, 12000);
        });
      </script>
    </head>
    <body>
      <button type="button" class="toggle-ui-btn" onclick="toggleDashboardView()">
        ⚙️ <span id="toggle-ui-text">Thu Gọn Bảng Control</span>
      </button>
      <div class="header">
        <h1>KIRU ĐẸP TRAI</h1>
        <div>${statusBadge}</div>
      </div>
      <div class="container" id="main-dashboard">
        <div>
          <div class="card">
            <h3>Trạng Thái Bot: <span style="color: var(--accent-pink);">${BOT_USERNAME}</span></h3>
            <div class="status-grid">
              <div class="status-item"><span class="label">Server</span><span class="value"><code>${BOT_HOST}:${BOT_PORT}</code></span></div>
              <div class="status-item"><span class="label">Proxy IP</span><span class="value" style="color:var(--accent-yellow);"><code>${BOT_PROXY ? BOT_PROXY : 'Trực tiếp (Render IP)'}</code></span></div>
              <div class="status-item"><span class="label">Ping</span><span class="value" style="color: var(--accent-cyan);">${currentPing} ms</span></div>
              <div class="status-item"><span class="label">Tọa Độ</span><span class="value"><code>${currentCoords}</code></span></div>
              <div class="status-item"><span class="label">Vật Phẩm Trên Tay</span><span class="value" style="color: var(--accent-yellow);"><code>${currentWeapon}</code></span></div>
              <div class="status-item"><span class="label">Hoạt Động</span><span class="value">${uptimeMinutes} phút</span></div>
              <div class="status-item"><span class="label">RAM</span><span class="value">${memoryUsage} MB</span></div>
            </div>
            <form class="input-group" action="/api/command" method="POST">
              <input type="text" name="command" placeholder="Gửi lệnh hoặc chat vào server..." autocomplete="off" required>
              <button type="submit">Gửi Chat</button>
            </form>
            <div class="btn-group-responsive">
              ${isManualStopped 
                ? `<a href="/api/toggle-bot" style="text-decoration: none;"><button type="button" class="btn-start" style="width: 100%;">BẬT BOT</button></a>`
                : `<a href="/api/toggle-bot" style="text-decoration: none;"><button type="button" class="btn-stop" style="width: 100%;">TẮT BOT</button></a>`
              }
              <a href="/api/inventory" style="text-decoration: none;"><button type="button" class="btn-purple" style="width: 100%;">Túi Đồ [inv]</button></a>
              <a href="/api/tusat" style="text-decoration: none;"><button type="button" class="btn-stop" style="width: 100%;">Tự Sát (/tusat)</button></a>
              <a href="/api/clear-error-log" style="text-decoration: none;"><button type="button" class="btn-warning" style="width: 100%;">Xóa Lỗi</button></a>
              <a href="/api/clear-mention-log" style="text-decoration: none;"><button type="button" class="btn-warning" style="width: 100%;">Mention (${botMentionLogs.length})</button></a>
              <a href="/api/hard-restart" style="text-decoration: none;" onclick="return confirm('Reset App?');"><button type="button" class="btn-stop" style="width: 100%;">Reset App</button></a>
            </div>
          </div>

          <!-- CẤU HÌNH Ô CÔNG CỤ -->
          <div class="card">
            <h3>Cấu Hình Ô Công Cụ Bot (Ô 1 ➔ Ô 9)</h3>
            <form action="/api/update-hotbar" method="POST">
              <div><label>Thời gian cầm mỗi ô (giây):</label><input type="number" min="1" name="duration" value="${hotbarHoldDurationSec}" required></div>
              <div style="margin-top: 8px;"><label>Chọn ô cần luân chuyển:</label></div>
              <div class="hot
