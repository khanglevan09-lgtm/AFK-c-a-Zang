const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ÉP MÚI GIỜ VIỆT NAM TOÀN HỆ THỐNG
process.env.TZ = 'Asia/Ho_Chi_Minh';

let BOT_USERNAME = process.env.BOT_USERNAME || 'Kiru Đẹp Trai';
let BOT_PASSWORD = process.env.BOT_PASSWORD || 'YourPasswordHere';
let BOT_HOST = process.env.BOT_HOST || 'mc.example.com';
let BOT_PORT = parseInt(process.env.BOT_PORT) || 25565;

const toggles = {
  afkmode: false,
  thien: false,
  quylai: false,
  dinhthan: false,
  quanghao: false,
  attackLeft: false,
  attackRight: false,
  skill1: false,
  skill2: false,
  skill3: false,
  sneak: false
};

let attackLeftIntervalMs = 500;
let attackRightIntervalMs = 500;

const slotConfig = {
  enabled: [false, false, false, false, false, false, false, false, false],
  holdTimeSec: 5
};
let currentSlotIndex = 0;

let bot = null;
let reconnectTimeout = null;
let isReconnecting = false;
let isManualStopped = false;
let isSpawnGracePeriod = true;
let spawnGraceTimer = null;

let currentReconnectDelay = 8000;
let consecutiveFailures = 0;

let watchdogInterval = null;
let posCheckInterval = null;
let pingInterval = null;
let ramGcInterval = null;

let quylaiInterval = null;
let attackLeftInterval = null;
let attackRightInterval = null;
let slotSwitchInterval = null;

let lastPacketTime = Date.now();
let currentCoords = 'Đang xác định...';
let currentPing = 0;

const startTime = Date.now();
const serverChatLogs = [];
const errorLogs = [];    
const pingLogs = [];     
const botMentionLogs = [];

function getVNTime() {
  return new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function stripFormatting(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/§[0-9a-fk-or]/gi, '').replace(/&[0-9a-fk-or]/gi, '').replace(/\u001b\[[0-9;]*m/g, '').trim();
}

// Chuẩn hóa Unicode Small-Caps thành chữ thường tiêu chuẩn để nhận diện chính xác
function normalizeText(str) {
  if (typeof str !== 'string') return '';
  let text = stripFormatting(str);
  const smallCapsMap = {
    'ᴀ':'a', 'ʙ':'b', 'ᴄ':'c', 'ᴅ':'d', 'ᴇ':'e', 'ꜰ':'f', 'ɢ':'g', 'ʜ':'h', 'ɪ':'i',
    'ᴊ':'j', 'ᴋ':'k', 'ʟ':'l', 'ᴍ':'m', 'ɴ':'n', 'ᴏ':'o', 'ᴘ':'p', 'ǫ':'q', 'ʀ':'r',
    'ꜱ':'s', 'ᴛ':'t', 'ᴜ':'u', 'ᴠ':'v', 'ᴡ':'w', 'x':'x', 'ʏ':'y', 'ᴢ':'z'
  };
  text = text.replace(/[ᴀ-ᴢ]/g, ch => smallCapsMap[ch] || ch);
  return text.toLowerCase();
}

function addChatLog(msg) {
  if (!msg) return;
  const formatted = '[' + getVNTime() + '] ' + msg;
  if (serverChatLogs.length > 0 && serverChatLogs[0] === formatted) return;
  serverChatLogs.unshift(formatted);
  if (serverChatLogs.length > 100) serverChatLogs.pop();
}

function addErrorLog(type, details) {
  errorLogs.unshift({
    time: getVNTime(),
    type: type,
    details: details || 'Không có chi tiết'
  });
  if (errorLogs.length > 60) errorLogs.pop();
}

function addPingLog(pingVal) {
  pingLogs.unshift({
    time: getVNTime(),
    ping: pingVal
  });
  if (pingLogs.length > 15) pingLogs.pop();
}

function addBotMentionLog(msg) {
  botMentionLogs.unshift({
    time: getVNTime(),
    text: msg
  });
  if (botMentionLogs.length > 40) botMentionLogs.pop();
}

function getExactItemName(item) {
  if (!item) return 'Tay không';
  
  if (item.customName) {
    try {
      const parsed = JSON.parse(item.customName);
      if (parsed.text) return stripFormatting(parsed.text);
      if (parsed.extra && Array.isArray(parsed.extra)) {
        return stripFormatting(parsed.extra.map(e => (typeof e === 'string' ? e : e.text || '')).join(''));
      }
    } catch (e) {
      return stripFormatting(item.customName);
    }
  }

  if (item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value) {
    const disp = item.nbt.value.display.value;
    if (disp.Name && disp.Name.value) {
      const rawName = disp.Name.value;
      try {
        const parsed = JSON.parse(rawName);
        if (typeof parsed === 'string') return stripFormatting(parsed);
        if (parsed.text) return stripFormatting(parsed.text);
        if (parsed.extra && Array.isArray(parsed.extra)) {
          return stripFormatting(parsed.extra.map(e => (typeof e === 'string' ? e : e.text || '')).join(''));
        }
      } catch (e) {
        return stripFormatting(rawName);
      }
    }
  }

  return item.displayName || item.name || 'Vật phẩm không tên';
}

function safeChat(msg) {
  if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped && !isSpawnGracePeriod) {
    try {
      bot.chat(msg);
      addChatLog('[TỰ ĐỘNG]: ' + msg);
    } catch (e) {
      addErrorLog('Lỗi Chat', e.message || String(e));
    }
  }
}

