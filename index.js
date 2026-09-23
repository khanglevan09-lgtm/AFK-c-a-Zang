const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ÉP MÚI GIỜ VIỆT NAM TOÀN HỆ THỐNG
process.env.TZ = 'Asia/Ho_Chi_Minh';

const OPTIONS = {
  host: 'vangioinetwork.xyz',
  port: 19000,
  username: 'Kiru',
  hideErrors: false,
  checkTimeoutInterval: 60 * 1000, 
  keepAlive: true,
  physicsEnabled: true,
  viewDistance: 'tiny'
};

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isManualStopped = false; // BẬT/TẮT BOT THỦ CÔNG
let isFirstSpawn = true;

let currentReconnectDelay = 30000; 
let consecutiveFailures = 0; 

let actionTimeout = null;
let antiAfkTimeout = null;
let ramGcInterval = null;
let posCheckInterval = null;
let watchdogInterval = null;
let pingInterval = null;
let socketHeartbeatInterval = null;
let loginTimer1 = null;
let loginTimer2 = null;
let respawnTimer = null;
let commandResponseTimer = null;

let isAwaitingResponse = false;
let isAutoActionRunning = false;
let lastActionTime = Date.now();
let currentCoords = 'Đang xác định...';
let collectedCount = 0;
let currentPing = 0;

const startTime = Date.now();
const serverChatLogs = [];
const errorLogs = [];    
const pingLogs = [];     
const kiruMentionLogs = []; // NHẬT KÝ LƯU TRỮ VĨNH VIỄN

let lastTimeAge = 0;
let lastTimeAgeUpdate = Date.now();

