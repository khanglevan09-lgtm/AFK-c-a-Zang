const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware đọc dữ liệu JSON và Form
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 1. DANH SÁCH LƯU TRỮ TRẠNG THÁI (Lưu trong RAM Server)
const activatedIps = new Set(); // Lưu danh sách các IP đã kích hoạt key thành công
const validKeys = new Set(['PREMIUM123', 'VIP2026', 'ADMIN_KEY']); // Danh sách Key hợp lệ (Thay đổi theo ý bạn)

// Trạng thái các nút bấm trên Bảng Điều Khiển
const botSettings = {
  afk: false,
  thien: false,
  quy_lay: false,
  dinh_than: false,
  quang_hao: false,
  tui_do: false,
  danh_trai: false,
  danh_phai: false,
  skill1: false,
  skill2: false,
  skill3: false,
  autoClickSpeed: 0.5
};

// Hàm lấy địa chỉ IP chuẩn của người dùng (Tương thích với Render)
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

// 2. API KÍCH HOẠT KEY (Gửi kết quả dạng JSON - Không chuyển hướng trang)
app.post('/api/activate-key', (req, res) => {
  try {
    const userIp = getClientIp(req);
    const inputKey = (req.body.key || '').trim();

    if (!inputKey) {
      return res.json({ success: false, message: 'Vui lòng nhập key kích hoạt!' });
    }

    if (validKeys.has(inputKey) || inputKey.startsWith('KEY_')) {
      activatedIps.add(userIp); // Ghi nhớ IP này đã được kích hoạt
      return res.json({
        success: true,
        message: `Kích hoạt thành công gói [PREMIUM]! Key [${inputKey}] đã áp dụng cho IP: ${userIp}`
      });
    } else {
      return res.json({
        success: false,
        message: `Kích hoạt thất bại: Key [${inputKey}] không hợp lệ hoặc đã hết hạn!`
      });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ: ' + error.message });
  }
});

// 3. API BẬT/TẮT TÍNH NĂNG BẢNG ĐIỀU KHIỂN (Gửi kết quả dạng JSON)
app.post('/api/toggle-feature', (req, res) => {
  try {
    const userIp = getClientIp(req);
    
    // Kiểm tra IP đã kích hoạt key chưa
    if (!activatedIps.has(userIp)) {
      return res.json({
        success: false,
        message: 'Tính năng đang bị KHÓA! Vui lòng kích hoạt Key trước khi sử dụng.'
      });
    }

    const { feature } = req.body;
    if (botSettings.hasOwnProperty(feature)) {
      botSettings[feature] = !botSettings[feature];
      const statusText = botSettings[feature] ? 'BẬT' : 'TẮT';
      return res.json({
        success: true,
        message: `Đã ${statusText} tính năng [${feature}] thành công!`,
        newState: botSettings[feature]
      });
    } else {
      return res.json({ success: false, message: 'Tính năng không tồn tại!' });
    }
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Lỗi server: ' + error.message });
  }
});

// 4. API LƯU TỐC ĐỘ AUTO CLICK
app.post('/api/save-speed', (req, res) => {
  const userIp = getClientIp(req);
  if (!activatedIps.has(userIp)) {
    return res.json({ success: false, message: 'Bạn chưa kích hoạt Key!' });
  }

  const { speed } = req.body;
  botSettings.autoClickSpeed = parseFloat(speed) || 0.5;
  return res.json({ success: true, message: `Đã lưu tốc độ Click: ${botSettings.autoClickSpeed}s` });
});

// 5. TRANG CHỦ GIAO DIỆN CHÍNH
app.get('/', (req, res) => {
  const userIp = getClientIp(req);
  const isUnlocked = activatedIps.has(userIp); // Kiểm tra IP đã lưu trong bộ nhớ chưa

  const html = `
  <!DOCTYPE html>
  <html lang="vi">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bảng Điều Khiển Bot</title>
    <style>
      body {
        background-color: #11111b;
        color: #cdd6f4;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        margin: 0;
        padding: 20px;
        background-size: cover;
        background-position: center;
        background-attachment: fixed;
        transition: background-image 0.5s ease-in-out;
      }
      .container {
        max-width: 900px;
        margin: 0 auto;
        background: rgba(24, 24, 37, 0.92);
        padding: 25px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        backdrop-filter: blur(8px);
      }
      h2, h3 { color: #89b4fa; margin-top: 15px; margin-bottom: 10px; }
      
      /* Input & Buttons Style */
      input[type="text"], input[type="number"], input[type="password"] {
        background: #313244;
        border: 1px solid #45475a;
        color: #fff;
        padding: 8px 12px;
        border-radius: 6px;
        outline: none;
      }
      button {
        background: #313244;
        color: #cdd6f4;
        border: 1px solid #45475a;
        padding: 10px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: bold;
        transition: all 0.2s;
        margin: 4px;
      }
      button:hover:not(:disabled) { background: #45475a; color: #89b4fa; }
      button:disabled { opacity: 0.5; cursor: not-allowed; }
      
      .btn-primary { background: #89b4fa; color: #11111b; border: none; }
      .btn-primary:hover { background: #b4befe; }
      .unlocked { border-color: #a6e3a1; color: #a6e3a1; }

      /* Khung Nhật Ký Thông Báo */
      .log-container {
        background: #181825;
        border: 1px solid #313244;
        border-radius: 8px;
        padding: 12px;
        margin-top: 15px;
        font-family: 'Courier New', Courier, monospace;
      }
      .log-title { font-weight: bold; color: #f5e0dc; margin-bottom: 8px; border-bottom: 1px solid #313244; padding-bottom: 4px; }
      .log-box { max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }

      .grid-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px; }
    </style>
  </head>
  <body>

    <div class="container">
      <h2>🔑 Kích Hoạt Bản Quyền</h2>
      <div style="display: flex; gap: 10px; align-items: center;">
        <input type="password" id="pwd-input" placeholder="Nhập Key tại đây..." style="width: 250px;">
        <button type="button" onclick="togglePasswordVisibility()"><span id="eye-text">Hiện</span></button>
        <button type="button" class="btn-primary" onclick="activateKeyDirect()">Kích Hoạt</button>
      </div>

      <!-- KHUNG NHẬT KÝ THÔNG BÁO TRỰC TIẾP -->
      <div class="log-container">
        <div class="log-title">📋 Nhật Ký Thông Báo:</div>
        <div class="log-box" id="log-box">
          <div style="color: #6c7086;">[Hệ thống] Trạng thái IP (${userIp}): ${isUnlocked ? '✅ ĐÃ KÍCH HOẠT' : '🔒 CHƯA KÍCH HOẠT'}</div>
        </div>
      </div>

      <hr style="border-color: #313244; margin: 20px 0;">

      <h3>Bảng Bật / Tắt Tính Năng</h3>
      <div class="grid-btns">
        <button onclick="toggleFeature('afk')" ${isUnlocked ? '' : 'disabled'} class="${isUnlocked ? 'unlocked' : ''}">
          AFK Mode: ${isUnlocked ? (botSettings.afk ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('thien')" ${isUnlocked ? '' : 'disabled'} class="${isUnlocked ? 'unlocked' : ''}">
          Thiền: ${isUnlocked ? (botSettings.thien ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('quy_lay')" ${isUnlocked ? '' : 'disabled'} class="${isUnlocked ? 'unlocked' : ''}">
          Quỳ Lạy: ${isUnlocked ? (botSettings.quy_lay ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('dinh_than')" ${isUnlocked ? '' : 'disabled'} class="${isUnlocked ? 'unlocked' : ''}">
          Định Thân: ${isUnlocked ? (botSettings.dinh_than ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('quang_hao')" ${isUnlocked ? '' : 'disabled'} class="${isUnlocked ? 'unlocked' : ''}">
          Quang Hào: ${isUnlocked ? (botSettings.quang_hao ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('tui_do')" ${isUnlocked ? '' : 'disabled'} class="${isUnlocked ? 'unlocked' : ''}">
          Túi Đồ: ${isUnlocked ? (botSettings.tui_do ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
      </div>

      <h3>Auto Click Chuột</h3>
      <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 15px;">
        <label>Tốc độ (s):</label>
        <input type="number" id="speed-input" value="${botSettings.autoClickSpeed}" step="0.1" style="width: 80px;" ${isUnlocked ? '' : 'disabled'}>
        <button class="btn-primary" onclick="saveSpeed()" ${isUnlocked ? '' : 'disabled'}>Lưu Tốc Độ</button>
      </div>

      <div class="grid-btns">
        <button onclick="toggleFeature('danh_trai')" ${isUnlocked ? '' : 'disabled'} style="width: 48%;">
          Đánh Trái: ${isUnlocked ? (botSettings.danh_trai ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('danh_phai')" ${isUnlocked ? '' : 'disabled'} style="width: 48%;">
          Đánh Phải: ${isUnlocked ? (botSettings.danh_phai ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
      </div>

      <h3>Thiết Lập Skill (Lặp 10 giây/lần)</h3>
      <div class="grid-btns">
        <button onclick="toggleFeature('skill1')" ${isUnlocked ? '' : 'disabled'}>
          Kỹ Năng 1: ${isUnlocked ? (botSettings.skill1 ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('skill2')" ${isUnlocked ? '' : 'disabled'}>
          Kỹ Năng 2: ${isUnlocked ? (botSettings.skill2 ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
        <button onclick="toggleFeature('skill3')" ${isUnlocked ? '' : 'disabled'}>
          Kỹ Năng 3: ${isUnlocked ? (botSettings.skill3 ? '✅ BẬT' : '❌ TẮT') : '🔒 KHÓA'}
        </button>
      </div>
    </div>

    <script>
      // 1. Hàm ghi log vào ô nhật ký
      function addLog(message, isSuccess = true) {
        const logBox = document.getElementById('log-box');
        const timeStr = new Date().toLocaleTimeString('vi-VN');
        const color = isSuccess ? '#a6e3a1' : '#f38ba8';
        const icon = isSuccess ? '✅' : '❌';

        const item = document.createElement('div');
        item.innerHTML = \`<span style="color: #6c7086;">[\${timeStr}]</span> \${icon} <span style="color: \${color};">\${message}</span>\`;
        logBox.appendChild(item);
        logBox.scrollTop = logBox.scrollHeight;
      }

      // 2. Kích hoạt Key trực tiếp (Không redirect/chuyển trang)
      async function activateKeyDirect() {
        const input = document.getElementById('pwd-input');
        const keyVal = input.value.trim();

        if (!keyVal) {
          addLog('Vui lòng nhập key trước khi nhấn Kích Hoạt!', false);
          return;
        }

        try {
          const res = await fetch('/api/activate-key', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: keyVal })
          });
          const data = await res.json();

          if (data.success) {
            addLog(data.message, true);
            input.value = '';
            // Reload nhẹ sau 1 giây để mở khóa toàn bộ giao diện
            setTimeout(() => { location.reload(); }, 1200);
          } else {
            addLog(data.message, false);
          }
        } catch (err) {
          addLog('Không thể kết nối đến máy chủ!', false);
        }
      }

      // 3. Bật/tắt tính năng qua API ngầm
      async function toggleFeature(featureName) {
        try {
          const res = await fetch('/api/toggle-feature', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feature: featureName })
          });
          const data = await res.json();

          if (data.success) {
            addLog(data.message, true);
            setTimeout(() => { location.reload(); }, 500);
          } else {
            addLog(data.message, false);
          }
        } catch (err) {
          addLog('Lỗi gửi yêu cầu tới server!', false);
        }
      }

      // 4. Lưu tốc độ Auto Click
      async function saveSpeed() {
        const speed = document.getElementById('speed-input').value;
        try {
          const res = await fetch('/api/save-speed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ speed })
          });
          const data = await res.json();
          addLog(data.message, data.success);
        } catch (err) {
          addLog('Lỗi lưu tốc độ!', false);
        }
      }

      // 5. Tự động Reload kiểm tra (Chỉ reload khi người dùng không gõ chữ)
      setInterval(() => {
        const activeEl = document.activeElement;
        if (!activeEl || activeEl.tagName !== 'INPUT') {
          location.reload();
        }
      }, 6000);

      // 6. Xử lý đổi background Anime
      async function rotateAnimeBg() {
        try {
          const res = await fetch('https://api.waifu.pics/sfw/waifu');
          const data = await res.json();
          if (data && data.url) {
            const img = new Image();
            img.src = data.url;
            img.onload = () => { document.body.style.backgroundImage = 'url("' + data.url + '")'; };
          }
        } catch (e) {}
      }

      // 7. Ẩn/Hiện mật khẩu
      function togglePasswordVisibility() {
        const pwdInput = document.getElementById('pwd-input');
        const eyeText = document.getElementById('eye-text');
        if (pwdInput.type === 'password') {
          pwdInput.type = 'text';
          eyeText.textContent = 'Ẩn';
        } else {
          pwdInput.type = 'password';
          eyeText.textContent = 'Hiện';
        }
      }

      window.addEventListener('DOMContentLoaded', () => {
        rotateAnimeBg();
        setInterval(rotateAnimeBg, 60000);
      });
    </script>
  </body>
  </html>
  `;

  res.send(html);
});

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});