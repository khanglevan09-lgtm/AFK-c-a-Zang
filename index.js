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
  quylai: false, // Sử dụng lệnh /quylay
  dinhthan: false,
  quanghao: false,
  attackLeft: false,
  attackRight: false,
  skill1: false,
  skill2: false,
  skill3: false,
  sneak: false // Nút ngồi / rón rén (Shift)
};

// Cấu hình tốc độ click chuột (tối thiểu 0.1s = 100ms)
let attackLeftIntervalMs = 500;
let attackRightIntervalMs = 500;

// Cấu hình Chuyển Ô Vật Phẩm (Hotbar 1-9 -> Index 0-8)
const slotConfig = {
  enabled: [false, false, false, false, false, false, false, false, false],
  holdTimeSec: 5
};
let currentSlotIndex = 0;

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
let sneakLoopInterval = null;
let slotSwitchInterval = null;

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
  if (serverChatLogs.length > 80) serverChatLogs.pop();
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
  if (botMentionLogs.length > 30) botMentionLogs.pop();
}

// Xử lý đọc chính xác tên vật phẩm từ Minecraft NBT / Display Name
function stripFormatting(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/§[0-9a-fk-or]/gi, '').replace(/&[0-9a-fk-or]/gi, '').trim();
}

function getExactItemName(item) {
  if (!item) return 'Tay không';
  
  if (item.customName) {
    try {
      const parsed = JSON.parse(item.customName);
      if (parsed.text) return stripFormatting(parsed.text);
      if (parsed.extra && Array.isArray(parsed.extra)) {
        return stripFormatting(parsed.extra.map(e => (typeof e === 'string' ? e : e.text || '')).join(''));
      }
    } catch (e) {
      return stripFormatting(item.customName);
    }
  }

  if (item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value) {
    const disp = item.nbt.value.display.value;
    if (disp.Name && disp.Name.value) {
      const rawName = disp.Name.value;
      try {
        const parsed = JSON.parse(rawName);
        if (typeof parsed === 'string') return stripFormatting(parsed);
        if (parsed.text) return stripFormatting(parsed.text);
        if (parsed.extra && Array.isArray(parsed.extra)) {
          return stripFormatting(parsed.extra.map(e => (typeof e === 'string' ? e : e.text || '')).join(''));
        }
      } catch (e) {
        return stripFormatting(rawName);
      }
    }
  }

  return item.displayName || item.name || 'Vật phẩm không tên';
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

// API TRẢ VỀ DỮ LIỆU REALTIME CẬP NHẬT GIAO DIỆN KHÔNG CẦN F5 TRANG
app.get('/api/status', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? getExactItemName(bot.heldItem) : 'Tay không';
  
  let statusBadge = '<span class="badge-off">OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">ĐÃ TẮT THỦ CÔNG (NHƯỜNG NICK)</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">ONLINE</span>';
  } else {
    statusBadge = `<span class="badge-off">RECONNECTING (${Math.round(currentReconnectDelay / 1000)}s)</span>`;
  }

  res.json({
    statusBadge,
    botUsername: BOT_USERNAME,
    botHost: BOT_HOST,
    botPort: BOT_PORT,
    currentPing,
    currentCoords,
    currentWeapon,
    uptimeMinutes,
    memoryUsage,
    serverChatLogs,
    errorLogs,
    pingLogs,
    botMentionLogs
  });
});

// ENDPOINT CẬP NHẬT CẤU HÌNH TỰ ĐỘNG (SỬA LỖI 502 RENDER)
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
  
  // Trả về response thành công trước để Render không bị đứt Socket / 502 Bad Gateway
  res.redirect('/');

  // Tái kết nối asynchronously
  setImmediate(() => {
    consecutiveFailures = 0;
    isManualStopped = false;
    createBot();
  });
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
      if (feat === 'quylai') safeChat('/quylay'); // Lệnh đổi thành /quylay
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

