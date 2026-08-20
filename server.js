require('dotenv').config();

// ---------------------------------------------------------
// 💡 強制設定 DNS 伺服器，解決 Windows 下 querySrv ECONNREFUSED 問題
// ---------------------------------------------------------
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // 用於管理者幫忙重置密碼時加密
const User = require('./models/User'); // 引入 User 模型

// 🔒 1. 引入 JWT 驗證與角色權限中間件
const { authenticateToken, authorizeRoles } = require('./middleware/auth');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------
// Google 試算表 Web App URL (作為備用或主要帳號來源)
// ---------------------------------------------------------
const GOOGLE_SHEET_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyN7yQj_K6N9l1S9d2VPsNaYTaBO_6foPEmAvN660YySbk6fn3SK6fyanJyuA-BjaUH/exec';

// ---------------------------------------------------------
// 0. 連接 MongoDB 雲端資料庫
// ---------------------------------------------------------
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB 雲端資料庫連線成功！'))
    .catch(err => console.error('❌ MongoDB 連線失敗:', err));
} else {
  console.warn('⚠️ 未在 .env 檔案中找到 MONGODB_URI，請檢查設定。');
}

// ---------------------------------------------------------
// 帳號驗證與管理 API (Auth APIs)
// ---------------------------------------------------------

// 1. [一鍵建立初始管理者帳號 API] (POST /api/auth/init-admin) - 公開 (僅供初次部署初始化)
app.post('/api/auth/init-admin', async (req, res) => {
  try {
    const adminExists = await User.findOne({ username: 'admin' });
    if (adminExists) {
      return res.status(400).json({ success: false, message: '管理者帳號已存在！' });
    }

    const admin = new User({
      username: 'admin',
      password: 'adminpassword123',
      name: '系統管理員',
      role: 'admin', // 💡 升級：初始化角色為最高階管理員 (super_admin)
      isActive: true
    });

    await admin.save();
    res.json({ success: true, message: '✅ 管理者帳號建立成功！帳號: admin / 密碼: adminpassword123' });
  } catch (error) {
    console.error('❌ 初始化管理者帳號失敗詳細原因:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. [通用/司機/後台登入 API] (POST /api/auth/login) - 公開
// 💡 支援 MongoDB 與 Google 試算表 (Accounts 分頁) 雙重驗證，並依角色返回建議的導向路徑
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '請輸入帳號與密碼！' });
    }

    // ---------------------------------------------------------
    // 步驟 A: 優先驗證 MongoDB 資料庫
    // ---------------------------------------------------------
    let user = null;
    let isMongoUser = false;

    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ username });
      if (user) {
        isMongoUser = true;
      }
    }

    if (isMongoUser) {
      if (!user.isActive) {
        return res.status(403).json({ success: false, message: '此帳號已被停用，請聯繫管理者。' });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: '帳號或密碼錯誤！' });
      }

      // 發放 JWT Token (包含 role)
      const token = jwt.sign(
        { userId: user._id, username: user.username, role: user.role, name: user.name },
        process.env.JWT_SECRET || 'smile_wms_secret_key_2026_safe',
        { expiresIn: '30d' }
      );

      // 判斷跳轉目標頁面
      const isAdminRole = ['super_admin', 'admin', 'warehouse_manager'].includes(user.role);
      const redirectUrl = isAdminRole ? '/index.html' : '/scan.html';

      return res.json({
        success: true,
        message: '登入成功！',
        token,
        redirectUrl,
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role // 👈 供前端判斷 role 權限
        }
      });
    }

    // ---------------------------------------------------------
    // 步驟 B: MongoDB 無此帳號時，轉向 Google 試算表 Accounts 分頁驗證
    // ---------------------------------------------------------
    try {
      const gsResponse = await fetch(GOOGLE_SHEET_WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          username: username,
          password: password
        })
      });

      const gsData = await gsResponse.json();

      if (gsData.status === 'success') {
        const userRole = gsData.role || 'driver';
        const token = jwt.sign(
          { userId: gsData.username, username: gsData.username, role: userRole, name: gsData.name },
          process.env.JWT_SECRET || 'smile_wms_secret_key_2026_safe',
          { expiresIn: '30d' }
        );

        const isAdminRole = ['super_admin', 'admin', 'warehouse_manager'].includes(userRole);
        const redirectUrl = isAdminRole ? '/index.html' : '/scan.html';

        return res.json({
          success: true,
          message: '登入成功！',
          token,
          redirectUrl,
          user: {
            id: gsData.username,
            username: gsData.username,
            name: gsData.name,
            role: userRole // 👈 供前端判斷 role 權限
          }
        });
      } else {
        return res.status(400).json({ success: false, message: gsData.message || '帳號或密碼錯誤！' });
      }
    } catch (sheetErr) {
      console.error('Google 試算表驗證失敗:', sheetErr);
      return res.status(400).json({ success: false, message: '帳號或密碼錯誤！' });
    }

  } catch (error) {
    console.error('登入失敗:', error);
    res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試。' });
  }
});

