const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// --- CẤU HÌNH BOT AFK ---
const OPTIONS = {
  host: 'IP_SERVER_CUA_BAN', // SỬA: Thay IP server của bạn
  port: 25565,               // SỬA: Thay port (mặc định 25565)
  username: 'Ten_Bot_AFK',   // SỬA: Tên bot
  version: false,            // Tự động dò phiên bản server
  auth: 'offline',
  hideErrors: true           // Bỏ qua các packet lỗi hiển thị từ server
};

// --- QUẢN LÝ TRẠNG THÁI TOÀN CỤC ---
let bot = null;
let failCount = 0;
let reconnectTimeout = null; 
let clickInterval = null;
let healthCheckInterval = null;
let loginTimer1 = null;      
let loginTimer2 = null;      
let isReconnecting = false;  // Cờ chống Double Reconnect
let isFirstSpawn = true;     // Cờ chống lặp lệnh khi teleport/chết
const startTime = Date.now();

// --- BẢNG ĐIỀU KHIỂN WEB (GIỮ BOT ONLINE ON RENDER) ---
app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  
  res.send(`
    <div style="font-family: Arial, sans-serif; padding: 20px; background: #121212; color: #fff; border-radius: 8px;">
      <h2>🤖 Minecraft AFK Bot - System Status</h2>
      <p>🟢 <b>Trạng thái Web:</b> Running</p>
      <p>⏱️ <b>Uptime:</b> ${uptimeMinutes} phút</p>
      <p>📊 <b>RAM Đang Dùng:</b> ${memoryUsage} MB</p>
      <p>🔄 <b>Số lần Reconnect thất bại:</b> ${failCount}</p>
      <p>🎮 <b>Target Server:</b> ${OPTIONS.host}:${OPTIONS.port}</p>
    </div>
  `);
});

app.listen(port, () => {
  console.log(`[HTTP SERVER] Đang chạy tại port ${port}`);
});

// --- HÀM DỌN DẸP SẠCH BỘ NHỚ & TIMERS (TRIỆT TIÊU LEAK RAM) ---
function cleanupBot() {
  // 1. Xóa sạch tất cả các bộ đếm thời gian
  if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
  if (clickInterval) { clearInterval(clickInterval); clickInterval = null; }
  if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
  if (loginTimer1) { clearTimeout(loginTimer1); loginTimer1 = null; }
  if (loginTimer2) { clearTimeout(loginTimer2); loginTimer2 = null; }

  // 2. Cưỡng chế hủy socket và giải phóng bộ nhớ RAM tức thì
  if (bot) {
    try { bot.removeAllListeners(); } catch (e) {}
    try {
      if (bot._client) {
        bot._client.removeAllListeners();
        if (bot._client.socket) bot._client.socket.destroy(); // Hủy socket mạng trực tiếp
        bot._client.end();
      }
    } catch (e) {}
    try { bot.quit(); } catch (e) {}
    bot = null; // Gán null để Garbage Collector hốt rác RAM ngay
  }
}

