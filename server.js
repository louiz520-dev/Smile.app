// 1. 載入環境變數設定 (.env)
require('dotenv').config();

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // 強制使用 Google DNS 解析 MongoDB 網址

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// 2. 中間件 (Middleware) 設定
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 設定靜態檔案資料夾 (對應 public 目錄裡的前端頁面)
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------------
// 3. 資料庫 Schema 定義
// -------------------------------------------------------------------

// 3.1 進貨紀錄 Schema (對應 index.html 儀表板的需求)
const recordSchema = new mongoose.Schema({
  time: { type: String, default: () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) },
  supplier: { type: String, default: '未指定廠商' },
  driverName: { type: String, default: '未登記' },
  plateNumber: { type: String, default: '未紀錄' },
  palletCount: { type: Number, default: 1 },
  status: { type: String, default: '已進貨' },
  createdAt: { type: Date, default: Date.now }
});

const Record = mongoose.model('Record', recordSchema);

// 3.2 使用者 Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['developer', 'manager', 'staff'], default: 'staff' },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// 3.3 庫存 Schema
const inventorySchema = new mongoose.Schema({
  itemCode: { type: String, required: true, unique: true },
  itemName: { type: String, required: true },
  category: { type: String, required: true },
  quantity: { type: Number, required: true, default: 0 },
  unitPrice: { type: Number, required: true, default: 0 },
  location: { type: String, default: '未分配' },
  updatedAt: { type: Date, default: Date.now }
});

const Inventory = mongoose.model('Inventory', inventorySchema);

// -------------------------------------------------------------------
// 4. API 路由 (API Routes)
// -------------------------------------------------------------------

// 4.1 取得進貨紀錄 API (供 index.html 使用)
app.get('/api/records', async (req, res) => {
  try {
    const records = await Record.find().sort({ createdAt: -1 }).limit(20);
    res.json(records);
  } catch (error) {
    res.status(500).json({ success: false, message: '無法取得紀錄', error: error.message });
  }
});

// 4.2 新增進貨紀錄 API (供 scan.html 司機端提交使用)
app.post('/api/records', async (req, res) => {
  try {
    const newRecord = new Record(req.body);
    await newRecord.save();
    res.status(201).json({ success: true, message: '紀錄新增成功', data: newRecord });
  } catch (error) {
    res.status(400).json({ success: false, message: '新增紀錄失敗', error: error.message });
  }
});

// 4.3 使用者登入 API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username, password });
    if (!user) {
      return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }
    res.json({ success: true, message: '登入成功', user: { username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ success: false, message: '伺服器內部錯誤', error: error.message });
  }
});

// 4.4 庫存管理相關 API
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find().sort({ updatedAt: -1 });
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: '無法取得庫存資料', error: error.message });
  }
});

// SPA 退回機制
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------------------------------------------------------
// 5. 資料庫連線與啟動
// -------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://louiz520_db_user:O2XQ61mjKHLMs3qg@smile.eudkfpx.mongodb.net:27017/warehouse_db?ssl=true&authSource=admin&appName=Smile';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('🔗 已成功連接至 MongoDB Atlas 雲端資料庫！'))
  .catch(err => console.error('❌ MongoDB 資料庫連線失敗:', err.message));

if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`🚀 本地伺服器啟動於 http://localhost:${PORT}`));
}

module.exports = app;