// 2.1 [專用：後台管理員登入 API] (POST /api/auth/admin-login) - 公開
// 💡 強制檢驗角色，非管理者拒絕登入，防範司機帳號登入後台
app.post('/api/auth/admin-login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '請輸入管理員帳號與密碼！' });
    }

    let user = null;
    if (mongoose.connection.readyState === 1) {
      user = await User.findOne({ username });
    }

    if (user) {
      if (!user.isActive) {
        return res.status(403).json({ success: false, message: '此帳號已被停用。' });
      }

      // 權限過濾：非管理員權限直接阻擋
      const isAdminRole = ['super_admin', 'admin', 'warehouse_manager'].includes(user.role);
      if (!isAdminRole) {
        return res.status(403).json({ success: false, message: '權限不足！此頁面僅限後台管理人員登入。' });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: '帳號或密碼錯誤！' });
      }

      const token = jwt.sign(
        { userId: user._id, username: user.username, role: user.role, name: user.name },
        process.env.JWT_SECRET || 'smile_wms_secret_key_2026_safe',
        { expiresIn: '30d' }
      );

      return res.json({
        success: true,
        message: '後台登入成功！',
        token,
        redirectUrl: '/index.html',
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role
        }
      });
    }

    // 後備 Google 試算表驗證
    try {
      const gsResponse = await fetch(GOOGLE_SHEET_WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username, password })
      });
      const gsData = await gsResponse.json();

      if (gsData.status === 'success') {
        const isAdminRole = ['super_admin', 'admin', 'warehouse_manager'].includes(gsData.role);
        if (!isAdminRole) {
          return res.status(403).json({ success: false, message: '權限不足！此頁面僅限後台管理人員登入。' });
        }

        const token = jwt.sign(
          { userId: gsData.username, username: gsData.username, role: gsData.role, name: gsData.name },
          process.env.JWT_SECRET || 'smile_wms_secret_key_2026_safe',
          { expiresIn: '30d' }
        );

        return res.json({
          success: true,
          message: '後台登入成功！',
          token,
          redirectUrl: '/index.html',
          user: { id: gsData.username, username: gsData.username, name: gsData.name, role: gsData.role }
        });
      } else {
        return res.status(400).json({ success: false, message: gsData.message || '帳號或密碼錯誤！' });
      }
    } catch (err) {
      return res.status(400).json({ success: false, message: '帳號或密碼錯誤！' });
    }

  } catch (error) {
    console.error('後台登入失敗:', error);
    res.status(500).json({ success: false, message: '伺服器錯誤，請稍後再試。' });
  }
});