function cleanupBot() {
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  if (posCheckInterval) { clearInterval(posCheckInterval); posCheckInterval = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
  if (quylaiInterval) { clearInterval(quylaiInterval); quylaiInterval = null; }
  if (attackLeftInterval) { clearInterval(attackLeftInterval); attackLeftInterval = null; }
  if (attackRightInterval) { clearInterval(attackRightInterval); attackRightInterval = null; }
  if (slotSwitchInterval) { clearInterval(slotSwitchInterval); slotSwitchInterval = null; }
  if (spawnGraceTimer) { clearTimeout(spawnGraceTimer); spawnGraceTimer = null; }

  if (bot) {
    try {
      bot.removeAllListeners();
      if (bot._client) bot._client.removeAllListeners();
      bot.end();
    } catch (e) {
      // Dọn dẹp lỗi socket ẩn
    }
    bot = null;
  }

  isSpawnGracePeriod = true;
}

function scheduleReconnect(reason, customDelayMs = null) {
  // DỌN DẸP INTERVALS TRƯỚC ĐỂ TRÁNH TRÙNG LẶP WATCHDOG
  cleanupBot();

  if (isManualStopped) return;
  if (isReconnecting) return;

  isReconnecting = true;
  consecutiveFailures++;

  let delay = customDelayMs !== null ? customDelayMs : Math.min(8000 + (consecutiveFailures * 2000), 30000);
  currentReconnectDelay = delay;

  addErrorLog('KẾT NỐI LẠI', `Lý do: [${reason}]. Thử lại sau ${Math.round(delay / 1000)} giây...`);

  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    createBot();
  }, delay);
}

function restartLoops() {
  if (quylaiInterval) { clearInterval(quylaiInterval); quylaiInterval = null; }
  if (attackLeftInterval) { clearInterval(attackLeftInterval); attackLeftInterval = null; }
  if (attackRightInterval) { clearInterval(attackRightInterval); attackRightInterval = null; }
  if (slotSwitchInterval) { clearInterval(slotSwitchInterval); slotSwitchInterval = null; }

  if (!bot || !bot._client || bot._client.state !== 'play' || isManualStopped || isSpawnGracePeriod) {
    return;
  }

  // Quỳ lạy Loop
  if (toggles.quylai) {
    quylaiInterval = setInterval(() => {
      safeChat('/quylay');
    }, 12000);
  }

  // Attack Left Click Loop
  if (toggles.attackLeft) {
    attackLeftInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && bot._client.state === 'play') {
        try {
          bot.swingArm('mainhand');
        } catch (e) {}
      }
    }, attackLeftIntervalMs);
  }

  // Attack Right Click Loop
  if (toggles.attackRight) {
    attackRightInterval = setInterval(() => {
      if (bot && bot.entity && bot._client && bot._client.state === 'play') {
        try {
          bot.swingArm('offhand');
          bot.activateItem();
        } catch (e) {}
      }
    }, attackRightIntervalMs);
  }

  // Sneak Toggle
  if (bot) {
    try {
      bot.setControlState('sneak', toggles.sneak);
    } catch (e) {}
  }

  // Hotbar Switcher
  const activeSlots = [];
  for (let i = 0; i < 9; i++) {
    if (slotConfig.enabled[i]) activeSlots.push(i);
  }

  if (activeSlots.length > 0) {
    slotSwitchInterval = setInterval(() => {
      if (!bot || !bot.inventory || !bot._client || bot._client.state !== 'play') return;
      currentSlotIndex = (currentSlotIndex + 1) % activeSlots.length;
      const targetSlot = activeSlots[currentSlotIndex];
      try {
        bot.setQuickBarSlot(targetSlot);
      } catch (e) {}
    }, Math.max(1, slotConfig.holdTimeSec) * 1000);
  }
}

function createBot() {
  if (isManualStopped) return;

  cleanupBot();

  addErrorLog('KẾT NỐI', `Đang kết nối tới ${BOT_HOST}:${BOT_PORT} với tên [${BOT_USERNAME}]...`);
  lastPacketTime = Date.now();

  try {
    bot = mineflayer.createBot({
      host: BOT_HOST,
      port: BOT_PORT,
      username: BOT_USERNAME,
      password: BOT_PASSWORD,
      auth: 'offline',
      checkTimeoutInterval: 60 * 1000
    });

    bot.on('login', () => {
      addErrorLog('THÀNH CÔNG', `Đã xác thực thành công với Server! Đang chờ Spawn...`);
      lastPacketTime = Date.now();

      if (bot._client) {
        bot._client.on('packet', () => {
          lastPacketTime = Date.now();
        });
        bot._client.on('error', (err) => {
          addErrorLog('Client Socket Error', err ? (err.message || String(err)) : 'Không xác định');
        });
      }
    });

    bot.on('spawn', () => {
      lastPacketTime = Date.now();
      addErrorLog('VÀO GAME', `Bot [${BOT_USERNAME}] đã Spawn vào thế giới game!`);

      // Cho phép thời gian chờ 5 giây sau khi Spawn rồi mới bật các Loop tự động
      isSpawnGracePeriod = true;
      if (spawnGraceTimer) clearTimeout(spawnGraceTimer);
      spawnGraceTimer = setTimeout(() => {
        isSpawnGracePeriod = false;
        consecutiveFailures = 0;
        addErrorLog('SẴN SÀNG', `Đã hết thời gian chờ Spawn (5s). Kích hoạt các tính năng tự động...`);
        restartLoops();
      }, 5000);

      // Watchdog Check Interval
      if (watchdogInterval) clearInterval(watchdogInterval);
      watchdogInterval = setInterval(() => {
        if (!bot || !bot._client || bot._client.state !== 'play' || !bot.entity || isSpawnGracePeriod || isManualStopped || isReconnecting) {
          lastPacketTime = Date.now();
          return;
        }
        const timeSinceLastPacket = Date.now() - lastPacketTime;
        if (timeSinceLastPacket > 45000) {
          addErrorLog('Watchdog', `Kẹt Packet thế giới > 45s (${Math.round(timeSinceLastPacket / 1000)}s). Tiến hành Reconnect...`);
          scheduleReconnect('Watchdog packet timeout', 10000);
        }
      }, 15000);

      // Position Check Interval
      if (posCheckInterval) clearInterval(posCheckInterval);
      posCheckInterval = setInterval(() => {
        if (bot && bot.entity && bot.entity.position) {
          const pos = bot.entity.position;
          currentCoords = `X: ${Math.round(pos.x)}, Y: ${Math.round(pos.y)}, Z: ${Math.round(pos.z)}`;
        }
      }, 3000);

      // Ping Check Interval
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (bot && bot._client) {
          currentPing = bot._client.latency || 0;
          addPingLog(currentPing);
        }
      }, 10000);
    });

    const handleRawChatMessage = (rawText) => {
      if (!rawText) return;
      const cleanText = stripFormatting(rawText);
      if (!cleanText) return;

      addChatLog(cleanText);

      // Check for bot mention
      if (BOT_USERNAME && cleanText.toLowerCase().includes(BOT_USERNAME.toLowerCase()) && !cleanText.startsWith('[TỰ ĐỘNG]') && !cleanText.startsWith('[WEB-ADMIN]')) {
        addBotMentionLog(cleanText);
      }
    };

    bot.on('messagestr', (msg) => handleRawChatMessage(msg));
    bot.on('message', (jsonMsg) => {
      if (jsonMsg) handleRawChatMessage(jsonMsg.toString());
    });

    bot.on('kicked', (reason) => {
      let rawReason = typeof reason === 'string' ? reason : JSON.stringify(reason);
      let cleanReason = stripFormatting(rawReason);
      let normReason = normalizeText(rawReason);

      addErrorLog('Bị Server Kick', cleanReason || 'Không có lý do');

      // Kiểm tra lý do Kick với văn bản Unicode chuẩn hóa
      if (normReason.includes('luu du lieu') || normReason.includes('lưu dữ liệu') || normReason.includes('vao lai sau') || normReason.includes('vào lại sau') || normReason.includes('5 giay') || normReason.includes('5 giây')) {
        scheduleReconnect('Server yêu cầu chờ lưu dữ liệu', 12000);
      } else {
        scheduleReconnect('Bị Server Kick', 8000);
      }
    });

    bot.on('error', (err) => {
      const errMsg = err ? (err.message || String(err)) : 'Không xác định';
      addErrorLog('Mineflayer Error', errMsg);

      if (errMsg.includes('ENOTFOUND') || errMsg.includes('getaddrinfo')) {
        scheduleReconnect('Không tìm thấy IP/Domain Server (ENOTFOUND)', 15000);
      } else {
        scheduleReconnect('Mineflayer Error', 10000);
      }
    });

    bot.on('end', (reason) => {
      addErrorLog('Mất Kết Nối (End)', reason || 'Socket Closed');
      scheduleReconnect('Ngắt kết nối Socket', 8000);
    });

  } catch (err) {
    addErrorLog('Cài đặt Bot thất bại', err.message || String(err));
    scheduleReconnect('Cài đặt thất bại', 10000);
  }
}

