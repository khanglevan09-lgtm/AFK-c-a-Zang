const mineflayer = require('mineflayer')
const express = require('express')

const app = express()
const port = process.env.PORT || 3000

// Tạo web server ảo để Render không báo lỗi
app.get('/', (req, res) => {
  res.send('Bot AFK Minecraft đang hoạt động!')
})

app.listen(port, () => {
  console.log(`HTTP Server running on port ${port}`)
})

function createBot() {
  const bot = mineflayer.createBot({
    host: 'vangioinetwork.xyz', // SỬA: Thay IP server của bạn vào đây
    port: 25565,               // SỬA: Thay port nếu server có port riêng
    username: 'Kiru',   // SỬA: Tên nhân vật bot của bạn
    version: '1.21.4',         // Phiên bản Minecraft
    auth: 'offline'            // Chế độ dành cho server crack/offline
  })

  bot.on('spawn', () => {
    console.log('[LOG] Bot đã vào server thành công!')
    
    // Tự động gõ lệnh /login sau khi vào server 3 giây
    setTimeout(() => {
      bot.chat('/l Kiru2000@') // SỬA: Thay mật khẩu của bạn
      console.log('[LOG] Đã thực hiện lệnh: /login')
    }, 3000)

    // Tự động gõ lệnh AFK sau 6 giây
    setTimeout(() => {
      bot.chat('/afkmode vao')
      console.log('[LOG] Đã thực hiện lệnh: /afkmode vao')
    }, 6000)

    // Liên tục vung tay và click chuột (Anti-AFK)
    let clickState = 'left';
    const clickInterval = setInterval(() => {
      if (!bot.entity) return;

      if (clickState === 'left') {
        bot.swingArm('right');
        clickState = 'right';
      } else {
        bot.activateItem();
        clickState = 'left';
      }
    }, 330);

    bot.clickInterval = clickInterval;
  })

  bot.on('message', (message) => {
    const text = message.toString();
    // Chỉ in ra log nếu tin nhắn có chứa từ "Kiru" hoặc chứa tên của Bot
    if (text.includes('Kiru') || text.includes(bot.username)) {
      console.log('[SERVER CHAT]: ' + text);
    }
  })

  bot.on('end', () => {
    console.log('[LOG] Bot bị mất kết nối, đang kết nối lại sau 10 giây...')
    if (bot.clickInterval) clearInterval(bot.clickInterval);
    setTimeout(createBot, 10000)
  })

  bot.on('error', (err) => {
    console.log('[LỖI BOT]:', err)
    if (bot.clickInterval) clearInterval(bot.clickInterval);
  })
}

createBot()

// --- ĐOẠN CODE CHỐNG SẬP (ANTI-CRASH) ---
process.on('uncaughtException', (err) => {
  // Bỏ qua lỗi packet (như world_particles) của bản 1.21.4 để bot không bị văng
  if (err.name === 'PartialReadError' || (err.message && err.message.includes('packet_world_particles'))) {
    return;
  }
  console.log('[LỖI HỆ THỐNG]:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('[LỖI KHÔNG XÁC ĐỊNH]:', reason);
});
