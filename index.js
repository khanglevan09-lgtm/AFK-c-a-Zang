const mineflayer = require('mineflayer');
const express = require('express');

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
  skill3: false,
  sneak: false
};

let attackLeftIntervalMs = 500;
let attackRightIntervalMs = 500;

const slotConfig = {
  enabled: [false, false, false, false, false, false, false, false, false],
  holdTimeSec: 5
};
let currentSlotIndex = 0;

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isManualStopped = false;
let isFirstSpawn = true;

let currentReconnectDelay = 12000;
let consecutiveFailures = 0; 

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
  serverChatLogs.unshift('[' + getVNTime() + '] ' + msg);
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

function triggerChatWindow(durationMs) {
  if (!durationMs) durationMs = 8000;
  isAwaitingResponse = true;
  if (commandResponseTimer) clearTimeout(commandResponseTimer);
  commandResponseTimer = setTimeout(() => {
    isAwaitingResponse = false;
  }, durationMs);
}

function safeChat(msg) {
  if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
    try {
      bot.chat(msg);
      addChatLog('[TỰ ĐỘNG]: ' + msg);
    } catch (e) {
      addErrorLog('Lỗi Chat', e.message);
    }
  }
}

function renderSlotGrid() {
  let html = '';
  for (let i = 0; i < 9; i++) {
    const num = i + 1;
    const checked = slotConfig.enabled[i] ? 'checked' : '';
    html += '<div class="slot-item">' +
              '<div><b>Ô ' + num + '</b></div>' +
              '<input type="checkbox" name="slot_' + i + '" ' + checked + '>' +
            '</div>';
  }
  return html;
}

function renderMentionLogs() {
  if (botMentionLogs.length === 0) {
    return '<i>Chưa có tin nhắn nào nhắc đến ' + BOT_USERNAME + '...</i>';
  }
  return botMentionLogs.map(k => '<div>[' + k.time + ']' + k.text + '</div>').join('');
}

function renderPingLogs() {
  if (pingLogs.length === 0) return 'Đang thu thập...';
  return pingLogs.map(p => '[' + p.time + ':' + p.ping + 'ms]').join(' ➔ ');
}

function renderChatLogs() {
  if (serverChatLogs.length === 0) return '<i>Chưa có nhật ký...</i>';
  return serverChatLogs.map(l => '<div>' + l + '</div>').join('');
}

function renderErrorLogs() {
  if (errorLogs.length === 0) return '<div style="color:var(--accent-green);">Không có lỗi!</div>';
  return errorLogs.map(e => '<div>[' + e.time + '] <b>[' + e.type + ']</b>:' + e.details + '</div>').join('');
}

function renderToggleBtn(key, label) {
  const isON = toggles[key];
  const btnClass = isON ? 'btn-start' : 'btn-stop';
  const statusText = isON ? 'BẬT' : 'TẮT';
  return '<a href="/api/toggle/' + key + '" style="text-decoration: none;"><button type="button" class="' + btnClass + '" style="width: 100%;">' + label + ': ' + statusText + '</button></a>';
}

app.get('/api/ping', (req, res) => res.send('PONG_OK'));

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
    statusBadge = '<span class="badge-off">RECONNECTING (' + Math.round(currentReconnectDelay / 1000) + 's)</span>';
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

  addErrorLog('CẤU HÌNH', 'Đã cập nhật cấu hình Bot [' + BOT_USERNAME + ']. Đang kết nối lại...');
  res.redirect('/');

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
    addChatLog('[WEB-ADMIN]: ' + cmd);
    triggerChatWindow(8000);
  }
  res.redirect('/');
});

