const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- CẤU HÌNH BOT ---
const OPTIONS = {
  host: 'vangioinetwork.xyz',
  port: 19000,
  username: 'Kiru',
  hideErrors: true,
  checkTimeoutInterval: 60 * 1000,
  keepAlive: true,
  physicsEnabled: true,
  viewDistance: 'tiny'
};

// --- QUẢN LÝ TRẠNG THÁI TOÀN CỤC ---
let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isFirstSpawn = true;
let reconnectDelay = 5000;

// Quản lý Chat & Lệnh Web
let isAwaitingResponse = false;
let commandResponseTimer = null;

// Timers & Intervals
let actionTimeout = null;
let afkMoveInterval = null;
let keepAliveInterval = null;
let ramGcInterval = null;
let posCheckInterval = null;
let watchdogInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let respawnTimer = null;

// Dữ liệu Realtime
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

// --- AUTOMATIC SELF-PING (CHỐNG HOSTING RENDER/KOYEB SLEEP) ---
setInterval(() => {
  http.get(`http://localhost:${port}/api/ping`, () => {}).on('error', () => {});
}, 3 * 60 * 1000); // 3 phút ping 1 lần

app.get('/api/ping', (req, res) => res.send('PONG'));

// --- API XỬ LÝ LỆNH TỪ WEB DASHBOARD ---
app.post('/api/command', (req, res) => {
  const cmd = req.body.command;
  if (!bot || !bot._client) {
    return res.send('Bot đang ngoại tuyến!');
  }
  if (cmd) {
    bot.chat(cmd);
    addChatLog(`[WEB-ADMIN]: ${cmd}`);
    triggerChatWindow(8000);
  }
  res.redirect('/');
});

app.get('/api/restart', (req, res) => {
  addChatLog('🔄 [WEB-ADMIN]: Yêu cầu khởi động lại bot...');
  console.log('[HỆ THỐNG] Khởi động lại bot từ Web Dashboard');
  
  reconnectDelay = 5000;
  isReconnecting = false; 
  handleReconnect();
  res.redirect('/');
});

// --- GIAO DIỆN WEB DASHBOARD ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Minecraft AFK Bot Dashboard</title>
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
          if (!input || document.activeElement !== input) {
            location.reload(); 
          }
        }, 5000);
      </script>
    </head>
    <body>
      <h2>🤖 Minecraft AFK Bot Dashboard</h2>
      
      <div class="card">
        <h3>📌 Trạng Thái Bot</h3>
        <p>🟢 <b>Kết nối Server:</b> ${bot ? '<span class="badge-on">ONLINE</span>' : '<span class="badge-off">ĐANG RECONNECT</span>'}</p>
        <p>🏃 <b>Chống Kick AFK 10 Phút:</b> <span class="badge-on">ĐANG KÍCH HOẠT</span></p>
        <p>📍 <b>Tọa độ:</b> <code>${currentCoords}</code></p>
        <p>🗡️ <b>Món đồ trên tay:</b> <code>${currentWeapon}</code></p>
        <p>📦 <b>Tổng lượt nhặt đồ:</b> ${collectedCount} lần</p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM Heap:</b> ${memoryUsage} MB / 512 MB</p>
      </div>

      <div class="card">
        <h3>⚙️ Bảng Điều Khiển</h3>
        <form class="input-group" action="/api/command" method="POST">
          <input type="text" id="cmd-input" name="command" placeholder="Nhập lệnh (vd: /afkmode vao) hoặc chat..." autocomplete="off" required>
          <button type="submit">Gửi Lệnh</button>
        </form>
        <form action="/api/restart" method="GET" onsubmit="return confirm('Bạn có chắc chắn muốn khởi động lại kết nối của bot không?');">
          <button type="submit" class="btn-danger">🔄 Khởi Động Lại Bot Thủ Công</button>
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

app.listen(port, () => console.log(`[HTTP SERVER] Đang chạy tại port ${port}`));

