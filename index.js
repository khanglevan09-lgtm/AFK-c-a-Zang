const mineflayer = require('mineflayer')
const express = require('express')

const app = express()
const port = process.env.PORT || 3000

app.get('/', (req, res) => {
  res.send('Bot AFK Minecraft với tính năng nhấp chuột đang hoạt động!')
})

app.listen(port, () => {
  console.log(`HTTP Server running on port ${port}`)
})

function createBot() {
  const bot = mineflayer.createBot({
    host: 'vangioinetwork.xyz',
    port: 25565,
    username: 'Kiru',
    version: '1.21.4'
  })

  bot.on('spawn', () => {
    console.log('[LOG] Bot đã vào server thành công!')
    
    setTimeout(() => {
      bot.chat('/login Kiru2000@')
      console.log('[LOG] Đã thực hiện lệnh: /login')
    }, 3000)

    setTimeout(() => {
      bot.chat('/afkmode vao')
      console.log('[LOG] Đã thực hiện lệnh: /afkmode vao')
    }, 6000)

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
    console.log('[SERVER CHAT]: ' + message.toString())
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
