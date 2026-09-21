const mineflayer = require('mineflayer')
const express = require('express')

const app = express()
const port = process.env.PORT || 3000

app.get('/', (req, res) => {
  res.send('Bot AFK Minecraft đang hoạt động!')
})

app.listen(port, () => {
  console.log(`HTTP Server running on port ${port}`)
})

function createBot() {
  const bot = mineflayer.createBot({
    host: 'vangioinetwork.xyz',
    port: 25565,
    username: 'Kiru',
    version: false
  })

  bot.on('spawn', () => {
    console.log('Bot da vao server thành công!')
    
    setTimeout(() => {
      bot.chat('/login Kiru2000@')
    }, 3000)

    setTimeout(() => {
      bot.chat('/afkmode vao')
    }, 6000)
  })

  bot.on('end', () => {
    console.log('Bot bi mat ket noi, dang ket noi lai sau 10 giay...')
    setTimeout(createBot, 10000)
  })

  bot.on('error', (err) => {
    console.log('Loi Bot:', err)
  })
}

createBot()