// --- HÀM DỌN DẸP BỘ NHỚ VÀ SOCKET ---
function cleanupBot() {
  isAutoActionRunning = false;
  currentCoords = 'Đang xác định...';

  if (actionTimeout) clearTimeout(actionTimeout);

  const intervals = [afkMoveInterval, keepAliveInterval, ramGcInterval, posCheckInterval, watchdogInterval];
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

// --- THỰC THI CHU KỲ CLICK L/R VA SNEAK ---
function scheduleNextAction() {
  if (!bot || !bot._client || bot._client.socket.destroyed) {
    isAutoActionRunning = false;
    return;
  }

  isAutoActionRunning = true;
  lastActionTime = Date.now();

  try {
    const target = bot.nearestEntity(e => 
      (e.type === 'mob' || e.type === 'hostile' || e.type === 'animal' || e.type === 'player') &&
      e.position && bot.entity && bot.entity.position &&
      e.id !== bot.entity.id &&
      e.position.distanceTo(bot.entity.position) <= 4.0
    );

    if (target) {
      bot.attack(target);
    } else {
      bot.swingArm('right');
    }

    try { bot.activateItem(); } catch (err) {}

    // Ngồi (Shift) nhẹ nhàng
    bot.setControlState('sneak', true);
    setTimeout(() => {
      if (bot) bot.setControlState('sneak', false);
    }, 400);

  } catch (err) {}

  const randomDelay = Math.floor(1000 + Math.random() * 500); // Ngẫu nhiên 1s -> 1.5s
  actionTimeout = setTimeout(scheduleNextAction, randomDelay);
}

// --- HÀM DI CHUYỂN THỰC TẾ CHỐNG AFK KICK (CỰC KỲ QUAN TRỌNG) ---
function startAntiAfkMovement() {
  if (afkMoveInterval) clearInterval(afkMoveInterval);

  afkMoveInterval = setInterval(() => {
    if (!bot || !bot.entity) return;

    try {
      // Giữ nút Tiến (W) trong 1 giây
      bot.setControlState('forward', true);
      
      // Nhảy 1 nhịp để thay đổi Y-coordinate
      if (Math.random() > 0.3) {
        bot.setControlState('jump', true);
        setTimeout(() => { if (bot) bot.setControlState('jump', false); }, 250);
      }

      setTimeout(() => {
        if (!bot) return;
        bot.setControlState('forward', false);

        // Lùi nhẹ lại vị trí cũ
        bot.setControlState('back', true);
        setTimeout(() => {
          if (bot) bot.setControlState('back', false);
        }, 800);

      }, 1000);
    } catch (e) {}
  }, 45 * 1000); // 45 giây di chuyển 1 lần
}

function createBot() {
  cleanupBot();
  isFirstSpawn = true;
  lastTimeAge = 0;
  lastTimeAgeUpdate = Date.now();

  console.log(`\n[HỆ THỐNG] Đang kết nối đến ${OPTIONS.host}...`);

  try {
    bot = mineflayer.createBot(OPTIONS);
    bot.setMaxListeners(0);

    if (bot._client) {
      bot._client.setMaxListeners(0);
      bot._client.on('error', () => {});
    }
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] Kết nối lại sau ${reconnectDelay / 1000} giây...`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server!');
    addChatLog('✅ Đã kết nối vào Server!');
    triggerChatWindow(12000);

    reconnectDelay = 5000;

    if (bot._client && bot._client.socket) {
      try {
        bot._client.socket.setKeepAlive(true, 10000);
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
          startAntiAfkMovement(); // Bật cơ chế nhích vị trí chống Kick 10m
        }
      }, 6000);

      ramGcInterval = setInterval(() => {
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }, 60 * 1000);

      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
        }
      }, 5 * 1000);

      keepAliveInterval = setInterval(() => {
        if (bot && bot.entity && bot._client) {
          try {
            const randomYaw = (Math.random() - 0.5) * 0.3;
            const randomPitch = (Math.random() - 0.5) * 0.1;
            bot.look(bot.entity.yaw + randomYaw, bot.entity.pitch + randomPitch, true);
          } catch (e) {}
        }
      }, 12 * 1000);

      watchdogInterval = setInterval(() => {
        if (!bot) return;

        if (!isAutoActionRunning || Date.now() - lastActionTime > 8000) {
          scheduleNextAction();
        }

        if (bot.time) {
          if (bot.time.age === lastTimeAge) {
            if (Date.now() - lastTimeAgeUpdate > 35000) {
              addChatLog('⚠️ Server ngưng gửi packet (Treo ngầm). Reconnecting...');
              console.log('[WATCHDOG] Reconnecting...');
              handleReconnect();
            }
          } else {
            lastTimeAge = bot.time.age;
            lastTimeAgeUpdate = Date.now();
          }
        }
      }, 10000);
    }
  });

  bot.on('death', () => {
    addChatLog('💀 Bot chết! Hồi sinh sau 2s...');

    respawnTimer = setTimeout(() => {
      if (bot && bot._client) {
        try { bot.respawn(); } catch (e) {}
      }

      setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Hồi sinh xong -> Gửi /afkmode vao');
          triggerChatWindow(5000);
          scheduleNextAction();
          startAntiAfkMovement();
        }
      }, 4000);
    }, 2000);
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
    addChatLog(`❌ Mất kết nối (${reason}). Reconnect sau ${reconnectDelay / 1000}s...`);
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

  console.log(`⏳ Chờ ${reconnectDelay / 1000} giây để Reconnect...`);
  
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, reconnectDelay);
}

// KHỞI CHẠY BOT
createBot();

// CHỐNG CRASH PROCESS
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
