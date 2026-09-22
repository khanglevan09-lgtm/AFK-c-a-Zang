const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

// --- CẤU HÌNH BOT (BẤT TỬ KẾT NỐI & CÓ VẬT LÝ) ---
const OPTIONS = {
  host: 'vangioinetwork.xyz', 
  port: 19000,               
  username: 'Kiru',   
  hideErrors: true,
  checkTimeoutInterval: 600 * 1000, // Tăng lên 10 phút để tránh Client tự ngắt khi mạng lag
  keepAlive: true,                  // Liên tục gửi ping giữ kết nối
  physicsEnabled: true,             // Bật vật lý để nhận lực đẩy của server
  viewDistance: 'tiny'
};

// --- QUẢN LÝ TRẠNG THÁI TOÀN CỤC ---
let bot = null;
let reconnectTimeout = null; 
let isReconnecting = false;  
let isFirstSpawn = true;     
let allowStagnantCheck = false; // Khóa kiểm tra tọa độ khi ở sảnh hoặc khi chết

// Timers & Intervals
let clickInterval = null;
let keepAliveInterval = null;
let ramGcInterval = null;
let posCheckInterval = null;
let clickWatchdogInterval = null;
let loginTimer1 = null;      
let loginTimer2 = null;      
let loginTimer3 = null;      
let respawnTimer = null;

// Dữ liệu theo dõi Realtime
let isClicking = false;
let lastClickTime = Date.now();
let currentCoords = 'Đang xác định...';
let lastPosition = null;
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
      <h2>🤖 Minecraft AFK Bot (Bất tử mạng)</h2>
      
      <div class="card">
        <h3>📌 Trạng Thái Bot</h3>
        <p>🟢 <b>Kết nối Server:</b> ${bot ? '<span class="badge-on">ONLINE</span>' : '<span class="badge-off">ĐANG RECONNECT</span>'}</p>
        <p>🖱️ <b>Auto Clicker:</b> ${isClicking ? '<span class="badge-on">ĐANG CHẠY</span>' : '<span class="badge-off">TẮT</span>'}</p>
        <p>📍 <b>Tọa độ (10s):</b> <code>${currentCoords}</code></p>
        <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút | 📊 <b>RAM:</b> ${memoryUsage} MB / 512 MB</p>
      </div>

      <div class="card">
        <h3>🎒 Thống Kê Vật Phẩm</h3>
        ${itemsHTML}
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

