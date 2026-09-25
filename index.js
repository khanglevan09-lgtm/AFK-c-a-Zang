const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ÉP MÚI GIỜ VIỆT NAM TOÀN HỆ THỐNG
process.env.TZ = 'Asia/Ho_Chi_Minh';

// --- CẤU HÌNH DỘNG ---
let BOT_USERNAME = process.env.BOT_USERNAME || 'Kiru Đẹp Trai';
let BOT_PASSWORD = process.env.BOT_PASSWORD || 'YourPasswordHere';
let BOT_HOST = process.env.BOT_HOST || 'mc.example.com';
let BOT_PORT = parseInt(process.env.BOT_PORT) || 25565;

// --- BẬT/TẮT CÁC TÍNH NĂNG TOGGLE ---
const toggles = {
  afkmode: false,
  thien: false,
  quylai: false,
  dinhthan: false,
  quanghao: false,
  attackLeft: false,
  attackRight: false,
  skill1: false,
  skill2: false,
  skill3: false
};

// Cấu hình tốc độ click chuột (tối thiểu 0.1s = 100ms)
let attackLeftIntervalMs = 500;
let attackRightIntervalMs = 500;

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isManualStopped = false; // BẬT/TẮT BOT THỦ CÔNG
let isFirstSpawn = true;

let currentReconnectDelay = 12000;
let consecutiveFailures = 0; 

// QUẢN LÝ TIMERS & INTERVALS
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

// TIMERS DÀNH CHO CÁC TÍNH NĂNG ĐỊNH KỲ
let quylaiInterval = null;
let attackLeftInterval = null;
let attackRightInterval = null;
let skillLoopInterval = null;

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
  if (serverChatLogs.length > 50) serverChatLogs.pop();
}

function addErrorLog(type, details) {
  errorLogs.unshift({
    time: getVNTime(),
    type: type,
    details: details
  });
  if (errorLogs.length > 50) errorLogs.pop();
}

function addPingLog(pingVal) {
  pingLogs.unshift({
    time: getVNTime(),
    ping: pingVal
  });
  if (pingLogs.length > 15) pingLogs.pop();
}

function addBotMentionLog(msg) {
  botMentionLogs.unshift({
    time: getVNTime(),
    text: msg
  });
}

function triggerChatWindow(durationMs = 8000) {
  isAwaitingResponse = true;
  if (commandResponseTimer) clearTimeout(commandResponseTimer);
  commandResponseTimer = setTimeout(() => {
    isAwaitingResponse = false;
  }, durationMs);
}

// HÀM GỬI CHAT AN TOÀN CHỐNG KẸT
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