app.get('/api/toggle/:feature', (req, res) => {
  const feat = req.params.feature;
  if (toggles.hasOwnProperty(feat)) {
    toggles[feat] = !toggles[feat];
    addChatLog('[CÀI ĐẶT] ' + feat.toUpperCase() + ' ➔ ' + (toggles[feat] ? 'BẬT' : 'TẮT'));

    if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
      if (feat === 'afkmode') safeChat(toggles[feat] ? '/afkmode vao' : '/afkmode ra');
      if (feat === 'thien') safeChat('/thien');
      if (feat === 'quylai') safeChat('/quylay');
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

app.post('/api/update-click-speed', (req, res) => {
  const leftSpeed = parseFloat(req.body.leftSpeed);
  const rightSpeed = parseFloat(req.body.rightSpeed);

  if (!isNaN(leftSpeed) && leftSpeed >= 0.1) attackLeftIntervalMs = Math.round(leftSpeed * 1000);
  if (!isNaN(rightSpeed) && rightSpeed >= 0.1) attackRightIntervalMs = Math.round(rightSpeed * 1000);

  restartLoops();
  res.redirect('/');
});

app.post('/api/update-slots', (req, res) => {
  const holdTimeSec = parseInt(req.body.holdTimeSec);
  if (!isNaN(holdTimeSec) && holdTimeSec >= 1) {
    slotConfig.holdTimeSec = holdTimeSec;
  }

  for (let i = 0; i < 9; i++) {
    slotConfig.enabled[i] = req.body['slot_' + i] === 'on';
  }

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
    statusBadge = '<span class="badge-pause">ĐÃ TẮT THỦ CÔNG</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">ONLINE</span>';
  } else {
    statusBadge = '<span class="badge-off">RECONNECTING (' + Math.round(currentReconnectDelay / 1000) + 's)</span>';
  }

  const hostDisplay = BOT_HOST + (BOT_PORT && BOT_PORT !== 25565 ? ':' + BOT_PORT : '');

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <meta name="referrer" content="no-referrer">
      <title>Kiru Đẹp Trai - MC Bot Control</title>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      
      <style>
        :root {
          --card-bg: rgba(11, 15, 25, 0.90);
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
          top: 0; left: 0; width: 100vw; height: 100vh;
          z-index: -2;
          overflow: hidden;
          background-color: #080c14;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bg-img-blur {
          position: absolute;
          top: -10%; left: -10%;
          width: 120vw; height: 120vh;
          object-fit: cover;
          filter: blur(35px) brightness(0.45);
          transform: scale(1.1);
          transition: opacity 0.6s ease;
        }

        .bg-img-main {
          position: absolute;
          top: 0; left: 0;
          width: 100vw; height: 100vh;
          object-fit: contain !important; /* BẮT BUỘC TRỌN VẸN 100% BỨC ẢNH - KHÔNG CẮT XÉN */
          object-position: center;
          transition: opacity 0.6s ease;
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
          background: rgba(3, 7, 18, 0.65);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          z-index: -1;
          transition: all 0.3s ease;
        }

        body.ui-hidden::before {
          background: transparent !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
        }

        body.ui-hidden .container,
        body.ui-hidden .header {
          display: none !important;
        }

        #fab-container {
          position: fixed;
          bottom: 20px;
          right: 20px;
          z-index: 9999;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .fab-toggle {
          padding: 12px 20px;
          border-radius: 30px;
          font-weight: 700;
          font-size: 0.92rem;
          cursor: pointer;
          background: linear-gradient(135deg, #0ea5e9, #a855f7);
          color: #ffffff;
          border: 2px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 8px 25px rgba(0, 0, 0, 0.8), 0 0 15px rgba(56, 189, 248, 0.6);
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
          padding: 14px 20px;
          background: rgba(11, 15, 25, 0.95);
          border: 1px solid var(--border);
          border-radius: 16px;
          margin-bottom: 20px;
          gap: 12px;
          flex-wrap: wrap;
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.25);
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
          background: rgba(0, 0, 0, 0.65);
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
          background: rgba(0, 0, 0, 0.75);
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

        .chat-box { background: rgba(0, 0, 0, 0.85); padding: 12px; border-radius: 12px; font-family: monospace; height: 320px; overflow-y: auto; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-size: 0.85rem; line-height: 1.5; }
        .error-box { background: rgba(15, 5, 5, 0.88); padding: 12px; border-radius: 12px; font-family: monospace; height: 220px; overflow-y: auto; color: #f87171; border: 1px solid rgba(244, 63, 94, 0.5); font-size: 0.85rem; line-height: 1.5; }
        .kiru-box { background: rgba(15, 23, 15, 0.88); padding: 12px; border-radius: 12px; font-family: monospace; height: 180px; overflow-y: auto; color: #facc15; border: 1px solid rgba(250, 204, 21, 0.5); font-size: 0.85rem; line-height: 1.5; }

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

        .btn-stop { background: linear-gradient(135deg, #b91c1c, #ef4444) !important; border: 1px solid #f87171 !important; box-shadow: 0 0 10px rgba(239, 68, 68, 0.3) !important; }
        .btn-start { background: linear-gradient(135deg, #15803d, #22c55e) !important; border: 1px solid #4ade80 !important; box-shadow: 0 0 10px rgba(34, 197, 94, 0.3) !important; }
        .btn-cyan { background: linear-gradient(135deg, #0369a1, #0ea5e9) !important; border: 1px solid #38bdf8 !important; box-shadow: 0 0 10px rgba(14, 165, 233, 0.3) !important; }
        .btn-warning { background: linear-gradient(135deg, #b45309, #f59e0b) !important; border: 1px solid #fbbf24 !important; box-shadow: 0 0 10px rgba(245, 158, 11, 0.3) !important; }
        .btn-purple { background: linear-gradient(135deg, #6b21a8, #a855f7) !important; border: 1px solid #c084fc !important; box-shadow: 0 0 10px rgba(168, 85, 247, 0.3) !important; }
        .btn-save { background: linear-gradient(135deg, #1d4ed8, #3b82f6) !important; border: 1px solid #60a5fa !important; width: 100%; margin-top: 10px; box-shadow: 0 0 12px rgba(59, 130, 246, 0.4) !important; }

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
        // TẬP HỢP CÁC API ANIME NỮ / WAIFU / 17+ CHẤT LƯỢNG CAO
        const ANIME_GIRL_APIS = [
          'https://api.waifu.im/search?included_tags=waifu',
          'https://api.waifu.im/search?included_tags=maid',
          'https://api.waifu.im/search?included_tags=oppai',
          'https://api.waifu.im/search?included_tags=uniform',
          'https://api.waifu.im/search?included_tags=marin-kitagawa',
          'https://api.waifu.im/search?included_tags=raiden-shogun',
          'https://api.waifu.pics/sfw/waifu',
          'https://api.waifu.pics/sfw/neko',
          'https://nekos.best/api/v2/waifu',
          'https://nekos.best/api/v2/neko'
        ];

        // KHO ẢNH DỰ PHÒNG CHUẨN ANIME NỮ ĐẸP
        const FALLBACK_WAIFUS = [
          'https://cdn.waifu.im/7438.jpg',
          'https://cdn.waifu.im/6226.jpg',
          'https://cdn.waifu.im/7140.jpg',
          'https://cdn.waifu.im/7290.jpg',
          'https://cdn.waifu.im/6831.jpg',
          'https://cdn.waifu.im/7580.jpg',
          'https://cdn.waifu.im/7418.jpg',
          'https://cdn.waifu.im/7212.jpg',
          'https://cdn.waifu.im/7211.jpg',
          'https://cdn.waifu.im/7001.jpg',
          'https://cdn.waifu.im/7155.jpg',
          'https://cdn.waifu.im/7320.jpg',
          'https://cdn.waifu.im/7610.jpg',
          'https://cdn.waifu.im/7780.jpg',
          'https://images6.alphacoders.com/133/1330919.png',
          'https://images3.alphacoders.com/132/1322891.jpeg',
          'https://images2.alphacoders.com/131/1312502.jpeg'
        ];

        // QUẢN LÝ BỘ NHỚ VÀ HÀNG ĐỢI (PRELOAD 2 - 3 TẤM)
        const QUEUE_TARGET_SIZE = 3;
        const imageQueue = []; 
        const seenUrls = new Set();
        let isQueueFilling = false;

        async function fetchUniqueAnimeGirlUrl() {
          for (let attempt = 0; attempt < 6; attempt++) {
            const api = ANIME_GIRL_APIS[Math.floor(Math.random() * ANIME_GIRL_APIS.length)];
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 2500);

              const sep = api.includes('?') ? '&' : '?';
              const randUrl = api + sep + '_r=' + Math.random().toString(36).substring(2, 8);

              const response = await fetch(randUrl, { signal: controller.signal });
              clearTimeout(timer);

              if (response.ok) {
                const data = await response.json();
                let url = '';
                if (data?.images?.[0]?.url) url = data.images[0].url;
                else if (data?.results?.[0]?.url) url = data.results[0].url;
                else if (data?.url) url = data.url;

                if (url && !seenUrls.has(url)) {
                  return url;
                }
              }
            } catch (e) {}
          }

          // Lấy từ kho dự phòng chưa xem
          for (const fbUrl of FALLBACK_WAIFUS) {
            if (!seenUrls.has(fbUrl)) return fbUrl;
          }

          // Nếu đã xem hết sạch thì làm mới danh sách xem
          seenUrls.clear();
          return FALLBACK_WAIFUS[Math.floor(Math.random() * FALLBACK_WAIFUS.length)];
        }

        function preloadSingleImage(url) {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.referrerPolicy = 'no-referrer';
            
            const timer = setTimeout(() => {
              img.src = '';
              reject(new Error('Preload Timeout'));
            }, 3000);

            img.onload = () => {
              clearTimeout(timer);
              resolve({ url, imgObj: img });
            };

            img.onerror = () => {
              clearTimeout(timer);
              reject(new Error('Preload Failed'));
            };

            img.src = url;
          });
        }

        async function fillImageCacheQueue() {
          if (isQueueFilling) return;
          isQueueFilling = true;

          while (imageQueue.length < QUEUE_TARGET_SIZE) {
            try {
              const urlCandidate = await fetchUniqueAnimeGirlUrl();
              if (urlCandidate && !seenUrls.has(urlCandidate)) {
                seenUrls.add(urlCandidate);
                const loadedData = await preloadSingleImage(urlCandidate);
                imageQueue.push(loadedData);
              }
            } catch (e) {
              await new Promise(r => setTimeout(r, 500));
            }
          }

          isQueueFilling = false;
        }

        function displayNextImage() {
          if (imageQueue.length === 0) {
            fillImageCacheQueue();
            return;
          }

          // RÚT VÀ XÓA ẢNH KHỎI HÀNG ĐỢI ĐỂ GIẢI PHÓNG RAM HỆ THỐNG
          const currentItem = imageQueue.shift();

          const bgMain = document.getElementById('bg-main-img');
          const bgBlur = document.getElementById('bg-blur-img');

          if (bgMain) bgMain.src = currentItem.url;
          if (bgBlur) bgBlur.src = currentItem.url;

          // HỦY THAM CHIẾU ĐỂ GARBAGE COLLECTOR DỌN SẠCH CPU/RAM
          if (currentItem.imgObj) {
            currentItem.imgObj.onload = null;
            currentItem.imgObj.onerror = null;
            currentItem.imgObj = null;
          }

          // TẢI BÙ VÀO HÀNG ĐỢI ĐỂ LUÔN DỰ TRỮ 2-3 TẤM BÊN DƯỚI
          fillImageCacheQueue();
        }

        function setCustomBgUrl() {
          const input = document.getElementById('custom-bg-input');
          if (input && input.value.trim() !== '') {
            const url = input.value.trim();
            const bgMain = document.getElementById('bg-main-img');
            const bgBlur = document.getElementById('bg-blur-img');
            if (bgMain) bgMain.src = url;
            if (bgBlur) bgBlur.src = url;
            closeModal('modal-custom-bg');
          }
        }

        function toggleDashboardUI() {
          document.body.classList.toggle('ui-hidden');
          const isHidden = document.body.classList.contains('ui-hidden');
          const fabBtn = document.getElementById('fab-ui-toggle');
          const headerBtn = document.getElementById('header-ui-toggle');
          const text = isHidden ? '📋 Hiện Bảng Control' : '👁️ Thu Gọn Bảng (Xem Ảnh)';

          if (fabBtn) fabBtn.innerHTML = text;
          if (headerBtn) headerBtn.innerHTML = text;

          try {
            localStorage.setItem('dashboard_ui_hidden', isHidden ? 'true' : 'false');
          } catch (e) {}
        }

        async function fetchRealtimeStatus() {
          const activeEl = document.activeElement;
          if (activeEl && activeEl.tagName === 'INPUT') return;

          try {
            const res = await fetch('/api/status');
            if (!res.ok) return;
            const data = await res.json();

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

        window.addEventListener('DOMContentLoaded', async () => {
          if (localStorage.getItem('dashboard_ui_hidden') === 'true') {
            toggleDashboardUI();
          }

          // Khởi tạo hàng đợi 3 tấm ảnh đầu tiên & hiển thị tấm đầu tiên
          await fillImageCacheQueue();
          displayNextImage();

          // THỜI GIAN ĐỔI ẢNH MỚI: DÚNG 20 GIÂY / 1 ẢNH (20000 ms)
          setInterval(displayNextImage, 20000);
          setInterval(fetchRealtimeStatus, 5000);
        });
      </script>
    </head>
    <body>
      <div id="bg-container">
        <img id="bg-blur-img" class="bg-img-blur" referrerpolicy="no-referrer" alt="background blur">
        <img id="bg-main-img" class="bg-img-main" referrerpolicy="no-referrer" alt="background main">
      </div>

      <div class="header">
        <h1>KIRU ĐẸP TRAI</h1>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <button type="button" class="btn-purple" onclick="openModal('modal-custom-bg')">🔗 Dán Link Ảnh</button>
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
                <span class="value"><code>${hostDisplay}</code></span>
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

            <div class="btn-group-responsive">
              <button type="button" class="btn-cyan" onclick="openModal('modal-chat')">💬 Cửa Sổ Chat Server</button>
              <button type="button" class="btn-warning" onclick="openModal('modal-errors')">⚠️ Cửa Sổ Nhật Ký Lỗi</button>
            </div>

            <div class="btn-group-responsive" style="margin-top: 10px;">
              ${isManualStopped 
                ? '<a href="/api/toggle-bot" style="text-decoration: none;"><button type="button" class="btn-start" style="width: 100%;">BẬT BOT</button></a>'
                : '<a href="/api/toggle-bot" style="text-decoration: none;"><button type="button" class="btn-stop" style="width: 100%;">TẮT BOT</button></a>'
              }
              <a href="/api/inventory" style="text-decoration: none;"><button type="button" class="btn-purple" style="width: 100%;">Túi Đồ [inv]</button></a>
              <a href="/api/tusat" style="text-decoration: none;"><button type="button" class="btn-stop" style="width: 100%;">Tự Sát (/tusat)</button></a>
              <a href="/api/clear-error-log" style="text-decoration: none;"><button type="button" class="btn-warning" style="width: 100%;">Xóa Lỗi</button></a>
              <a href="/api/clear-mention-log" style="text-decoration: none;"><button type="button" class="btn-warning" style="width: 100%;">Mention (${botMentionLogs.length})</button></a>
              <a href="/api/hard-restart" style="text-decoration: none;"><button type="button" class="btn-stop" style="width: 100%;">Reset App</button></a>
            </div>
          </div>

          <!-- Ô CÔNG CỤ TỰ ĐỘNG CHUYỂN DỔI -->
          <div class="card">
            <h3>Cấu Hình Ô Công Cụ Bot (Ô 1 ➔ Ô 9)</h3>
            <form action="/api/update-slots" method="POST">
              <div style="margin-bottom: 8px;">
                <label>Thời gian cầm mỗi ô trước khi đổi sang ô tiếp theo (giây):</label>
                <input type="number" min="1" name="holdTimeSec" value="${slotConfig.holdTimeSec}" required>
              </div>
              <label>Bật/Tắt các ô cần chuyển đổi cầm trên tay:</label>
              <div class="slot-grid">
                ${renderSlotGrid()}
              </div>
              <button type="submit" class="btn-save">Lưu Thiết Lập Ô Cầm</button>
            </form>
          </div>

          <!-- BẬT / TẮT TÍNH NĂNG AUTO -->
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

          <!-- FORM CẤU HÌNH -->
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
                <input type="text" name="host" value="${hostDisplay}" required autocomplete="off" placeholder="vangioinetwork.xyz hoặc ip:port">
              </div>
              <button type="submit" class="btn-save">Lưu Cấu Hình & Tái Kết Nối</button>
            </div>
          </form>

          <div class="card">
            <h3>Nhật Ký Nhắc Tên [${BOT_USERNAME}]</h3>
            <div class="kiru-box">
              ${renderMentionLogs()}
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <h3>Lịch Sử Ping</h3>
            <p style="word-break: break-all;"><code>${renderPingLogs()}</code></p>
          </div>
        </div>
      </div>

      <!-- MODAL CHAT SERVER -->
      <div id="modal-chat" class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3 style="margin: 0; color: var(--accent-cyan);">💬 Cửa Sổ Chat Server</h3>
            <button type="button" class="modal-close" onclick="closeModal('modal-chat')">&times;</button>
          </div>
          <div class="chat-box" style="flex: 1; height: 100%;">
            ${renderChatLogs()}
          </div>
          <form class="input-group" action="/api/command" method="POST" style="margin-top: 12px;">
            <input type="text" name="command" placeholder="Nhập lệnh hoặc chat..." autocomplete="off" required>
            <button type="submit">Gửi Ngay</button>
          </form>
        </div>
      </div>

      <!-- MODAL LỖI -->
      <div id="modal-errors" class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <h3 style="margin: 0; color: #f87171;">⚠️ Nhật Ký Lỗi Hệ Thống</h3>
            <button type="button" class="modal-close" onclick="closeModal('modal-errors')">&times;</button>
          </div>
          <div class="error-box" style="flex: 1; height: 100%;">
            ${renderErrorLogs()}
          </div>
          <div style="margin-top: 12px; text-align: right;">
            <button type="button" class="btn-cyan" onclick="closeModal('modal-errors')">Đóng Cửa Sổ</button>
          </div>
        </div>
      </div>

      <!-- MODAL DÁN LINK ẢNH TÙY CHỈNH -->
      <div id="modal-custom-bg" class="modal-overlay">
        <div class="modal-card" style="max-width: 500px;">
          <div class="modal-header">
            <h3 style="margin: 0; color: var(--accent-purple);">🖼️ Dán Link Ảnh Nền Tùy Chỉnh</h3>
            <button type="button" class="modal-close" onclick="closeModal('modal-custom-bg')">&times;</button>
          </div>
          <p style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 12px;">
            Nhập đường dẫn URL hình ảnh (JPG, PNG, GIF...) bạn muốn làm ảnh nền:
          </p>
          <input type="text" id="custom-bg-input" placeholder="https://example.com/anime-wallpaper.jpg" style="margin-bottom: 15px;">
          <div style="display: flex; gap: 10px; justify-content: flex-end;">
            <button type="button" class="btn-cyan" onclick="setCustomBgUrl()">Áp Dụng Ảnh</button>
            <button type="button" class="btn-stop" onclick="closeModal('modal-custom-bg')">Đóng</button>
          </div>
        </div>
      </div>

      <!-- NÚT NỔI FAB LUÔN HIỂN THỊ -->
      <div id="fab-container">
        <button id="fab-ui-toggle" type="button" class="fab-toggle" onclick="toggleDashboardUI()">
          👁️ Thu Gọn Bảng (Xem Ảnh)
        </button>
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => console.log('[HTTP SERVER] Running on port ' + port));

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

  if (!bot || !bot.entity || !bot._client || bot._client.state !== 'play' || isManualStopped) return;

  if (toggles.quylai) {
    quylaiInterval = setInterval(() => {
      if (toggles.quylai) safeChat('/quylay');
    }, 47000);
  }

  if (toggles.attackLeft) {
    attackLeftInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
        try { bot.swingArm('right'); } catch (e) {}
      }
    }, attackLeftIntervalMs);
  }

  if (toggles.attackRight) {
    attackRightInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped) {
        try { bot.activateItem(); } catch (e) {}
      }
    }, attackRightIntervalMs);
  }

  if (toggles.skill1 || toggles.skill2 || toggles.skill3) {
    skillLoopInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && !isManualStopped) {
        if (toggles.skill1) safeChat('/kinang_1');
        if (toggles.skill2) safeChat('/kinang_2');
        if (toggles.skill3) safeChat('/kinang_3');
      }
    }, 10000);
  }

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

  stopFeatureLoops();

  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }
  if (antiAfkTimeout) { clearTimeout(antiAfkTimeout); antiAfkTimeout = null; }

  const intervals = [ramGcInterval, posCheckInterval, watchdogInterval, pingInterval];
  intervals.forEach(i => i && clearInterval(i));

  const timeouts = [reconnectTimeout, loginTimer1, loginTimer2, respawnTimer, commandResponseTimer];
  timeouts.forEach(t => t && clearTimeout(t));

  if (bot) {
    try {
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

  console.log('[HỆ THỐNG] Kết nối đến ' + currentOptions.host + ':' + currentOptions.port + ' với tên [' + BOT_USERNAME + ']...');

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
          bot.chat('/l ' + BOT_PASSWORD);
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
          currentCoords = 'x: ' + pos.x.toFixed(1) + ', Y: ' + pos.y.toFixed(1) + ', Z: ' + pos.z.toFixed(1);
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

  bot.on('end', (reason) => {
    stopFeatureLoops();
    addErrorLog('Mất Kết Nối (End)', 'Server ngắt socket: ' + reason);
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

  if (consecutiveFailures >= 10) {
    addErrorLog('CẢNH BÁO NẶNG', 'Mất kết nối nhiều lần. Tạm dừng 30s trước khi thử lại...');
    reconnectTimeout = setTimeout(() => {
      isReconnecting = false;
      consecutiveFailures = 0;
      createBot();
    }, 30000);
    return;
  }

  console.log('Chờ ' + (currentReconnectDelay / 1000) + 's để tái kết nối...');
  
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    currentReconnectDelay = 12000;
    createBot();
  }, currentReconnectDelay);
}

createBot();

setInterval(() => {
  const heapUsed = process.memoryUsage().heapUsed / 1024 / 1024;
  if (heapUsed > 350) {
    console.log('[CẢNH BÁO RAM] RAM sử dụng ' + heapUsed.toFixed(1) + 'MB. Đang giải phóng bộ nhớ Bot...');
    cleanupBot();
    setTimeout(() => {
      if (!isManualStopped) createBot();
    }, 3000);
  } else if (heapUsed > 200 && global.gc) {
    try { global.gc(); } catch (e) {}
  }
}, 20000);

process.on('uncaughtException', (err) => {
  addErrorLog('Uncaught Exception', err.message + ' (' + (err.code || 'NO_CODE') + ')');
  try { handleReconnect(); } catch(e) {}
});

process.on('unhandledRejection', (reason) => {
  addErrorLog('Unhandled Rejection', String(reason));
});