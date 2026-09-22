const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- CẤU HÌNH BOT TỐI ƯU SIÊU NHẸ ---
const OPTIONS = {
  host: 'vangioinetwork.xyz',
  port: 19000,
  username: 'Kiru',
  // version: '1.20.1', // Điền phiên bản cụ thể của server nếu biết để bỏ qua bước Ping dò phiên bản
  hideErrors: true,
  checkTimeoutInterval: 60 * 1000,
  keepAlive: true,
  physicsEnabled: true,
  viewDistance: 'tiny'
};

// --- QUẢN LÝ TRẠNG THÁI ---
let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isFirstSpawn = true;
let reconnectDelay = 10000;

// Web Admin & Chat
let isAwaitingResponse = false;
let commandResponseTimer = null;

// Timers
let actionTimeout = null;
let antiAfkInterval = null;
let ramGcInterval = null;
let posCheckInterval = null;
let watchdogInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let respawnTimer = null;

// Realtime Stats
let isAutoActionRunning = false;
let lastActionTime = Date.now();
let currentCoords = 'Đang xác định...';
let collectedCount = 0;
const serverChatLogs = [];
const startTime = Date.now();

let lastTimeAge = 0;
let lastTimeAgeUpdate = Date.now();

function addChatLog(msg) {
  serverChatLogs.unshift(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
  if (serverChatLogs.length > 20) serverChatLogs.pop();
}

function triggerChatWindow(durationMs = 8000) {
  isAwaitingResponse = true;
  if (commandResponseTimer) clearTimeout(commandResponseTimer);
  commandResponseTimer = setTimeout(() => {
    isAwaitingResponse = false;
  }, durationMs);
}

// Ping Route giữ Web Service sống
app.get('/api/ping', (req, res) => res.send('PONG'));

// --- API WEB DASHBOARD ---
app.post('/api/command', (req, res) => {
  const cmd = req.body.command;
  if (!bot || !bot._client) return res.send('Bot đang ngoại tuyến!');
  if (cmd) {
    bot.chat(cmd);
    addChatLog(`[WEB-ADMIN]: ${cmd}`);
    triggerChatWindow(8000);
  }
  res.redirect('/');
});

app.get('/api/restart', (req, res) => {
  addChatLog('🔄 [WEB-ADMIN]: Yêu cầu khởi động lại bot...');
  console.log('[HỆ THỐNG] Khởi động lại thủ công...');
  reconnectDelay = 5000;
  isReconnecting = false; 
  handleReconnect();
  res.redirect('/');
});

// --- GIAO DIỆN DASHBOARD ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Minecraft Ultra-Stable AFK Bot</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; margin: 0; }
        .card { background: #1e293b; padding: 15px; margin-bottom: 15px; border-radius: 10px; border: 1px solid #334155; }
        h2 { margin-top: 0; color: #38bdf8; }
        .badge-on { background: #22c55e; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .badge-off { background: #ef4444; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .chat-box { background: #090d16; padding: 10px; border-radius: 5px; font-family: monospace; height: 220px; overflow-y: auto; color: #e2e8f0; }
        .input-group { display: flex; gap: 10px; margin-top: 10px; }
        input[type="text"] { flex: 1; padding: 10px; border-radius: 5px; border: 1px solid #475569; background: #0f172a; color: white; }
        button { padding: 10px 20px; background: #3b82f6; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        button:hover { background: #2563eb; }
        .btn-danger { background: #ef4444; width: 100%; margin-top: 10px; }
        .btn-danger:hover { background: #dc2626; }
      </style>
      <script>
        setInterval(() => { 
          const input = document.getElementById('cmd-input');
          if (!input || document.activeElement !== input) { location.reload(); }
        }, 5000);
      </script>
    </head>
    <body>
      <h2>🤖 Minecraft Ultra-Stable AFK Bot Dashboard</h2>
      <div class="card">
        <h3>📌 Trạng Thái Bot</h3>
        <p>🟢 <b>Kết nối Server:</b> ${bot ? '<span class="badge-on">STABLE ONLINE</span>' : '<span class="badge-off">RECONNECTING</span>'}</p>
        <p>🛡️ <b>Chống Anti-Cheat Rate Limit:</b> <span class="badge-on">KÍCH HOẠT (2.5s - 3.5s/action)</span></p>
        <p>📍 <b>Tọa độ:</b> <code>${currentCoords}</code></p>
        <p>🗡️ <b>Đồ trên tay:</b> <code>${currentWeapon}</code></p>
        <p>📦 <b>Đã nhặt đồ:</b> ${collectedCount} lần</p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM Tối Ưu:</b> ${memoryUsage} MB / 512 MB</p>
      </div>

      <div class="card">
        <h3>⚙️ Bảng Điều Khiển</h3>
        <form class="input-group" action="/api/command" method="POST">
          <input type="text" id="cmd-input" name="command" placeholder="Nhập lệnh hoặc chat..." autocomplete="off" required>
          <button type="submit">Gửi Lệnh</button>
        </form>
        <form action="/api/restart" method="GET" onsubmit="return confirm('Khởi động lại bot?');">
          <button type="submit" class="btn-danger">🔄 Reset Kết Nối Thủ Công</button>
        </form>
      </div>

      <div class="card">
        <h3>💬 Nhật Ký Server</h3>
        <div class="chat-box">
          ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => console.log(`[HTTP SERVER] Running on port ${port}`));

// --- HÀM DỌN DẸP TRUYỆT ĐỐI KHÔNG ĐỂ LẠI MẸO RÒ RỈ MEMORY ---
function cleanupBot() {
  isAutoActionRunning = false;
  currentCoords = 'Đang xác định...';

  // Hủy triệt để Action Loop để tránh nhân bản
  if (actionTimeout) {
    clearTimeout(actionTimeout);
    actionTimeout = null;
  }

  const intervals = [antiAfkInterval, ramGcInterval, posCheckInterval, watchdogInterval];
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
}

// --- VÒNG LẶP HÀNH ĐỘNG AN TOÀN (CHỐNG NHÂN BẢN PHÍM/CLICK) ---
function scheduleNextAction() {
  // BẢO VỆ 1: Hủy ngay Timeout cũ nếu có để ngăn việc nhân bản vòng lặp
  if (actionTimeout) {
    clearTimeout(actionTimeout);
    actionTimeout = null;
  }

  if (!bot || !bot._client || bot._client.socket.destroyed) {
    isAutoActionRunning = false;
    return;
  }

  isAutoActionRunning = true;
  lastActionTime = Date.now();

  const currentBot = bot; // Lưu reference tránh Race Condition khi Reconnect

  try {
    const target = currentBot.nearestEntity(e => 
      (e.type === 'mob' || e.type === 'hostile' || e.type === 'animal' || e.type === 'player') &&
      e.position && currentBot.entity && currentBot.entity.position &&
      e.id !== currentBot.entity.id &&
      e.position.distanceTo(currentBot.entity.position) <= 4.0
    );

    if (target) {
      currentBot.attack(target);
    } else {
      currentBot.swingArm('right');
    }

    try { currentBot.activateItem(); } catch (err) {}

    // BẢO VỆ 2: Khóa nhún Shift an toàn
    currentBot.setControlState('sneak', true);
    setTimeout(() => {
      if (bot === currentBot && bot.entity) {
        bot.setControlState('sneak', false);
      }
    }, 200);

  } catch (err) {}

  const safeDelay = Math.floor(2500 + Math.random() * 1000);
  actionTimeout = setTimeout(scheduleNextAction, safeDelay);
}

// --- CHỐNG KICK AFK BẰNG XOAY HƯỚNG NHẸ ---
function startAntiAfkRotations() {
  if (antiAfkInterval) clearInterval(antiAfkInterval);

  antiAfkInterval = setInterval(() => {
    if (!bot || !bot.entity) return;

    try {
      const randomYaw = (Math.random() - 0.5) * 0.4;
      const randomPitch = (Math.random() - 0.5) * 0.1;
      bot.look(bot.entity.yaw + randomYaw, bot.entity.pitch + randomPitch, true);
    } catch (e) {}
  }, 30 * 1000);
}

function createBot() {
  cleanupBot();
  isFirstSpawn = true;
  lastTimeAge = 0;
  lastTimeAgeUpdate = Date.now();

  console.log(`\n[HỆ THỐNG] Đang kết nối tối ưu đến ${OPTIONS.host}...`);

  try {
    bot = mineflayer.createBot(OPTIONS);
    bot.setMaxListeners(0);

    if (bot._client) {
      bot._client.setMaxListeners(0);
      bot._client.on('error', () => {});
    }
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] Reconnect sau ${reconnectDelay / 1000}s...`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot vào thành công!');
    addChatLog('✅ Kết nối ổn định thành công!');
    triggerChatWindow(12000);

    if (bot._client && bot._client.socket) {
      try {
        bot._client.socket.setNoDelay(true);
        bot._client.socket.setKeepAlive(true, 15000);
        bot._client.socket.on('error', () => {});
      } catch (e) {}
    }

    if (isFirstSpawn) {
      isFirstSpawn = false;

      loginTimer1 = setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/l Kiru2000@');
          triggerChatWindow(4000);
        }
      }, 3000);

      loginTimer2 = setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/afkmode vao');
          triggerChatWindow(6000);
          scheduleNextAction();
          startAntiAfkRotations();
        }
      }, 6000);

      ramGcInterval = setInterval(() => {
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }, 45 * 1000);

      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
        }
      }, 5 * 1000);

      watchdogInterval = setInterval(() => {
        if (!bot) return;

        if (!isAutoActionRunning || Date.now() - lastActionTime > 12000) {
          scheduleNextAction();
        }

        if (bot.time) {
          if (bot.time.age === lastTimeAge) {
            if (Date.now() - lastTimeAgeUpdate > 45000) {
              addChatLog('⚠️ Server ngắt packet. Tiến hành Reconnect...');
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
    addChatLog('💀 Bot chết! Hồi sinh sau 3s...');
    respawnTimer = setTimeout(() => {
      if (bot && bot._client) {
        try { bot.respawn(); } catch (e) {}
      }

      setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Hồi sinh xong -> /afkmode vao');
          triggerChatWindow(5000);
          scheduleNextAction();
          startAntiAfkRotations();
        }
      }, 4000);
    }, 3000);
  });

  bot.on('playerCollect', (collector) => {
    try {
      if (collector && bot.entity && collector.id === bot.entity.id) {
        collectedCount++;
      }
    } catch (e) {}
  });

  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (!text) return;

      const lowerText = text.toLowerCase();

      if (
        text.includes('█') || 
        lowerText.includes('hồi chiêu') || 
        lowerText.includes('ʜồi ᴄʜɪêᴜ') || 
        lowerText.includes('cooldown')
      ) {
        return;
      }

      const isRelevant = lowerText.includes('kiru') || lowerText.includes('bot') || lowerText.includes('login') || lowerText.includes('afk');

      if (isRelevant || isAwaitingResponse) {
        addChatLog(text);
        console.log('[CHAT]: ' + text);
      }
    } catch (e) {}
  });

  bot.on('end', (reason) => {
    addChatLog(`❌ Đóng kết nối (${reason}). Chờ ${reconnectDelay / 1000}s...`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    if (err.code !== 'ECONNRESET') {
      console.log('[MINEFLAYER ERROR]', err.message);
    }
  });

  bot.on('kicked', (reason) => {
    addChatLog(`⚠️ Bị Kick: ${reason}`);
    handleReconnect();
  });
}

function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  console.log(`⏳ Đang chờ ${reconnectDelay / 1000} giây để Reconnect...`);
  
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, reconnectDelay);
}

// KHỞI CHẠY BOT
createBot();

// BẮT BẢO VỆ CHỐNG CRASH HỆ THỐNG
const ignoreErrorKeywords = [
  'socketclosed', 'econnreset', 'etimedout', 'epipe', 'enotfound',
  'partialreaderror', 'packet_world_particles', 'read econnreset', 'write econnreset'
];

process.on('uncaughtException', (err) => {
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toUpperCase();

  if (ignoreErrorKeywords.some(k => msg.includes(k) || code === k.toUpperCase())) {
    return;
  }
  
  console.log('[CRASH PREVENTED]', err.message);
  handleReconnect();
});

process.on('unhandledRejection', () => {});