function getVNTime() {
  return new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function addChatLog(msg) {
  serverChatLogs.unshift(`[${getVNTime()}] ${msg}`);
  if (serverChatLogs.length > 25) serverChatLogs.pop();
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

function addKiruLog(msg) {
  kiruMentionLogs.unshift({
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

app.get('/api/ping', (req, res) => res.send('PONG_OK'));

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

// ROUTE BẬT / TẮT BOT THỦ CÔNG DE TỰ VÀO GAME
app.get('/api/toggle-bot', (req, res) => {
  isManualStopped = !isManualStopped;
  if (isManualStopped) {
    addErrorLog('THỦ CÔNG', 'Đã TẮT Bot từ Web Dashboard. Ngắt kết nối để người chơi tự đăng nhập.');
    cleanupBot();
  } else {
    addErrorLog('THỦ CÔNG', 'Đã BẬT lại Bot từ Web Dashboard. Bắt đầu kết nối Server...');
    consecutiveFailures = 0;
    createBot();
  }
  res.redirect('/');
});

app.get('/api/clear-error-log', (req, res) => {
  errorLogs.length = 0;
  res.redirect('/');
});

app.get('/api/clear-kiru-log', (req, res) => {
  kiruMentionLogs.length = 0;
  res.redirect('/');
});

app.get('/api/hard-restart', (req, res) => {
  addErrorLog('HỆ THỐNG', 'Khởi động lại tiến trình Node.js thủ công...');
  process.exit(1); 
});

app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  let statusBadge = '<span class="badge-off">OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">⏸️ ĐÃ TẮT THỦ CÔNG (ĐANG NHƯỜNG NICK)</span>';
  } else if (bot) {
    statusBadge = '<span class="badge-on">🟢 ONLINE</span>';
  } else {
    statusBadge = `<span class="badge-off">🔄 RECONNECTING (${currentReconnectDelay / 1000}s)</span>`;
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kiru Control Center</title>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --card-bg: rgba(22, 30, 46, 0.75);
          --accent-cyan: #38bdf8;
          --accent-pink: #ec4899;
          --accent-purple: #a855f7;
          --accent-green: #22c55e;
          --accent-red: #ef4444;
          --accent-yellow: #f59e0b;
          --border: rgba(56, 189, 248, 0.15);
        }
        * { box-sizing: border-box; }
        body {
          font-family: 'Plus Jakarta Sans', sans-serif;
          background: #060911 linear-gradient(135deg, #090d16 0%, #0d1527 50%, #150d2a 100%);
          background-attachment: fixed;
          color: #f8fafc;
          padding: 20px;
          margin: 0;
          min-height: 100vh;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 15px;
          border-bottom: 2px solid var(--border);
          margin-bottom: 20px;
        }
        h1 {
          font-family: 'Orbitron', sans-serif;
          font-size: 1.8rem;
          margin: 0;
          background: linear-gradient(90deg, var(--accent-cyan), var(--accent-pink));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .container {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 20px;
        }
        @media (max-width: 1024px) { .container { grid-template-columns: 1fr; } }
        
        .card {
          background: var(--card-bg);
          backdrop-filter: blur(12px);
          padding: 20px;
          border-radius: 16px;
          border: 1px solid var(--border);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
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
        .badge-on { background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; padding: 4px 12px; border-radius: 20px; font-weight: bold; }
        .badge-off { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; padding: 4px 12px; border-radius: 20px; font-weight: bold; }
        .badge-pause { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; padding: 4px 12px; border-radius: 20px; font-weight: bold; }
        
        .chat-box { background: #04060c; padding: 12px; border-radius: 10px; font-family: monospace; height: 200px; overflow-y: auto; color: #38bdf8; border: 1px solid #1e293b; }
        .error-box { background: #110505; padding: 12px; border-radius: 10px; font-family: monospace; height: 200px; overflow-y: auto; color: #f87171; border: 1px solid #450a0a; }
        .kiru-box { background: #0d1512; padding: 12px; border-radius: 10px; font-family: monospace; height: 220px; overflow-y: auto; color: #facc15; border: 1px solid #713f12; }
        
        .input-group { display: flex; gap: 10px; margin-top: 10px; }
        input[type="text"] { flex: 1; padding: 12px 15px; border-radius: 10px; border: 1px solid #334155; background: #0b0f19; color: white; outline: none; font-size: 1rem; }
        input[type="text"]:focus { border-color: var(--accent-cyan); box-shadow: 0 0 10px rgba(56, 189, 248, 0.3); }
        
        button { padding: 12px 20px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: bold; transition: all 0.2s ease; }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4); }
        .btn-stop { background: linear-gradient(135deg, #dc2626, #991b1b) !important; }
        .btn-start { background: linear-gradient(135deg, #16a34a, #15803d) !important; }
        .btn-warning { background: linear-gradient(135deg, #d97706, #b45309) !important; }
        
        .anime-card { text-align: center; }
        .anime-img {
          width: 100%;
          max-height: 380px;
          object-fit: cover;
          border-radius: 12px;
          border: 2px solid var(--accent-pink);
          box-shadow: 0 0 15px rgba(236, 72, 153, 0.3);
          transition: opacity 0.4s ease-in-out;
        }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
      </style>
      <script>
        setInterval(() => { 
          const input = document.getElementById('cmd-input');
          if (!input || document.activeElement !== input) { location.reload(); }
        }, 5000);

        async function fetchAnimeWaifu() {
          try {
            const res = await fetch('https://api.waifu.pics/sfw/waifu');
            const data = await res.json();
            if (data && data.url) {
              const imgEl = document.getElementById('anime-waifu-img');
              if (imgEl) {
                imgEl.style.opacity = '0.2';
                setTimeout(() => {
                  imgEl.src = data.url;
                  imgEl.style.opacity = '1';
                }, 300);
              }
            }
          } catch (e) {}
        }
        setInterval(fetchAnimeWaifu, 12000);
        window.onload = fetchAnimeWaifu;
      </script>
    </head>
    <body>
      <div class="header">
        <h1>✨ KIRU CONTROL HUB</h1>
        <div>${statusBadge}</div>
      </div>

      <div class="container">
        <div>
          <div class="card">
            <h3>🎮 Trạng Thái & Thao Tác Chính</h3>
            <p>📶 <b>Ping:</b> <b style="color: var(--accent-cyan);">${currentPing} ms</b> | 📍 <b>Tọa Độ:</b> <code>${currentCoords}</code></p>
            <p>🗡️ <b>Trang Bị:</b> <code>${currentWeapon}</code> | 📦 <b>Nhặt Vật Phẩm:</b> ${collectedCount} lần</p>
            <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM Heap:</b> ${memoryUsage} MB</p>

            <form class="input-group" action="/api/command" method="POST">
              <input type="text" id="cmd-input" name="command" placeholder="Gửi lệnh hoặc tin nhắn vào server..." autocomplete="off" required>
              <button type="submit">Gửi</button>
            </form>

            <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap;">
              ${isManualStopped 
                ? `<a href="/api/toggle-bot" style="text-decoration: none; flex: 1;"><button type="button" class="btn-start" style="width: 100%;">▶️ BẬT BOT (KẾT NỐI SERVER)</button></a>`
                : `<a href="/api/toggle-bot" style="text-decoration: none; flex: 1;"><button type="button" class="btn-stop" style="width: 100%;">⏸️ TẮT BOT (ĐỂ TỰ VÀO GAME)</button></a>`
              }
              <a href="/api/clear-error-log" style="text-decoration: none;"><button type="button" class="btn-warning">🧹 Xóa Lỗi</button></a>
              <a href="/api/clear-kiru-log" style="text-decoration: none;"><button type="button" class="btn-warning">🧹 Kiru Log (${kiruMentionLogs.length})</button></a>
              <a href="/api/hard-restart" style="text-decoration: none;" onclick="return confirm('Reset toàn bộ Tiến Trình Code?');"><button type="button" class="btn-stop">🔄 Reset App</button></a>
            </div>
          </div>

          <div class="card">
            <h3>⭐ Nhật Ký Nhắc Tên [Kiru] (Lưu vĩnh viễn)</h3>
            <div class="kiru-box">
              ${kiruMentionLogs.length > 0 
                ? kiruMentionLogs.map(k => `<div>[${k.time}]${k.text}</div>`).join('') 
                : '<i>Chưa có tin nhắn hoặc thông báo nào nhắc đến Kiru...</i>'}
            </div>
          </div>

          <div class="grid-2">
            <div class="card">
              <h3>💬 Chat Server</h3>
              <div class="chat-box">
                ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
              </div>
            </div>

            <div class="card">
              <h3>🚨 Nhật Ký Lỗi Phát Sinh</h3>
              <div class="error-box">
                ${errorLogs.length > 0 ? errorLogs.map(e => `<div>[${e.time}] <b>[${e.type}]</b>:${e.details}</div>`).join('') : '<div style="color:var(--accent-green);">Không có lỗi!</div>'}
              </div>
            </div>
          </div>
        </div>

        <div>
          <!-- HIỂN THỊ ẢNH ANIME TỰ ĐỘNG XOAY TUA -->
          <div class="card anime-card">
            <h3 style="justify-content: center; color: var(--accent-pink);">💖 Anime Waifu Companion</h3>
            <img id="anime-waifu-img" class="anime-img" src="https://pic.re/image" alt="Anime Waifu" onerror="this.src='https://pic.re/image'">
            <p style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px;">Tự động đổi ảnh waifu mỗi 12 giây ✨</p>
          </div>

          <div class="card">
            <h3>📊 Lịch Sử Ping (15 lần gần nhất)</h3>
            <p><code>${pingLogs.length > 0 ? pingLogs.map(p => `[${p.time}:${p.ping}ms]`).join(' ➔ ') : 'Đang thu thập dữ liệu...'}</code></p>
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

  const intervals = [ramGcInterval, posCheckInterval, watchdogInterval, pingInterval, socketHeartbeatInterval];
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
    const actionType = Math.floor(Math.random() * 4);

    if (actionType === 0) {
      currentBot.swingArm('right');
    } else if (actionType === 1) {
      const target = currentBot.nearestEntity(e => 
        (e.type === 'mob' || e.type === 'hostile' || e.type === 'animal' || e.type === 'player') &&
        e.position && currentBot.entity && currentBot.entity.position &&
        e.id !== currentBot.entity.id &&
        e.position.distanceTo(currentBot.entity.position) <= 3.5
      );
      if (target) currentBot.attack(target);
      else currentBot.swingArm('right');
    } else if (actionType === 2) {
      currentBot.setControlState('sneak', true);
      setTimeout(() => {
        if (bot === currentBot && bot.entity) bot.setControlState('sneak', false);
      }, Math.floor(150 + Math.random() * 200));
    } else {
      try { currentBot.activateItem(); } catch (err) {}
    }

  } catch (err) {}

  const randomDelay = Math.floor(4500 + Math.random() * 4500);
  actionTimeout = setTimeout(scheduleNextAction, randomDelay);
}

function scheduleRandomRotation() {
  if (antiAfkTimeout) clearTimeout(antiAfkTimeout);

  if (isManualStopped) return;

  const nextRotationDelay = Math.floor(15000 + Math.random() * 20000);

  antiAfkTimeout = setTimeout(() => {
    if (bot && bot.entity) {
      try {
        const deltaYaw = (Math.random() - 0.5) * 0.4;
        const deltaPitch = (Math.random() - 0.5) * 0.15;
        bot.look(bot.entity.yaw + deltaYaw, bot.entity.pitch + deltaPitch, false);
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

  console.log(`\n[HỆ THỐNG] Đang kết nối đến ${OPTIONS.host}:${OPTIONS.port}...`);

  try {
    bot = mineflayer.createBot(OPTIONS);
    bot.setMaxListeners(0);

    bot._client.on('packet', (data, meta) => {
      if (
        meta.name === 'world_particles' || 
        meta.name === 'named_sound_effect' || 
        meta.name === 'sound_effect' ||
        meta.name === 'entity_velocity'
      ) {
        return;
      }
    });

    if (bot._client) {
      bot._client.setMaxListeners(0);
      bot._client.on('error', (err) => {
        addErrorLog('Client Socket Error', err.message || err.code || 'Unknown TCP error');
      });
    }
  } catch (err) {
    addErrorLog('Init Failed', err.message);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server!');
    addChatLog('✅ Kết nối ổn định thành công!');
    triggerChatWindow(12000);

    consecutiveFailures = 0;

    try {
      if (bot._client) {
        bot._client.write('custom_payload', {
          channel: 'minecraft:brand',
          data: Buffer.from('\x07vanilla')
        });
      }
    } catch (e) {}

    if (bot._client && bot._client.socket) {
      try {
        bot._client.socket.setNoDelay(true);
        bot._client.socket.setKeepAlive(true, 3000); 
      } catch (e) {}
    }

    if (isFirstSpawn) {
      isFirstSpawn = false;

      loginTimer1 = setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat('/l Kiru2000@');
          triggerChatWindow(4000);
        }
      }, 3500);

      loginTimer2 = setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat('/afkmode vao');
          triggerChatWindow(6000);
          scheduleNextAction();
          scheduleRandomRotation();
        }
      }, 7000);

      // KHẮC PHỤC TRIỆT ĐỂ LỖI SERIALIZATION _value undefined
      socketHeartbeatInterval = setInterval(() => {
        if (!isManualStopped && bot && bot._client && !bot._client.socket.destroyed) {
          try {
            if (bot.entity && typeof bot.entity.yaw === 'number' && typeof bot.entity.pitch === 'number') {
              bot._client.write('look', {
                yaw: bot.entity.yaw,
                pitch: bot.entity.pitch,
                onGround: Boolean(bot.entity.onGround)
              });
            }
          } catch (e) {}
        }
      }, 3000);

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

        if (!isAutoActionRunning || Date.now() - lastActionTime > 15000) {
          scheduleNextAction();
        }

        if (bot.time) {
          if (bot.time.age === lastTimeAge) {
            if (Date.now() - lastTimeAgeUpdate > 45000) {
              addErrorLog('Watchdog', 'Kẹt Packet thế giới quá 45s. Đang tiến hành Reconnect...');
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
    addErrorLog('Event Chết', 'Bot bị quái hoặc người chơi đánh tử vong');

    respawnTimer = setTimeout(() => {
      if (bot && bot._client && !isManualStopped) {
        try { bot.respawn(); } catch (e) {}
      }

      setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Đã hồi sinh -> /afkmode vao');
          triggerChatWindow(5000);
          scheduleNextAction();
          scheduleRandomRotation();
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

      if (lowerText.includes('kiru')) {
        addKiruLog(text);
      }

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
    addErrorLog('Mất Kết Nối (End)', `Đường truyền bị ngắt: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    addErrorLog('Mineflayer Error', err.message || err.toString());
  });

  bot.on('kicked', (reason) => {
    addErrorLog('Bị Server Kick', typeof reason === 'string' ? reason : JSON.stringify(reason));
    handleReconnect();
  });
}

function handleReconnect() {
  if (isManualStopped || isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  consecutiveFailures++;

  if (consecutiveFailures >= 10) {
    addErrorLog('CẢNH BÁO NẶNG', 'Mất kết nối nhiều lần. Khởi động lại toàn bộ tiến trình...');
    setTimeout(() => {
      process.exit(1);
    }, 3000);
    return;
  }

  if (currentReconnectDelay < 30000) {
    currentReconnectDelay = 30000;
  }

  console.log(`⏳ Đang chờ ${currentReconnectDelay / 1000}s để tái kết nối...`);
  
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
