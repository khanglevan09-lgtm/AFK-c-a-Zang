const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

// --- CẤU HÌNH BOT AFK TỐI ƯU BỘ NHỚ ---
const OPTIONS = {
  host: 'vangioinetwork.xyz', 
  port: 19000,               
  username: 'Kiru',   
  hideErrors: true,
  checkTimeoutInterval: 120 * 1000, // Tăng thời gian chờ timeout lên 120 giây
  physicsEnabled: false,            // TẮT VẬT LÝ 3D: Cắt giảm 70% dung lượng RAM tiêu thụ
  viewDistance: 'tiny'              // TẮT TẢI CHUNK: Không lưu bản đồ xung quanh vào RAM
};

// --- QUẢN LÝ TRẠNG THÁI TOÀN CỤC ---
let bot = null;
let failCount = 0;
let reconnectTimeout = null; 
let clickInterval = null;
let keepAliveInterval = null;
let healthCheckInterval = null;
let loginTimer1 = null;      
let loginTimer2 = null;      
let isReconnecting = false;  
let isFirstSpawn = true;     
const startTime = Date.now();

// --- BẢNG ĐIỀU KHIỂN WEB (MONITOR RAM REALTIME) ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  
  res.send(`
    <div style="font-family: Arial, sans-serif; padding: 20px; background: #121212; color: #fff; border-radius: 8px;">
      <h2>🤖 Minecraft AFK Bot - System Status</h2>
      <p>🟢 <b>Trạng thái Web:</b> Running</p>
      <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút</p>
      <p>📊 <b>RAM Đang Dùng:</b> ${memoryUsage} MB / 512 MB</p>
      <p>🔄 <b>Số lần Reconnect thất bại:</b> ${failCount}</p>
      <p>🎮 <b>Target Server:</b> ${OPTIONS.host}:${OPTIONS.port}</p>
    </div>
  `);
});

app.listen(port, () => {
  console.log(`[HTTP SERVER] Đang chạy tại port ${port}`);
});

// --- HÀM DỌN DẸP SẠCH BỘ NHỚ & TRIỆT TÊU LEAK RAM ---
function cleanupBot() {
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  if (clickInterval) { clearInterval(clickInterval); clickInterval = null; }
  if (keepAliveInterval) { clearInterval(keepAliveInterval); keepAliveInterval = null; }
  if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
  if (loginTimer1) { clearTimeout(loginTimer1); loginTimer1 = null; }
  if (loginTimer2) { clearTimeout(loginTimer2); loginTimer2 = null; }

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

  // Ép Garbage Collector thu hồi RAM nếu được kích hoạt
  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }
}

function createBot() {
  cleanupBot();
  isFirstSpawn = true; 

  console.log(`\n[HỆ THỐNG] Đang kết nối đến ${OPTIONS.host}:${OPTIONS.port}...`);
  
  try {
    bot = mineflayer.createBot(OPTIONS);
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] ❌ Không thể tạo instance bot: ${err.message}`);
    handleReconnect();
    return;
  }

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server thành công!');
    failCount = 0; 
    isReconnecting = false;

    if (isFirstSpawn) {
      isFirstSpawn = false;

      // CHUỖI GỬI PACKET DỰ TRỮ KẾT NỐI (MỖI 10 GIÂY XOAY NHẸ + VẪY TAY)
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      keepAliveInterval = setInterval(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          try {
            bot.swingArm('right');
            if (bot.entity) {
              bot.look(bot.entity.yaw + 0.05, bot.entity.pitch, true);
            }
          } catch (e) {}
        }
      }, 10000);

      // 1. CHUỖI LỆNH ĐĂNG NHẬP
      loginTimer1 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/l Kiru2000@');
          console.log('[LOG] ⌨️ Đã gõ lệnh: /l ***');
        }
      }, 10000);

      loginTimer2 = setTimeout(() => {
        if (bot && bot._client && !bot._client.socket.destroyed) {
          bot.chat('/afkmode vao');
          console.log('[LOG] ⌨️ Đã gõ lệnh: /afkmode vao');
          
          startAutoClicker();
        }
      }, 20000);

      // 2. GIÁM SÁT KẾT NỐI (HEALTH CHECK)
      if (healthCheckInterval) clearInterval(healthCheckInterval);
      healthCheckInterval = setInterval(() => {
        const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        console.log(`[GIÁM SÁT] Kiểm tra bot - RAM: ${memoryUsage} MB`);

        const isSocketDead = !bot || !bot._client || !bot._client.socket || bot._client.socket.destroyed;
        if (isSocketDead) {
          console.log('[CẢNH BÁO] ⚠️ Phát hiện mất kết nối ngầm. Reconnect!');
          handleReconnect(); 
        }
      }, 300 * 1000); // Kiểm tra mỗi 5 phút
    }
  });

  bot.on('message', (message) => {
    try {
      const text = message.toString();
      const myName = OPTIONS.username;
      if (text.includes('Kiru') || (myName && text.includes(myName))) {
        console.log('[SERVER CHAT]: ' + text);
      }
    } catch (e) {}
  });

  bot.on('end', (reason) => {
    console.log(`[VĂNG GAME] ❌ Mất kết nối: ${reason}`);
    handleReconnect();
  });

  bot.on('error', (err) => {
    console.log(`[LỖI MẠNG] ❌ Sự cố kết nối: ${err.message}`);
    handleReconnect();
  });

  bot.on('kicked', (reason) => {
    console.log(`[BỊ KICK] ⚠️ Server đã đá bot: ${reason}`);
  });
}

function startAutoClicker() {
  let clickState = 'left';
  if (clickInterval) clearInterval(clickInterval);
  
  clickInterval = setInterval(() => {
    try {
      if (!bot || !bot._client || bot._client.socket.destroyed) return;
      
      if (clickState === 'left') {
        bot.swingArm('right');
        clickState = 'right';
      } else {
        bot.activateItem();
        clickState = 'left';
      }
    } catch (err) {}
  }, 600); // Tần số click 600ms giúp giảm tải gửi packet
}

function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;

  cleanupBot();

  let waitTime = 15 + (failCount * 5);
  if (waitTime > 60) waitTime = 60;

  console.log(`[RECONNECT] ⏳ Hẹn giờ kết nối lại sau ${waitTime} giây...`);

  reconnectTimeout = setTimeout(() => {
    failCount++;
    console.log(`[RECONNECT] 🔄 Đang kết nối lại lần thứ ${failCount}...`);
    createBot();
  }, waitTime * 1000);
}

createBot();

// --- CHỐNG SẬP APP CẤP HỆ THỐNG ---
process.on('uncaughtException', (err) => {
  if (err.name === 'PartialReadError' || (err.message && err.message.includes('packet_world_particles'))) return;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EPIPE' || err.code === 'ENOTFOUND') {
    return;
  }
  console.log('[LỖI UNCAUGHT]:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.log('[LỖI PROMISE UNHANDLED]:', reason);
});
    
