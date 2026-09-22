const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

// --- CẤU HÌNH BOT ---
const OPTIONS = {
  host: 'vangioinetwork.xyz', 
  port: 19000,               
  username: 'Kiru',   
  hideErrors: true,
  checkTimeoutInterval: 120 * 1000,
  physicsEnabled: false,            // Tắt vật lý 3D tiết kiệm RAM
  viewDistance: 'tiny'              // Giảm tầm nhìn tiết kiệm RAM
};

// --- QUẢN LÝ TRẠNG THÁI & CHAT LOGS ---
let bot = null;
let failCount = 0;
let reconnectTimeout = null; 
let clickInterval = null;
let keepAliveInterval = null;
let healthCheckInterval = null;
let loginTimer1 = null;      
let loginTimer2 = null;      
let loginTimer3 = null;      // Timer lặp lại lệnh /afkmode vao
let isReconnecting = false;  
let isFirstSpawn = true;     
let isClicking = false;
let lastClickAction = 'Chưa bật';
const startTime = Date.now();
const serverChatLogs = []; // Lưu 15 tin nhắn chat gần nhất

function addChatLog(msg) {
  serverChatLogs.unshift(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
  if (serverChatLogs.length > 15) serverChatLogs.pop();
}

// --- BẢNG ĐIỀU KHIỂN WEB TRỰC QUAN ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

  // Lấy danh sách vật phẩm trong túi đồ
  let inventoryHTML = '<i>Túi đồ trống hoặc chưa vào game...</i>';
  if (bot && bot.inventory) {
    const items = bot.inventory.items();
    if (items.length > 0) {
      inventoryHTML = '<ul style="margin: 5px 0; padding-left: 20px;">' + 
        items.map(item => `<li><b>${item.displayName || item.name}</b> x${item.count}</li>`).join('') + 
        '</ul>';
    } else {
      inventoryHTML = '<i>Túi đồ đang trống.</i>';
    }
  }

  // Lấy tọa độ bot
  let posText = 'Chưa xác định';
  if (bot && bot.entity) {
    posText = `X: ${Math.round(bot.entity.position.x)}, Y: ${Math.round(bot.entity.position.y)}, Z: ${Math.round(bot.entity.position.z)}`;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta http-equiv="refresh" content="5">
      <title>Minecraft AFK Bot Monitor</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; margin: 0; }
        .card { background: #1e293b; padding: 15px; margin-bottom: 15px; border-radius: 10px; border: 1px solid #334155; }
        h2 { margin-top: 0; color: #38bdf8; }
        .badge-on { background: #22c55e; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .badge-off { background: #ef4444; color: #fff; padding: 3px 8px; border-radius: 5px; font-weight: bold; }
        .chat-box { background: #090d16; padding: 10px; border-radius: 5px; font-family: monospace; max-height: 200px; overflow-y: auto; color: #e2e8f0; }
      </style>
    </head>
    <body>
      <h2>🤖 Minecraft AFK Bot Dashboard</h2>
      
      <div class="card">
        <h3>📌 Trạng Thái Hệ Thống</h3>
        <p>🟢 <b>Bot Status:</b> ${bot ? '<span class="badge-on">ONLINE</span>' : '<span class="badge-off">OFFLINE</span>'}</p>
        <p>🖱️ <b>Auto Clicker:</b> ${isClicking ? `<span class="badge-on">ĐANG HOẠT ĐỘNG (${lastClickAction})</span>` : '<span class="badge-off">TẮT</span>'}</p>
        <p>📍 <b>Tọa độ Bot:</b> ${posText}</p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM:</b> ${memoryUsage} MB / 512 MB</p>
      </div>

      <div class="card">
        <h3>🎒 Vật Phẩm Trong Túi Đồ (Đã Nhặt)</h3>
        ${inventoryHTML}
      </div>

      <div class="card">
        <h3>💬 Nhật Ký Chat Server (15 tin nhắn mới nhất)</h3>
        <div class="chat-box">
          ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có tin nhắn...</i>'}
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`[HTTP SERVER] Đang chạy tại port ${port}`);
});

// --- HÀM DỌN DẸP BỘ NHỚ ---
function cleanupBot() {
  isClicking = false;
  lastClickAction = 'Tắt';
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  if (clickInterval) { clearInterval(clickInterval); clickInterval = null; }
  if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
  if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
  if (loginTimer1) { clearTimeout(loginTimer1); loginTimer1 = null; }
  if (loginTimer2) { clearTimeout(loginTimer2); loginTimer2 = null; }
  if (loginTimer3) { clearTimeout(loginTimer3); loginTimer3 = null; }

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

  if (global.gc) { try { global.gc(); } catch (e) {} }
}

function createBot() {
  cleanupBot();
  isFirstSpawn = true; 

  console.log(`\n[HỆ THỐNG] Đang kết nối đến ${OPTIONS.host}:${OPTIONS.port}...`);
  addChatLog(`[HỆ THỐNG] Đang kết nối đến server...`);
  
  try {
    bot = mineflayer.createBot(OPTIONS);
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] ❌ ${err.message}`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server!');
    addChatLog('✅ Bot đã vào server thành công!');
    failCount = 0; 
    isReconnecting = false;

    if (isFirstSpawn) {
      isFirstSpawn = false;

      // Giữ kết nối socket bằng cách xoay nhẹ góc nhìn
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      keepAliveInterval = setInterval(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          try {
            if (bot.entity) {
              bot.look(bot.entity.yaw + 0.05, bot.entity.pitch, true);
            }
          } catch (e) {}
        }
      }, 10000);

      // 1. TỰ ĐỘNG ĐĂNG NHẬP (Sau 10s)
      loginTimer1 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/l Kiru2000@');
          console.log('[LOG] ⌨️ Đã gõ: /l ***');
          addChatLog('⌨️ Đã gửi lệnh đăng nhập (/l ***)');
        }
      }, 10000);

      // 2. NHẬP LỆNH /AFKMODE VAO LẦN 1 (Sau 20s)
      loginTimer2 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/afkmode vao');
          console.log('[LOG] ⌨️ Đã gõ: /afkmode vao (lần 1)');
          addChatLog('⌨️ Đã gửi lệnh: /afkmode vao (lần 1)');
        }
      }, 20000);

      // 3. NHẬP LẠI LỆNH /AFKMODE VAO LẦN 2 (Sau lần 1 đúng 20 giây = mốc 40s)
      loginTimer3 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/afkmode vao');
          console.log('[LOG] ⌨️ Đã gõ: /afkmode vao (lần 2 - sau 20s)');
          addChatLog('⌨️ Đã gửi lại lệnh: /afkmode vao (lần 2)');
          
          // Bật Clicker sau khi hoàn tất chuỗi lệnh
          startAutoClicker();
        }
      }, 40000);

      // Health Check
      if (healthCheckInterval) clearInterval(healthCheckInterval);
      healthCheckInterval = setInterval(() => {
        const isSocketDead = !bot || !bot._client || !bot._client.socket || bot._client.socket.destroyed;
        if (isSocketDead) handleReconnect(); 
      }, 300 * 1000);
    }
  });

  // THEO DÕI CHAT SERVER
  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (text) {
        addChatLog(text);
        console.log('[CHAT]: ' + text);
      }
    } catch (e) {}
  });

  // SỰ KIỆN NHẶT VẬT PHẨM
  bot.on('playerCollect', (collector, itemEntity) => {
    try {
      if (collector && bot.entity && collector.id === bot.entity.id) {
        addChatLog(`🎒 Vừa nhặt được vật phẩm mới! (Kiểm tra túi đồ)`);
        console.log(`[TÚI ĐỒ] 🎒 Đã nhặt được vật phẩm mới.`);
      }
    } catch (e) {}
  });

  bot.on('end', (reason) => {
    console.log(`[VĂNG GAME] ❌ Mất kết nối: ${reason}`);
    addChatLog(`❌ Văng game: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    console.log(`[LỖI MẠNG] ❌ ${err.message}`);
    addChatLog(`❌ Lỗi mạng: ${err.message}`);
    handleReconnect();
  });

  bot.on('kicked', (reason) => {
    console.log(`[BỊ KICK] ⚠️ ${reason}`);
    addChatLog(`⚠️ Bị kick: ${reason}`);
  });
}

