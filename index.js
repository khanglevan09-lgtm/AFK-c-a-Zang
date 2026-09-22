const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

// Cấu hình Express đọc dữ liệu từ Web Form
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --- CẤU HÌNH BOT (BẤT TỬ KẾT NỐI & TỐI ƯU RENDER) ---
const OPTIONS = {
  host: 'vangioinetwork.xyz',
  port: 19000,
  username: 'Kiru',
  hideErrors: true,
  checkTimeoutInterval: 600 * 1000, // 10 phút timeout tránh ngắt mạng ảo
  keepAlive: true,
  physicsEnabled: true,
  viewDistance: 'tiny' // Tầm nhìn cực ngắn để giảm tải tối đa RAM trên Render
};

// --- QUẢN LÝ TRẠNG THÁI TOÀN CỤC ---
let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isFirstSpawn = true;
let allowStagnantCheck = false;

// Quản lý Chat & Lệnh Web
let isAwaitingResponse = false;
let commandResponseTimer = null;

// Timers & Intervals
let clickInterval = null;
let keepAliveInterval = null;
let ramGcInterval = null;
let posCheckInterval = null;
let clickWatchdogInterval = null;
let worldClearInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let loginTimer3 = null;
let respawnTimer = null;

// Dữ liệu Realtime
let isClicking = false;
let lastClickTime = Date.now();
let currentCoords = 'Đang xác định...';
let lastPosition = null;
const collectedItems = {};
const serverChatLogs = [];
const startTime = Date.now();

function addChatLog(msg) {
  serverChatLogs.unshift(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
  if (serverChatLogs.length > 20) serverChatLogs.pop();
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

    // Mở cửa sổ lưu log chat trong 5 giây sau khi gửi lệnh
    isAwaitingResponse = true;
    if (commandResponseTimer) clearTimeout(commandResponseTimer);
    commandResponseTimer = setTimeout(() => {
      isAwaitingResponse = false;
    }, 5000);
  }
  res.redirect('/');
});

// --- GIAO DIỆN WEB DASHBOARD ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

  let itemsHTML = '<i>Chưa nhặt được vật phẩm nào...</i>';
  const itemKeys = Object.keys(collectedItems);
  if (itemKeys.length > 0) {
    itemsHTML = '<ul style="margin: 5px 0; padding-left: 20px;">' +
      itemKeys.map(k => `<li><b>${k}</b>: x${collectedItems[k]}</li>`).join('') +
      '</ul>';
  }

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
      </style>
      <script>
        // Tự động làm mới trang mỗi 5 giây, nhưng dừng lại nếu người dùng đang nhập lệnh
        setTimeout(() => { 
          const input = document.getElementById('cmd-input');
          if (!input || document.activeElement !== input) {
            location.reload(); 
          }
        }, 5000);
      </script>
    </head>
    <body>
      <h2>🤖 Minecraft AFK Bot (Render Ready)</h2>
      
      <div class="card">
        <h3>📌 Trạng Thái Bot</h3>
        <p>🟢 <b>Kết nối Server:</b> ${bot ? '<span class="badge-on">ONLINE</span>' : '<span class="badge-off">ĐANG RECONNECT</span>'}</p>
        <p>🖱️ <b>Auto Clicker:</b> ${isClicking ? '<span class="badge-on">ĐANG CHẠY</span>' : '<span class="badge-off">TẮT</span>'}</p>
        <p>📍 <b>Tọa độ (10s):</b> <code>${currentCoords}</code></p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM Heap:</b> ${memoryUsage} MB / 512 MB</p>
      </div>

      <div class="card">
        <h3>⚙️ Bảng Điều Khiển Lệnh Direct</h3>
        <form class="input-group" action="/api/command" method="POST">
          <input type="text" id="cmd-input" name="command" placeholder="Nhập lệnh (vd: /spawn) hoặc chat..." autocomplete="off" required>
          <button type="submit">Gửi Lệnh</button>
        </form>
      </div>

      <div class="card">
        <h3>🎒 Thống Kê Vật Phẩm</h3>
        ${itemsHTML}
      </div>

      <div class="card">
        <h3>💬 Nhật Ký Server (Đã Lọc Kiru / Bot)</h3>
        <div class="chat-box">
          ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => console.log(`[HTTP SERVER] Đang chạy tại port ${port}`));