process.on('uncaughtException', (err) => {
  const errMsg = err ? (err.message || String(err)) : 'Unknown';
  addErrorLog('Uncaught Exception', errMsg);
  if (!bot || !bot._client || bot._client.state !== 'play') {
    scheduleReconnect('Hồi phục sau Uncaught Exception', 10000);
  }
});

process.on('unhandledRejection', (reason) => {
  addErrorLog('Unhandled Rejection', String(reason));
  if (!bot || !bot._client || bot._client.state !== 'play') {
    scheduleReconnect('Hồi phục sau Unhandled Rejection', 10000);
  }
});

ramGcInterval = setInterval(() => {
  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }
}, 30000);

app.get('/api/ping', (req, res) => res.send('PONG_OK'));

app.get('/api/status', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? getExactItemName(bot.heldItem) : 'Tay không';
  
  let statusBadge = '<span class="badge-off">OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">ĐÃ TẮT THỦ CÔNG (NHƯỜNG NICK)</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">ONLINE</span>';
  } else {
    statusBadge = '<span class="badge-off">RECONNECTING (' + Math.round(currentReconnectDelay / 1000) + 's)</span>';
  }

  res.json({
    statusBadge,
    botUsername: BOT_USERNAME,
    botHost: BOT_HOST,
    botPort: BOT_PORT,
    currentPing,
    currentCoords,
    currentWeapon,
    uptimeMinutes,
    memoryUsage,
    serverChatLogs,
    errorLogs,
    pingLogs,
    botMentionLogs
  });
});

app.post('/api/update-config', (req, res) => {
  const { username, password, host } = req.body;
  
  if (username !== undefined && username.trim() !== '') BOT_USERNAME = username.trim();
  if (password !== undefined && password.trim() !== '') BOT_PASSWORD = password.trim();
  
  if (host !== undefined && host.trim() !== '') {
    let cleanHost = host.trim();
    if (cleanHost.includes(':')) {
      const parts = cleanHost.split(':');
      BOT_HOST = parts[0];
      BOT_PORT = parseInt(parts[1]) || 25565;
    } else {
      BOT_HOST = cleanHost;
      BOT_PORT = 25565;
    }
  }

  addErrorLog('CẤU HÌNH', 'Đã cập nhật cấu hình Bot [' + BOT_USERNAME + ']. Đang kết nối lại...');
  res.redirect('/');

  setImmediate(() => {
    consecutiveFailures = 0;
    isManualStopped = false;
    createBot();
  });
});

app.post('/api/command', (req, res) => {
  try {
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || (req.headers['content-type'] && req.headers['content-type'].includes('json'));

    if (isManualStopped) {
      if (isAjax) return res.status(400).json({ success: false, message: 'Bot đang ở trạng thái TẮT thủ công!' });
      return res.redirect('/');
    }
    
    const cmd = req.body ? req.body.command : null;
    if (!bot || !bot._client || bot._client.state !== 'play') {
      if (isAjax) return res.status(400).json({ success: false, message: 'Bot đang ngoại tuyến!' });
      return res.redirect('/');
    }

    if (cmd && typeof cmd === 'string') {
      const cleanCmd = cmd.trim();
      if (cleanCmd) {
        bot.chat(cleanCmd);
        addChatLog('[WEB-ADMIN]: ' + cleanCmd);
      }
    }

    if (isAjax) {
      return res.json({ success: true, logs: serverChatLogs });
    }
    res.redirect('/');
  } catch (err) {
    addErrorLog('Lỗi gửi lệnh', err.message || String(err));
    if (req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || (req.headers['content-type'] && req.headers['content-type'].includes('json'))) {
      return res.status(500).json({ success: false, message: 'Lỗi server: ' + (err.message || 'Không xác định') });
    }
    res.redirect('/');
  }
});

