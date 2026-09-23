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

let currentReconnectDelay = 12000; // Tăng delay mặc định lên 12s để server kịp dọn session
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
let collectedCount = 0;
let currentPing = 0;

const startTime = Date.now();
const serverChatLogs = [];
const errorLogs = [];    
const pingLogs = [];     
const kiruMentionLogs = [];

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

app.get('/api/clear-kiru-log', (req, res) => {
  kiruMentionLogs.length = 0;
  res.redirect('/');
});

app.get('/api/hard-restart', (req, res) => {
  addErrorLog('HỆ THỐNG', 'Khởi động lại tiến trình Node.js...');
  process.exit(1); 
});

app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? bot.heldItem.displayName : 'Tay không';

  let statusBadge = '<span class="badge-off">🔴 OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">⏸️ ĐÃ TẮT THỦ CÔNG (NHƯỜNG NICK)</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">🟢 ONLINE</span>';
  } else {
    statusBadge = `<span class="badge-off">🔄 RECONNECTING (${Math.round(currentReconnectDelay / 1000)}s)</span>`;
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kiru Cyber Control Hub</title>
      <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --card-bg: rgba(10, 14, 26, 0.78);
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
          padding: 20px;
          color: #f8fafc;
          min-height: 100vh;
          background: #05070f url('https://api.waifu.pics/sfw/waifu') no-repeat center center fixed;
          background-size: cover;
          transition: background-image 1s ease-in-out;
          position: relative;
        }

        /* Lớp phủ mờ giúp đọc UI rõ trên nền ảnh */
        body::before {
          content: '';
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(4, 6, 14, 0.65);
          backdrop-filter: blur(8px);
          z-index: -1;
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
          font-size: 2rem;
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
        @media (max-width: 1024px) { .container { grid-template-columns: 1fr; } }
        
        .card {
          background: var(--card-bg);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          padding: 20px;
          border-radius: 18px;
          border: 1px solid var(--border);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5);
          margin-bottom: 20px;
        }
        h3 {
          margin-top: 0;
          color: var(--accent-cyan);
          font-size: 1.15rem;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .badge-on { background: rgba(74, 222, 128, 0.2); color: #4ade80; border: 1px solid #22c55e; padding: 6px 14px; border-radius: 20px; font-weight: bold; }
        .badge-off { background: rgba(244, 63, 94, 0.2); color: #f43f5e; border: 1px solid #f43f5e; padding: 6px 14px; border-radius: 20px; font-weight: bold; }
        .badge-pause { background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid #f59e0b; padding: 6px 14px; border-radius: 20px; font-weight: bold; }
        
        .chat-box { background: rgba(0, 0, 0, 0.6); padding: 12px; border-radius: 12px; font-family: monospace; height: 220px; overflow-y: auto; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); }
        .error-box { background: rgba(20, 5, 5, 0.7); padding: 12px; border-radius: 12px; font-family: monospace; height: 220px; overflow-y: auto; color: #f87171; border: 1px solid rgba(244, 63, 94, 0.3); }
        .kiru-box { background: rgba(15, 23, 15, 0.7); padding: 12px; border-radius: 12px; font-family: monospace; height: 200px; overflow-y: auto; color: #facc15; border: 1px solid rgba(250, 204, 21, 0.3); }
        
        .input-group { display: flex; gap: 10px; margin-top: 15px; }
        input[type="text"] { flex: 1; padding: 12px 16px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.15); background: rgba(0, 0, 0, 0.5); color: white; outline: none; font-size: 1rem; }
        input[type="text"]:focus { border-color: var(--accent-pink); box-shadow: 0 0 12px rgba(244, 63, 94, 0.4); }
        
        button { padding: 12px 20px; background: linear-gradient(135deg, #e11d48, #be123c); color: white; border: none; border-radius: 12px; cursor: pointer; font-weight: bold; transition: all 0.25s ease; }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 15px rgba(225, 29, 72, 0.5); }
        .btn-stop { background: linear-gradient(135deg, #dc2626, #991b1b) !important; }
        .btn-start { background: linear-gradient(135deg, #16a34a, #15803d) !important; }
        .btn-warning { background: linear-gradient(135deg, #d97706, #b45309) !important; }
        
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
      </style>
      <script>
        // Reload trang nhẹ nếu người dùng không gõ phím
        setInterval(() => { 
          const input = document.getElementById('cmd-input');
          if (!input || document.activeElement !== input) { location.reload(); }
        }, 6000);

        // NỀN ANIME TỰ ĐỘNG ĐỔI MỖI 1 PHÚT (60000ms)
        async function rotateAnimeBg() {
          try {
            const res = await fetch('https://api.waifu.pics/sfw/waifu');
            const data = await res.json();
            if (data && data.url) {
              const img = new Image();
              img.src = data.url;
              img.onload = () => {
                document.body.style.backgroundImage = 'url("' + data.url + '")';
              };
            }
          } catch (e) {}
        }
        setInterval(rotateAnimeBg, 60000);
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
            <h3>🎮 Trạng Thái & Thao Tác Trực Tiếp</h3>
            <p>📶 <b>Ping:</b> <b style="color: var(--accent-cyan);">${currentPing} ms</b> | 📍 <b>Tọa Độ:</b> <code>${currentCoords}</code></p>
            <p>🗡️ <b>Trang Bị:</b> <code>${currentWeapon}</code> | 📦 <b>Nhặt Vật Phẩm:</b> ${collectedCount} lần</p>
            <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM Heap:</b> ${memoryUsage} MB</p>

            <form class="input-group" action="/api/command" method="POST">
              <input type="text" id="cmd-input" name="command" placeholder="Gửi lệnh hoặc chat vào server..." autocomplete="off" required>
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
            <h3>⭐ Nhật Ký Nhắc Tên [Kiru]</h3>
            <div class="kiru-box">
              ${kiruMentionLogs.length > 0 
                ? kiruMentionLogs.map(k => `<div>[${k.time}]${k.text}</div>`).join('') 
                : '<i>Chưa có tin nhắn nào nhắc đến Kiru...</i>'}
            </div>
          </div>
        </div>

        <div>
          <div class="card">
            <h3>📊 Lịch Sử Ping</h3>
            <p><code>${pingLogs.length > 0 ? pingLogs.map(p => `[${p.time}:${p.ping}ms]`).join(' ➔ ') : 'Đang thu thập...'}</code></p>
          </div>

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

// Xoay góc nhìn an toàn chuẩn API Mineflayer
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

  console.log(`\n[HỆ THỐNG] Kết nối đến ${OPTIONS.host}:${OPTIONS.port}...`);

  try {
    bot = mineflayer.createBot(OPTIONS);
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
    console.log('[LOG] ✅ Bot đã vào game!');
    addChatLog('✅ Kết nối ổn định thành công!');
    triggerChatWindow(12000);

    consecutiveFailures = 0;

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
    addChatLog('💀 Bot tử vong! Chờ hồi sinh...');
    addErrorLog('Event Chết', 'Bot tử vong');

    respawnTimer = setTimeout(() => {
      if (bot && bot._client && !isManualStopped) {
        try { bot.respawn(); } catch (e) {}
      }

      setTimeout(() => {
        if (bot && bot._client && !isManualStopped) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Hồi sinh -> /afkmode vao');
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
    addErrorLog('Mất Kết Nối (End)', `Server ngắt socket: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    addErrorLog('Mineflayer Error', err.message || err.toString());
  });

  bot.on('kicked', (reason) => {
    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
    addErrorLog('Bị Server Kick', reasonStr);
    
    // Nếu server báo lưu dữ liệu, tăng delay chờ server lưu xong
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

  console.log(`⏳ Chờ ${currentReconnectDelay / 1000}s để tái kết nối...`);
  
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