// ENDPOINT CẬP NHẬT CẤU HÌNH TỰ ĐỘNG
app.post('/api/update-config', (req, res) => {
  const { username, password, host } = req.body;
  
  if (username !== undefined) BOT_USERNAME = username.trim();
  if (password !== undefined) BOT_PASSWORD = password.trim();
  
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

  addErrorLog('CẤU HÌNH', `Đã cập nhật cấu hình Bot [${BOT_USERNAME}]. Đang kết nối lại...`);
  
  consecutiveFailures = 0;
  isManualStopped = false;
  createBot();
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

// ENDPOINT XỬ LÝ BẬT/TẮT TÍNH NĂNG TOGGLE
app.get('/api/toggle/:feature', (req, res) => {
  const feat = req.params.feature;
  if (toggles.hasOwnProperty(feat)) {
    toggles[feat] = !toggles[feat];
    addChatLog(`[CÀI ĐẶT] ${feat.toUpperCase()} ➔ ${toggles[feat] ? 'BẬT' : 'TẮT'}`);

    if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
      if (feat === 'afkmode') safeChat(toggles[feat] ? '/afkmode vao' : '/afkmode ra');
      if (feat === 'thien') safeChat('/thien');
      if (feat === 'quylai') safeChat('/quylai');
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

// ENDPOINT SETTING TỐC ĐỘ CLICK CHUỘT
app.post('/api/update-click-speed', (req, res) => {
  const leftSpeed = parseFloat(req.body.leftSpeed);
  const rightSpeed = parseFloat(req.body.rightSpeed);

  if (!isNaN(leftSpeed) && leftSpeed >= 0.1) {
    attackLeftIntervalMs = Math.round(leftSpeed * 1000);
  }
  if (!isNaN(rightSpeed) && rightSpeed >= 0.1) {
    attackRightIntervalMs = Math.round(rightSpeed * 1000);
  }

  restartLoops();
  res.redirect('/');
});

// ENDPOINT LỆNH NHANH [INV]
app.get('/api/inventory', (req, res) => {
  if (bot && bot._client && !isManualStopped) {
    bot.chat('[inv]');
    addChatLog('[WEB-ADMIN]: [inv]');
    triggerChatWindow(4000);
  }
  res.redirect('/');
});

// ENDPOINT LỆNH NHANH TỰ SÁT [/tusat]
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
    addErrorLog('THỦ CÔNG', 'Đã TẮT Bot từ Dashboard. Ngắt kết nối để tự đăng nhập game.');
    cleanupBot();
  } else {
    addErrorLog('THỦ CÔNG', 'Đã BẬT lại Bot từ Dashboard. Đang kết nối lại Server...');
    consecutiveFailures = 0;
    createBot();
  }
  res.redirect('/');
});

app.get('/api/clear-error-log', (req, res) => {
  errorLogs.length = 0;
  res.redirect('/');
});

app.get('/api/clear-mention-log', (req, res) => {
  botMentionLogs.length = 0;
  res.redirect('/');
});

app.get('/api/hard-restart', (req, res) => {
  addErrorLog('HỆ THỐNG', 'Khởi động lại tiến trình Node.js...');
  process.exit(1); 
});

app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  let statusBadge = '<span class="badge-off">OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">ĐÃ TẮT THỦ CÔNG (NHƯỜNG NICK)</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">ONLINE</span>';
  } else {
    statusBadge = `<span class="badge-off">RECONNECTING (${Math.round(currentReconnectDelay / 1000)}s)</span>`;
  }

  const renderToggleBtn = (key, label) => {
    const isON = toggles[key];
    const btnClass = isON ? 'btn-start' : 'btn-stop';
    const statusText = isON ? 'BẬT' : 'TẮT';
    return `<a href="/api/toggle/${key}" style="text-decoration: none;"><button type="button" class="${btnClass}" style="width: 100%;">${label}: ${statusText}</button></a>`;
  };

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <title>Kiru Đẹp Trai</title>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --card-bg: rgba(10, 14, 26, 0.85);
          --accent-cyan: #38bdf8;
          --accent-pink: #f43f5e;
          --accent-purple: #c084fc;
          --accent-green: #4ade80;
          --accent-yellow: #fbbf24;
          --border: rgba(244, 63, 94, 0.25);
        }
        * { box-sizing: border-box; }
        
        body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          margin: 0;
          padding: 16px;
          color: #f8fafc;
          min-height: 100vh;
          background-color: #05070f;
          background-position: center center;
          background-repeat: no-repeat;
          background-attachment: fixed;
          background-size: cover;
          transition: background-image 0.8s ease-in-out;
          position: relative;
        }

        body::before {
          content: '';
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(4, 6, 14, 0.70);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: -1;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 15px;
          border-bottom: 2px solid var(--border);
          margin-bottom: 20px;
          gap: 12px;
          flex-wrap: wrap;
        }

        h1 {
          font-family: 'Orbitron', sans-serif;
          font-size: 1.8rem;
          margin: 0;
          background: linear-gradient(90deg, #38bdf8, #f43f5e, #c084fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 20px rgba(244, 63, 94, 0.4);
        }

        .container {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 20px;
        }

        .card {
          background: var(--card-bg);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          padding: 18px;
          border-radius: 18px;
          border: 1px solid var(--border);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
          margin-bottom: 20px;
        }

        h3 {
          margin-top: 0;
          color: var(--accent-cyan);
          font-size: 1.1rem;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .badge-on { background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid #22c55e; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; }
        .badge-off { background: rgba(244, 63, 94, 0.2); color: #f43f5e; border: 1px solid #f43f5e; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; }
        .badge-pause { background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid #f59e0b; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; }
        
        .status-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px;
          margin: 15px 0;
        }

        .status-item {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 10px 12px;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .status-item .label {
          font-size: 0.7rem;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 700;
        }

        .status-item .value {
          font-size: 0.9rem;
          font-weight: 600;
          color: #f8fafc;
          word-break: break-all;
        }

        .chat-box { background: rgba(0, 0, 0, 0.6); padding: 12px; border-radius: 12px; font-family: monospace; height: 320px; overflow-y: auto; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); font-size: 0.85rem; }
        .error-box { background: rgba(20, 5, 5, 0.7); padding: 12px; border-radius: 12px; font-family: monospace; height: 220px; overflow-y: auto; color: #f87171; border: 1px solid rgba(244, 63, 94, 0.3); font-size: 0.85rem; }
        .kiru-box { background: rgba(15, 23, 15, 0.7); padding: 12px; border-radius: 12px; font-family: monospace; height: 200px; overflow-y: auto; color: #facc15; border: 1px solid rgba(250, 204, 21, 0.3); font-size: 0.85rem; }
        
        .input-group { display: flex; gap: 10px; margin-top: 10px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

        input[type="text"], input[type="password"], input[type="number"] { 
          width: 100%; 
          padding: 10px 14px; 
          border-radius: 10px; 
          border: 1px solid rgba(255, 255, 255, 0.15); 
          background: rgba(0, 0, 0, 0.5); 
          color: white; 
          outline: none; 
          font-size: 0.9rem; 
        }
        input:focus { border-color: var(--accent-pink); box-shadow: 0 0 10px rgba(244, 63, 94, 0.4); }
        
        button { padding: 10px 18px; background: linear-gradient(135deg, #e11d48, #be123c); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; transition: all 0.25s ease; white-space: nowrap; font-size: 0.9rem; }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(225, 29, 72, 0.5); }
        .btn-stop { background: linear-gradient(135deg, #dc2626, #991b1b) !important; }
        .btn-start { background: linear-gradient(135deg, #16a34a, #15803d) !important; }
        .btn-warning { background: linear-gradient(135deg, #d97706, #b45309) !important; }
        .btn-purple { background: linear-gradient(135deg, #9333ea, #6b21a8) !important; }
        .btn-save { background: linear-gradient(135deg, #0284c7, #0369a1) !important; width: 100%; margin-top: 10px; }
        .btn-eye {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          background: transparent;
          border: none;
          color: var(--accent-cyan);
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: bold;
          padding: 4px 8px;
        }
        .btn-eye:hover { color: #fff; transform: translateY(-50%); box-shadow: none; }
        label { font-size: 0.8rem; color: #94a3b8; display: block; margin-bottom: 4px; }

        .btn-group-responsive {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px;
          margin-top: 15px;
        }

        @media (max-width: 1024px) {
          .container { grid-template-columns: 1fr; }
        }

        @media (max-width: 600px) {
          body { padding: 10px; }
          .header { flex-direction: column; align-items: flex-start; }
          h1 { font-size: 1.5rem; }
          .form-grid { grid-template-columns: 1fr; }
          .input-group { flex-direction: column; }
          .input-group button { width: 100%; }
          .btn-group-responsive { grid-template-columns: 1fr; }
          .card { padding: 14px; }
        }
      </style>
      <script>
        setInterval(() => { 
          const activeEl = document.activeElement;
          if (!activeEl || activeEl.tagName !== 'INPUT') { location.reload(); }
        }, 5000);

        async function rotateAnimeBg() {
          try {
            const res = await fetch('https://api.waifu.pics/sfw/waifu');
            const data = await res.json();
            if (data && data.url) {
              const img = new Image();
              img.src = data.url;
              img.onload = () => {
                document.body.style.backgroundImage = 'url("' + data.url + '")';
              };
            }
          } catch (e) {}
        }
        
        function togglePasswordVisibility() {
          const pwdInput = document.getElementById('pwd-input');
          const eyeText = document.getElementById('eye-text');
          if (pwdInput.type === 'password') {
            pwdInput.type = 'text';
            eyeText.textContent = 'Ẩn';
          } else {
            pwdInput.type = 'password';
            eyeText.textContent = 'Hiện';
          }
        }

        window.addEventListener('DOMContentLoaded', () => {
          rotateAnimeBg();
          setInterval(rotateAnimeBg, 60000);
        });
      </script>
    </head>
    <body>
      <div class="header">
        <h1>KIRU ĐẸP TRAI</h1>
        <div>${statusBadge}</div>
      </div>

      <div class="container">
        <div>
          <!-- THÔNG TIN TRẠNG THÁI BOT -->
          <div class="card">
            <h3>Trạng Thái Bot: <span style="color: var(--accent-pink);">${BOT_USERNAME}</span></h3>
            
            <div class="status-grid">
              <div class="status-item">
                <span class="label">Server</span>
                <span class="value"><code>${BOT_HOST}:${BOT_PORT}</code></span>
              </div>
              <div class="status-item">
                <span class="label">Ping</span>
                <span class="value" style="color: var(--accent-cyan);">${currentPing} ms</span>
              </div>
              <div class="status-item">
                <span class="label">Tọa Độ</span>
                <span class="value"><code>${currentCoords}</code></span>
              </div>
              <div class="status-item">
                <span class="label">Trang Bị</span>
                <span class="value"><code>${currentWeapon}</code></span>
              </div>
              <div class="status-item">
                <span class="label">Hoạt Động</span>
                <span class="value">${uptimeMinutes} phút</span>
              </div>
              <div class="status-item">
                <span class="label">RAM</span>
                <span class="value">${memoryUsage} MB</span>
              </div>
            </div>

            <form class="input-group" action="/api/command" method="POST">
              <input type="text" id="cmd-input" name="command" placeholder="Gửi lệnh hoặc chat vào server..." autocomplete="off" required>
              <button type="submit">Gửi</button>
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
              <a href="/api/hard-restart" style="text-decoration: none;" onclick="return confirm('Reset toàn bộ Tiến Trình Code?');"><button type="button" class="btn-stop" style="width: 100%;">Reset App</button></a>
            </div>
          </div>

          <!-- BẬT / TẮT TÍNH NĂNG AUTO (NÚT GỌN GÀNG) -->
          <div class="card">
            <h3>Bật / Tắt Lệnh Tự Động</h3>
            <div class="btn-group-responsive">
              ${renderToggleBtn('afkmode', 'AFK Mode')}
              ${renderToggleBtn('thien', 'Thiền')}
              ${renderToggleBtn('quylai', 'Quỳ Lạy')}
              ${renderToggleBtn('dinhthan', 'Định Thân')}
              ${renderToggleBtn('quanghao', 'Quang Hào')}
            </div>
          </div>

          <!-- ĐÁNH TRÁI / ĐÁNH PHẢI -->
          <div class="card">
            <h3>Đánh Liên Tục (Click Mouse)</h3>
            <div class="btn-group-responsive" style="margin-bottom: 12px;">
              ${renderToggleBtn('attackLeft', 'Đánh Trái')}
              ${renderToggleBtn('attackRight', 'Đánh Phải')}
            </div>
            <form action="/api/update-click-speed" method="POST" class="form-grid">
              <div>
                <label>Tốc độ Trái (giây, min 0.1s):</label>
                <input type="number" step="0.1" min="0.1" name="leftSpeed" value="${(attackLeftIntervalMs / 1000).toFixed(1)}">
              </div>
              <div>
                <label>Tốc độ Phải (giây, min 0.1s):</label>
                <input type="number" step="0.1" min="0.1" name="rightSpeed" value="${(attackRightIntervalMs / 1000).toFixed(1)}">
              </div>
              <div style="grid-column: 1 / -1;">
                <button type="submit" class="btn-save">Lưu Tốc Độ Click</button>
              </div>
            </form>
          </div>

          <!-- SETTING SKILL -->
          <div class="card">
            <h3>Khu Vực Skill</h3>
            <div class="btn-group-responsive">
              ${renderToggleBtn('skill1', 'Kỹ Năng 1')}
              ${renderToggleBtn('skill2', 'Kỹ Năng 2')}
              ${renderToggleBtn('skill3', 'Kỹ Năng 3')}
            </div>
          </div>

          <!-- FORM DÙNG CHUNG CHO TẤT CẢ CẤU HÌNH -->
          <form action="/api/update-config" method="POST">
            <div class="card">
              <h3>Đăng Nhập</h3>
              <div class="form-grid">
                <div>
                  <label>Tên Nhân Vật:</label>
                  <input type="text" name="username" value="${BOT_USERNAME}" required autocomplete="off">
                </div>
                <div>
                  <label>Mật Khẩu:</label>
                  <div style="position: relative;">
                    <input type="password" id="pwd-input" name="password" value="${BOT_PASSWORD}" required autocomplete="off" style="padding-right: 55px;">
                    <button type="button" class="btn-eye" onclick="togglePasswordVisibility()"><span id="eye-text">Hiện</span></button>
                  </div>
                </div>
              </div>
            </div>

            <div class="card">
              <h3>IP Server</h3>
              <div>
                <label>IP Server:</label>
                <input type="text" name="host" value="${BOT_HOST}${BOT_PORT && BOT_PORT !== 25565 ? ':' + BOT_PORT : ''}" required autocomplete="off" placeholder="vangioinetwork.xyz hoặc ip:port">
              </div>
              <button type="submit" class="btn-save">Lưu Cấu Hình & Tái Kết Nối</button>
            </div>
          </form>

          <div class="card">
            <h3>Nhật Ký Nhắc Tên [${BOT_USERNAME}]</h3>
            <div class="kiru-box">
              ${botMentionLogs.length > 0 
                ? botMentionLogs.map(k => `<div>[${k.time}]${k.text}</div>`).join('') 
                : `<i>Chưa có tin nhắn nào nhắc đến ${BOT_USERNAME}...</i>`}
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <h3>Lịch Sử Ping</h3>
            <p style="word-break: break-all;"><code>${pingLogs.length > 0 ? pingLogs.map(p => `[${p.time}:${p.ping}ms]`).join(' ➔ ') : 'Đang thu thập...'}</code></p>
          </div>

          <!-- CHAT SERVER REALTIME 24/24 -->
          <div class="card">
            <h3>Chat Server (24/24)</h3>
            <div class="chat-box">
              ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
            </div>
          </div>

          <div class="card">
            <h3>Nhật Ký Lỗi Phát Sinh</h3>
            <div class="error-box">
              ${errorLogs.length > 0 ? errorLogs.map(e => `<div>[${e.time}] <b>[${e.type}]</b>:${e.details}</div>`).join('') : '<div style="color:var(--accent-green);">Không có lỗi!</div>'}
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => console.log(`[HTTP SERVER] Running on port ${port}`));

function stopFeatureLoops() {
  if (quylaiInterval) { clearInterval(quylaiInterval); quylaiInterval = null; }
  if (attackLeftInterval) { clearInterval(attackLeftInterval); attackLeftInterval = null; }
  if (attackRightInterval) { clearInterval(attackRightInterval); attackRightInterval = null; }
  if (skillLoopInterval) { clearInterval(skillLoopInterval); skillLoopInterval = null; }
}

function restartLoops() {
  stopFeatureLoops();

  // Kiểm tra chặt chẽ xem bot có tồn tại trong game hay không
  if (!bot || !bot.entity || !bot._client || bot._client.state !== 'play' || isManualStopped) return;

  // 1. Quỳ lạy lặp lại mỗi 47s khi công tắc đang BẬT
  if (toggles.quylai) {
    quylaiInterval = setInterval(() => {
      if (toggles.quylai) safeChat('/quylai');
    }, 47000);
  }

  // 2. Click Chuột Trái liên tục (CÓ BẢO VỆ CHỐNG CRASH)
  if (toggles.attackLeft) {
    attackLeftInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
        try { bot.swingArm('right'); } catch (e) {}
      }
    }, attackLeftIntervalMs);
  }

  // 3. Click Chuột Phải liên tục (CÓ BẢO VỆ CHỐNG CRASH)
  if (toggles.attackRight) {
    attackRightInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
        try { bot.activateItem(); } catch (e) {}
      }
    }, attackRightIntervalMs);
  }

  // 4. Lặp lại Skill 1, 2, 3 mỗi 10s khi công tắc đang BẬT
  if (toggles.skill1 || toggles.skill2 || toggles.skill3) {
    skillLoopInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && !isManualStopped) {
        if (toggles.skill1) safeChat('/kinang_1');
        if (toggles.skill2) safeChat('/kinang_2');
        if (toggles.skill3) safeChat('/kinang_3');
      }
    }, 10000);
  }
}

function cleanupBot() {
  isAutoActionRunning = false;
  currentCoords = 'Đang xác định...';
  currentPing = 0;

  stopFeatureLoops(); // QUAN TRỌNG: Dừng mọi hành động spam click/skill ngay khi ngắt kết nối

  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }
  if (antiAfkTimeout) { clearTimeout(antiAfkTimeout); antiAfkTimeout = null; }

  const intervals = [ramGcInterval, posCheckInterval, watchdogInterval, pingInterval];
  intervals.forEach(i => i && clearInterval(i));

  const timeouts = [reconnectTimeout, loginTimer1, loginTimer2, respawnTimer, commandResponseTimer];
  timeouts.forEach(t => t && clearTimeout(t));

  if (bot) {
    try {
      bot.clearControlStates();
      // Loại bỏ việc xóa listeners can thiệp sâu, để cho bot.end() xử lý
      bot.end(); 
    } catch (e) {}
    bot = null;
  }

  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }
}

function scheduleNextAction() {
  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }

  if (isManualStopped || !bot || !bot.entity || !bot._client || bot._client.socket.destroyed) {
    isAutoActionRunning = false;
    return;
  }

  isAutoActionRunning = true;
  lastActionTime = Date.now();
  const currentBot = bot;

  try {
    const actionType = Math.floor(Math.random() * 3);

    if (actionType === 0) {
      currentBot.swingArm('right');
    } else if (actionType === 1) {
      currentBot.setControlState('sneak', true);
      setTimeout(() => {
        if (bot === currentBot && bot.entity) bot.setControlState('sneak', false);
      }, Math.floor(150 + Math.random() * 200));
    } else {
      try { currentBot.activateItem(); } catch (err) {}
    }
  } catch (err) {}

  const randomDelay = Math.floor(5000 + Math.random() * 5000);
  actionTimeout = setTimeout(scheduleNextAction, randomDelay);
}

function scheduleRandomRotation() {
  if (antiAfkTimeout) clearTimeout(antiAfkTimeout);

  if (isManualStopped) return;

  const nextRotationDelay = Math.floor(15000 + Math.random() * 20000);

  antiAfkTimeout = setTimeout(() => {
    if (bot && bot.entity && bot.health > 0 && bot._client && bot._client.state === 'play') {
      try {
        const deltaYaw = (Math.random() - 0.5) * 0.3;
        const deltaPitch = (Math.random() - 0.5) * 0.1;
        bot.look(bot.entity.yaw + deltaYaw, bot.entity.pitch + deltaPitch, true);
      } catch (e) {}
    }
    scheduleRandomRotation();
  }, nextRotationDelay);
}

function executeActiveFeaturesOnSpawn() {
  if (!bot || !bot.entity || !bot._client || isManualStopped) return;

  let delay = 1000;
  
  if (toggles.afkmode) {
    setTimeout(() => safeChat('/afkmode vao'), delay);
    delay += 1200;
  }
  if (toggles.thien) {
    setTimeout(() => safeChat('/thien'), delay);
    delay += 1200;
  }
  if (toggles.quylai) {
    setTimeout(() => safeChat('/quylai'), delay);
    delay += 1200;
  }
  if (toggles.dinhthan) {
    setTimeout(() => safeChat('/dinhthan'), delay);
    delay += 1200;
  }
  if (toggles.quanghao) {
    setTimeout(() => safeChat('/quanghao'), delay);
    delay += 1200;
  }

  setTimeout(() => {
    restartLoops();
  }, delay + 500);
}

function createBot() {
  if (isManualStopped) return;

  cleanupBot();
  isFirstSpawn = true;
  lastTimeAge = 0;
  lastTimeAgeUpdate = Date.now();

  const currentOptions = {
    host: BOT_HOST,
    port: BOT_PORT,
    username: BOT_USERNAME,
    hideErrors: false,
    checkTimeoutInterval: 60 * 1000, 
    keepAlive: true,
    physicsEnabled: true,
    viewDistance: 'tiny'
  };

  console.log(`\n[HỆ THỐNG] Kết nối đến ${currentOptions.host}:${currentOptions.port} với tên [${BOT_USERNAME}]...`);

  try {
    bot = mineflayer.createBot(currentOptions);
    bot.setMaxListeners(0);

    if (bot._client) {
      bot._client.setMaxListeners(0);
      bot._client.on('error', (err) => {
        addErrorLog('Client Socket Error', err.message || err.code || 'Lỗi TCP Socket');
      });
    }
  } catch (err) {
    addErrorLog('Init Failed', err.message);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] Bot đã vào game!');
    addChatLog('Kết nối ổn định thành công!');
    triggerChatWindow(12000);

    consecutiveFailures = 0;

    if (isFirstSpawn) {
      isFirstSpawn = false;

      loginTimer1 = setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat(`/l ${BOT_PASSWORD}`);
          triggerChatWindow(4000);
        }
      }, 3500);

      loginTimer2 = setTimeout(() => {
        if (bot && bot.entity && bot._client && !isManualStopped) {
          executeActiveFeaturesOnSpawn();
          scheduleNextAction();
          scheduleRandomRotation();
        }
      }, 7000);

      ramGcInterval = setInterval(() => {
        if (bot && bot.entities && bot.entity && bot.entity.position) {
          const myPos = bot.entity.position;
          Object.keys(bot.entities).forEach(id => {
            const ent = bot.entities[id];
            if (ent && ent.position && ent.id !== bot.entity.id) {
              if (ent.position.distanceTo(myPos) > 16) {
                delete bot.entities[id];
              }
            }
          });
        }
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }, 30000);

      pingInterval = setInterval(() => {
        if (bot && bot.player) {
          currentPing = bot.player.ping || 0;
          addPingLog(currentPing);
        }
      }, 10000);

      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `x: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
        }
      }, 5000);

      watchdogInterval = setInterval(() => {
        if (!bot || isManualStopped) return;

        if (!isAutoActionRunning || Date.now() - lastActionTime > 20000) {
          scheduleNextAction();
        }

        if (bot.time) {
          if (bot.time.age === lastTimeAge) {
            if (Date.now() - lastTimeAgeUpdate > 45000) {
              addErrorLog('Watchdog', 'Kẹt Packet thế giới > 45s. Tiến hành Reconnect...');
              handleReconnect();
            }
          } else {
            lastTimeAge = bot.time.age;
            lastTimeAgeUpdate = Date.now();
          }
        }
      }, 15000);
    }
  });

  bot.on('death', () => {
    addChatLog('Bot tử vong! Chờ hồi sinh...');
    addErrorLog('Event Chết', 'Bot tử vong');

    respawnTimer = setTimeout(() => {
      if (bot && bot._client && !isManualStopped) {
        try { bot.respawn(); } catch (e) {}
      }

      setTimeout(() => {
        if (bot && bot.entity && bot._client && !isManualStopped) {
          executeActiveFeaturesOnSpawn();
          scheduleNextAction();
          scheduleRandomRotation();
        }
      }, 4500);
    }, 4000);
  });

  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (!text) return;

      const lowerText = text.toLowerCase();
      const botNameLower = BOT_USERNAME.toLowerCase();

      if (lowerText.includes(botNameLower)) {
        addBotMentionLog(text);
      }

      if (
        text.includes('█') || 
        lowerText.includes('hồi chiêu') || 
        lowerText.includes('ʜồi ᴄʜɪêᴜ') || 
        lowerText.includes('cooldown')
      ) {
        return;
      }

      addChatLog(text);
      console.log('[CHAT]: ' + text);

    } catch (e) {}
  });

  // Hủy toàn bộ loops ngay khi bị văng
  bot.on('end', (reason) => {
    stopFeatureLoops();
    addErrorLog('Mất Kết Nối (End)', `Server ngắt socket: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    stopFeatureLoops();
    addErrorLog('Mineflayer Error', err.message || err.toString());
  });

  bot.on('kicked', (reason) => {
    stopFeatureLoops();
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    addErrorLog('Bị Server Kick', reasonStr);
    
    if (reasonStr.includes('LƯU DỮ LIỆU') || reasonStr.includes('lưu dữ liệu') || reasonStr.includes('\u003d\u003d')) {
      // Khi server lưu dữ liệu, tăng thời gian đợi reconnect lên 25s để tránh timeout socket
      currentReconnectDelay = 25000;
    }
    handleReconnect();
  });
}

function handleReconnect() {
  if (isManualStopped || isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  consecutiveFailures++;

  if (consecutiveFailures >= 10) {
    addErrorLog('CẢNH BÁO NẶNG', 'Mất kết nối 10 lần. Khởi động lại App...');
    setTimeout(() => {
      process.exit(1);
    }, 3000);
    return;
  }

  console.log(`Chờ ${currentReconnectDelay / 1000}s để tái kết nối...`);
  
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    currentReconnectDelay = 12000; // Trả lại delay chuẩn cho lần sau
    createBot();
  }, currentReconnectDelay);
}

createBot();

process.on('uncaughtException', (err) => {
  addErrorLog('Uncaught Exception', `${err.message} (${err.code || 'NO_CODE'})`);
  try { handleReconnect(); } catch(e) {}
});

process.on('unhandledRejection', (reason) => {
  addErrorLog('Unhandled Rejection', String(reason));
});