app.get('/api/toggle/:feature', (req, res) => {
  const feat = req.params.feature;
  if (toggles.hasOwnProperty(feat)) {
    toggles[feat] = !toggles[feat];
    addChatLog('[CÀI ĐẶT] ' + feat.toUpperCase() + ' ➔ ' + (toggles[feat] ? 'BẬT' : 'TẮT'));

    if (bot && bot.entity && bot._client && bot._client.state === 'play' && !isManualStopped && !isSpawnGracePeriod) {
      if (feat === 'afkmode') safeChat(toggles[feat] ? '/afkmode vao' : '/afkmode ra');
      if (feat === 'thien') safeChat('/thien');
      if (feat === 'quylai') safeChat('/quylay');
      if (feat === 'dinhthan') safeChat('/dinhthan');
      if (feat === 'quanghao') safeChat('/quanghao');
      if (feat === 'skill1') safeChat('/kinang_1');
      if (feat === 'skill2') safeChat('/kinang_2');
      if (feat === 'skill3') safeChat('/kinang_3');

      restartLoops();
    }
  }
  res.redirect('/');
});

app.post('/api/update-click-speed', (req, res) => {
  const leftSpeed = parseFloat(req.body.leftSpeed);
  const rightSpeed = parseFloat(req.body.rightSpeed);

  if (!isNaN(leftSpeed) && leftSpeed >= 0.1) attackLeftIntervalMs = Math.round(leftSpeed * 1000);
  if (!isNaN(rightSpeed) && rightSpeed >= 0.1) attackRightIntervalMs = Math.round(rightSpeed * 1000);

  restartLoops();
  res.redirect('/');
});

app.post('/api/update-slots', (req, res) => {
  const holdTimeSec = parseInt(req.body.holdTimeSec);
  if (!isNaN(holdTimeSec) && holdTimeSec >= 1) {
    slotConfig.holdTimeSec = holdTimeSec;
  }

  for (let i = 0; i < 9; i++) {
    slotConfig.enabled[i] = req.body['slot_' + i] === 'on';
  }

  restartLoops();
  res.redirect('/');
});

app.get('/api/inventory', (req, res) => {
  if (bot && bot._client && !isManualStopped) {
    safeChat('[inv]');
  }
  res.redirect('/');
});