function createBot() {
  // Dọn dẹp tài nguyên cũ trước khi khởi tạo
  cleanupBot();
  isFirstSpawn = true; 

  console.log(`\n[HỆ THỐNG] Đang tiến hành kết nối đến ${OPTIONS.host}:${OPTIONS.port}...`);
  
  try {
    bot = mineflayer.createBot(OPTIONS);
  } catch (err) {
    console.log(`[LỖI KHỞI TẠO] ❌ Không thể tạo instance bot: ${err.message}`);
    handleReconnect();
    return;
  }

  isReconnecting = false;

  bot.on('spawn', () => {
    console.log('[LOG] ✅ Bot đã vào server thành công!');
    failCount = 0; 
    isReconnecting = false;

    // CHỈ CHẠY CHUỖI LỆNH Ở LẦN SPAWN ĐẦU TIÊN (Tránh lặp lệnh khi teleport/chết)
    if (isFirstSpawn) {
      isFirstSpawn = false;

      // 1. CHUỖI LỆNH ĐĂNG NHẬP & AFK (10s -> Login -> 10s -> AFK)
      loginTimer1 = setTimeout(() => {
        if (bot && bot.entity) {
          bot.chat('/l Kiru2000@');
          console.log('[LOG] ⌨️ Đã gõ lệnh: /l *** (Mật khẩu đã được ẩn)');
        }

        loginTimer2 = setTimeout(() => {
          if (bot && bot.entity) {
            bot.chat('/afkmode vao');
            console.log('[LOG] ⌨️ Đã gõ lệnh: /afkmode vao');
          }
        }, 10000); 

      }, 10000);

      // 2. VÒNG LẶP CLICK CHUỘT LUÂN PHIÊN (Có try-catch chống sập khi lag/dịch chuyển)
      let clickState = 'left';
      if (clickInterval) clearInterval(clickInterval);
      
      clickInterval = setInterval(() => {
        try {
          if (!bot || !bot.entity) return;
          
          if (clickState === 'left') {
            bot.swingArm('right'); // Click trái (vung tay)
            clickState = 'right';
          } else {
            bot.activateItem();    // Click phải (dùng item/tương tác)
            clickState = 'left';
          }
        } catch (err) {
          // Bỏ qua lỗi tạm thời do xung đột gói tin
        }
      }, 330);

      // 3. GIÁM SÁT KẾT NỐI (HEALTH CHECK - Chu kỳ 10 phút)
      if (healthCheckInterval) clearInterval(healthCheckInterval);
      healthCheckInterval = setInterval(() => {
        console.log('[GIÁM SÁT] Đang kiểm tra tình trạng bot (Chu kỳ 10 phút)...');
        if (!bot || !bot.entity) {
          console.log('[CẢNH BÁO] ⚠️ Phát hiện Ghost Connection. Ép thoát để kết nối lại!');
          handleReconnect(); 
        } else {
          console.log('[GIÁM SÁT] ✅ Tình trạng ổn định.');
        }
      }, 600 * 1000);
    }
  });

  // LẮNG NGHE KÊNH CHAT (An toàn tuyệt đối với null check)
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
    console.log(`[LỖI MẠNG] ❌ Phát hiện sự cố kết nối: ${err.message}`);
    handleReconnect();
  });

  bot.on('kicked', (reason) => {
    console.log(`[BỊ KICK] ⚠️ Server đã đá bot: ${reason}`);
  });
}

// --- HÀM XỬ LÝ KẾT NỐI LẠI (XẢ RAM LẬP TỨC + TỰ ĐỘNG ĐẾM GIỜ) ---
function handleReconnect() {
  if (isReconnecting) return;
  isReconnecting = true;

  // Dọn dẹp tài nguyên và giải phóng RAM ngay lập tức khi văng game
  cleanupBot();

  // Thuật toán đếm giờ: Bắt đầu 30s, +10s mỗi lần thất bại, Tối đa 120s
  let waitTime = 30 + (failCount * 10);
  if (waitTime > 120) waitTime = 120;

  console.log(`[RECONNECT] ⏳ Hẹn giờ kết nối lại sau ${waitTime} giây...`);

  reconnectTimeout = setTimeout(() => {
    failCount++;
    console.log(`[RECONNECT] 🔄 Đang thử kết nối lại... (Lần thất bại thứ ${failCount})`);
    createBot();
  }, waitTime * 1000);
}

// Khởi động bot lần đầu
createBot();

// --- BẮT LỖI CẤP NỀN TẢNG NODEJS (CHỐNG SẬP APP TRÊN RENDER/VPS) ---
process.on('uncaughtException', (err) => {
  if (err.name === 'PartialReadError' || (err.message && err.message.includes('packet_world_particles'))) return;
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EPIPE' || err.code === 'ENOTFOUND') {
    console.log(`[LỖI MẠNG HỆ THỐNG] ⚠️ Máy chủ ngắt kết nối (${err.code})`);
    return;
  }
  console.log('[LỖI UNCAUGHT]:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.log('[LỖI PROMISE UNHANDLED]:', reason);
});
