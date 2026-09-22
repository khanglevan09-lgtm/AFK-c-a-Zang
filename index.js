const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

// --- CẤU HÌNH BOT (ĐÃ BẬT LẠI VẬT LÝ 3D) ---
const OPTIONS = {
  host: 'vangioinetwork.xyz', 
  port: 19000,               
  username: 'Kiru',   
  hideErrors: true,
  checkTimeoutInterval: 120 * 1000,
  physicsEnabled: true,             // ✅ ĐÃ KÍCH HOẠT LẠI VẬT LÝ 3D để nhận lực đẩy di chuyển
  viewDistance: 'tiny'              // Giữ tầm nhìn nhỏ để tiết kiệm RAM khi bật physics
};

// --- QUẢN LÝ TRẠNG THÁI TOÀN CỤC ---
let bot = null;
let failCount = 0;
let reconnectTimeout = null; 
let isReconnecting = false;  
let isFirstSpawn = true;     

// Timers & Intervals
let clickInterval = null;
let keepAliveInterval = null;
let connCheckInterval = null;
let ramGcInterval = null;
let posCheckInterval = null;
let afkStagnantCheckInterval = null;
let clickWatchdogInterval = null;
let loginTimer1 = null;      
let loginTimer2 = null;      
let loginTimer3 = null;      

// Dữ liệu theo dõi Realtime
let isClicking = false;
let lastClickTime = Date.now();
let currentCoords = 'Đang xác định...';
let lastPosition = null;
let positionStagnantCount = 0;
const collectedItems = {}; 
const serverChatLogs = [];
const startTime = Date.now();

function addChatLog(msg) {
  serverChatLogs.unshift(`[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`);
  if (serverChatLogs.length > 15) serverChatLogs.pop();
}

// --- BẢNG ĐIỀU KHIỂN WEB DASHBOARD ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

  let itemsHTML = '<i>Chưa nhặt được vật phẩm nào trong phiên này...</i>';
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
      <meta http-equiv="refresh" content="5">
      <title>Minecraft AFK Bot Dashboard</title>
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
      <h2>🤖 Minecraft AFK Bot (Kiru) Dashboard</h2>
      
      <div class="card">
        <h3>📌 Trạng Thái Bot</h3>
        <p>🟢 <b>Kết nối Server:</b> ${bot ? '<span class="badge-on">ONLINE</span>' : '<span class="badge-off">OFFLINE</span>'}</p>
        <p>🖱️ <b>Auto Clicker (1s/lần):</b> ${isClicking ? '<span class="badge-on">ĐANG CHẠY</span>' : '<span class="badge-off">TẮT</span>'}</p>
        <p>📍 <b>Tọa độ (Báo mỗi 10s):</b> <code>${currentCoords}</code></p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM:</b> ${memoryUsage} MB / 512 MB</p>
      </div>

      <div class="card">
        <h3>🎒 Thống Kê Vật Phẩm Đã Nhặt</h3>
        ${itemsHTML}
      </div>

      <div class="card">
        <h3>💬 Nhật Ký Chat Server (15 tin gần nhất)</h3>
        <div class="chat-box">
          ${serverChatLogs.length > 0 ? serverChatLogs.map(l => `<div>${l}</div>`).join('') : '<i>Chưa có nhật ký...</i>'}
        </div>
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => console.log(`[HTTP SERVER] Đang chạy tại port ${port}`));

