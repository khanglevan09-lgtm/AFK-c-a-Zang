const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- CẤU HÌNH STEALTH (ẨN MÌNH MỐI NGUY ANTI-CHEAT) ---
const OPTIONS = {
  host: 'vangioinetwork.xyz',
  port: 19000,
  username: 'Kiru',
  hideErrors: true,
  checkTimeoutInterval: 45 * 1000,
  keepAlive: true,
  physicsEnabled: true,
  viewDistance: 'tiny'
};

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isFirstSpawn = true;
let reconnectDelay = 25000; // Nghỉ 25s để Server reset điểm Violation Level (VL)

// Web & Chat Admin
let isAwaitingResponse = false;
let commandResponseTimer = null;

// Timers
let actionTimeout = null;
let antiAfkTimeout = null;
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
  if (serverChatLogs.length > 25) serverChatLogs.pop();
}

function triggerChatWindow(durationMs = 8000) {
  isAwaitingResponse = true;
  if (commandResponseTimer) clearTimeout(commandResponseTimer);
  commandResponseTimer = setTimeout(() => {
    isAwaitingResponse = false;
  }, durationMs);
}

app.get('/api/ping', (req, res) => res.send('PONG_STEALTH_OK'));

// --- DASHBOARD API ---
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
  addChatLog('🔄 [WEB-ADMIN]: Yêu cầu tái kết nối...');
  reconnectDelay = 10000;
  isReconnecting = false; 
  handleReconnect();
  res.redirect('/');
});