// --- HÀM DỌN DẸP BỘ NHỚ TRƯỚC KHI RECONNECT ---
function cleanupBot() {
  isClicking = false;
  allowStagnantCheck = false;
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  if (clickInterval) clearInterval(clickInterval);
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  if (ramGcInterval) clearInterval(ramGcInterval);
  if (posCheckInterval) clearInterval(posCheckInterval);
  if (clickWatchdogInterval) clearInterval(clickWatchdogInterval);
  if (loginTimer1) clearTimeout(loginTimer1);
  if (loginTimer2) clearTimeout(loginTimer2);
  if (loginTimer3) clearTimeout(loginTimer3);
  if (respawnTimer) clearTimeout(respawnTimer);

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
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] Tự kết nối lại ngay...`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server!');
    addChatLog('✅ Đã kết nối vào Server!');
    isReconnecting = false;

    if (isFirstSpawn) {
      isFirstSpawn = false;

      // 1. CHUỖI ĐĂNG NHẬP (10s -> 20s -> 40s)
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
          
          // Sau khi vào xong AFK, cho phép kiểm tra kẹt tọa độ
          allowStagnantCheck = true;
          if (bot.entity && bot.entity.position) {
            lastPosition = { ...bot.entity.position };
          }
        }
      }, 40000);

      // 2. DỌN DẸP RAM MỖI 2 PHÚT
      ramGcInterval = setInterval(() => {
        if (global.gc) {
          try { global.gc(); } catch (e) {}
        }
      }, 120 * 1000);

      // 3. KIỂM TRA TỌA ĐỘ VÀ KẸT 5 BLOCK / 10 GIÂY
      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
          console.log(`[TỌA ĐỘ] 📍 ${currentCoords}`);
          
          // Nếu được phép kiểm tra kẹt (đã vào afkmode, chưa chết)
          if (allowStagnantCheck && lastPosition) {
            const dx = pos.x - lastPosition.x;
            const dy = pos.y - lastPosition.y;
            const dz = pos.z - lastPosition.z;
            const distance = Math.sqrt(dx*dx + dy*dy + dz*dz); // Tính khoảng cách 3D thực tế
            
            console.log(`[AFK CHECK] Quãng đường di chuyển 10s qua: ${distance.toFixed(1)} block`);
            
            if (distance < 5.0) {
              console.log('[AFK CHECK] ☠️ Di chuyển < 5 block. KÍCH HOẠT TỰ SÁT!');
              addChatLog(`☠️ Bị kẹt (di chuyển ${distance.toFixed(1)} block). Dùng /tusat`);
              bot.chat('/tusat');
              // Khóa check lại để tránh spam /tusat khi đang nằm chết
              allowStagnantCheck = false; 
            }
          }
          // Cập nhật tọa độ cuối cùng cho chu kỳ 10s tiếp theo
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

      // 5. CHỐNG ANTI-BOT (Nhích nhẹ góc nhìn ngẫu nhiên mỗi 12s)
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

  // TỰ ĐỘNG HỒI SINH & VÀO LẠI AFK KHI CHẾT DO /TUSAT
  bot.on('death', () => {
    console.log('[TRẠNG THÁI] 💀 Bot đã chết! Tự động hồi sinh...');
    addChatLog('💀 Bot chết! Hồi sinh sau 2s...');
    
    allowStagnantCheck = false; // Ngừng kiểm tra 10s trong lúc hồi sinh

    respawnTimer = setTimeout(() => {
      if (bot && bot._client) {
        try { bot.respawn(); } catch (e) {}
      }
      
      // Chờ 5s sau khi hồi sinh để vào lại AFK Mode
      setTimeout(() => {
        if (bot && bot._client) {
          bot.chat('/afkmode vao');
          addChatLog('⌨️ Hồi sinh xong -> Lệnh /afkmode vao');
          
          // Reset tọa độ và bật lại kiểm tra kẹt
          if (bot.entity && bot.entity.position) {
            lastPosition = { ...bot.entity.position };
          }
          allowStagnantCheck = true;
        }
      }, 5000);

    }, 2000);
  });

  // BẮT SỰ KIỆN NHẶT ĐỒ
  bot.on('playerCollect', (collector, itemEntity) => {
    try {
      if (collector && bot.entity && collector.id === bot.entity.id) {
        let itemName = 'Vật phẩm';
        if (itemEntity && itemEntity.metadata) {
          const metaVals = Object.values(itemEntity.metadata);
          for (const val of metaVals) {
            if (val && typeof val === 'object' && val.displayName) {
              itemName = val.displayName; break;
            }
          }
        }
        collectedItems[itemName] = (collectedItems[itemName] || 0) + 1;
      }
    } catch (e) {}
  });

  // GHI LOG CHAT
  bot.on('message', (message) => {
    try {
      const text = message.toString().trim();
      if (text) {
        addChatLog(text);
        console.log('[CHAT]: ' + text);
      }
    } catch (e) {}
  });

  // XỬ LÝ MỌI SỰ CỐ NGẮT KẾT NỐI -> ÉP RECONNECT NGAY LẬP TỨC 2s
  bot.on('end', (reason) => {
    console.log(`[VĂNG GAME] ❌ Ngắt kết nối. Đang ép vào lại...`);
    addChatLog(`❌ Rớt mạng: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    console.log(`[LỖI MẠNG] ❌ Cố tình phớt lờ lỗi để giữ kết nối.`);
    // Không ném lỗi ra ngoài, Mineflayer sẽ tự fire 'end' nếu đứt hẳn
  });

  bot.on('kicked', (reason) => {
    console.log(`[BỊ KICK] ⚠️ Bị đá khỏi Server. Ép vào lại...`);
    addChatLog(`⚠️ Bị Kick: ${reason}`);
    handleReconnect();
  });
}

// HÀM ÉP KẾT NỐI LẠI TRONG VÒNG 2 GIÂY MÀ KHÔNG CHỜ ĐỢI DÀI
function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;
  cleanupBot();

  console.log(`⏳ Đang ép hệ thống kết nối lại sau 2 giây...`);
  addChatLog(`⏳ Bắt buộc kết nối lại ngay lập tức...`);

  reconnectTimeout = setTimeout(() => {
    createBot();
  }, 2000);
}

// KHỞI CHẠY BOT LẦN ĐẦU
createBot();

// BỨC TƯỜNG BẢO VỆ CHỐNG CRASH NODEJS DÙ BẤT CỨ LỖI GÌ XẢY RA
process.on('uncaughtException', (err) => {
  // Hoàn toàn im lặng bắt các lỗi Network, Socket, Parsing để không sập tiến trình Web
  if (err.name === 'PartialReadError' || (err.message && err.message.includes('packet_world_particles'))) return;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EPIPE' || err.code === 'ENOTFOUND') return;
});

process.on('unhandledRejection', (reason) => {
  // Im lặng phớt lờ lỗi bất đồng bộ
});
