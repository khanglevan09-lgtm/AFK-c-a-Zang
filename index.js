const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

// Middleware đọc dữ liệu JSON và URL-encoded
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ÉP MÚI GIỜ VIỆT NAM TOÀN HỆ THỐNG
process.env.TZ = 'Asia/Ho_Chi_Minh';

// --- CẤU HÌNH DỘNG (CÓ THỂ THAY ĐỔI TỪ WEB DASHBOARD) ---
let BOT_USERNAME = process.env.BOT_USERNAME || 'Kiru Đẹp Trai';
let BOT_PASSWORD = process.env.BOT_PASSWORD || 'YourPasswordHere';
let BOT_HOST = process.env.BOT_HOST || 'mc.example.com';
let BOT_PORT = parseInt(process.env.BOT_PORT) || 25565;

// =========================================================================
// === CẤU HÌNH KEY PHÂN QUYỀN TỪNG TÍNH NĂNG VÀ SỐ LƯỢT IP ================
// =========================================================================

const KEY_DATABASE = {
  PREMIUM: [
    { key: "KEY_FULL_VIP_999", maxUses: 1, usedIps: [] },
    { key: "KEY_FULL_VIP_888", maxUses: 5, usedIps: [] }
  ],
  THIEN: [
    { key: "KEY_THIEN_01", maxUses: 2, usedIps: [] }
  ],
  QUY_LAI: [
    { key: "KEY_QUYLAI_01", maxUses: 2, usedIps: [] },
    { key: "KEY_QUYLAI_VIP", maxUses: 5, usedIps: [] }
  ],
  CLICK_MOUSE: [
    { key: "KEY_CLICK_01", maxUses: 1, usedIps: [] }
  ],
  QUANG_HAO: [
    { key: "KEY_QUANGHAO_01", maxUses: 1, usedIps: [] }
  ],
  DINH_THAN: [
    { key: "KEY_DINHTHAN_01", maxUses: 1, usedIps: [] }
  ],
  AFK_MODE: [
    { key: "KEY_AFK_01", maxUses: 1, usedIps: [] }
  ],
  TUI_DO: [
    { key: "KEY_TUIDO_01", maxUses: 1, usedIps: [] }
  ],
  SKILL_1: [ { key: "KEY_SKILL1_01", maxUses: 1, usedIps: [] } ],
  SKILL_2: [ { key: "KEY_SKILL2_01", maxUses: 1, usedIps: [] } ],
  SKILL_3: [ { key: "KEY_SKILL3_01", maxUses: 1, usedIps: [] } ],
  CHAT_UNLIMITED: [
    { key: "KEY_CHAT_VIP_01", maxUses: 1, usedIps: [] }
  ]
};

const ipPermissions = {};

// Lấy thông tin IP đã kích hoạt
function getClientIp(req) {
  try {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress || req.ip || '127.0.0.1';
  } catch (e) {
    return '127.0.0.1';
  }
}

function getIpData(userIp) {
  if (!ipPermissions[userIp]) {
    ipPermissions[userIp] = {
      features: {},
      chatCount: 0,
      chatUnlimited: false,
      activatedKeys: []
    };
  }
  return ipPermissions[userIp];
}