// --- HÀM DỌN DẸP BỘ NHỚ TRƯỚC KHI RECONNECT ---
function cleanupBot() {
  isClicking = false;
  allowStagnantCheck = false;

  const intervals = [clickInterval, keepAliveInterval, ramGcInterval, posCheckInterval, clickWatchdogInterval, worldClearInterval];
  intervals.forEach(i => i && clearInterval(i));

  const timeouts = [reconnectTimeout, loginTimer1, loginTimer2, loginTimer3, respawnTimer, commandResponseTimer];
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

// --- AUTO CLICKER (1s/lần) ---
function startAutoClicker() {
  if (clickInterval) clearInterval(clickInterval);
  isClicking = true;
  let clickState = 'left';

  clickInterval = setInterval(() => {
    if (!bot || !bot._client || bot._client.socket.destroyed) {
      isClicking = false;
      return;
    }
    try {
      if (clickState === 'left') {
        bot.swingArm('right');
        clickState = 'right';
      } else {
        bot.activateItem();
        clickState = 'left';
      }
      lastClickTime = Date.now();
    } catch (err) {}
  }, 1000);
}

function createBot() {
  cleanupBot();
  isFirstSpawn = true;

  console.log(`\n[HỆ THỐNG] Đang kết nối đến ${OPTIONS.host}...`);

  try {
    bot = mineflayer.createBot(OPTIONS);
    // Tắt giới hạn Listener tránh rò rỉ bộ nhớ từ NodeJS EventEmitter
    bot.setMaxListeners(0);
    if (bot._client) bot._client.setMaxListeners(0);
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] Kết nối lại sau 6 giây...`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server!');
    addChatLog('✅ Đã kết nối vào Server!');
    isReconnecting = false;

    if (isFirstSpawn) {
      isFirstSpawn = false;

      // 1. CHUỖI ĐĂNG NHẬP
      loginTimer1 = setTimeout(() => {
        if (bot && bot._client) bot.chat('/l Kiru2000@');
      }, 10000);

      loginTimer2 = setTimeout(() => {
        if (bot && bot._client) bot.chat('/afkmode vao');
      }, 20000);

      loginTimer3 = setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/afkmode vao');
          startAutoClicker();
          allowStagnantCheck = true;
          if (bot.entity && bot.entity.position) {
            lastPosition = { ...bot.entity.position };
          }
        }
      }, 40000);

      // 2. TỐI ƯU HÓA BỘ NHỚ CHO RENDER (RAM DƯỚI 200MB)
      ramGcInterval = setInterval(() => {
        // Xóa danh sách Entity tích tụ không dùng đến
        if (bot && bot.entities) {
          for (const id in bot.entities) {
            if (bot.entity && id !== bot.entity.id.toString()) {
              delete bot.entities[id];
            }
          }
        }
        // Gọi Garbage Collector ép giải phóng bộ nhớ
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }, 60 * 1000);

      // Dọn dẹp cache World/Chunk định kỳ mỗi 3 phút
      worldClearInterval = setInterval(() => {
        if (bot && bot.world && typeof bot.world.clear === 'function') {
          try { bot.world.clear(); } catch (e) {}
        }
      }, 3 * 60 * 1000);

      // 3. KIỂM TRA TỌA ĐỘ VÀ KẸT 5 BLOCK / 10 GIÂY
      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
          
          if (allowStagnantCheck && lastPosition) {
            const dx = pos.x - lastPosition.x;
            const dy = pos.y - lastPosition.y;
            const dz = pos.z - lastPosition.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (distance < 5.0) {
              console.log('[AFK CHECK] ☠️ Kích hoạt tự sát!');
              addChatLog(`☠️ Di chuyển < 5 block (${distance.toFixed(1)}m) -> /tusat`);
              bot.chat('/tusat');
              allowStagnantCheck = false;
            }
          }
          lastPosition = { x: pos.x, y: pos.y, z: pos.z };
        }
      }, 10 * 1000);

      // 4. AUTO CLICKER WATCHDOG
      clickWatchdogInterval = setInterval(() => {
        const timeDiff = Date.now() - lastClickTime;
        if (!isClicking || timeDiff > 4000) {
          startAutoClicker();
        }
      }, 15 * 1000);

      // 5. CHỐNG ANTI-BOT (Nhích góc nhìn mỗi 12s)
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

  // TỰ ĐỘNG HỒI SINH
  bot.on('death', () => {
    addChatLog('💀 Bot chết! Hồi sinh sau 2s...');
    allowStagnantCheck = false;

    respawnTimer = setTimeout(() => {
      if (bot && bot._client) {
        try { bot.respawn(); } catch (e) {}
      }

      setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Hồi sinh xong -> Lệnh /afkmode vao');
          if (bot.entity && bot.entity.position) {
            lastPosition = { ...bot.entity.position };
          }
          allowStagnantCheck = true;
        }
      }, 5000);
    }, 2000);
  });

  // NHẶT ĐỒ
  bot.on('playerCollect', (collector, itemEntity) => {
    try {
      if (collector && bot.entity && collector.id === bot.entity.id) {
        let itemName = 'Vật phẩm';
        if (itemEntity && itemEntity.metadata) {
          const metaVals = Object.values(itemEntity.metadata);
          for (const val of metaVals) {
            if (val && typeof val === 'object' && val.displayName) {
              itemName = val.displayName;
              break;
            }
          }
        }
        collectedItems[itemName] = (collectedItems[itemName] || 0) + 1;
      }
    } catch (e) {}
  });

  // LỌC CHAT: Chỉ lưu tin nhắn có liên quan "kiru", "bot" HOẶC phản hồi trong 5s sau khi nhập lệnh từ web
  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (!text) return;

      const lowerText = text.toLowerCase();
      const isRelevant = lowerText.includes('kiru') || lowerText.includes('bot');

      if (isRelevant || isAwaitingResponse) {
        addChatLog(text);
        console.log('[CHAT FILTERED]: ' + text);
      }
    } catch (e) {}
  });

  // XỬ LÝ MẤT KẾT NỐI (ÉP RECONNECT SAU 6 GIÂY TRÁNH BAN IP RENDER)
  bot.on('end', (reason) => {
    addChatLog(`❌ Rớt mạng: ${reason}`);
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

  console.log(`⏳ Đang chờ 6 giây để kết nối lại an toàn...`);
  reconnectTimeout = setTimeout(() => {
    createBot();
  }, 6000);
}

// KHỞI CHẠY BOT
createBot();

// BỨC TƯỜNG BẢO VỆ CHỐNG CRASH PROCESS NODEJS
const ignoreErrorKeywords = [
  'socketclosed', 'econnreset', 'etimedout', 'epipe', 'enotfound',
  'partialreaderror', 'packet_world_particles'
];

process.on('uncaughtException', (err) => {
  const msg = (err.message || '').toLowerCase();
  const code = (err.code || '').toUpperCase();

  if (ignoreErrorKeywords.some(k => msg.includes(k) || code === k.toUpperCase())) {
    return; // Bỏ qua hoàn toàn các lỗi mạng và lỗi đọc packet
  }
  console.log('[CRASH PREVENTED]', err.message);
});

process.on('unhandledRejection', () => {});