// BẬT AUTO CLICKER VÀ CẬP NHẬT TRẠNG THÁI
function startAutoClicker() {
  let clickState = 'left';
  isClicking = true;
  if (clickInterval) clearInterval(clickInterval);
  
  clickInterval = setInterval(() => {
    try {
      if (!bot || !bot._client || bot._client.socket.destroyed) {
        isClicking = false;
        return;
      }
      
      if (clickState === 'left') {
        bot.swingArm('right');
        lastClickAction = 'Click Trái (Swing Arm)';
        clickState = 'right';
      } else {
        bot.activateItem();
        lastClickAction = 'Click Phải (Use Item)';
        clickState = 'left';
      }
    } catch (err) {}
  }, 600);
}

function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;

  cleanupBot();

  let waitTime = 15 + (failCount * 5);
  if (waitTime > 60) waitTime = 60;

  addChatLog(`⏳ Hẹn giờ kết nối lại sau ${waitTime} giây...`);

  reconnectTimeout = setTimeout(() => {
    failCount++;
    createBot();
  }, waitTime * 1000);
}

createBot();

process.on('uncaughtException', (err) => {
  if (err.name === 'PartialReadError' || (err.message && err.message.includes('packet_world_particles'))) return;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EPIPE' || err.code === 'ENOTFOUND') return;
  console.log('[LỖI UNCAUGHT]:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.log('[LỖI PROMISE UNHANDLED]:', reason);
});
        