// 🔒 3. [管理者新增帳號 API] (POST /api/auth/create-user)
// 支援建立 driver, warehouse_manager, super_admin 角色
app.post('/api/auth/create-user', authenticateToken, authorizeRoles('super_admin', 'admin', 'warehouse_manager'), async (req, res) => {
  try {
    const { username, password, name, role } = req.body;

    const userExists = await User.findOne({ username });
    if (userExists) {
      return res.status(400).json({ success: false, message: '此帳號名稱已存在！' });
    }

    const newUser = new User({
      username,
      password,
      name,
      role: role || 'driver'
    });

    await newUser.save();
    
    let roleNameText = '司機';
    if (role === 'super_admin' || role === 'admin') roleNameText = '高階管理員';
    if (role === 'warehouse_manager') roleNameText = '倉管人員';

    res.json({ success: true, message: `✅ 成功建立帳號：${name} (${roleNameText})` });
  } catch (error) {
    console.error('❌ 新增使用者失敗詳細原因:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// 🔒 4. [驗證當前身份 API] (GET /api/auth/me) - 受保護
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// 🔒 5. [取得所有使用者清單 API] (GET /api/auth/users) - 管理者專用
app.get('/api/auth/users', authenticateToken, authorizeRoles('super_admin', 'admin', 'warehouse_manager'), async (req, res) => {
  try {
    const users = await User.find({}, 'username name role isActive createdAt').sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    console.error('取得使用者清單失敗:', error);
    res.status(500).json({ success: false, message: '讀取使用者清單時發生錯誤' });
  }
});

// 🔒 6. [重置使用者密碼 API] (PUT /api/auth/reset-password) - 高階管理者專用
app.put('/api/auth/reset-password', authenticateToken, authorizeRoles('super_admin', 'admin'), async (req, res) => {
  try {
    const { username, newPassword } = req.body;

    if (!username || !newPassword) {
      return res.status(400).json({ success: false, message: '缺少帳號或新密碼欄位！' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ success: false, message: '找不到該帳號！' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: `✅ 帳號 [${username}] 的密碼已成功重置！` });
  } catch (error) {
    console.error('重置密碼失敗:', error);
    res.status(500).json({ success: false, message: '重置密碼時發生伺服器錯誤' });
  }
});

// 🔒 7. [切換帳號啟用狀態 API] (PUT /api/auth/toggle-status) - 高階管理者專用
app.put('/api/auth/toggle-status', authenticateToken, authorizeRoles('super_admin', 'admin'), async (req, res) => {
  try {
    const { username, isActive } = req.body;

    const user = await User.findOneAndUpdate(
      { username },
      { isActive },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: '找不到該帳號！' });
    }

    res.json({ 
      success: true, 
      message: `✅ 帳號 [${username}] 狀態已更新為：${isActive ? '啟用' : '停用'}` 
    });
  } catch (error) {
    console.error('切換帳號狀態失敗:', error);
    res.status(500).json({ success: false, message: '更新狀態失敗' });
  }
});

// ---------------------------------------------------------
// 舊有功能：Google 試算表與掃碼/分析 API (加上權限防護)
// ---------------------------------------------------------

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), (err) => {
    if (err) res.status(204).end();
  });
});

function normalizeDateStr(dateInput) {
  if (!dateInput) return '';
  const str = String(dateInput).trim();
  const match = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function parsePalletString(palletData) {
  if (!palletData) return [];
  if (Array.isArray(palletData)) return palletData;
  
  const items = String(palletData).split(',');
  return items.map(item => {
    const match = item.trim().match(/^(.*?)\s*x\s*(\d+)$/i);
    if (match) {
      return { name: match[1].trim(), count: parseInt(match[2], 10) };
    }
    return { name: item.trim(), count: 1 };
  });
}

// 🔒 1. 司機端提交 API (POST /api/scan) - 受保護
app.post('/api/scan', authenticateToken, async (req, res) => {
  try {
    const { barcode, status, pallets } = req.body;
    const driver = req.user?.name || req.body.driver || '未知司機';

    if (!barcode || !pallets || !Array.isArray(pallets) || pallets.length === 0) {
      return res.status(400).json({ error: '缺少條碼或棧板資訊' });
    }

    const response = await fetch(GOOGLE_SHEET_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({ driver, barcode, status, pallets })
    });

    const result = await response.json();
    res.status(200).json({ success: true, message: '成功寫入試算表', data: result });
  } catch (error) {
    console.error('寫入 Google 試算表失敗:', error);
    res.status(500).json({ error: '寫入 Google 試算表時發生錯誤' });
  }
});