app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Minecraft Stealth Persistence Bot</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0b0f19; color: #f8fafc; padding: 20px; margin: 0; }
        .card { background: #161e2e; padding: 15px; margin-bottom: 15px; border-radius: 10px; border: 1px solid #273549; }
        h2 { margin-top: 0; color: #38bdf8; }
        .badge-on { background: #22c55e; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .badge-off { background: #ef4444; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .chat-box { background: #060911; padding: 10px; border-radius: 5px; font-family: monospace; height: 240px; overflow-y: auto; color: #38bdf8; }
        .input-group { display: flex; gap: 10px; margin-top: 10px; }
        input[type="text"] { flex: 1; padding: 10px; border-radius: 5px; border: 1px solid #334155; background: #0b0f19; color: white; }
        button { padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        button:hover { background: #1d4ed8; }
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
      <h2>🛡️ Minecraft Stealth Persistence Bot (An Toàn Anti-Cheat)</h2>
      <div class="card">
        <h3>📌 Trạng Thái Bot</h3>
        <p>🟢 <b>Kết Nối:</b> ${bot ? '<span class="badge-on">ONLINE (Đang Stealth)</span>' : '<span class="badge-off">ĐANG NGHỈ XÓA VL (RECONNECTING...)</span>'}</p>
        <p>🛡️ <b>Chống Anti-Cheat Tích Điểm:</b> <span class="badge-on">KÍCH HOẠT (Human Rate Limit 4.5-7.5s)</span></p>
        <p>📍 <b>Tọa độ:</b> <code>${currentCoords}</code></p>
        <p>🗡️ <b>Trang bị:</b> <code>${currentWeapon}</code></p>
        <p>📦 <b>Đã nhặt:</b> ${collectedCount} item</p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM:</b> ${memoryUsage} MB</p>
      </div>

      <div class="card">
        <h3>⚙️ Lệnh Web Admin</h3>
        <form class="input-group" action="/api/command" method="POST">
          <input type="text" id="cmd-input" name="command" placeholder="Nhập lệnh..." autocomplete="off" required>
          <button type="submit">Gửi Lệnh</button>
        </form>
        <form action="/api/restart" method="GET" onsubmit="return confirm('Tái kết nối thủ công?');">
          <button type="submit" class="btn-danger">🔄 Khởi Động Lại Connection</button>
        </form>
      </div>

      <div class="card">
        <h3>💬 Chat Server</h3>
        <div class="chat-box">
          ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
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

  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }
  if (antiAfkTimeout) { clearTimeout(antiAfkTimeout); antiAfkTimeout = null; }

  const intervals = [ramGcInterval, posCheckInterval, watchdogInterval];
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

// --- THAO TÁC GIỐNG NGƯỜI THẬT (HUMAN-LIKE STEALTH ACTION) ---
function scheduleNextAction() {
  if (actionTimeout) { clearTimeout(actionTimeout); actionTimeout = null; }

  if (!bot || !bot._client || bot._client.socket.destroyed) {
    isAutoActionRunning = false;
    return;
  }

  isAutoActionRunning = true;
  lastActionTime = Date.now();
  const currentBot = bot;

  try {
    const target = currentBot.nearestEntity(e => 
      (e.type === 'mob' || e.type === 'hostile' || e.type === 'animal' || e.type === 'player') &&
      e.position && currentBot.entity && currentBot.entity.position &&
      e.id !== currentBot.entity.id &&
      e.position.distanceTo(currentBot.entity.position) <= 3.8
    );

    if (target) {
      currentBot.attack(target);
    } else {
      currentBot.swingArm('right');
    }

    // Nhún Shift đơn lẻ, giãn cách với nhịp đánh để không đè Packet
    if (Math.random() > 0.4) {
      setTimeout(() => {
        if (bot === currentBot && bot.entity) {
          bot.setControlState('sneak', true);
          setTimeout(() => {
            if (bot === currentBot && bot.entity) bot.setControlState('sneak', false);
          }, 250);
        }
      }, 400);
    }

  } catch (err) {}

  // Tần suất đánh tự nhiên từ 4.5s đến 7.5s (Tránh bị Anti-Cheat nghi ngờ là Auto-Clicker)
  const humanDelay = Math.floor(4500 + Math.random() * 3000);
  actionTimeout = setTimeout(scheduleNextAction, humanDelay);
}

// --- CHỐNG AFK BẰNG XOAY CAMERA NHẸ NHÀNG (MỖI 45-90 GIÂY) ---
function scheduleStealthRotation() {
  if (antiAfkTimeout) clearTimeout(antiAfkTimeout);

  const nextRotationDelay = Math.floor(45000 + Math.random() * 45000);

  antiAfkTimeout = setTimeout(() => {
    if (bot && bot.entity) {
      try {
        const deltaYaw = (Math.random() - 0.5) * 0.5;
        const deltaPitch = (Math.random() - 0.5) * 0.2;
        bot.look(bot.entity.yaw + deltaYaw, bot.entity.pitch + deltaPitch, false);
      } catch (e) {}
    }
    scheduleStealthRotation();
  }, nextRotationDelay);
}

function createBot() {
  cleanupBot();
  isFirstSpawn = true;
  lastTimeAge = 0;
  lastTimeAgeUpdate = Date.now();

  console.log(`\n[HỆ THỐNG] Kết nối Stealth tới ${OPTIONS.host}:${OPTIONS.port}...`);

  try {
    bot = mineflayer.createBot(OPTIONS);
    bot.setMaxListeners(0);

    if (bot._client) {
      bot._client.setMaxListeners(0);
      bot._client.on('error', () => {});
    }
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] Thử lại sau ${reconnectDelay / 1000}s...`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server!');
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
      }, 3500);

      loginTimer2 = setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/afkmode vao');
          triggerChatWindow(6000);
          scheduleNextAction();
          scheduleStealthRotation();
        }
      }, 7000);

      ramGcInterval = setInterval(() => {
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }, 30 * 1000);

      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
        }
      }, 5 * 1000);

      watchdogInterval = setInterval(() => {
        if (!bot) return;

        if (!isAutoActionRunning || Date.now() - lastActionTime > 15000) {
          scheduleNextAction();
        }

        if (bot.time) {
          if (bot.time.age === lastTimeAge) {
            if (Date.now() - lastTimeAgeUpdate > 40000) {
              addChatLog('⚠️ Đứng packet mạng (Ghost Connection). Tái kết nối...');
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
    addChatLog('💀 Bot tử vong! Chờ hồi sinh sau 4s...');
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
          scheduleStealthRotation();
        }
      }, 4500);
    }, 4000);
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
    addChatLog(`❌ Mất kết nối (${reason}). Chờ ${reconnectDelay / 1000}s để xóa điểm Anti-Cheat...`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    if (err.code !== 'ECONNRESET') {
      console.log('[MINEFLAYER ERROR]', err.message);
    }
  });

  bot.on('kicked', (reason) => {
    addChatLog(`⚠️ Server Kick: ${reason}`);
    handleReconnect();
  });
}

function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  console.log(`⏳ Tạm nghỉ ${reconnectDelay / 1000}s cho Anti-Cheat Server hết tích điểm VL...`);
  
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, reconnectDelay);
}

// KHỞI CHẠY BOT
createBot();

// CHỐNG CRASH HỆ THỐNG
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