// --- HÀM DỌN DẸP BỘ NHỚ ---
function cleanupBot() {
  isClicking = false;
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (clickInterval) clearInterval(clickInterval);
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  if (connCheckInterval) clearInterval(connCheckInterval);
  if (ramGcInterval) clearInterval(ramGcInterval);
  if (posCheckInterval) clearInterval(posCheckInterval);
  if (afkStagnantCheckInterval) clearInterval(afkStagnantCheckInterval);
  if (clickWatchdogInterval) clearInterval(clickWatchdogInterval);
  if (loginTimer1) clearTimeout(loginTimer1);
  if (loginTimer2) clearTimeout(loginTimer2);
  if (loginTimer3) clearTimeout(loginTimer3);

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

  if (global.gc) {
    try { global.gc(); } catch (e) {}
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

  console.log(`\n[HỆ THỐNG] Đang kết nối đến ${OPTIONS.host}:${OPTIONS.port}...`);
  addChatLog(`[HỆ THỐNG] Đang kết nối đến server...`);
  
  try {
    bot = mineflayer.createBot(OPTIONS);
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO]: ${err.message}`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server thành công!');
    addChatLog('✅ Bot đã vào server!');
    failCount = 0; 
    isReconnecting = false;

    if (isFirstSpawn) {
      isFirstSpawn = false;

      // 1. CHUỖI ĐĂNG NHẬP (10s -> 20s -> 40s)
      loginTimer1 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/l Kiru2000@');
          addChatLog('⌨️ Đã gõ: /l ***');
        }
      }, 10000);

      loginTimer2 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Đã gõ: /afkmode vao (Lần 1)');
        }
      }, 20000);

      loginTimer3 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Đã gõ lại: /afkmode vao (Lần 2)');
          startAutoClicker();
        }
      }, 40000);

      // 2. DỌN DẸP RAM ĐỊNH KỲ 2 PHÚT
      ramGcInterval = setInterval(() => {
        const memBefore = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
        const memAfter = (processmemoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        console.log(`[DỌN RAM] 🧹 Dọn RAM chu kỳ 2 phút: ${memBefore}MB -> ${memAfter}MB`);
      }, 120 * 1000);

      // 3. KIỂM TRA KẾT NỐI MỖI 3 PHÚT
      connCheckInterval = setInterval(() => {
        if (!bot || !bot._client || !bot._client.socket || bot._client.socket.destroyed) {
          console.log('[KẾT NỐI] ⚠️ Mất socket! Đang kết nối lại...');
          addChatLog('⚠️ Phát hiện mất kết nối qua kiểm tra 3 phút!');
          handleReconnect();
        } else {
          try { bot.swingArm('right'); } catch (e) {}
          console.log('[KẾT NỐI] 🟢 Kiểm tra 3 phút: Kết nối ổn định.');
        }
      }, 180 * 1000);

      // 4. KIỂM TRA TỌA ĐỘ MỖI 10 GIÂY (Hiển thị chi tiết chữ số thập phân)
      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
          console.log(`[TỌA ĐỘ] 📍 ${currentCoords}`);
        }
      }, 10 * 1000);

      // 5. AUTO CLICKER WATCHDOG (Tự kích hoạt lại nếu ngừng)
      clickWatchdogInterval = setInterval(() => {
        const timeDiff = Date.now() - lastClickTime;
        if (!isClicking || timeDiff > 4000) {
          console.log('[WATCHDOG] ⚠️ Clicker bị ngưng -> Tự bật lại clicker!');
          addChatLog('⚠️ Auto clicker ngưng hoạt động -> Khởi động lại!');
          startAutoClicker();
        }
      }, 15 * 1000);

      // 6. KIỂM TRA BOT ĐỨNG IM (Đứng yên 2 lần liên tiếp -> Gửi /tusat)
      afkStagnantCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          
          // So sánh tọa độ thực tế có biến động quá 0.2 block không
          if (lastPosition && Math.abs(pos.x - lastPosition.x) < 0.2 && Math.abs(pos.z - lastPosition.z) < 0.2) {
            positionStagnantCount++;
            console.log(`[AFK CHECK] ⚠️ Bot không di chuyển lần ${positionStagnantCount}/2`);
            
            if (positionStagnantCount >= 2) { 
              console.log('[AFK CHECK] ☠️ Bot kẹt tọa độ 2 lần liên tiếp -> Thực hiện /tusat!');
              addChatLog('☠️ Bot không di chuyển 2 lần -> Gửi /tusat');
              bot.chat('/tusat');
              positionStagnantCount = 0;
            }
          } else {
            positionStagnantCount = 0;
          }
          lastPosition = { x: pos.x, y: pos.y, z: pos.z };
        }
      }, 60 * 1000); 

      // 7. CHỐNG ANTI-BOT (Nhích nhẹ góc nhìn ngẫu nhiên mỗi 12s)
      keepAliveInterval = setInterval(() => {
        if (bot && bot.entity && bot._client && !bot._client.socket.destroyed) {
          try {
            const randomYaw = (Math.random() - 0.5) * 0.1;
            const randomPitch = (Math.random() - 0.5) * 0.1;
            bot.look(bot.entity.yaw + randomYaw, bot.entity.pitch + randomPitch, true);
          } catch (e) {}
        }
      }, 12 * 1000);
    }
  });

  // TỰ ĐỘNG HỒI SINH KHI CHẾT Hoặc DÙNG /TUSAT
  bot.on('death', () => {
    console.log('[TRẠNG THÁI] 💀 Bot đã chết! Chuẩn bị hồi sinh...');
    addChatLog('💀 Bot đã chết! Tự động hồi sinh sau 2s...');
    
    setTimeout(() => {
      if (bot && bot._client && !bot._client.socket.destroyed) {
        try { bot.respawn(); } catch (e) {}
      }
    }, 2000);

    setTimeout(() => {
      if (bot && bot._client && !bot._client.socket.destroyed) {
        bot.chat('/afkmode vao');
        addChatLog('⌨️ Hồi sinh hoàn tất -> Gửi lại lệnh /afkmode vao');
      }
    }, 7000);
  });

  // BẮT SỰ KIỆN NHẶT ĐỒ
  bot.on('playerCollect', (collector, itemEntity) => {
    try {
      if (collector && bot.entity && collector.id === bot.entity.id) {
        let itemName = 'Vật phẩm drop';
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
        addChatLog(`🎒 Nhặt được: ${itemName}`);
        console.log(`[NHẶT ĐỒ] 🎒 Đã nhặt: ${itemName} (Tổng: ${collectedItems[itemName]})`);
      }
    } catch (e) {}
  });

  // LẮNG NGHE CHAT SERVER
  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (text) {
        addChatLog(text);
        console.log('[SERVER CHAT]: ' + text);
      }
    } catch (e) {}
  });

  bot.on('end', (reason) => {
    console.log(`[VĂNG GAME] ❌ Mất kết nối: ${reason}`);
    addChatLog(`❌ Mất kết nối: ${reason}`);
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

// CHỐNG CRASH HỆ THỐNG
process.on('uncaughtException', (err) => {
  if (err.name === 'PartialReadError' || (err.message && err.message.includes('packet_world_particles'))) return;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EPIPE' || err.code === 'ENOTFOUND') return;
  console.log('[LỖI UNCAUGHT]:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.log('[LỖI PROMISE UNHANDLED]:', reason);
});
  
