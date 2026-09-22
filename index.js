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
  checkTimeoutInterval: 600 * 1000,
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
let keepAliveInterval = null;
let ramGcInterval = null;
let posCheckInterval = null;
let clickWatchdogInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let respawnTimer = null;

// Dữ liệu Realtime & Sát Thương
let isClicking = false;
let lastClickTime = Date.now();
let currentCoords = 'Đang xác định...';
let collectedCount = 0;
let totalHits = 0;
let totalDamageDealt = 0;
let targetPrevHealth = {};
const serverChatLogs = [];
const startTime = Date.now();

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

// --- GIAO DIỆN WEB DASHBOARD ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

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
        .stat-highlight { color: #f43f5e; font-weight: bold; font-size: 1.1em; }
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
        <p>🖱️ <b>Auto Clicker:</b> ${isClicking ? '<span class="badge-on">ĐANG CHẠY</span>' : '<span class="badge-off">TẮT</span>'}</p>
        <p>📍 <b>Tọa độ:</b> <code>${currentCoords}</code></p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM Heap:</b> ${memoryUsage} MB / 512 MB</p>
      </div>

      <div class="card">
        <h3>⚔️ Thống Kê Chiến Đấu & Sát Thương</h3>
        <p>💥 <b>Đòn đánh chính xác:</b> ${totalHits} lần hit</p>
        <p>🗡️ <b>Tổng sát thương gây ra:</b> <span class="stat-highlight">${totalDamageDealt.toFixed(1)} HP</span></p>
        <p>📦 <b>Tổng lượt nhặt đồ:</b> ${collectedCount} lần</p>
      </div>

      <div class="card">
        <h3>⚙️ Bảng Điều Khiển Lệnh Direct</h3>
        <form class="input-group" action="/api/command" method="POST">
          <input type="text" id="cmd-input" name="command" placeholder="Nhập lệnh (vd: /afkmode vao) hoặc chat..." autocomplete="off" required>
          <button type="submit">Gửi Lệnh</button>
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
  isClicking = false;

  const intervals = [clickInterval, keepAliveInterval, ramGcInterval, posCheckInterval, clickWatchdogInterval];
  intervals.forEach(i => i && clearInterval(i));

  const timeouts = [reconnectTimeout, loginTimer1, loginTimer2, respawnTimer, commandResponseTimer];
  timeouts.forEach(t => t && clearTimeout(t));

  if (bot) {
    try {
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

// --- AUTO CLICKER TẤN CÔNG & TÍNH SÁT THƯƠNG ---
function startAutoClicker() {
  if (clickInterval) clearInterval(clickInterval);
  isClicking = true;

  clickInterval = setInterval(() => {
    if (!bot || !bot._client || bot._client.socket.destroyed) {
      isClicking = false;
      return;
    }
    try {
      // 1. Quét tìm mob/entity trong phạm vi đánh (4.5 blocks)
      const target = bot.nearestEntity(e => 
        (e.type === 'mob' || e.type === 'hostile' || e.type === 'animal') &&
        e.position && bot.entity && bot.entity.position &&
        e.position.distanceTo(bot.entity.position) <= 4.5
      );

      if (target) {
        // Tấn công trực tiếp thực thể
        bot.attack(target);
        totalHits++;

        // Lưu lượng máu trước đòn đánh
        if (target.health !== undefined) {
          targetPrevHealth[target.id] = target.health;
        } else {
          // Nếu server không công khai máu entity, tính sát thương ước lượng mặc định (5 HP)
          totalDamageDealt += 5;
        }
      }

      // 2. Vung tay tạo gói tin giữ AFK
      bot.swingArm('right');
      lastClickTime = Date.now();

      // Dọn dẹp Cache theo dõi máu định kỳ
      if (Object.keys(targetPrevHealth).length > 100) {
        targetPrevHealth = {};
      }
    } catch (err) {}
  }, 1000);
}

function createBot() {
  cleanupBot();
  isFirstSpawn = true;

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
          startAutoClicker();
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

      // 4. WATCHDOG AUTO CLICKER
      clickWatchdogInterval = setInterval(() => {
        const timeDiff = Date.now() - lastClickTime;
        if (!isClicking || timeDiff > 4000) {
          startAutoClicker();
        }
      }, 15 * 1000);

      // 5. CHỐNG ANTI-BOT
      keepAliveInterval = setInterval(() => {
        if (bot && bot.entity && bot._client) {
          try {
            const randomYaw = (Math.random() - 0.5) * 0.1;
            const randomPitch = (Math.random() - 0.5) * 0.1;
            bot.look(bot.entity.yaw + randomYaw, bot.entity.pitch + randomPitch, true);
          } catch (e) {}
        }
      }, 12 * 1000);
    }
  });

  // BẮT SÁT THƯƠNG KHI MÁU MOB GIẢM
  bot.on('entityHurt', (entity) => {
    try {
      if (!bot || !bot.entity) return;
      const dist = entity.position ? entity.position.distanceTo(bot.entity.position) : 99;
      
      // Nếu thực thể bị thương nằm trong tầm đánh của Bot
      if (dist <= 4.5 && entity.id !== bot.entity.id) {
        const prevHp = targetPrevHealth[entity.id];
        if (prevHp !== undefined && entity.health !== undefined) {
          const damage = prevHp - entity.health;
          if (damage > 0) {
            totalDamageDealt += damage;
          }
          targetPrevHealth[entity.id] = entity.health;
        }
      }
    } catch (e) {}
  });

  // BẮT SÁT THƯƠNG TỪ THANH ACTIONBAR (NẾU SERVER CÓ HỔ TRỢ KHỦNG TỪ PLUGIN)
  bot.on('actionBar', (message) => {
    try {
      const text = message.toString().trim();
      if (!text) return;
      
      // Tìm số sát thương ví dụ: -15 HP hoặc 15 Sát thương
      const match = text.match(/-?(\d+(\.\d+)?)\s*(hp|sát thương|damage)/i);
      if (match && match[1]) {
        const dmg = parseFloat(match[1]);
        if (!isNaN(dmg) && dmg > 0) {
          totalDamageDealt += dmg;
        }
      }
    } catch (e) {}
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
      addChatLog(`❌ Rớt mạng: ${reason}`);
    }
    handleReconnect();
  });

  bot.on('error', () => {});

  bot.on('kicked', (reason) => {
    addChatLog(`⚠️ Bị Kick: ${reason}`);
    handleReconnect();
  });
}

function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  console.log(`⏳ Đang chờ 5 giây để kết nối lại...`);
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false; // Reset cờ trước khi khởi tạo lại Bot mới
    createBot();
  }, 5000);
}

// KHỞI CHẠY BOT
createBot();

// CHỐNG CRASH PROCESS NODEJS
const ignoreErrorKeywords = [
  'socketclosed', 'econnreset', 'etimedout', 'epipe', 'enotfound',
  'partialreaderror', 'packet_world_particles'
];

process.on('uncaughtException', (err) => {
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toUpperCase();

  if (ignoreErrorKeywords.some(k => msg.includes(k) || code === k.toUpperCase())) {
    return;
  }
  console.log('[CRASH PREVENTED] Lỗi ngầm:', err.message);
  handleReconnect();
});

process.on('unhandledRejection', () => {});