function activateKeyForIp(userIp, inputKey) {
  const ipData = getIpData(userIp);
  let foundCategory = null;
  let keyObj = null;

  for (const [catName, list] of Object.entries(KEY_DATABASE)) {
    const match = list.find(k => k.key === inputKey);
    if (match) {
      foundCategory = catName;
      keyObj = match;
      break;
    }
  }

  if (!keyObj) {
    if (inputKey.startsWith('KEY_VIP_') || inputKey.startsWith('VIP_')) {
      ipData.activatedKeys.push(inputKey);
      Object.keys(KEY_DATABASE).forEach(cat => {
        ipData.features[cat.toLowerCase()] = true;
      });
      ipData.chatUnlimited = true;
      return {
        success: true,
        message: `Kích hoạt thành công Key Đặc Biệt [${inputKey}] cho IP ${userIp}!`
      };
    }
    return { success: false, message: `Key [${inputKey}] không hợp lệ hoặc không tồn tại!` };
  }

  const alreadyUsedByThisIp = keyObj.usedIps.includes(userIp);

  if (!alreadyUsedByThisIp && keyObj.usedIps.length >= keyObj.maxUses) {
    return { 
      success: false, 
      message: `Key [${inputKey}] đã HẾT SỐ LƯỢT kích hoạt trên các IP khác (${keyObj.usedIps.length}/${keyObj.maxUses} IP)!` 
    };
  }

  if (!alreadyUsedByThisIp) {
    keyObj.usedIps.push(userIp);
  }

  if (!ipData.activatedKeys.includes(inputKey)) {
    ipData.activatedKeys.push(inputKey);
  }

  if (foundCategory === 'PREMIUM') {
    Object.keys(KEY_DATABASE).forEach(cat => {
      ipData.features[cat.toLowerCase()] = true;
    });
    ipData.chatUnlimited = true;
  } else if (foundCategory === 'CHAT_UNLIMITED') {
    ipData.chatUnlimited = true;
  } else {
    ipData.features[foundCategory.toLowerCase()] = true;
  }

  const remaining = keyObj.maxUses - keyObj.usedIps.length;
  return {
    success: true,
    message: `Kích hoạt thành công gói [${foundCategory}]! Key còn kích hoạt được cho ${remaining} IP khác.`
  };
}

// CÁC BIẾN TRẠNG THÁI NÚT BẤM
let toggleAfk = false;
let toggleThien = false;
let toggleQuyLai = false;
let toggleDinhThan = false;
let toggleQuangHao = false;
let toggleLeftClick = false;
let toggleRightClick = false;

let clickSpeed = 0.5;

let toggleSkill1 = false;
let toggleSkill2 = false;
let toggleSkill3 = false;

// TIMERS LẶP
let quyLaiInterval = null;
let leftClickInterval = null;
let rightClickInterval = null;
let skillInterval = null;

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
  if (serverChatLogs.length > 100) serverChatLogs.pop();
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

function executeToggledCommands() {
  if (!bot || !bot._client) return;

  if (toggleAfk) bot.chat('/afkmode vao');
  if (toggleThien) bot.chat('/thien');
  if (toggleDinhThan) bot.chat('/dinhthan');
  if (toggleQuangHao) bot.chat('/quanghao');

  startQuyLaiLoop();
  startClickLoop();
  startSkillLoop();
}

function startQuyLaiLoop() {
  if (quyLaiInterval) clearInterval(quyLaiInterval);
  if (toggleQuyLai && bot && bot._client) {
    bot.chat('/quylai');
    quyLaiInterval = setInterval(() => {
      if (toggleQuyLai && bot && bot._client) {
        bot.chat('/quylai');
      }
    }, 47000);
  }
}

function startClickLoop() {
  if (leftClickInterval) clearInterval(leftClickInterval);
  if (rightClickInterval) clearInterval(rightClickInterval);

  const delay = Math.max(100, Math.floor(clickSpeed * 1000));

  if (toggleLeftClick) {
    leftClickInterval = setInterval(() => {
      if (toggleLeftClick && bot && bot._client) {
        try { bot.swingArm('right'); } catch (e) {}
      }
    }, delay);
  }

  if (toggleRightClick) {
    rightClickInterval = setInterval(() => {
      if (toggleRightClick && bot && bot._client) {
        try { bot.activateItem(); } catch (e) {}
      }
    }, delay);
  }
}

function startSkillLoop() {
  if (skillInterval) clearInterval(skillInterval);
  if (toggleSkill1 || toggleSkill2 || toggleSkill3) {
    skillInterval = setInterval(() => {
      if (!bot || !bot._client) return;
      if (toggleSkill1) bot.chat('kinang_1');
      if (toggleSkill2) bot.chat('kinang_2');
      if (toggleSkill3) bot.chat('kinang_3');
    }, 10000);
  }
}

app.get('/api/ping', (req, res) => res.send('PONG_OK'));