// 🔒 2. 後台動態分析 API (GET /api/analytics) - 受保護 (僅限管理者/倉管)
app.get('/api/analytics', authenticateToken, authorizeRoles('super_admin', 'admin', 'warehouse_manager'), async (req, res) => {
  try {
    const sheetResponse = await fetch(GOOGLE_SHEET_WEB_APP_URL, { redirect: 'follow' });
    const responseText = await sheetResponse.text();

    if (responseText.trim().startsWith('<')) {
      console.error('❌ [GAS 權限警告] 抓到的是 HTML 頁面而非 JSON，請將 GAS 存取權限改為「任何人」！');
      return res.status(200).json({
        todayRecords: [],
        dailyInMap: {},
        dailyOutMap: {},
        stockMap: {}
      });
    }

    let rawRecords = [];
    try {
      rawRecords = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ JSON 剖析失敗:', e);
    }

    const todayStr = normalizeDateStr(new Date());

    const records = (Array.isArray(rawRecords) ? rawRecords : []).map((r, index) => ({
      id: r.timestamp || Date.now() - index,
      driver: r.driver || '未知司機',
      barcode: r.barcode || '',
      status: r.status || '',
      pallets: parsePalletString(r.palletStr || r.pallets),
      created_at: r.timestamp
    }));

    const todayRecords = records.filter(r => normalizeDateStr(r.created_at) === todayStr);

    const dailyInMap = {};
    const dailyOutMap = {};
    const stockMap = {};

    records.forEach(r => {
      const recordDateStr = normalizeDateStr(r.created_at);
      const isToday = (recordDateStr === todayStr);
      const isOut = r.status.includes('出倉') || r.status.includes('提貨') || r.status.includes('越庫');

      (r.pallets || []).forEach(p => {
        const pName = p.name;
        const pCount = p.count;

        if (!stockMap[pName]) stockMap[pName] = 0;
        if (isOut) {
          stockMap[pName] = Math.max(0, stockMap[pName] - pCount);
        } else {
          stockMap[pName] += pCount;
        }

        if (isToday) {
          if (isOut) {
            dailyOutMap[pName] = (dailyOutMap[pName] || 0) + pCount;
          } else {
            dailyInMap[pName] = (dailyInMap[pName] || 0) + pCount;
          }
        }
      });
    });

    res.status(200).json({
      todayRecords,
      dailyInMap,
      dailyOutMap,
      stockMap
    });
  } catch (error) {
    console.error('讀取失敗:', error);
    res.status(200).json({
      todayRecords: [],
      dailyInMap: {},
      dailyOutMap: {},
      stockMap: {}
    });
  }
});

// 🔒 3. 讀取所有歷史紀錄 API (GET /api/records) - 受保護 (僅限管理者/倉管)
app.get('/api/records', authenticateToken, authorizeRoles('super_admin', 'admin', 'warehouse_manager'), async (req, res) => {
  try {
    const sheetResponse = await fetch(GOOGLE_SHEET_WEB_APP_URL, { redirect: 'follow' });
    const rawRecords = await sheetResponse.json();
    res.status(200).json(rawRecords);
  } catch (error) {
    res.status(500).json({ error: '讀取失敗' });
  }
});

// 匯出 Express app 供 api/index.js (Vercel Serverless Function) 呼叫
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 伺服器運作中，Port: ${PORT}`);
  });
}