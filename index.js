const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ÉP MÚI GIỜ VIỆT NAM TOÀN HỆ THỐNG
process.env.TZ = 'Asia/Ho_Chi_Minh';

// --- QUẢN LÝ ĐA TÀI KHOẢN (MULTI-ACCOUNT) ---
// Hỗ trợ danh sách tài khoản để tránh quá tải RAM trên Render Free (khuyến nghị tối đa 2-3 tài khoản)
let accounts = [
  {
    username: process.env.BOT_USERNAME || 'Kiru Đẹp Trai',
    password: process.env.BOT_PASSWORD || 'YourPasswordHere',
    host: process.env.BOT_HOST || 'mc.example.com',
    port: parseInt(process.env.BOT_PORT) || 25565,
    enabled: true
  }
];

// Lưu trữ các instance bot đang chạy
const botInstances = new Map();

// --- BẬT/TẮT CÁC TÍNH NĂNG TOGGLE CHUNG ---
const globalToggles = {
  afkmode: false,
  thien: false,
  quylay: false,
  dinhthan: false,
  quanghao: false,
  ngoi: false,
  attackLeft: false,
  attackRight: false,
  sneakLeft: false,  // MỚI: Ngồi + Chuột trái
  sneakRight: false, // MỚI: Ngồi + Chuột phải
  skill1: false,
  skill2: false,
  skill3: false
};

// Cấu hình tốc độ click chuột (ms)
let attackLeftIntervalMs = 500;
let attackRightIntervalMs = 500;
let sneakClickIntervalMs = 1000;

// CẤU HÌNH HOTBAR (Ô 1 -> 9)
let hotbarEnabled = [false, false, false, false, false, false, false, false, false];
let hotbarHoldDurationSec = 5;

// GLOBAL LOGS & SYSTEM STATUS
const serverChatLogs = [];
const errorLogs = [];
const pingLogs = [];
const botMentionLogs = [];
const commandGuideList = [
  { cmd: '/afkmode vao / ra', desc: 'Bật/tắt chế độ AFK nhận quà.' },
  { cmd: '/thien', desc: 'Ngồi thiền tu luyện.' },
  { cmd: '/quylay', desc: 'Quỳ lạy nhận phúc lợi.' },
  { cmd: '/dinhthan', desc: 'Định thần tăngộ tính.' },
  { cmd: '/quanghao', desc: 'Kích hoạt hào quang.' },
  { cmd: '/tusat', desc: 'Tự sát về điểm hồi sinh khi kẹt.' },
  { cmd: '/inv', desc: 'Kiểm tra túi đồ nhanh.' },
  { cmd: '/kinang_1 / 2 / 3', desc: 'Sử dụng kỹ năng chiến đấu.' }
];