app.get('/api/tusat', (req, res) => {
  if (bot && bot._client && !isManualStopped) {
    safeChat('/tusat');
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

app.get('/api/clear-mention-log', (req, res) => {
  botMentionLogs.length = 0;
  res.redirect('/');
});

app.get('/api/hard-restart', (req, res) => {
  addErrorLog('HỆ THỐNG', 'Dọn dẹp bộ nhớ và kết nối lại Bot...');
  cleanupBot();
  consecutiveFailures = 0;
  createBot();
  res.redirect('/'); 
});

function renderToggleBtn(key, label) {
  const isON = toggles[key];
  const btnClass = isON ? 'btn-start' : 'btn-stop';
  const statusText = isON ? 'BẬT' : 'TẮT';
  return '<a href="/api/toggle/' + key + '" style="text-decoration: none;"><button type="button" class="' + btnClass + '" style="width: 100%;">' + label + ': ' + statusText + '</button></a>';
}

function renderSlotGrid() {
  let html = '';
  for (let i = 0; i < 9; i++) {
    const num = i + 1;
    const checked = slotConfig.enabled[i] ? 'checked' : '';
    html += '<div class="slot-item">' +
              '<div><b>Ô ' + num + '</b></div>' +
              '<input type="checkbox" name="slot_' + i + '" ' + checked + '>' +
            '</div>';
  }
  return html;
}

app.get('/', (req, res) => {
  const uptimeMinutes = Math.floor((Date.now() - startTime) / 60000);
  const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const currentWeapon = (bot && bot.heldItem) ? getExactItemName(bot.heldItem) : 'Tay không';

  let statusBadge = '<span class="badge-off">OFFLINE</span>';
  if (isManualStopped) {
    statusBadge = '<span class="badge-pause">ĐÃ TẮT THỦ CÔNG</span>';
  } else if (bot && bot._client && bot._client.state === 'play') {
    statusBadge = '<span class="badge-on">ONLINE</span>';
  } else {
    statusBadge = '<span class="badge-off">RECONNECTING (' + Math.round(currentReconnectDelay / 1000) + 's)</span>';
  }

  const hostDisplay = BOT_HOST + (BOT_PORT && BOT_PORT !== 25565 ? ':' + BOT_PORT : '');

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="referrer" content="no-referrer">
  <title>Kiru Đẹp Trai - MC Bot Control</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  
  <style>
    :root {
      --card-bg: rgba(11, 15, 25, 0.90);
      --accent-cyan: #38bdf8;
      --accent-pink: #f43f5e;
      --accent-purple: #c084fc;
      --accent-green: #4ade80;
      --accent-yellow: #fbbf24;
      --border: rgba(56, 189, 248, 0.35);
    }

    * { box-sizing: border-box; }

    #bg-container {
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      z-index: -2;
      overflow: hidden;
      background-color: #080c14;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .bg-img-blur {
      position: absolute;
      top: -10%; left: -10%;
      width: 120vw; height: 120vh;
      object-fit: cover;
      filter: blur(35px) brightness(0.45);
      transform: scale(1.1);
      transition: opacity 0.6s ease;
    }

    .bg-img-main {
      position: absolute;
      top: 0; left: 0;
      width: 100vw; height: 100vh;
      object-fit: contain !important;
      object-position: center;
      transition: opacity 0.6s ease;
    }

    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      margin: 0;
      padding: 16px;
      color: #f8fafc;
      min-height: 100vh;
      position: relative;
    }

    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(3, 7, 18, 0.65);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      z-index: -1;
      transition: all 0.3s ease;
    }

    body.ui-hidden::before {
      background: transparent !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
    }

    body.ui-hidden .container,
    body.ui-hidden .header {
      display: none !important;
    }

    #fab-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .fab-toggle {
      padding: 12px 20px;
      border-radius: 30px;
      font-weight: 700;
      font-size: 0.92rem;
      cursor: pointer;
      background: linear-gradient(135deg, #0ea5e9, #a855f7);
      color: #ffffff;
      border: 2px solid rgba(255, 255, 255, 0.8);
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.8), 0 0 15px rgba(56, 189, 248, 0.6);
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .fab-toggle:hover {
      transform: scale(1.08);
      box-shadow: 0 10px 30px rgba(56, 189, 248, 0.9);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      background: rgba(11, 15, 25, 0.95);
      border: 1px solid var(--border);
      border-radius: 16px;
      margin-bottom: 20px;
      gap: 12px;
      flex-wrap: wrap;
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.25);
    }

    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 1.8rem;
      margin: 0;
      background: linear-gradient(90deg, #38bdf8, #f43f5e, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 0 15px rgba(56, 189, 248, 0.5);
      letter-spacing: 1px;
    }

    .container {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }

    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      padding: 18px;
      border-radius: 18px;
      border: 1px solid var(--border);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.8), 0 0 15px rgba(56, 189, 248, 0.15);
      margin-bottom: 20px;
    }

    h3 {
      margin-top: 0;
      color: var(--accent-cyan);
      font-size: 1.15rem;
      display: flex;
      align-items: center;
      gap: 8px;
      text-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }

    .badge-on { background: rgba(34, 197, 94, 0.25); color: #4ade80; border: 1px solid #4ade80; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; box-shadow: 0 0 10px rgba(74, 222, 128, 0.3); }
    .badge-off { background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid #f87171; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; box-shadow: 0 0 10px rgba(248, 113, 113, 0.3); }
    .badge-pause { background: rgba(245, 158, 11, 0.25); color: #fbbf24; border: 1px solid #fbbf24; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.85rem; box-shadow: 0 0 10px rgba(251, 191, 36, 0.3); }

    .status-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin: 15px 0;
    }

    .status-item {
      background: rgba(0, 0, 0, 0.65);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 10px 12px;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .status-item .label {
      font-size: 0.7rem;
      color: #cbd5e1;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 700;
    }

    .status-item .value {
      font-size: 0.9rem;
      font-weight: 700;
      color: #ffffff;
      word-break: break-all;
    }

    .slot-grid {
      display: grid;
      grid-template-columns: repeat(9, 1fr);
      gap: 8px;
      margin: 12px 0;
    }
    .slot-item {
      background: rgba(0, 0, 0, 0.75);
      border: 1px solid rgba(56, 189, 248, 0.4);
      border-radius: 10px;
      padding: 8px 4px;
      text-align: center;
      font-size: 0.85rem;
      color: #f1f5f9;
      font-weight: bold;
    }
    .slot-item input[type="checkbox"] {
      margin-top: 6px;
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: var(--accent-pink);
    }

    .chat-box { background: rgba(0, 0, 0, 0.88); padding: 12px; border-radius: 12px; font-family: monospace; height: 350px; overflow-y: auto; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-size: 0.85rem; line-height: 1.5; }
    .error-box { background: rgba(15, 5, 5, 0.9); padding: 12px; border-radius: 12px; font-family: monospace; height: 350px; overflow-y: auto; color: #f87171; border: 1px solid rgba(244, 63, 94, 0.5); font-size: 0.85rem; line-height: 1.5; }
    .kiru-box { background: rgba(15, 23, 15, 0.9); padding: 12px; border-radius: 12px; font-family: monospace; height: 350px; overflow-y: auto; color: #facc15; border: 1px solid rgba(250, 204, 21, 0.5); font-size: 0.85rem; line-height: 1.5; }

    .input-group { display: flex; gap: 10px; margin-top: 10px; }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

    label { font-size: 0.85rem; color: #e2e8f0; display: block; margin-bottom: 6px; font-weight: 600; }

    input[type="text"], input[type="password"], input[type="number"] { 
      width: 100%; 
      padding: 10px 14px; 
      border-radius: 10px; 
      border: 1px solid rgba(255, 255, 255, 0.25); 
      background: rgba(0, 0, 0, 0.65); 
      color: #ffffff; 
      outline: none; 
      font-size: 0.9rem; 
      font-weight: 600;
    }
    input:focus { border-color: var(--accent-cyan); box-shadow: 0 0 12px rgba(56, 189, 248, 0.5); }

    button {
      padding: 10px 18px;
      background: linear-gradient(135deg, #e11d48, #be123c);
      color: white;
      border: 1px solid #f43f5e;
      border-radius: 10px;
      cursor: pointer;
      font-weight: bold;
      transition: all 0.25s ease;
      white-space: nowrap;
      font-size: 0.88rem;
      box-shadow: 0 4px 12px rgba(225, 29, 72, 0.3);
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    button:hover { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(225, 29, 72, 0.6); }

    .btn-stop { background: linear-gradient(135deg, #b91c1c, #ef4444) !important; border: 1px solid #f87171 !important; box-shadow: 0 0 10px rgba(239, 68, 68, 0.3) !important; }
    .btn-start { background: linear-gradient(135deg, #15803d, #22c55e) !important; border: 1px solid #4ade80 !important; box-shadow: 0 0 10px rgba(34, 197, 94, 0.3) !important; }
    .btn-cyan { background: linear-gradient(135deg, #0369a1, #0ea5e9) !important; border: 1px solid #38bdf8 !important; box-shadow: 0 0 10px rgba(14, 165, 233, 0.3) !important; }
    .btn-warning { background: linear-gradient(135deg, #b45309, #f59e0b) !important; border: 1px solid #fbbf24 !important; box-shadow: 0 0 10px rgba(245, 158, 11, 0.3) !important; }
    .btn-purple { background: linear-gradient(135deg, #6b21a8, #a855f7) !important; border: 1px solid #c084fc !important; box-shadow: 0 0 10px rgba(168, 85, 247, 0.3) !important; }
    .btn-save { background: linear-gradient(135deg, #1d4ed8, #3b82f6) !important; border: 1px solid #60a5fa !important; width: 100%; margin-top: 10px; box-shadow: 0 0 12px rgba(59, 130, 246, 0.4) !important; }

    .btn-group-responsive {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin-top: 15px;
    }

    .modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(10px);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      padding: 16px;
    }
    .modal-card {
      background: #0b0f19;
      border: 1px solid var(--border);
      border-radius: 16px;
      width: 100%;
      max-width: 800px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      padding: 20px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.9), 0 0 20px rgba(56, 189, 248, 0.3);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }
    .modal-close {
      background: transparent;
      border: none;
      color: #f43f5e;
      font-size: 1.6rem;
      cursor: pointer;
      font-weight: bold;
    }

    @media (max-width: 600px) {
      body { padding: 10px; }
      .header { flex-direction: column; align-items: flex-start; }
      h1 { font-size: 1.5rem; }
      .form-grid { grid-template-columns: 1fr; }
      .input-group { flex-direction: column; }
      .input-group button { width: 100%; }
      .btn-group-responsive { grid-template-columns: 1fr; }
      .slot-grid { grid-template-columns: repeat(3, 1fr); }
      .card { padding: 14px; }
    }
  </style>

  <script>
    const ANIME_GIRL_APIS = [
      'https://api.waifu.im/search?included_tags=waifu',
      'https://api.waifu.im/search?included_tags=maid',
      'https://api.waifu.im/search?included_tags=oppai',
      'https://api.waifu.im/search?included_tags=uniform',
      'https://api.waifu.im/search?included_tags=marin-kitagawa',
      'https://api.waifu.im/search?included_tags=raiden-shogun',
      'https://api.waifu.pics/sfw/waifu',
      'https://api.waifu.pics/sfw/neko',
      'https://nekos.best/api/v2/waifu',
      'https://nekos.best/api/v2/neko'
    ];

    const FALLBACK_WAIFUS = [
      'https://cdn.waifu.im/7438.jpg',
      'https://cdn.waifu.im/6226.jpg',
      'https://cdn.waifu.im/7140.jpg',
      'https://cdn.waifu.im/7290.jpg',
      'https://cdn.waifu.im/6831.jpg',
      'https://cdn.waifu.im/7580.jpg',
      'https://cdn.waifu.im/7418.jpg',
      'https://cdn.waifu.im/7212.jpg',
      'https://cdn.waifu.im/7211.jpg',
      'https://images6.alphacoders.com/133/1330919.png',
      'https://images3.alphacoders.com/132/1322891.jpeg',
      'https://images2.alphacoders.com/131/1312502.jpeg'
    ];

    const QUEUE_TARGET_SIZE = 3;
    const imageQueue = []; 
    const seenUrls = new Set();
    let isQueueFilling = false;

    async function fetchUniqueAnimeGirlUrl() {
      for (let attempt = 0; attempt < 6; attempt++) {
        const api = ANIME_GIRL_APIS[Math.floor(Math.random() * ANIME_GIRL_APIS.length)];
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);

          const sep = api.includes('?') ? '&' : '?';
          const randUrl = api + sep + '_r=' + Math.random().toString(36).substring(2, 8);

          const response = await fetch(randUrl, { signal: controller.signal });
          clearTimeout(timer);

          if (response.ok) {
            const data = await response.json();
            let url = '';
            if (data?.images?.[0]?.url) url = data.images[0].url;
            else if (data?.results?.[0]?.url) url = data.results[0].url;
            else if (data?.url) url = data.url;

            if (url && !seenUrls.has(url)) {
              return url;
            }
          }
        } catch (e) {}
      }

      for (const fbUrl of FALLBACK_WAIFUS) {
        if (!seenUrls.has(fbUrl)) return fbUrl;
      }

      seenUrls.clear();
      return FALLBACK_WAIFUS[Math.floor(Math.random() * FALLBACK_WAIFUS.length)];
    }

    function preloadSingleImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        
        const timer = setTimeout(() => {
          img.src = '';
          reject(new Error('Preload Timeout'));
        }, 3000);

        img.onload = () => {
          clearTimeout(timer);
          if (img.width >= img.height) {
            resolve({ url, imgObj: img });
          } else {
            reject(new Error('Not Landscape'));
          }
        };

        img.onerror = () => {
          clearTimeout(timer);
          reject(new Error('Preload Failed'));
        };

        img.src = url;
      });
    }

    async function fillImageCacheQueue() {
      if (isQueueFilling) return;
      isQueueFilling = true;

      while (imageQueue.length < QUEUE_TARGET_SIZE) {
        try {
          const urlCandidate = await fetchUniqueAnimeGirlUrl();
          if (urlCandidate && !seenUrls.has(urlCandidate)) {
            seenUrls.add(urlCandidate);
            const loadedData = await preloadSingleImage(urlCandidate);
            imageQueue.push(loadedData);
          }
        } catch (e) {
          await new Promise(r => setTimeout(r, 400));
        }
      }

      isQueueFilling = false;
    }

    function displayNextImage() {
      if (imageQueue.length === 0) {
        fillImageCacheQueue();
        return;
      }

      const currentItem = imageQueue.shift();

      const bgMain = document.getElementById('bg-main-img');
      const bgBlur = document.getElementById('bg-blur-img');

      if (bgMain) bgMain.src = currentItem.url;
      if (bgBlur) bgBlur.src = currentItem.url;

      if (currentItem.imgObj) {
        currentItem.imgObj.onload = null;
        currentItem.imgObj.onerror = null;
        currentItem.imgObj = null;
      }

      fillImageCacheQueue();
    }

    function toggleDashboardUI() {
      document.body.classList.toggle('ui-hidden');
      const isHidden = document.body.classList.contains('ui-hidden');
      
      const fabBtnText = document.getElementById('fab-ui-toggle-text');
      const headerBtnText = document.getElementById('header-ui-toggle-text');

      const labelText = isHidden ? '📋 Hiện Bảng Control' : '👁️ Thu Gọn Bảng (Xem Ảnh)';

      if (fabBtnText) fabBtnText.innerText = labelText;
      if (headerBtnText) headerBtnText.innerText = labelText;

      localStorage.setItem('ui_hidden_mode', isHidden ? '1' : '0');
    }

    function openModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'flex';
    }

    function closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
    }

    async function sendChatCommand(event) {
      if (event) event.preventDefault();
      const input = document.getElementById('modal-chat-input');
      if (!input || !input.value.trim()) return;

      const cmdText = input.value.trim();
      input.value = '';

      try {
        const response = await fetch('/api/command', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ command: cmdText })
        });
        const data = await response.json();
        if (data.success) {
          updateChatBox(data.logs);
        }
      } catch (err) {
        console.error('Lỗi gửi chat:', err);
      }
    }

    function updateChatBox(logs) {
      const chatBox = document.getElementById('modal-chat-box');
      if (chatBox && logs) {
        chatBox.innerHTML = logs.map(l => '<div>' + l + '</div>').join('');
      }
    }

    async function pollStatus() {
      try {
        const response = await fetch('/api/status');
        if (response.ok) {
          const data = await response.json();
          
          document.getElementById('val-badge').innerHTML = data.statusBadge;
          document.getElementById('val-username').innerText = data.botUsername;
          document.getElementById('val-server').innerText = data.botHost + (data.botPort && data.botPort !== 25565 ? ':' + data.botPort : '');
          document.getElementById('val-ping').innerText = data.currentPing + ' ms';
          document.getElementById('val-coords').innerText = data.currentCoords;
          document.getElementById('val-weapon').innerText = data.currentWeapon;
          document.getElementById('val-uptime').innerText = data.uptimeMinutes + ' phút';
          document.getElementById('val-ram').innerText = data.memoryUsage + ' MB';

          updateChatBox(data.serverChatLogs);

          const errBox = document.getElementById('modal-error-box');
          if (errBox) {
            if (data.errorLogs.length === 0) {
              errBox.innerHTML = '<div style="color:var(--accent-green);">Không có lỗi!</div>';
            } else {
              errBox.innerHTML = data.errorLogs.map(e => '<div>[' + e.time + '] <b>[' + e.type + ']</b>: ' + e.details + '</div>').join('');
            }
          }

          const mentionBox = document.getElementById('modal-mention-box');
          if (mentionBox) {
            if (data.botMentionLogs.length === 0) {
              mentionBox.innerHTML = '<div style="color:var(--accent-green);">Chưa có tin nhắn nào nhắc đến bot...</div>';
            } else {
              mentionBox.innerHTML = data.botMentionLogs.map(k => '<div>[' + k.time + '] ' + k.text + '</div>').join('');
            }
            document.getElementById('btn-mention-count').innerText = 'Mention (' + data.botMentionLogs.length + ')';
          }
        }
      } catch (e) {}
    }

    window.addEventListener('DOMContentLoaded', () => {
      fillImageCacheQueue().then(() => displayNextImage());
      setInterval(displayNextImage, 20000);

      if (localStorage.getItem('ui_hidden_mode') === '1') {
        toggleDashboardUI();
      }

      setInterval(pollStatus, 1500);
    });
  </script>
</head>
<body>

  <div id="bg-container">
    <img id="bg-blur-img" class="bg-img-blur" src="https://cdn.waifu.im/7438.jpg" alt="Background Blur" referrerpolicy="no-referrer">
    <img id="bg-main-img" class="bg-img-main" src="https://cdn.waifu.im/7438.jpg" alt="Background Main" referrerpolicy="no-referrer">
  </div>

  <div id="fab-container">
    <button type="button" class="fab-toggle" onclick="toggleDashboardUI()">
      <span id="fab-ui-toggle-text">👁️ Thu Gọn Bảng (Xem Ảnh)</span>
    </button>
  </div>

  <div class="header">
    <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
      <h1>KIRU ĐẸP TRAI</h1>
      <span id="val-badge">${statusBadge}</span>
    </div>

    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <button type="button" class="btn-cyan" onclick="toggleDashboardUI()">
        <span id="header-ui-toggle-text">👁️ Thu Gọn Bảng (Xem Ảnh)</span>
      </button>
      <button type="button" class="btn-purple" onclick="openModal('modal-config')">⚙️ Cấu Hình Bot</button>
    </div>
  </div>

  <div class="container">
    <div class="card">
      <h3> Trạng Thái Bot: <span id="val-username" style="color:#ffffff;">${BOT_USERNAME}</span></h3>
      
      <div class="status-grid">
        <div class="status-item"><span class="label">Server</span><span class="value" id="val-server">${hostDisplay}</span></div>
        <div class="status-item"><span class="label">Ping</span><span class="value" id="val-ping">${currentPing} ms</span></div>
        <div class="status-item"><span class="label">Tọa Độ</span><span class="value" id="val-coords">${currentCoords}</span></div>
        <div class="status-item"><span class="label">Vật Phẩm Cầm Tay</span><span class="value" id="val-weapon">${(bot && bot.heldItem) ? getExactItemName(bot.heldItem) : 'Tay không'}</span></div>
        <div class="status-item"><span class="label">Hoạt Động</span><span class="value" id="val-uptime">${Math.floor((Date.now() - startTime) / 60000)} phút</span></div>
        <div class="status-item"><span class="label">RAM</span><span class="value" id="val-ram">${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB</span></div>
      </div>

      <div class="btn-group-responsive">
        <button type="button" class="btn-cyan" onclick="openModal('modal-chat')">💬 Cửa Sổ Chat Server</button>
        <button type="button" class="btn-warning" onclick="openModal('modal-error')">⚠️ Cửa Sổ Nhật Ký Lỗi</button>
      </div>

      <div class="btn-group-responsive" style="margin-top: 10px;">
        <a href="/api/toggle-bot" style="text-decoration:none;"><button type="button" class="${isManualStopped ? 'btn-start' : 'btn-stop'}" style="width:100%;">${isManualStopped ? 'BẬT BOT' : 'TẮT BOT'}</button></a>
        <a href="/api/inventory" style="text-decoration:none;"><button type="button" class="btn-purple" style="width:100%;">Túi Đồ [/inv]</button></a>
        <a href="/api/tusat" style="text-decoration:none;"><button type="button" class="btn-stop" style="width:100%;">Tự Sát [/tusat]</button></a>
        <a href="/api/clear-error-log" style="text-decoration:none;"><button type="button" class="btn-warning" style="width:100%;">Xóa Lỗi</button></a>
        <button type="button" class="btn-warning" id="btn-mention-count" onclick="openModal('modal-mention')">Mention (0)</button>
        <a href="/api/hard-restart" style="text-decoration:none;"><button type="button" class="btn-stop" style="width:100%;">Reset App</button></a>
      </div>
    </div>

    <div class="card">
      <h3>⚙️ Cài Đặt Tự Động & Chức Năng Tool</h3>
      <div class="btn-group-responsive">
        ${renderToggleBtn('afkmode', 'AFK Mode (/afkmode)')}
        ${renderToggleBtn('thien', 'Thiền (/thien)')}
        ${renderToggleBtn('quylai', 'Quỳ Lạy (/quylay)')}
        ${renderToggleBtn('dinhthan', 'Định Thần (/dinhthan)')}
        ${renderToggleBtn('quanghao', 'Quang Hào (/quanghao)')}
      </div>

      <div class="btn-group-responsive" style="margin-top: 10px;">
        ${renderToggleBtn('attackLeft', 'Đánh Tay Trái')}
        ${renderToggleBtn('attackRight', 'Đánh Tay Phải')}
        ${renderToggleBtn('sneak', 'Ngồi/Cúi (Sneak)')}
      </div>

      <div class="btn-group-responsive" style="margin-top: 10px;">
        ${renderToggleBtn('skill1', 'Kỹ Năng 1 (/kinang_1)')}
        ${renderToggleBtn('skill2', 'Kỹ Năng 2 (/kinang_2)')}
        ${renderToggleBtn('skill3', 'Kỹ Năng 3 (/kinang_3)')}
      </div>

      <form action="/api/update-click-speed" method="POST" style="margin-top: 15px;">
        <div class="form-grid">
          <div>
            <label>Tốc độ Đánh Trái (giây):</label>
            <input type="number" step="0.1" name="leftSpeed" value="${(attackLeftIntervalMs / 1000).toFixed(1)}">
          </div>
          <div>
            <label>Tốc độ Đánh Phải (giây):</label>
            <input type="number" step="0.1" name="rightSpeed" value="${(attackRightIntervalMs / 1000).toFixed(1)}">
          </div>
        </div>
        <button type="submit" class="btn-save">Lưu Tốc Độ Click</button>
      </form>
    </div>

    <div class="card">
      <h3>🎒 Cấu Hình Ô Công Cụ Bot (Ô 1 ➔ Ô 9)</h3>
      <form action="/api/update-slots" method="POST">
        <label>Thời gian cầm mỗi ô trước khi đổi sang ô tiếp theo (giây):</label>
        <input type="number" name="holdTimeSec" value="${slotConfig.holdTimeSec}" min="1">
        <div style="margin-top: 10px;"><label>Bật/Tắt các ô cần chuyển đổi cầm trên tay:</label></div>
        <div class="slot-grid">
          ${renderSlotGrid()}
        </div>
        <button type="submit" class="btn-save">Lưu Thiết Lập Ô Cầm</button>
      </form>
    </div>
  </div>

  <!-- MODAL CHAT SERVER -->
  <div id="modal-chat" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-header">
        <h3 style="margin:0;">💬 Cửa Sổ Chat Server</h3>
        <button type="button" class="modal-close" onclick="closeModal('modal-chat')">&times;</button>
      </div>
      <div id="modal-chat-box" class="chat-box"></div>
      <form onsubmit="sendChatCommand(event)" class="input-group">
        <input type="text" id="modal-chat-input" placeholder="Gửi lệnh hoặc chat vào server..." autocomplete="off">
        <button type="submit" class="btn-cyan">Gửi Chat</button>
      </form>
    </div>
  </div>

  <!-- MODAL ERROR LOGS -->
  <div id="modal-error" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-header">
        <h3 style="margin:0; color:var(--accent-pink);">⚠️ Cửa Sổ Nhật Ký Lỗi</h3>
        <button type="button" class="modal-close" onclick="closeModal('modal-error')">&times;</button>
      </div>
      <div id="modal-error-box" class="error-box"></div>
      <div style="margin-top:10px; text-align:right;">
        <a href="/api/clear-error-log"><button type="button" class="btn-warning">Xóa Nhật Ký Lỗi</button></a>
      </div>
    </div>
  </div>

  <!-- MODAL MENTIONS (MENU GIỐNG NHẬT KÝ LỖI) -->
  <div id="modal-mention" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-header">
        <h3 style="margin:0; color:var(--accent-yellow);">🔔 Cửa Sổ Nhật Ký Nhắc Tên (Mention)</h3>
        <button type="button" class="modal-close" onclick="closeModal('modal-mention')">&times;</button>
      </div>
      <div id="modal-mention-box" class="kiru-box"></div>
      <div style="margin-top:10px; text-align:right;">
        <a href="/api/clear-mention-log"><button type="button" class="btn-warning">Xóa Nhật Ký Nhắc Tên</button></a>
      </div>
    </div>
  </div>

  <!-- MODAL BOT CONFIG -->
  <div id="modal-config" class="modal-overlay">
    <div class="modal-card">
      <div class="modal-header">
        <h3 style="margin:0;">⚙️ Cấu Hình Kết Nối Bot</h3>
        <button type="button" class="modal-close" onclick="closeModal('modal-config')">&times;</button>
      </div>
      <form action="/api/update-config" method="POST">
        <div style="margin-bottom:12px;">
          <label>Tên Bot (Username):</label>
          <input type="text" name="username" value="${BOT_USERNAME}" required>
        </div>
        <div style="margin-bottom:12px;">
          <label>Mật Khẩu Bot:</label>
          <input type="password" name="password" value="${BOT_PASSWORD}">
        </div>
        <div style="margin-bottom:12px;">
          <label>Địa Chỉ Server (IP / Host:Port):</label>
          <input type="text" name="host" value="${hostDisplay}" required>
        </div>
        <button type="submit" class="btn-save">Lưu Cấu Hình & Kết Nối Lại</button>
      </form>
    </div>
  </div>

</body>
</html>`;

  res.send(html);
});

app.listen(port, () => {
  console.log(`[HTTP] Server dashboard control active on port ${port}`);
  createBot();
});