// ENDPOINT KÍCH HOẠT KEY TỪ WEB (TRẢ VỀ JSON)
app.post('/api/activate-key', (req, res) => {
  try {
    const userIp = getClientIp(req);
    const inputKey = (req.body.key || '').trim();

    if (!inputKey) {
      return res.json({ success: false, message: 'Vui lòng nhập Key kích hoạt!' });
    }

    const result = activateKeyForIp(userIp, inputKey);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + err.message });
  }
});

app.get('/api/activate-key', (req, res) => res.redirect('/'));

// ENDPOINT BẬT/TẮT TÍNH NĂNG TỪ BẢNG ĐIỀU KHIỂN (JSON)
app.post('/api/toggle-feature', (req, res) => {
  try {
    const userIp = getClientIp(req);
    const ipData = getIpData(userIp);
    const { feature, speed } = req.body;

    const featureMap = {
      'afk': 'afk_mode',
      'thien': 'thien',
      'quylai': 'quy_lai',
      'dinhthan': 'dinh_than',
      'quanghao': 'quang_hao',
      'inventory': 'tui_do',
      'leftclick': 'click_mouse',
      'rightclick': 'click_mouse',
      'skill1': 'skill_1',
      'skill2': 'skill_2',
      'skill3': 'skill_3'
    };

    const reqGroup = featureMap[feature];

    if (reqGroup && !ipData.features[reqGroup] && !ipData.features['premium']) {
      return res.json({
        success: false,
        message: `Tính năng [${feature.toUpperCase()}] đang bị KHÓA! Vui lòng nhập Key kích hoạt.`
      });
    }

    if (speed !== undefined) {
      let parsedSpeed = parseFloat(speed);
      if (!isNaN(parsedSpeed)) {
        clickSpeed = Math.max(0.1, parsedSpeed);
        startClickLoop();
        return res.json({
          success: true,
          message: `Đã lưu tốc độ Auto Click mới: ${clickSpeed} giây/lần!`
        });
      }
    }

    let newStateStr = '';

    if (feature === 'afk') { 
      toggleAfk = !toggleAfk; 
      newStateStr = toggleAfk ? 'BẬT' : 'TẮT';
      if (toggleAfk && bot && bot._client) bot.chat('/afkmode vao'); 
    }
    else if (feature === 'thien') { 
      toggleThien = !toggleThien; 
      newStateStr = toggleThien ? 'BẬT' : 'TẮT';
      if (toggleThien && bot && bot._client) bot.chat('/thien'); 
    }
    else if (feature === 'quylai') { 
      toggleQuyLai = !toggleQuyLai; 
      newStateStr = toggleQuyLai ? 'BẬT' : 'TẮT';
      startQuyLaiLoop(); 
    }
    else if (feature === 'dinhthan') { 
      toggleDinhThan = !toggleDinhThan; 
      newStateStr = toggleDinhThan ? 'BẬT' : 'TẮT';
      if (toggleDinhThan && bot && bot._client) bot.chat('/dinhthan'); 
    }
    else if (feature === 'quanghao') { 
      toggleQuangHao = !toggleQuangHao; 
      newStateStr = toggleQuangHao ? 'BẬT' : 'TẮT';
      if (toggleQuangHao && bot && bot._client) bot.chat('/quanghao'); 
    }
    else if (feature === 'inventory') { 
      if (bot && bot._client) bot.chat('[inv]'); 
      return res.json({ success: true, message: 'Đã gửi lệnh mở Túi Đồ [inv] vào Game!' });
    }
    else if (feature === 'leftclick') { 
      toggleLeftClick = !toggleLeftClick; 
      newStateStr = toggleLeftClick ? 'BẬT' : 'TẮT';
      startClickLoop(); 
    }
    else if (feature === 'rightclick') { 
      toggleRightClick = !toggleRightClick; 
      newStateStr = toggleRightClick ? 'BẬT' : 'TẮT';
      startClickLoop(); 
    }
    else if (feature === 'skill1') { 
      toggleSkill1 = !toggleSkill1; 
      newStateStr = toggleSkill1 ? 'BẬT' : 'TẮT';
      startSkillLoop(); 
    }
    else if (feature === 'skill2') { 
      toggleSkill2 = !toggleSkill2; 
      newStateStr = toggleSkill2 ? 'BẬT' : 'TẮT';
      startSkillLoop(); 
    }
    else if (feature === 'skill3') { 
      toggleSkill3 = !toggleSkill3; 
      newStateStr = toggleSkill3 ? 'BẬT' : 'TẮT';
      startSkillLoop(); 
    }

    return res.json({
      success: true,
      message: `Đã ${newStateStr} tính năng [${feature.toUpperCase()}] thành công!`,
      newState: newStateStr
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi Server: ' + error.message });
  }
});

app.get('/api/toggle-feature', (req, res) => res.redirect('/'));

app.post('/api/command', (req, res) => {
  try {
    const userIp = getClientIp(req);
    const ipData = getIpData(userIp);

    if (!ipData.chatUnlimited && !ipData.features['premium']) {
      if (ipData.chatCount >= 5) {
        return res.json({
          success: false,
          message: 'IP của bạn đã dùng hết 5 lượt Chat thử! Vui lòng nhập Key Chat Vô Hạn.'
        });
      }
      ipData.chatCount++;
    }

    if (isManualStopped) {
      return res.json({ success: false, message: 'Bot đang ở trạng thái TẮT thủ công!' });
    }
    
    const cmd = (req.body.command || '').trim();
    if (!bot || !bot._client) {
      return res.json({ success: false, message: 'Bot đang ngoại tuyến! Không thể gửi lệnh.' });
    }

    if (cmd) {
      bot.chat(cmd);
      addChatLog(`[WEB-ADMIN]: ${cmd}`);
      triggerChatWindow(8000);
      return res.json({ success: true, message: `Đã gửi lệnh: "${cmd}"` });
    }
    return res.json({ success: false, message: 'Lệnh chat không được để trống!' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Lỗi gửi lệnh: ' + e.message });
  }
});

app.get('/api/command', (req, res) => res.redirect('/'));

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
  const userIp = getClientIp(req);
  const ipData = getIpData(userIp);

  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  let statusBadge = 'OFFLINE';
  if (isManualStopped) {
    statusBadge = 'ĐÃ TẮT THỦ CÔNG (NHƯỜNG NICK)';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = 'ONLINE';
  } else {
    statusBadge = `<span class="badge-off">RECONNECTING (${Math.round(currentReconnectDelay / 1000)}s)</span>`;
  }

  const isCatUnlocked = (catName) => ipData.features[catName] || ipData.features['premium'];

  res.send(`
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kiru Minecraft Bot - Full Version</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --card-bg: rgba(10, 14, 26, 0.88);
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
      background: rgba(4, 6, 14, 0.72);
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

    .log-console {
      background: #11111b;
      border: 1px solid #313244;
      border-radius: 12px;
      padding: 12px;
      margin-top: 12px;
      font-family: 'Consolas', 'Courier New', monospace;
    }

    .log-console-title {
      font-weight: bold;
      color: #f5e0dc;
      border-bottom: 1px solid #313244;
      padding-bottom: 6px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
    }

    .log-console-box {
      max-height: 140px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.82rem;
    }

    .chat-box { background: rgba(0, 0, 0, 0.6); padding: 12px; border-radius: 12px; font-family: monospace; height: 350px; overflow-y: auto; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); font-size: 0.85rem; }
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
    
    .btn-toggle-on { background: linear-gradient(135deg, #16a34a, #15803d) !important; width: 100%; }
    .btn-toggle-off { background: rgba(255, 255, 255, 0.1) !important; color: #94a3b8 !important; border: 1px solid rgba(255,255,255,0.2) !important; width: 100%; }
    .btn-locked { background: rgba(50, 50, 50, 0.4) !important; color: #64748b !important; border: 1px dashed #475569 !important; width: 100%; cursor: not-allowed; }

    .btn-stop { background: linear-gradient(135deg, #dc2626, #991b1b) !important; }
    .btn-start { background: linear-gradient(135deg, #16a34a, #15803d) !important; }
    .btn-warning { background: linear-gradient(135deg, #d97706, #b45309) !important; }
    .btn-save { background: linear-gradient(135deg, #0284c7, #0369a1) !important; width: 100%; margin-top: 10px; }
    .btn-eye { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: var(--accent-cyan); cursor: pointer; font-size: 0.85rem; font-weight: bold; padding: 4px 8px; }
    label { font-size: 0.8rem; color: #94a3b8; display: block; margin-bottom: 4px; }

    .btn-group-responsive {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-top: 15px;
    }

    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin-top: 10px;
    }

    @media (max-width: 1024px) { .container { grid-template-columns: 1fr; } }
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
    function addLog(message, isSuccess = true) {
      const logBox = document.getElementById('log-box');
      if (!logBox) return;
      const now = new Date();
      const timeStr = now.toLocaleTimeString('vi-VN');
      
      const logItem = document.createElement('div');
      const color = isSuccess ? '#a6e3a1' : '#f38ba8';
      const icon = isSuccess ? '✅' : '❌';

      logItem.innerHTML = `<span style="color: #6c7086;">[\${timeStr}]</span> \${icon} <span style="color: \${color};">\${message}</span>`;
      
      logBox.appendChild(logItem);
      logBox.scrollTop = logBox.scrollHeight;
    }

    async function activateKeyDirect(keyOverride) {
      const keyInput = document.getElementById('key-input-val');
      const keyVal = keyOverride || (keyInput ? keyInput.value.trim() : '');

      if (!keyVal) {
        addLog("Vui lòng nhập Key kích hoạt trước khi bấm Kích Hoạt!", false);
        return;
      }

      try {
        const res = await fetch('/api/activate-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: keyVal })
        });
        const data = await res.json();

        if (data.success) {
          addLog(data.message, true);
          localStorage.setItem('saved_bot_key', keyVal);
          if (keyInput) keyInput.value = '';
          setTimeout(() => { location.reload(); }, 1000);
        } else {
          addLog(data.message, false);
          if (keyOverride) {
            localStorage.removeItem('saved_bot_key');
          }
        }
      } catch (err) {
        addLog("Lỗi kết nối tới Server!", false);
      }
    }

    async function autoRestoreKey() {
      const savedKey = localStorage.getItem('saved_bot_key');
      const hasActivatedKeys = ${ipData.activatedKeys.length > 0 ? 'true' : 'false'};

      if (savedKey && !hasActivatedKeys) {
        addLog('[Hệ thống] Đang tự động khôi phục bản quyền từ thiết bị...', true);
        await activateKeyDirect(savedKey);
      }
    }

    async function toggleFeatureDirect(featureName) {
      try {
        const res = await fetch('/api/toggle-feature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature: featureName })
        });
        const data = await res.json();

        if (data.success) {
          addLog(data.message, true);
          setTimeout(() => { location.reload(); }, 450);
        } else {
          addLog(data.message, false);
        }
      } catch (err) {
        addLog("Không thể gửi lệnh bật/tắt tới Server!", false);
      }
    }

    async function saveSpeedDirect() {
      const speedInput = document.getElementById('speed-input-val');
      if (!speedInput) return;
      const speed = speedInput.value;

      try {
        const res = await fetch('/api/toggle-feature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ feature: 'leftclick', speed: speed })
        });
        const data = await res.json();
        addLog(data.message, data.success);
      } catch (err) {
        addLog("Lỗi lưu tốc độ Auto Click!", false);
      }
    }

    async function sendCommandDirect(event) {
      if (event) event.preventDefault();
      const cmdInput = document.getElementById('cmd-input');
      if (!cmdInput) return;
      const cmd = cmdInput.value.trim();

      if (!cmd) {
        addLog("Vui lòng nhập nội dung tin nhắn chat!", false);
        return;
      }

      try {
        const res = await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: cmd })
        });
        const data = await res.json();

        if (data.success) {
          addLog(data.message, true);
          cmdInput.value = '';
        } else {
          addLog(data.message, false);
        }
      } catch (err) {
        addLog("Lỗi gửi lệnh chat!", false);
      }
    }

    setInterval(() => { 
      const activeEl = document.activeElement;
      if (!activeEl || activeEl.tagName !== 'INPUT') { location.reload(); }
    }, 8000);

    async function rotateAnimeBg() {
      try {
        const res = await fetch('https://api.waifu.pics/sfw/waifu');
        const data = await res.json();
        if (data && data.url) {
          const img = new Image();
          img.src = data.url;
          img.onload = () => { document.body.style.backgroundImage = 'url("' + data.url + '")'; };
        }
      } catch (e) {}
    }
    
    function togglePasswordVisibility() {
      const pwdInput = document.getElementById('pwd-input');
      const eyeText = document.getElementById('eye-text');
      if (pwdInput.type === 'password') {
        pwdInput.type = 'text'; eyeText.textContent = 'Ẩn';
      } else {
        pwdInput.type = 'password'; eyeText.textContent = 'Hiện';
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      autoRestoreKey();
      rotateAnimeBg();
      setInterval(rotateAnimeBg, 60000);
    });
  </script>
</head>
<body>
  <div class="header">
    <h1>KIRU MINECRAFT BOT</h1>
    <div>${statusBadge}</div>
  </div>

  <div class="container">
    <div>
      <div class="card" style="border-color: var(--accent-yellow);">
        <h3>🔑 Kích Hoạt Key Từng Tính Năng</h3>
        
        <div class="input-group">
          <input type="text" id="key-input-val" placeholder="Nhập mã Key mua riêng..." autocomplete="off">
          <button type="button" class="btn-start" onclick="activateKeyDirect()">Kích Hoạt</button>
        </div>

        <div class="log-console">
          <div class="log-console-title">
            <span>📋 Nhật Ký Thông Báo Thao Tác</span>
            <span style="color: #6c7086; font-weight: normal; font-size: 0.75rem;">IP: ${userIp}</span>
          </div>
          <div class="log-console-box" id="log-box">
            <div style="color: #6c7086;">[Hệ thống] Trạng thái IP (${userIp}): ${ipData.activatedKeys.length > 0 ? '✅ ĐÃ MỞ KHÓA (' + ipData.activatedKeys.join(', ') + ')' : '🔒 CHƯA KÍCH HOẠT KEY'}</div>
          </div>
        </div>

        <div style="margin-top: 10px; font-size: 0.8rem; color: #94a3b8;">
          <b>Danh sách Key đã áp dụng:</b> ${ipData.activatedKeys.length > 0 ? ipData.activatedKeys.join(', ') : 'Chưa có'}
        </div>
      </div>

      <div class="card">
        <h3>Bảng Bật / Tắt Tính Năng</h3>

        <div class="feature-grid">
          <button type="button" onclick="toggleFeatureDirect('afk')" class="${!isCatUnlocked('afk_mode') ? 'btn-locked' : (toggleAfk ? 'btn-toggle-on' : 'btn-toggle-off')}">
            AFK Mode: ${!isCatUnlocked('afk_mode') ? '🔒 KHÓA' : (toggleAfk ? 'ON' : 'OFF')}
          </button>

          <button type="button" onclick="toggleFeatureDirect('thien')" class="${!isCatUnlocked('thien') ? 'btn-locked' : (toggleThien ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Thiền: ${!isCatUnlocked('thien') ? '🔒 KHÓA' : (toggleThien ? 'ON' : 'OFF')}
          </button>

          <button type="button" onclick="toggleFeatureDirect('quylai')" class="${!isCatUnlocked('quy_lai') ? 'btn-locked' : (toggleQuyLai ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Quỳ Lạy (47s): ${!isCatUnlocked('quy_lai') ? '🔒 KHÓA' : (toggleQuyLai ? 'ON' : 'OFF')}
          </button>

          <button type="button" onclick="toggleFeatureDirect('dinhthan')" class="${!isCatUnlocked('dinh_than') ? 'btn-locked' : (toggleDinhThan ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Định Thân: ${!isCatUnlocked('dinh_than') ? '🔒 KHÓA' : (toggleDinhThan ? 'ON' : 'OFF')}
          </button>

          <button type="button" onclick="toggleFeatureDirect('quanghao')" class="${!isCatUnlocked('quang_hao') ? 'btn-locked' : (toggleQuangHao ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Quang Hào: ${!isCatUnlocked('quang_hao') ? '🔒 KHÓA' : (toggleQuangHao ? 'ON' : 'OFF')}
          </button>

          <button type="button" onclick="toggleFeatureDirect('inventory')" class="${!isCatUnlocked('tui_do') ? 'btn-locked' : 'btn-warning'}">
            ${!isCatUnlocked('tui_do') ? '🔒 Túi Đồ' : 'Túi Đồ [inv]'}
          </button>
        </div>

        <h4 style="color: var(--accent-purple); margin-bottom: 5px; margin-top: 15px;">Auto Click Chuột</h4>
        <div style="margin-bottom: 10px;">
          <div style="display:flex; gap:10px; align-items: center;">
            <label style="margin:0; white-space:nowrap;">Tốc độ (s):</label>
            <input type="number" step="0.1" min="0.1" id="speed-input-val" value="${clickSpeed}" style="width: 80px;">
            <button type="button" class="btn-save" onclick="saveSpeedDirect()" style="margin:0; width:auto;">Lưu Tốc Độ</button>
          </div>
        </div>
        <div class="feature-grid">
          <button type="button" onclick="toggleFeatureDirect('leftclick')" class="${!isCatUnlocked('click_mouse') ? 'btn-locked' : (toggleLeftClick ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Đánh Trái: ${!isCatUnlocked('click_mouse') ? '🔒 KHÓA' : (toggleLeftClick ? 'ON' : 'OFF')}
          </button>
          <button type="button" onclick="toggleFeatureDirect('rightclick')" class="${!isCatUnlocked('click_mouse') ? 'btn-locked' : (toggleRightClick ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Đánh Phải: ${!isCatUnlocked('click_mouse') ? '🔒 KHÓA' : (toggleRightClick ? 'ON' : 'OFF')}
          </button>
        </div>

        <h4 style="color: var(--accent-purple); margin-bottom: 5px; margin-top: 15px;">Thiết Lập Skill (Lặp 10 giây/lần)</h4>
        <div class="feature-grid">
          <button type="button" onclick="toggleFeatureDirect('skill1')" class="${!isCatUnlocked('skill_1') ? 'btn-locked' : (toggleSkill1 ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Kỹ Năng 1: ${!isCatUnlocked('skill_1') ? '🔒 KHÓA' : (toggleSkill1 ? 'ON' : 'OFF')}
          </button>
          <button type="button" onclick="toggleFeatureDirect('skill2')" class="${!isCatUnlocked('skill_2') ? 'btn-locked' : (toggleSkill2 ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Kỹ Năng 2: ${!isCatUnlocked('skill_2') ? '🔒 KHÓA' : (toggleSkill2 ? 'ON' : 'OFF')}
          </button>
          <button type="button" onclick="toggleFeatureDirect('skill3')" class="${!isCatUnlocked('skill_3') ? 'btn-locked' : (toggleSkill3 ? 'btn-toggle-on' : 'btn-toggle-off')}">
            Kỹ Năng 3: ${!isCatUnlocked('skill_3') ? '🔒 KHÓA' : (toggleSkill3 ? 'ON' : 'OFF')}
          </button>
        </div>
      </div>

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
            <span class="label">Lượt Chat</span>
            <span class="value" style="color: var(--accent-yellow);">${ipData.chatUnlimited || isCatUnlocked('premium') ? 'VÔ HẠN' : (5 - ipData.chatCount) + ' LẦN'}</span>
          </div>
          <div class="status-item">
            <span class="label">RAM</span>
            <span class="value">${memoryUsage} MB</span>
          </div>
        </div>

        <form class="input-group" onsubmit="sendCommandDirect(event)">
          <input type="text" id="cmd-input" placeholder="Gửi lệnh chat..." autocomplete="off" required>
          <button type="submit">Gửi Chat</button>
        </form>

        <div class="btn-group-responsive">
          ${isManualStopped 
            ? `<a href="/api/toggle-bot" style="text-decoration: none;"><button type="button" class="btn-start" style="width: 100%;">BẬT BOT</button></a>`
            : `<a href="/api/toggle-bot" style="text-decoration: none;"><button type="button" class="btn-stop" style="width: 100%;">TẮT BOT</button></a>`
          }
          <a href="/api/clear-error-log" style="text-decoration: none;"><button type="button" class="btn-warning" style="width: 100%;">Xóa Lỗi</button></a>
          <a href="/api/clear-mention-log" style="text-decoration: none;"><button type="button" class="btn-warning" style="width: 100%;">Mention (${botMentionLogs.length})</button></a>
          <a href="/api/hard-restart" style="text-decoration: none;"><button type="button" class="btn-stop" style="width: 100%;">Reset App</button></a>
        </div>
      </div>

      <form action="/api/update-config" method="POST">
        <div class="card">
          <h3>Đăng Nhập Bot</h3>
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
          <h3>IP Server Minecraft</h3>
          <div>
            <label>Địa chỉ IP Server:</label>
            <input type="text" name="host" value="${BOT_HOST}${BOT_PORT && BOT_PORT !== 25565 ? ':' + BOT_PORT : ''}" required autocomplete="off" placeholder="mc.example.com hoặc ip:port">
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

      <div class="card">
        <h3>Chat Server (Tự động 100%)</h3>
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

function cleanupBot() {
  isAutoActionRunning = false;
  currentCoords = 'Đang xác định...';
  currentPing = 0;

  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }
  if (antiAfkTimeout) { clearTimeout(antiAfkTimeout); antiAfkTimeout = null; }

  if (quyLaiInterval) { clearInterval(quyLaiInterval); quyLaiInterval = null; }
  if (leftClickInterval) { clearInterval(leftClickInterval); leftClickInterval = null; }
  if (rightClickInterval) { clearInterval(rightClickInterval); rightClickInterval = null; }
  if (skillInterval) { clearInterval(skillInterval); skillInterval = null; }

  const intervals = [ramGcInterval, posCheckInterval, watchdogInterval, pingInterval];
  intervals.forEach(i => i && clearInterval(i));

  const timeouts = [reconnectTimeout, loginTimer1, loginTimer2, respawnTimer, commandResponseTimer];
  timeouts.forEach(t => t && clearTimeout(t));

  if (bot) {
    try {
      bot.clearControlStates();
      bot.removeAllListeners();
      if (bot._client) {
        bot._client.removeAllListeners();
        if (bot._client.socket) {
          bot._client.socket.removeAllListeners();
          bot._client.socket.destroy();
        }
        bot._client.end();
      }
      bot.quit();
    } catch (e) {}
    bot = null;
  }

  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }
}

function scheduleNextAction() {
  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }

  if (isManualStopped || !bot || !bot._client || bot._client.socket.destroyed) {
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
        if (bot && bot._client && !isManualStopped) {
          executeToggledCommands(); 
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
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
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
        if (bot && bot._client && !isManualStopped) {
          executeToggledCommands(); 
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

      addChatLog(text);
      console.log('[CHAT]: ' + text);
    } catch (e) {}
  });

  bot.on('end', (reason) => {
    addErrorLog('Mất Kết Nối (End)', `Server ngắt socket: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    addErrorLog('Mineflayer Error', err.message || err.toString());
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    addErrorLog('Bị Server Kick', reasonStr);

    if (reasonStr.includes('LƯU DỮ LIỆU') || reasonStr.includes('lưu dữ liệu')) {
      currentReconnectDelay = 15000;
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
    addErrorLog('CẢNH BÁO NẶNG', 'Mất kết nối nhiều lần. Khởi động lại App...');
    setTimeout(() => {
      process.exit(1);
    }, 3000);
    return;
  }

  console.log(`Chờ ${currentReconnectDelay / 1000}s để tái kết nối...`);

  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, currentReconnectDelay);
}

createBot();

process.on('uncaughtException', (err) => {
  addErrorLog('Uncaught Exception', `${err.message} (${err.code || 'NO_CODE'})`);
  handleReconnect();
});

process.on('unhandledRejection', (reason) => {
  addErrorLog('Unhandled Rejection', String(reason));
});