function getVNTime() {
  return new Date().toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

function addChatLog(username, msg) {
  serverChatLogs.unshift(`[${getVNTime()}] [${username}] ${msg}`);
  if (serverChatLogs.length > 30) serverChatLogs.pop();
}

function addErrorLog(username, type, details) {
  errorLogs.unshift({
    time: getVNTime(),
    username: username,
    type: type,
    details: details
  });
  if (errorLogs.length > 30) errorLogs.pop();
}

function addPingLog(username, pingVal) {
  pingLogs.unshift({
    time: getVNTime(),
    username: username,
    ping: pingVal
  });
  if (pingLogs.length > 20) pingLogs.pop();
}

function addBotMentionLog(username, msg) {
  botMentionLogs.unshift({
    time: getVNTime(),
    username: username,
    text: msg
  });
  if (botMentionLogs.length > 20) botMentionLogs.pop();
}

// ==========================================
// ĐỊNH NGHĨA CLASS QUẢN LÝ TỪNG BOT (SAFE STACK)
// ==========================================
class ManagedBot {
  constructor(accountConfig) {
    this.config = accountConfig;
    this.bot = null;
    this.isManualStopped = false;
    this.isReconnecting = false;
    this.reconnectStage = 1; // 1: Smart Retry, 2: 60s retry -> 60s shutdown
    this.consecutiveFailures = 0;
    this.reconnectTimeout = null;
    this.statusBadge = 'OFFLINE';
    this.currentCoords = 'Đang xác định...';
    this.currentPing = 0;
    this.currentWeapon = 'Tay không';
    this.isFirstSpawn = true;
    
    // Timers & Intervals
    this.intervals = {};
    this.timeouts = {};
    this.lastTimeAge = 0;
    this.lastTimeAgeUpdate = Date.now();
    this.lastActionTime = Date.now();
    this.isAutoActionRunning = false;
    this.currentHotbarIndex = 0;

    if (this.config.enabled) {
      this.initBot();
    }
  }

  getHeldItemName() {
    if (!this.bot || !this.bot.heldItem) return 'Tay không';
    const item = this.bot.heldItem;
    return item.customName || item.displayName || item.name || 'Vật phẩm không tên';
  }

  safeChat(msg) {
    if (this.bot && this.bot.entity && this.bot._client && this.bot._client.state === 'play' && !this.isManualStopped) {
      try {
        this.bot.chat(msg);
        addChatLog(this.config.username, `[TỰ ĐỘNG]: ${msg}`);
      } catch (e) {
        addErrorLog(this.config.username, 'Lỗi Chat', e.message);
      }
    }
  }

  stopLoops() {
    Object.keys(this.intervals).forEach(key => {
      clearInterval(this.intervals[key]);
      delete this.intervals[key];
    });
    Object.keys(this.timeouts).forEach(key => {
      clearTimeout(this.timeouts[key]);
      delete this.timeouts[key];
    });
  }

  restartLoops() {
    this.stopLoops();
    if (!this.bot || !this.bot.entity || !this.bot._client || this.bot._client.state !== 'play' || this.isManualStopped) return;

    // 1. Quỳ lạy mỗi 47s
    if (globalToggles.quylay) {
      this.intervals.quylay = setInterval(() => {
        if (globalToggles.quylay) this.safeChat('/quylay');
      }, 47000);
    }

    // 2. Ngồi (Sneak) mỗi 5s
    if (globalToggles.ngoi) {
      this.intervals.ngoi = setInterval(() => {
        if (this.bot && this.bot.entity) {
          try {
            this.bot.setControlState('sneak', true);
            setTimeout(() => { if (this.bot && this.bot.entity) this.bot.setControlState('sneak', false); }, 1200);
          } catch (e) {}
        }
      }, 5000);
    }

    // 3. Đánh trái liên tục
    if (globalToggles.attackLeft) {
      this.intervals.attackLeft = setInterval(() => {
        if (this.bot && this.bot.entity) {
          try { this.bot.swingArm('right'); } catch (e) {}
        }
      }, attackLeftIntervalMs);
    }

    // 4. Đánh phải liên tục
    if (globalToggles.attackRight) {
      this.intervals.attackRight = setInterval(() => {
        if (this.bot && this.bot.entity) {
          try { this.bot.activateItem(); } catch (e) {}
        }
      }, attackRightIntervalMs);
    }

    // 5. Ngồi + Chuột trái (Sneak + Left Click)
    if (globalToggles.sneakLeft) {
      this.intervals.sneakLeft = setInterval(() => {
        if (this.bot && this.bot.entity) {
          try {
            this.bot.setControlState('sneak', true);
            this.bot.swingArm('right');
            setTimeout(() => { if (this.bot && this.bot.entity) this.bot.setControlState('sneak', false); }, 500);
          } catch (e) {}
        }
      }, sneakClickIntervalMs);
    }

    // 6. Ngồi + Chuột phải (Sneak + Right Click)
    if (globalToggles.sneakRight) {
      this.intervals.sneakRight = setInterval(() => {
        if (this.bot && this.bot.entity) {
          try {
            this.bot.setControlState('sneak', true);
            this.bot.activateItem();
            setTimeout(() => { if (this.bot && this.bot.entity) this.bot.setControlState('sneak', false); }, 500);
          } catch (e) {}
        }
      }, sneakClickIntervalMs);
    }

    // 7. Kỹ năng 1, 2, 3
    if (globalToggles.skill1 || globalToggles.skill2 || globalToggles.skill3) {
      this.intervals.skillLoop = setInterval(() => {
        if (globalToggles.skill1) this.safeChat('/kinang_1');
        if (globalToggles.skill2) this.safeChat('/kinang_2');
        if (globalToggles.skill3) this.safeChat('/kinang_3');
      }, 10000);
    }

    // 8. Hotbar Luân chuyển
    const activeSlots = hotbarEnabled.map((en, idx) => en ? idx : -1).filter(idx => idx !== -1);
    if (activeSlots.length === 1) {
      try { this.bot.setQuickBarSlot(activeSlots[0]); } catch (e) {}
    } else if (activeSlots.length > 1) {
      this.intervals.hotbarLoop = setInterval(() => {
        if (this.bot && this.bot.entity) {
          this.currentHotbarIndex = (this.currentHotbarIndex + 1) % activeSlots.length;
          try { this.bot.setQuickBarSlot(activeSlots[this.currentHotbarIndex]); } catch (e) {}
        }
      }, hotbarHoldDurationSec * 1000);
    }
  }

  cleanup() {
    this.stopLoops();
    this.isAutoActionRunning = false;
    this.currentCoords = 'Đang xác định...';
    this.currentPing = 0;
    this.statusBadge = 'OFFLINE';

    if (this.bot) {
      try {
        this.bot.clearControlStates();
        this.bot.end();
      } catch (e) {}
      this.bot = null;
    }
  }

  // YÊU CẦU 5: KIỂM TRA SERVER TRƯỚC KHI KẾT NỐI (SERVER STATUS & PLAYER COUNT > 5)
  async checkServerStatusBeforeConnect() {
    return new Promise((resolve) => {
      const mcData = require('minecraft-protocol');
      mc.ping({ host: this.config.host, port: this.config.port, timeout: 5000 }, (err, response) => {
        if (err) {
          resolve({ online: false, players: 0 });
        } else {
          const onlinePlayers = response?.players?.online || 0;
          resolve({ online: true, players: onlinePlayers });
        }
      });
    });
  }

  async handleSmartReconnect() {
    if (this.isManualStopped || this.isReconnecting) return;
    this.isReconnecting = true;
    this.cleanup();

    this.consecutiveFailures++;
    console.log(`[${this.config.username}] Mất kết nối lần thứ ${this.consecutiveFailures}`);

    // Giai đoạn 1: Thử lại nhanh 3 lần đầu theo cách thông minh (giữa các lần cách nhau 15s)
    if (this.consecutiveFailures <= 3) {
      this.statusBadge = `RECONNECT (GĐ 1 - Lần ${this.consecutiveFailures}/3)`;
      this.reconnectTimeout = setTimeout(() => {
        this.isReconnecting = false;
        this.initBot();
      }, 15000);
      return;
    }

    // Giai đoạn 2 (Yêu cầu của bạn): Sau 3 lần thất bại, chờ 60s kết nối lại. Nếu vẫn tạch -> Tắt bot 60s rồi kết nối lại.
    // Đồng thời kiểm tra xem server có đang mở và có trên 5 người chơi hay không.
    this.statusBadge = 'ĐANG KIỂM TRA TRẠNG THÁI SERVER...';
    
    let checkInterval = setInterval(async () => {
      if (this.isManualStopped) {
        clearInterval(checkInterval);
        return;
      }

      const serverInfo = await this.checkServerStatusBeforeConnect();
      console.log(`[${this.config.username}] Kiểm tra Server -> Online: ${serverInfo.online}, Players: ${serverInfo.players}`);

      if (serverInfo.online && serverInfo.players >= 5) {
        clearInterval(checkInterval);
        this.statusBadge = 'SERVER SẴN SÀNG - KẾT NỐI LẠI';
        addErrorLog(this.config.username, 'Reconnect GĐ 2', `Server mở, có ${serverInfo.players} người. Tiến hành vào game.`);
        
        this.reconnectTimeout = setTimeout(() => {
          this.isReconnecting = false;
          this.consecutiveFailures = 0; // Reset đếm lỗi khi server đã ổn định
          this.initBot();
        }, 60000); // Chờ 60 giây theo đúng yêu cầu
      } else {
        this.statusBadge = serverInfo.online ? `SERVER ÍT NGƯỜI (${serverInfo.players}/5). CHỜ...` : 'SERVER ĐANG TẮT/BẢO TRÌ. CHỜ...';
      }
    }, 20000); // Kiểm tra mỗi 20 giây
  }

  initBot() {
    if (this.isManualStopped) return;
    this.cleanup();
    this.isFirstSpawn = true;
    this.lastTimeAge = 0;
    this.lastTimeAgeUpdate = Date.now();

    const options = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      hideErrors: false,
      checkTimeoutInterval: 60 * 1000,
      keepAlive: true,
      physicsEnabled: true,
      viewDistance: 'tiny'
    };

    console.log(`\n[HỆ THỐNG] Đang kết nối ${options.username} tới ${options.host}:${options.port}...`);
    this.statusBadge = 'ĐANG KẾT NỐI...';

    try {
      this.bot = mineflayer.createBot(options);
      this.bot.setMaxListeners(0);
      if (this.bot._client) {
        this.bot._client.setMaxListeners(0);
        this.bot._client.on('error', (err) => {
          addErrorLog(this.config.username, 'Socket Error', err.message);
        });
      }
    } catch (err) {
      addErrorLog(this.config.username, 'Init Failed', err.message);
      this.handleSmartReconnect();
      return;
    }

    this.bot.on('spawn', () => {
      this.statusBadge = 'ONLINE';
      addChatLog(this.config.username, 'Bot đã vào game thành công!');
      this.consecutiveFailures = 0;

      if (this.isFirstSpawn) {
        this.isFirstSpawn = false;

        // Đăng nhập mật khẩu server (nếu có)
        this.timeouts.login1 = setTimeout(() => {
          if (this.bot && this.config.password) {
            this.bot.chat(`/l ${this.config.password}`);
          }
        }, 3500);

        // Kích hoạt tính năng & chống afk
        this.timeouts.login2 = setTimeout(() => {
          if (this.bot && this.bot.entity) {
            this.executeSpawnFeatures();
            this.scheduleRandomAction();
            this.scheduleRandomLook();
          }
        }, 7000);

        // YÊU CẦU 4: XÁC THỰC THỰC TẾ TRẠNG THÁI BOT TRONG SERVER (100% CHÍNH XÁC KHÔNG ẢO)
        this.intervals.watchdog = setInterval(() => {
          if (!this.bot || this.isManualStopped) return;

          // Kiểm tra xem thực thể bot có thực sự tồn tại trong thế giới không
          if (!this.bot.entity || !this.bot.entity.position) {
            addErrorLog(this.config.username, 'Watchdog', 'Phát hiện trạng thái bot ảo! Ép kết nối lại...');
            this.handleSmartReconnect();
            return;
          }

          // Cập nhật tọa độ thực tế
          const pos = this.bot.entity.position;
          this.currentCoords = `X: ${pos.x.toFixed(1)}, Y: ${pos.y.toFixed(1)}, Z: ${pos.z.toFixed(1)}`;
          this.currentWeapon = this.getHeldItemName();

          // Kiểm tra packet thế giới đứng yên quá 45s (kẹt map)
          if (this.bot.time) {
            if (this.bot.time.age === this.lastTimeAge) {
              if (Date.now() - this.lastTimeAgeUpdate > 45000) {
                addErrorLog(this.config.username, 'Watchdog', 'Đứng hình packet > 45s. Reconnect...');
                this.handleSmartReconnect();
              }
            } else {
              this.lastTimeAge = this.bot.time.age;
              this.lastTimeAgeUpdate = Date.now();
            }
          }
        }, 15000);

        // Cập nhật Ping định kỳ
        this.intervals.ping = setInterval(() => {
          if (this.bot && this.bot.player) {
            this.currentPing = this.bot.player.ping || 0;
            addPingLog(this.config.username, this.currentPing);
          }
        }, 10000);

        // Dọn dẹp bộ nhớ RAM thừa (Garbage Collector friendly cho Render Free)
        this.intervals.gc = setInterval(() => {
          if (this.bot && this.bot.entities && this.bot.entity) {
            const myPos = this.bot.entity.position;
            Object.keys(this.bot.entities).forEach(id => {
              const ent = this.bot.entities[id];
              if (ent && myPos && ent.position && ent.position.distanceTo(myPos) > 15 && ent.id !== this.bot.entity.id) {
                delete this.bot.entities[id];
              }
            });
          }
          if (global.gc) { try { global.gc(); } catch (e) {} }
        }, 20000);
      }
    });

    this.bot.on('death', () => {
      addChatLog(this.config.username, 'Bot đã tử vong! Đang chờ hồi sinh...');
      this.timeouts.respawn = setTimeout(() => {
        if (this.bot) {
          try { this.bot.respawn(); } catch (e) {}
        }
        setTimeout(() => this.executeSpawnFeatures(), 4000);
      }, 3000);
    });

    this.bot.on('message', (message) => {
      try {
        const text = message.toString().trim();
        if (!text) return;
        if (text.toLowerCase().includes(this.config.username.toLowerCase())) {
          this.config.username && addBotMentionLog(this.config.username, text);
        }
        addChatLog(this.config.username, text);
      } catch (e) {}
    });

    this.bot.on('end', (reason) => {
      addErrorLog(this.config.username, 'Mất Kết Nối', `Lý do: ${reason}`);
      this.handleSmartReconnect();
    });

    this.bot.on('error', (err) => {
      addErrorLog(this.config.username, 'Mineflayer Error', err.message);
    });

    this.bot.on('kicked', (reason) => {
      const rStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
      addErrorLog(this.config.username, 'Bị Server Kick', rStr);
      this.handleSmartReconnect();
    });
  }

  executeSpawnFeatures() {
    if (!this.bot || this.isManualStopped) return;
    let delay = 1000;
    if (globalToggles.afkmode) { setTimeout(() => this.safeChat('/afkmode vao'), delay); delay += 1000; }
    if (globalToggles.thien) { setTimeout(() => this.safeChat('/thien'), delay); delay += 1000; }
    if (globalToggles.quylay) { setTimeout(() => this.safeChat('/quylay'), delay); delay += 1000; }
    if (globalToggles.dinhthan) { setTimeout(() => this.safeChat('/dinhthan'), delay); delay += 1000; }
    if (globalToggles.quanghao) { setTimeout(() => this.safeChat('/quanghao'), delay); delay += 1000; }
    setTimeout(() => this.restartLoops(), delay + 500);
  }

  scheduleRandomAction() {
    if (this.timeouts.action) clearTimeout(this.timeouts.action);
    if (this.isManualStopped || !this.bot || !this.bot.entity) return;

    this.isAutoActionRunning = true;
    this.lastActionTime = Date.now();

    try {
      const type = Math.floor(Math.random() * 3);
      if (type === 0) this.bot.swingArm('right');
      else if (type === 1) {
        this.bot.setControlState('sneak', true);
        setTimeout(() => { if (this.bot) this.bot.setControlState('sneak', false); }, 200);
      } else {
        this.bot.activateItem();
      }
    } catch (e) {}

    this.timeouts.action = setTimeout(() => this.scheduleRandomAction(), Math.floor(6000 + Math.random() * 6000));
  }

  scheduleRandomLook() {
    if (this.timeouts.look) clearTimeout(this.timeouts.look);
    if (this.isManualStopped || !this.bot || !this.bot.entity) return;

    this.timeouts.look = setTimeout(() => {
      if (this.bot && this.bot.entity && this.bot.health > 0) {
        try {
          const dyaw = (Math.random() - 0.5) * 0.4;
          const dpitch = (Math.random() - 0.5) * 0.2;
          this.bot.look(this.bot.entity.yaw + dyaw, this.bot.entity.pitch + dpitch, true);
        } catch (e) {}
      }
      this.scheduleRandomLook();
    }, Math.floor(15000 + Math.random() * 15000));
  }
}