// ENDPOINT SETTING CÁC Ô CÔNG CỤ (HOTBAR 1-9)
app.post('/api/update-slots', (req, res) => {
  const holdTimeSec = parseInt(req.body.holdTimeSec);
  if (!isNaN(holdTimeSec) && holdTimeSec >= 1) {
    slotConfig.holdTimeSec = holdTimeSec;
  }

  for (let i = 0; i < 9; i++) {
    slotConfig.enabled[i] = req.body[`slot_${i}`] === 'on';
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
  addErrorLog('HỆ THỐNG', 'Dọn dẹp bộ nhớ và kết nối lại Bot...');
  cleanupBot();
  consecutiveFailures = 0;
  createBot();
  res.redirect('/'); 
});

app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? getExactItemName(bot.heldItem) : 'Tay không';

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
      <title>Kiru Đẹp Trai - MC Bot Control</title>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --card-bg: rgba(11, 15, 25, 0.92);
          --accent-cyan: #38bdf8;
          --accent-pink: #f43f5e;
          --accent-purple: #c084fc;
          --accent-green: #4ade80;
          --accent-yellow: #fbbf24;
          --border: rgba(56, 189, 248, 0.35);
        }

        * { box-sizing: border-box; }

        #bg-container {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          z-index: -2;
          overflow: hidden;
          background-color: #05070f;
        }

        #bg-blur {
          position: absolute;
          top: -10%; left: -10%; width: 120%; height: 120%;
          background-position: center center;
          background-size: cover;
          filter: blur(30px) brightness(0.5);
          transform: scale(1.1);
          transition: background-image 0.6s ease-in-out;
        }

        #bg-main {
          position: absolute;
          top: 0; left: 0; width: 100%; height: 100%;
          background-position: center center;
          background-repeat: no-repeat;
          background-size: contain;
          transition: background-image 0.6s ease-in-out, background-size 0.3s ease;
        }

        body.bg-mode-cover #bg-main {
          background-size: cover;
        }

        body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          margin: 0;
          padding: 16px;
          color: #f8fafc;
          min-height: 100vh;
          position: relative;
        }

        body::before {
          content: '';
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(3, 7, 18, 0.75);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: -1;
          transition: all 0.3s ease;
        }

        /* TRẠNG THÁI ẨN GIAO DIỆN ĐỂ NẮM TRỌN HÌNH NỀN ANIME */
        body.ui-hidden::before {
          background: rgba(0, 0, 0, 0.02);
          backdrop-filter: blur(0px);
          -webkit-backdrop-filter: blur(0px);
        }

        body.ui-hidden .container,
        body.ui-hidden .header {
          display: none !important;
        }

        /* NÚT NỔI FAB ĐỔI TRẠNG THÁI BẢNG */
        .fab-toggle {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          padding: 12px 22px;
          border-radius: 30px;
          font-weight: 700;
          font-size: 0.95rem;
          cursor: pointer;
          background: linear-gradient(135deg, #0ea5e9, #a855f7);
          color: #ffffff;
          border: 2px solid rgba(255, 255, 255, 0.7);
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.7), 0 0 15px rgba(56, 189, 248, 0.5);
          transition: all 0.3s ease;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fab-toggle:hover {
          transform: scale(1.08);
          box-shadow: 0 10px 30px rgba(56, 189, 248, 0.9);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 20px;
          background: rgba(11, 15, 25, 0.95);
          border: 1px solid var(--border);
          border-radius: 16px;
          margin-bottom: 20px;
          gap: 12px;
          flex-wrap: wrap;
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
        }

        h1 {
          font-family: 'Orbitron', sans-serif;
          font-size: 1.8rem;
          margin: 0;
          background: linear-gradient(90deg, #38bdf8, #f43f5e, #c084fc);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          text-shadow: 0 0 15px rgba(56, 189, 248, 0.5);
          letter-spacing: 1px;
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
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 15px rgba(56, 189, 248, 0.15);
          margin-bottom: 20px;
        }

        h3 {
          margin-top: 0;
          color: var(--accent-cyan);
          font-size: 1.15rem;
          display: flex;
          align-items: center;
          gap: 8px;
          text-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
        }

        .badge-on { background: rgba(34, 197, 94, 0.25); color: #4ade80; border: 1px solid #4ade80; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; box-shadow: 0 0 10px rgba(74, 222, 128, 0.3); }
        .badge-off { background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid #f87171; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; box-shadow: 0 0 10px rgba(248, 113, 113, 0.3); }
        .badge-pause { background: rgba(245, 158, 11, 0.25); color: #fbbf24; border: 1px solid #fbbf24; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; box-shadow: 0 0 10px rgba(251, 191, 36, 0.3); }

        .status-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
          gap: 10px;
          margin: 15px 0;
        }

        .status-item {
          background: rgba(0, 0, 0, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.15);
          padding: 10px 12px;
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .status-item .label {
          font-size: 0.7rem;
          color: #cbd5e1;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 700;
        }

        .status-item .value {
          font-size: 0.9rem;
          font-weight: 700;
          color: #ffffff;
          word-break: break-all;
        }

        .slot-grid {
          display: grid;
          grid-template-columns: repeat(9, 1fr);
          gap: 8px;
          margin: 12px 0;
        }
        .slot-item {
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(56, 189, 248, 0.4);
          border-radius: 10px;
          padding: 8px 4px;
          text-align: center;
          font-size: 0.85rem;
          color: #f1f5f9;
          font-weight: bold;
        }
        .slot-item input[type="checkbox"] {
          margin-top: 6px;
          width: 18px;
          height: 18px;
          cursor: pointer;
          accent-color: var(--accent-pink);
        }

        .chat-box { background: rgba(0, 0, 0, 0.75); padding: 12px; border-radius: 12px; font-family: monospace; height: 320px; overflow-y: auto; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-size: 0.85rem; line-height: 1.5; }
        .error-box { background: rgba(15, 5, 5, 0.85); padding: 12px; border-radius: 12px; font-family: monospace; height: 220px; overflow-y: auto; color: #f87171; border: 1px solid rgba(244, 63, 94, 0.5); font-size: 0.85rem; line-height: 1.5; }
        .kiru-box { background: rgba(15, 23, 15, 0.85); padding: 12px; border-radius: 12px; font-family: monospace; height: 180px; overflow-y: auto; color: #facc15; border: 1px solid rgba(250, 204, 21, 0.5); font-size: 0.85rem; line-height: 1.5; }

        .input-group { display: flex; gap: 10px; margin-top: 10px; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

        label { font-size: 0.85rem; color: #e2e8f0; display: block; margin-bottom: 6px; font-weight: 600; }

        input[type="text"], input[type="password"], input[type="number"] { 
          width: 100%; 
          padding: 10px 14px; 
          border-radius: 10px; 
          border: 1px solid rgba(255, 255, 255, 0.25); 
          background: rgba(0, 0, 0, 0.65); 
          color: #ffffff; 
          outline: none; 
          font-size: 0.9rem; 
          font-weight: 600;
        }
        input:focus { border-color: var(--accent-cyan); box-shadow: 0 0 12px rgba(56, 189, 248, 0.5); }

        button {
          padding: 10px 18px;
          background: linear-gradient(135deg, #e11d48, #be123c);
          color: white;
          border: 1px solid #f43f5e;
          border-radius: 10px;
          cursor: pointer;
          font-weight: bold;
          transition: all 0.25s ease;
          white-space: nowrap;
          font-size: 0.88rem;
          box-shadow: 0 4px 12px rgba(225, 29, 72, 0.3);
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(225, 29, 72, 0.6); }

        .btn-stop { background: linear-gradient(135deg, #b91c1c, #ef4444) !important; border: 1px solid #f87171 !important; box-shadow: 0 0 10px rgba(239, 68, 68, 0.3) !important; text-shadow: 0 0 6px rgba(255,255,255,0.4) !important; }
        .btn-start { background: linear-gradient(135deg, #15803d, #22c55e) !important; border: 1px solid #4ade80 !important; box-shadow: 0 0 10px rgba(34, 197, 94, 0.3) !important; text-shadow: 0 0 6px rgba(255,255,255,0.4) !important; }
        .btn-cyan { background: linear-gradient(135deg, #0369a1, #0ea5e9) !important; border: 1px solid #38bdf8 !important; box-shadow: 0 0 10px rgba(14, 165, 233, 0.3) !important; text-shadow: 0 0 6px rgba(255,255,255,0.4) !important; }
        .btn-warning { background: linear-gradient(135deg, #b45309, #f59e0b) !important; border: 1px solid #fbbf24 !important; box-shadow: 0 0 10px rgba(245, 158, 11, 0.3) !important; text-shadow: 0 0 6px rgba(255,255,255,0.4) !important; }
        .btn-purple { background: linear-gradient(135deg, #6b21a8, #a855f7) !important; border: 1px solid #c084fc !important; box-shadow: 0 0 10px rgba(168, 85, 247, 0.3) !important; text-shadow: 0 0 6px rgba(255,255,255,0.4) !important; }
        .btn-save { background: linear-gradient(135deg, #1d4ed8, #3b82f6) !important; border: 1px solid #60a5fa !important; width: 100%; margin-top: 10px; box-shadow: 0 0 12px rgba(59, 130, 246, 0.4) !important; text-shadow: 0 0 6px rgba(255,255,255,0.4) !important; }

        .btn-group-responsive {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 10px;
          margin-top: 15px;
        }

        .modal-overlay {
          display: none;
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(10px);
          z-index: 1000;
          justify-content: center;
          align-items: center;
          padding: 16px;
        }
        .modal-card {
          background: #0b0f19;
          border: 1px solid var(--border);
          border-radius: 16px;
          width: 100%;
          max-width: 800px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          padding: 20px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.9), 0 0 20px rgba(56, 189, 248, 0.3);
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 10px;
        }
        .modal-close {
          background: transparent;
          border: none;
          color: #f43f5e;
          font-size: 1.6rem;
          cursor: pointer;
          font-weight: bold;
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
          .slot-grid { grid-template-columns: repeat(3, 1fr); }
          .card { padding: 14px; }
        }
      </style>
      <script>
        // DỌN DẸP BỘ NHỚ ẢNH CŨ KHI TẢI TẢI ẢNH MỚI (CHỐNG MEMORY LEAK)
        let currentBgImageObj = null;

        async function rotateAnimeBg() {
          const apis = [
            'https://api.waifu.pics/sfw/waifu',
            'https://nekos.best/api/v2/neko'
          ];

          // Giải phóng đối tượng ảnh cũ nếu tồn tại
          if (currentBgImageObj) {
            currentBgImageObj.onload = null;
            currentBgImageObj.onerror = null;
            currentBgImageObj = null;
          }

          for (let api of apis) {
            try {
              const res = await fetch(api);
              const data = await res.json();
              let imgUrl = '';
              if (data && data.url) imgUrl = data.url;
              else if (data && data.results && data.results[0] && data.results[0].url) imgUrl = data.results[0].url;

              if (imgUrl) {
                const img = new Image();
                currentBgImageObj = img;
                img.onload = () => {
                  const bgMain = document.getElementById('bg-main');
                  const bgBlur = document.getElementById('bg-blur');
                  if (bgMain) bgMain.style.backgroundImage = 'url("' + imgUrl + '")';
                  if (bgBlur) bgBlur.style.backgroundImage = 'url("' + imgUrl + '")';
                  img.onload = null;
                  img.onerror = null;
                  currentBgImageObj = null;
                };
                img.onerror = () => {
                  img.onload = null;
                  img.onerror = null;
                  currentBgImageObj = null;
                };
                img.src = imgUrl;
                break;
              }
            } catch (e) {}
          }
        }

        function toggleBgFit() {
          document.body.classList.toggle('bg-mode-cover');
          const isCover = document.body.classList.contains('bg-mode-cover');
          const btn = document.getElementById('bg-fit-toggle');
          if (btn) {
            btn.innerHTML = isCover ? '🖼️ Chế độ: Tràn Màn' : '🖼️ Chế độ: Vừa Khung (Xem Hết)';
          }
          try {
            localStorage.setItem('bg_fit_mode', isCover ? 'cover' : 'contain');
          } catch (e) {}
        }

        // CẬP NHẬT DỮ LIỆU REALTIME BẰNG AJAX (KHÔNG TẢI LẠI TRANG CHỐNG GIẬT LAG)
        async function fetchRealtimeStatus() {
          const activeEl = document.activeElement;
          if (activeEl && activeEl.tagName === 'INPUT') return; // Không update khi người dùng đang gõ phím

          try {
            const res = await fetch('/api/status');
            if (!res.ok) return;
            const data = await res.json();

            // Cập nhật các khung chat và logs nhẹ nhàng
            const chatBoxes = document.querySelectorAll('.chat-box');
            chatBoxes.forEach(box => {
              if (data.serverChatLogs && data.serverChatLogs.length > 0) {
                box.innerHTML = data.serverChatLogs.map(l => '<div>' + l + '</div>').join('');
              }
            });

            const errorBoxes = document.querySelectorAll('.error-box');
            errorBoxes.forEach(box => {
              if (data.errorLogs && data.errorLogs.length > 0) {
                box.innerHTML = data.errorLogs.map(e => '<div>[' + e.time + '] <b>[' + e.type + ']</b>:' + e.details + '</div>').join('');
              } else {
                box.innerHTML = '<div style="color:var(--accent-green);">Không có lỗi!</div>';
              }
            });
          } catch (e) {}
        }

        function openModal(id) {
          document.getElementById(id).style.display = 'flex';
        }

        function closeModal(id) {
          document.getElementById(id).style.display = 'none';
        }

        // HÀM BẬT/TẮT THU GỌN BẢNG CONTROL ĐỂ XEM ANIME BACKGROUND
        function toggleDashboardUI() {
          document.body.classList.toggle('ui-hidden');
          const isHidden = document.body.classList.contains('ui-hidden');
          const fabBtn = document.getElementById('fab-ui-toggle');
          const headerBtn = document.getElementById('header-ui-toggle');
          const btnText = isHidden ? '📋 Hiện Bảng Control' : '👁️ Thu Gọn Bảng (Xem Ảnh)';
          
          if (fabBtn) fabBtn.innerHTML = btnText;
          if (headerBtn) headerBtn.innerHTML = btnText;

          try {
            localStorage.setItem('dashboard_ui_hidden', isHidden ? 'true' : 'false');
          } catch (e) {}
        }

        window.addEventListener('DOMContentLoaded', () => {
          // Lấy trạng thái lưu từ trước nếu có
          if (localStorage.getItem('dashboard_ui_hidden') === 'true') {
            toggleDashboardUI();
          }

          if (localStorage.getItem('bg_fit_mode') === 'cover') {
            toggleBgFit();
          }

          rotateAnimeBg();
          setInterval(rotateAnimeBg, 90000); // Đổi ảnh mỗi 90 giây để tiết kiệm CPU/RAM
          setInterval(fetchRealtimeStatus, 5000); // Cập nhật log 5 giây 1 lần mượt mà
        });
      </script>
    </head>
    <body>
      <div id="bg-container">
        <div id="bg-blur"></div>
        <div id="bg-main"></div>
      </div>

      <div class="header">
        <h1>KIRU ĐẸP TRAI</h1>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <button id="bg-fit-toggle" type="button" class="btn-purple" onclick="toggleBgFit()">🖼️ Chế độ: Vừa Khung (Xem Hết)</button>
          <button id="header-ui-toggle" type="button" class="btn-cyan" onclick="toggleDashboardUI()">👁️ Thu Gọn Bảng (Xem Ảnh)</button>
          <div>${statusBadge}</div>
        </div>
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
                <span class="label">Vật Phẩm Cầm Trên Tay</span>
                <span class="value" style="color: var(--accent-yellow);"><code>${currentWeapon}</code></span>
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

            <!-- CỬA SỔ MENU CHO CÁC MỤC CHAT SERVER VÀ LỖI HỆ THỐNG -->
            <div class="btn-group-responsive">
              <button type="button" class="btn-cyan" onclick="openModal('modal-chat')">💬 Cửa Sổ Chat Server</button>
              <button type="button" class="btn-warning" onclick="openModal('modal-errors')">⚠️ Cửa Sổ Nhật Ký Lỗi</button>
            </div>

            <form class="input-group" action="/api/command" method="POST">
              <input type="text" id="cmd-input" name="command" placeholder="Gửi lệnh hoặc chat vào server..." autocomplete="off" required>
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
              <a href="/api/hard-restart" style="text-decoration: none;" onclick="return confirm('Reset toàn bộ Tiến Trình Code?');"><button type="button" class="btn-stop" style="width: 100%;">Reset App</button></a>
            </div>
          </div>

          <!-- Ô CÔNG CỤ TỰ ĐỘNG CHUYỂN DỔI (SLOTS 1 TO 9) -->
          <div class="card">
            <h3>Cấu Hình Ô Công Cụ Bot (Ô 1 ➔ Ô 9)</h3>
            <form action="/api/update-slots" method="POST">
              <div style="margin-bottom: 8px;">
                <label>Thời gian cầm mỗi ô trước khi đổi sang ô tiếp theo (giây):</label>
                <input type="number" min="1" name="holdTimeSec" value="${slotConfig.holdTimeSec}" required>
              </div>
              <label>Bật/Tắt các ô cần chuyển đổi cầm trên tay:</label>
              <div class="slot-grid">
                ${[1,2,3,4,5,6,7,8,9].map((num, idx) => `
                  <div class="slot-item">
                    <div><b>Ô ${num}</b></div>
                    <input type="checkbox" name="slot_${idx}" ${slotConfig.enabled[idx] ? 'checked' : ''}>
                  </div>
                `).join('')}
              </div>
              <button type="submit" class="btn-save">Lưu Thiết Lập Ô Cầm</button>
            </form>
          </div>

          <!-- BẬT / TẮT TÍNH NĂNG AUTO (NÚT GỌN GÀNG) -->
          <div class="card">
            <h3>Bật / Tắt Lệnh Tự Động & Hoạt Động</h3>
            <div class="btn-group-responsive">
              ${renderToggleBtn('afkmode', 'AFK Mode')}
              ${renderToggleBtn('thien', 'Thiền')}
              ${renderToggleBtn('quylai', 'Quỳ Lạy')}
              ${renderToggleBtn('dinhthan', 'Định Thân')}
              ${renderToggleBtn('quanghao', 'Quang Hào')}
              ${renderToggleBtn('sneak', 'Nút Ngồi / Rón Rén (Shift 5s)')}
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
              <h3>Cấu Hình Tài Khoản & Server</h3>
              <div class="form-grid">
                <div>
                  <label>Tên Nhân Vật:</label>
                  <input type="text" name="username" value="${BOT_USERNAME}" required autocomplete="off">
                </div>
                <div>
                  <label>Mật Khẩu:</label>
                  <input type="password" name="password" value="${BOT_PASSWORD}" required autocomplete="off" placeholder="••••••••">
                </div>
              </div>
              <div style="margin-top: 10px;">
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

          <!-- CHAT SERVER REALTIME PANEL GIÚP QUAN SÁT VÀ CHAT TRỰC TIẾP -->
          <div class="card">
            <h3>Chat Server (24/24)</h3>
            <div class="chat-box" style="height: 380px;">
              ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
            </div>
            <form class="input-group" action="/api/command" method="POST" style="margin-top: 10px;">
              <input type="text" name="command" placeholder="Nhập tin nhắn..." autocomplete="off" required>
              <button type="submit">Gửi</button>
            </form>
          </div>

          <div class="card">
            <h3>Nhật Ký Lỗi Phát Sinh</h3>
            <div class="error-box">
              ${errorLogs.length > 0 ? errorLogs.map(e => `<div>[${e.time}] <b>[${e.type}]</b>:${e.details}</div>`).join('') : '<div style="color:var(--accent-green);">Không có lỗi!</div>'}
            </div>
          </div>
        </div>
      </div>

      <!-- MODAL CHAT SERVER DẠNG CỬA SỔ MENU POPUP -->
      <div id="modal-chat" class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3 style="margin: 0; color: var(--accent-cyan);">💬 Cửa Sổ Chat Server</h3>
            <button class="modal-close" onclick="closeModal('modal-chat')">&times;</button>
          </div>
          <div class="chat-box" style="flex: 1; height: 100%;">
            ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
          </div>
          <form class="input-group" action="/api/command" method="POST" style="margin-top: 12px;">
            <input type="text" name="command" placeholder="Nhập lệnh hoặc chat..." autocomplete="off" required>
            <button type="submit">Gửi Ngay</button>
          </form>
        </div>
      </div>

      <!-- MODAL LỖI DẠNG CỬA SỔ MENU POPUP -->
      <div id="modal-errors" class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3 style="margin: 0; color: #f87171;">⚠️ Nhật Ký Lỗi Hệ Thống</h3>
            <button class="modal-close" onclick="closeModal('modal-errors')">&times;</button>
          </div>
          <div class="error-box" style="flex: 1; height: 100%;">
            ${errorLogs.length > 0 ? errorLogs.map(e => `<div>[${e.time}] <b>[${e.type}]</b>:${e.details}</div>`).join('') : '<div style="color:var(--accent-green);">Không có lỗi!</div>'}
          </div>
          <div style="margin-top: 12px; text-align: right;">
            <a href="/api/clear-error-log" style="text-decoration: none;"><button type="button" class="btn-warning">Xóa Nhật Ký Lỗi</button></a>
          </div>
        </div>
      </div>

      <!-- NÚT NỔI THU GỌN / MỞ BẢNG CONTROL GÓC DƯỚI -->
      <button id="fab-ui-toggle" type="button" class="fab-toggle" onclick="toggleDashboardUI()">
        👁️ Thu Gọn Bảng (Xem Ảnh)
      </button>
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
  if (sneakLoopInterval) { clearInterval(sneakLoopInterval); sneakLoopInterval = null; }
  if (slotSwitchInterval) { clearInterval(slotSwitchInterval); slotSwitchInterval = null; }
}

function restartLoops() {
  stopFeatureLoops();

  // Kiểm tra chặt chẽ xem bot có tồn tại trong game hay không
  if (!bot || !bot.entity || !bot._client || bot._client.state !== 'play' || isManualStopped) return;

  // 1. Quỳ lạy lặp lại mỗi 47s khi công tắc đang BẬT (/quylay)
  if (toggles.quylai) {
    quylaiInterval = setInterval(() => {
      if (toggles.quylai) safeChat('/quylay');
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

  // 5. Nút Ngồi / đi rón rén (Shift) - vòng lặp 5s 1 lần khi bật
  if (toggles.sneak) {
    let isSneaking = false;
    sneakLoopInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
        try {
          isSneaking = !isSneaking;
          bot.setControlState('sneak', isSneaking);
        } catch (e) {}
      }
    }, 5000);
  }

  // 6. Tự động chuyển đổi các Ô Thanh Công Cụ (Slots 1 - 9)
  const enabledSlots = slotConfig.enabled
    .map((enabled, index) => enabled ? index : null)
    .filter(idx => idx !== null);

  if (enabledSlots.length > 0) {
    slotSwitchInterval = setInterval(() => {
      if (bot && bot.inventory && bot._client && bot._client.state === 'play' && !isManualStopped) {
        try {
          if (enabledSlots.length === 1) {
            bot.setQuickBarSlot(enabledSlots[0]);
          } else {
            currentSlotIndex = (currentSlotIndex + 1) % enabledSlots.length;
            const targetSlot = enabledSlots[currentSlotIndex];
            bot.setQuickBarSlot(targetSlot);
          }
        } catch (e) {}
      }
    }, slotConfig.holdTimeSec * 1000);
  }
}

function cleanupBot() {
  isAutoActionRunning = false;
  currentCoords = 'Đang xác định...';
  currentPing = 0;

  stopFeatureLoops(); // Dừng mọi hành động spam click/skill ngay khi ngắt kết nối

  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }
  if (antiAfkTimeout) { clearTimeout(antiAfkTimeout); antiAfkTimeout = null; }

  const intervals = [ramGcInterval, posCheckInterval, watchdogInterval, pingInterval];
  intervals.forEach(i => i && clearInterval(i));

  const timeouts = [reconnectTimeout, loginTimer1, loginTimer2, respawnTimer, commandResponseTimer];
  timeouts.forEach(t => t && clearTimeout(t));

  if (bot) {
    try {
      // GIẢI PHÓNG TOÀN BỘ EVENT LISTENERS CHỐNG MEMORY LEAK
      bot.removeAllListeners();
      if (bot._client) {
        bot._client.removeAllListeners();
      }
      bot.clearControlStates();
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
      if (!toggles.sneak) {
        currentBot.setControlState('sneak', true);
        setTimeout(() => {
          if (bot === currentBot && bot.entity && !toggles.sneak) bot.setControlState('sneak', false);
        }, Math.floor(150 + Math.random() * 200));
      }
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
    setTimeout(() => safeChat('/quylay'), delay);
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
        // GIẢI PHÓNG CACHE WORLD CHUNKS CHỐNG TRÀN RAM RENDER
        if (bot && bot.world && bot.world.columns) {
          const columnKeys = Object.keys(bot.world.columns);
          if (columnKeys.length > 80) {
            bot.world.columns = {};
          }
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

  // KHÔNG DÙNG process.exit(1) ĐỂ BẢO VỆ WEB SERVER KHÔNG BỊ HTTP 503 RENDER
  if (consecutiveFailures >= 10) {
    addErrorLog('CẢNH BÁO NẶNG', 'Mất kết nối nhiều lần. Tạm dừng 30s trước khi thử lại...');
    reconnectTimeout = setTimeout(() => {
      isReconnecting = false;
      consecutiveFailures = 0;
      createBot();
    }, 30000);
    return;
  }

  console.log(`Chờ ${currentReconnectDelay / 1000}s để tái kết nối...`);
  
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    currentReconnectDelay = 12000;
    createBot();
  }, currentReconnectDelay);
}

createBot();

// BỘ GIÁM SÁT BỘ NHỚ RAM AN TOÀN (KHÔNG SẤP SERVER EXPRESS, KHÔNG BỊ 503)
setInterval(() => {
  const heapUsed = process.memoryUsage().heapUsed / 1024 / 1024;
  if (heapUsed > 350) {
    console.log(`[CẢNH BÁO RAM] RAM sử dụng ${heapUsed.toFixed(1)}MB. Đang giải phóng bộ nhớ Bot...`);
    cleanupBot();
    setTimeout(() => {
      if (!isManualStopped) createBot();
    }, 3000);
  } else if (heapUsed > 200 && global.gc) {
    try { global.gc(); } catch (e) {}
  }
}, 20000);

process.on('uncaughtException', (err) => {
  addErrorLog('Uncaught Exception', `${err.message} (${err.code || 'NO_CODE'})`);
  try { handleReconnect(); } catch(e) {}
});

process.on('unhandledRejection', (reason) => {
  addErrorLog('Unhandled Rejection', String(reason));
});