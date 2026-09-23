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
  hideErrors: true,
  checkTimeoutInterval: 120 * 1000, 
  keepAlive: true,
  physicsEnabled: true,
  viewDistance: 'tiny'
};

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isFirstSpawn = true;

let currentReconnectDelay = 30000; // Giảm thời gian chờ kết nối lại xuống 30s
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

let lastTimeAge = 0;
let lastTimeAgeUpdate = Date.now();

// HÀM LẤY GIỜ VIỆT NAM CHUẨN (UTC+7)
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

function triggerChatWindow(durationMs = 8000) {
  isAwaitingResponse = true;
  if (commandResponseTimer) clearTimeout(commandResponseTimer);
  commandResponseTimer = setTimeout(() => {
    isAwaitingResponse = false;
  }, durationMs);
}

app.get('/api/ping', (req, res) => res.send('PONG_OK'));

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

app.get('/api/clear-error-log', (req, res) => {
  errorLogs.length = 0;
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

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Minecraft Bot - VN Time & Anti-ECONNRESET</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #090d16; color: #f8fafc; padding: 20px; margin: 0; }
        .card { background: #161e2e; padding: 15px; margin-bottom: 15px; border-radius: 10px; border: 1px solid #273549; }
        h2 { margin-top: 0; color: #38bdf8; }
        .badge-on { background: #22c55e; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .badge-off { background: #ef4444; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .chat-box { background: #060911; padding: 10px; border-radius: 5px; font-family: monospace; height: 200px; overflow-y: auto; color: #38bdf8; }
        .error-box { background: #180909; padding: 10px; border-radius: 5px; font-family: monospace; height: 200px; overflow-y: auto; color: #f87171; border: 1px solid #7f1d1d; }
        .input-group { display: flex; gap: 10px; margin-top: 10px; }
        input[type="text"] { flex: 1; padding: 10px; border-radius: 5px; border: 1px solid #334155; background: #0b0f19; color: white; }
        button { padding: 10px 20px; background: #2563eb; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        button:hover { background: #1d4ed8; }
        .btn-danger { background: #ef4444; }
        .btn-danger:hover { background: #dc2626; }
        .btn-warning { background: #f59e0b; color: black; }
        .btn-warning:hover { background: #d97706; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
        @media (max-width: 768px) { .grid-2 { grid-template-columns: 1fr; } }
      </style>
      <script>
        setInterval(() => { 
          const input = document.getElementById('cmd-input');
          if (!input || document.activeElement !== input) { location.reload(); }
        }, 5000);
      </script>
    </head>
    <body>
      <h2>🛡️ Minecraft Bot Control Center (Múi Giờ VN & Chống ECONNRESET)</h2>
      
      <div class="card">
        <h3>📌 Trạng Thái Bot</h3>
        <p>🟢 <b>Kết Nối Server:</b> ${bot ? '<span class="badge-on">ONLINE</span>' : `<span class="badge-off">RECONNECTING (${currentReconnectDelay / 1000}s)</span>`}</p>
        <p>📶 <b>Ping Hiện Tại:</b> <b style="color: #38bdf8;">${currentPing} ms</b> | 📍 <b>Tọa Độ:</b> <code>${currentCoords}</code></p>
        <p>🗡️ <b>Trang Bị:</b> <code>${currentWeapon}</code> | 📦 <b>Nhặt Vật Phẩm:</b> ${collectedCount} lần</p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM Heap:</b> ${memoryUsage} MB | 🕒 <b>Giờ VN:</b> ${getVNTime()}</p>
      </div>

      <div class="card">
        <h3>⚙️ Thao Tác Điều Khiển</h3>
        <form class="input-group" action="/api/command" method="POST">
          <input type="text" id="cmd-input" name="command" placeholder="Gửi lệnh hoặc tin nhắn vào server..." autocomplete="off" required>
          <button type="submit">Gửi</button>
        </form>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <a href="/api/clear-error-log" style="text-decoration: none; flex: 1;"><button type="button" class="btn-warning" style="width: 100%;">🧹 Xóa Nhật Ký Lỗi</button></a>
          <a href="/api/hard-restart" style="text-decoration: none; flex: 1;" onclick="return confirm('Khởi động lại toàn bộ Tiến Trình Code?');"><button type="button" class="btn-danger" style="width: 100%;">🔄 Reset Toàn Bộ Code</button></a>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <h3>💬 Nhật Ký Chat Server</h3>
          <div class="chat-box">
            ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
          </div>
        </div>

        <div class="card">
          <h3>🚨 Nhật Ký Lỗi Phát Sinh</h3>
          <div class="error-box">
            ${errorLogs.length > 0 ? errorLogs.map(e => `<div>[${e.time}] <b>[${e.type}]</b>:${e.details}</div>`).join('') : '<div style="color:#22c55e;">Không có lỗi phát sinh!</div>'}
          </div>
        </div>
      </div>

      <div class="card">
        <h3>📊 Lịch Sử Ping (15 Lần Gần Nhất)</h3>
        <p><code>${pingLogs.length > 0 ? pingLogs.map(p => `[${p.time}:${p.ping}ms]`).join(' ➔ ') : 'Đang thu thập dữ liệu...'}</code></p>
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

  if (!bot || !bot._client || bot._client.socket.destroyed) {
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

  const nextRotationDelay = Math.floor(30000 + Math.random() * 40000);

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
        // Lọc bỏ log rác ECONNRESET để tránh làm rối bảng điều khiển
        if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
          addErrorLog('Client Socket Error', err.message || err.code || 'Unknown TCP error');
        }
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

    // BỔ SUNG CẤU HÌNH TCP KEEP-ALIVE SIÊU TẦN SỐ (5 SÂY/LẦN) ĐỂ TRÁNH RENDER TỰ NGẮT
    if (bot._client && bot._client.socket) {
      try {
        bot._client.socket.setNoDelay(true);
        bot._client.socket.setKeepAlive(true, 5000); 
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
          scheduleRandomRotation();
        }
      }, 7000);

      pingInterval = setInterval(() => {
        if (bot && bot.player) {
          currentPing = bot.player.ping || 0;
          addPingLog(currentPing);
        }
      }, 10000);

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
            if (Date.now() - lastTimeAgeUpdate > 45000) {
              addErrorLog('Watchdog', 'Mất dữ liệu kết nối (Kẹt Packet). Tự động Reconnect...');
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
      if (bot && bot._client) {
        try { bot.respawn(); } catch (e) {}
      }

      setTimeout(() => {
        if (bot && bot._client) {
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
    if (err.code !== 'ECONNRESET' && err.code !== 'EPIPE') {
      addErrorLog('Mineflayer Error', err.message || err.toString());
    }
  });

  bot.on('kicked', (reason) => {
    addErrorLog('Bị Server Kick', typeof reason === 'string' ? reason : JSON.stringify(reason));
    handleReconnect();
  });
}

function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  consecutiveFailures++;

  if (consecutiveFailures >= 8) {
    addErrorLog('CẢNH BÁO NẶNG', 'Đứt kết nối nhiều lần liên tiếp. Khởi động lại tiến trình...');
    setTimeout(() => {
      process.exit(1);
    }, 3000);
    return;
  }

  console.log(`⏳ Đang chờ ${currentReconnectDelay / 1000}s để tái kết nối...`);
  
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, currentReconnectDelay);
}

createBot();

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

  addErrorLog('Uncaught Exception', `${err.message} (${err.code || 'NO_CODE'})`);
  handleReconnect();
});

process.on('unhandledRejection', (reason) => {
  addErrorLog('Unhandled Rejection', String(reason));
});