// Khởi tạo các bot dựa trên mảng account
function initAllBots() {
  accounts.forEach((acc, index) => {
    botInstances.set(index, new ManagedBot(acc));
  });
}
initAllBots();


// ==========================================
// EXPRESS API & GAMING DASHBOARD (UI/UX)
// ==========================================

app.get('/api/ping', (req, res) => res.send('PONG_OK'));

// Thêm tài khoản mới
app.post('/api/account/add', (req, res) => {
  const { username, password, host } = req.body;
  if (username && host) {
    let cleanHost = host.trim();
    let port = 25565;
    if (cleanHost.includes(':')) {
      const p = cleanHost.split(':');
      cleanHost = p[0];
      port = parseInt(p[1]) || 25565;
    }
    accounts.push({
      username: username.trim(),
      password: password ? password.trim() : '',
      host: cleanHost,
      port: port,
      enabled: true
    });
    // Khởi tạo bot mới ngay lập tức
    const newIdx = accounts.length - 1;
    botInstances.set(newIdx, new ManagedBot(accounts[newIdx]));
  }
  res.redirect('/');
});

// Bật/Tắt tính năng global toggle
app.get('/api/toggle/:feature', (req, res) => {
  const feat = req.params.feature;
  if (globalToggles.hasOwnProperty(feat)) {
    globalToggles[feat] = !globalToggles[feat];
    addChatLog('SYSTEM', `Cài đặt [${feat.toUpperCase()}] ➔ ${globalToggles[feat] ? 'BẬT' : 'TẮT'}`);
    // Restart loops cho toàn bộ các bot đang chạy
    botInstances.forEach(b => b.restartLoops());
  }
  res.redirect('/');
});

// Gửi lệnh chat thủ công tới tất cả bot hoặc bot chỉ định
app.post('/api/command', (req, res) => {
  const cmd = req.body.command;
  if (cmd) {
    botInstances.forEach(b => {
      if (!b.isManualStopped) {
        b.safeChat(cmd);
      }
    });
  }
  res.redirect('/');
});

// Cập nhật cấ
