const mineflayer = require('mineflayer');
const express = require('express');

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
  checkTimeoutInterval: 30 * 1000, // Phát hiện mất kết nối nhanh hơn (30s)
  keepAlive: true,
  physicsEnabled: true,
  viewDistance: 'tiny'
};

// --- QUẢN LÝ TRẠNG THÁI TOÀN CỤC ---
let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isFirstSpawn = true;

// Quản lý Chat & Lệnh Web
let isAwaitingResponse = false;
let commandResponseTimer = null;

// Timers & Intervals
let clickInterval = null;
let sneakInterval = null;
let keepAliveInterval = null;
let ramGcInterval = null;
let posCheckInterval = null;
let clickWatchdogInterval = null;
let freezeWatchdogInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let respawnTimer = null;

// Dữ liệu Realtime
let isAutoActionRunning = false;
let isSneaking = false;
let lastClickTime = Date.now();
let currentCoords = 'Đang xác định...';
let collectedCount = 0;
const serverChatLogs = [];
const startTime = Date.now();

// Dữ liệu kiểm tra treo bot
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

// --- API KHỞI ĐỘNG LẠI BOT THỦ CÔNG ---
app.get('/api/restart', (req, res) => {
  addChatLog('🔄 [WEB-ADMIN]: Yêu cầu khởi động lại bot...');
  console.log('[HỆ THỐNG] Khởi động lại bot từ Web Dashboard');
  
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
        <p>🏃 <b>Di chuyển (W):</b> <span class="badge-on">LUÔN GIỮ W</span></p>
        <p>🧎 <b>Auto Sneak (Shift 1s):</b> ${isAutoActionRunning ? '<span class="badge-on">ĐANG BẬT</span>' : '<span class="badge-off">TẮT</span>'}</p>
        <p>🖱️ <b>Auto Click L/R (0.5s):</b> ${isAutoActionRunning ? '<span class="badge-on">ĐANG BẬT</span>' : '<span class="badge-off">TẮT</span>'}</p>
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
  isSneaking = false;
  currentCoords = 'Đang xác định...';

  const intervals = [clickInterval, sneakInterval, keepAliveInterval, ramGcInterval, posCheckInterval, clickWatchdogInterval, freezeWatchdogInterval];
  intervals.forEach(i => i && clearInterval(i));

  const timeouts = [reconnectTimeout, loginTimer1, loginTimer2, respawnTimer, commandResponseTimer];
  timeouts.forEach(t => t && clearTimeout(t));

  if (bot) {
    try {
      bot.setControlState('forward', false);
      bot.setControlState('sneak', false);
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

// --- QUẢN LÝ HÀNH ĐỘNG TỰ ĐỘNG (CLICK 0.5s & SHIFT 1s & DI CHUYỂN W) ---
function startAutoActions() {
  if (clickInterval) clearInterval(clickInterval);
  if (sneakInterval) clearInterval(sneakInterval);
  isAutoActionRunning = true;

  // 1. Luôn giữ nút W (Tiến lên)
  if (bot) {
    bot.setControlState('forward', true);
  }

  // 2. Click Chuột Trái & Phải chu kỳ mỗi 0.5 giây (500ms)
  clickInterval = setInterval(() => {
    if (!bot || !bot._client || bot._client.socket.destroyed) {
      isAutoActionRunning = false;
      return;
    }
    try {
      // --- Click Trái (Attack nếu có mob trong phạm vi, hoặc Swing arm) ---
      const target = bot.nearestEntity(e => 
        (e.type === 'mob' || e.type === 'hostile' || e.type === 'animal' || e.type === 'player') &&
        e.position && bot.entity && bot.entity.position &&
        e.id !== bot.entity.id &&
        e.position.distanceTo(bot.entity.position) <= 4.5
      );

      if (target) {
        bot.attack(target);
      } else {
        bot.swingArm('right'); // Click trái không khí
      }

      // --- Click Phải (Sử dụng vật phẩm trên tay) ---
      try {
        bot.activateItem(); // Click chuột phải
      } catch (err) {}

      lastClickTime = Date.now();
    } catch (err) {}
  }, 500);

  // 3. Tự động Ngồi (Shift) chu kỳ mỗi 1 giây (1000ms)
  sneakInterval = setInterval(() => {
    if (!bot || !bot._client || bot._client.socket.destroyed) return;
    try {
      isSneaking = !isSneaking;
      bot.setControlState('sneak', isSneaking);
    } catch (err) {}
  }, 1000);
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
    if (bot._client) bot._client.setMaxListeners(0);
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] Kết nối lại sau 5 giây...`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server!');
    addChatLog('✅ Đã kết nối vào Server!');
    triggerChatWindow(12000);

    // Kích hoạt di chuyển W ngay khi vừa spawn
    bot.setControlState('forward', true);

    if (bot._client && bot._client.socket) {
      try {
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) {}
    }

    if (isFirstSpawn) {
      isFirstSpawn = false;

      // 1. CHUỖI ĐĂNG NHẬP
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
          startAutoActions();
        }
      }, 6000);

      // 2. DỌN BỘ NHỚ RAM
      ramGcInterval = setInterval(() => {
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }, 60 * 1000);

      // 3. TỌA ĐỘ REALTIME
      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
        }
      }, 5 * 1000);

      // 4. WATCHDOG AUTO ACTION
      clickWatchdogInterval = setInterval(() => {
        const timeDiff = Date.now() - lastClickTime;
        if (!isAutoActionRunning || timeDiff > 4000) {
          startAutoActions();
        } else if (bot) {
          // Đảm bảo nút W luôn bật
          bot.setControlState('forward', true);
        }
      }, 15 * 1000);

      // 5. CHỐNG ANTI-BOT (Nhích góc nhìn nhẹ)
      keepAliveInterval = setInterval(() => {
        if (bot && bot.entity && bot._client) {
          try {
            const randomYaw = (Math.random() - 0.5) * 0.1;
            const randomPitch = (Math.random() - 0.5) * 0.1;
            bot.look(bot.entity.yaw + randomYaw, bot.entity.pitch + randomPitch, true);
          } catch (e) {}
        }
      }, 12 * 1000);

      // 6. WATCHDOG CHỐNG TREO BẰNG THỜI GIAN SERVER
      freezeWatchdogInterval = setInterval(() => {
        if (!bot || !bot.time) return;
        
        if (bot.time.age === lastTimeAge) {
          if (Date.now() - lastTimeAgeUpdate > 30000) {
            addChatLog('⚠️ Phát hiện bot bị treo/kẹt. Tiến hành kết nối lại...');
            console.log('[WATCHDOG] Bot bị treo kết nối ngầm. Đang restart...');
            handleReconnect();
          }
        } else {
          lastTimeAge = bot.time.age;
          lastTimeAgeUpdate = Date.now();
        }
      }, 10000);
    }
  });

  // TỰ ĐỘNG HỒI SINH
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
          startAutoActions();
        }
      }, 4000);
    }, 2000);
  });

  // ĐẾM LƯỢT NHẶT ĐỒ
  bot.on('playerCollect', (collector) => {
    try {
      if (collector && bot.entity && collector.id === bot.entity.id) {
        collectedCount++;
      }
    } catch (e) {}
  });

  // NHẬT KÝ CHAT
  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (!text) return;

      const lowerText = text.toLowerCase();
      const isRelevant = lowerText.includes('kiru') || lowerText.includes('bot') || lowerText.includes('login') || lowerText.includes('afk');

      if (isRelevant || isAwaitingResponse) {
        addChatLog(text);
        console.log('[CHAT]: ' + text);
      }
    } catch (e) {}
  });

  // XỬ LÝ MẤT KẾT NỐI
  bot.on('end', (reason) => {
    if (reason === 'socketClosed') {
      addChatLog('🔄 Server đóng kết nối (socketClosed). Reconnect sau 5s...');
    } else {
      addChatLog(`❌ Rớt mạng hoặc Server tắt: ${reason}`);
    }
    handleReconnect();
  });

  bot.on('error', (err) => {
    console.log('[MINEFLAYER ERROR]', err.message);
  });

  bot.on('kicked', (reason) => {
    addChatLog(`⚠️ Bị Kick khỏi server. Đang thử lại...`);
    handleReconnect();
  });
}

function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  console.log(`⏳ Đang chờ 5 giây để kết nối lại...`);
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, 5000);
}

// KHỞI CHẠY BOT
createBot();

// CHỐNG CRASH PROCESS NODEJS KHI CÓ LỖI TỪ THƯ VIỆN BÊN DƯỚI
const ignoreErrorKeywords = [
  'socketclosed', 'econnreset', 'etimedout', 'epipe', 'enotfound',
  'partialreaderror', 'packet_world_particles', 'read econnreset'
];

process.on('uncaughtException', (err) => {
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toUpperCase();

  if (ignoreErrorKeywords.some(k => msg.includes(k) || code === k.toUpperCase())) {
    return;
  }
  
  console.log('[CRASH PREVENTED] Lỗi chưa xử lý:', err.message);
  isReconnecting = false;
  handleReconnect();
});

process.on('unhandledRejection', () => {});
