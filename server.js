// 1. 載入環境變數設定 (.env)
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

// 2. 中間件 (Middleware) 設定
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 設定靜態檔案資料夾
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------------
// 3. MongoDB 資料庫連線優化 (適應 Vercel Serverless 環境)
// -------------------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://louiz520_db_user:O2XQ61mjKHLMs3qg@smile.eudkfpx.mongodb.net:27017/warehouse_db?ssl=true&authSource=admin&appName=Smile';

let isConnected = false;

async function connectToDatabase() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000
    });
    isConnected = true;
    console.log('🔗 已成功連接至 MongoDB Atlas 雲端資料庫！');
  } catch (err) {
    console.error('❌ MongoDB 資料庫連線失敗:', err.message);
    throw err;
  }
}

// 每次收到請求前確保資料庫連線已建立
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    try {
      await connectToDatabase();
    } catch (err) {
      return res.status(500).json({ success: false, message: '資料庫連線失敗，請檢查 MongoDB Atlas 設定', error: err.message });
    }
  }
  next();
});

// -------------------------------------------------------------------
// 4. 資料庫 Schema 定義
// -------------------------------------------------------------------

// 進貨紀錄 Schema
const recordSchema = new mongoose.Schema({
  time: { type: String, default: () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) },
  supplier: { type: String, default: '未指定廠商' },
  driverName: { type: String, default: '未登記' },
  plateNumber: { type: String, default: '未紀錄' },
  palletCount: { type: Number, default: 1 },
  status: { type: String, default: '已進貨' },
  createdAt: { type: Date, default: Date.now }
});

const Record = mongoose.models.Record || mongoose.model('Record', recordSchema);

// -------------------------------------------------------------------
// 5. API 路由 (API Routes)
// -------------------------------------------------------------------

// 5.1 取得進貨紀錄 API (儀表板使用)
app.get('/api/records', async (req, res) => {
  try {
    const records = await Record.find().sort({ createdAt: -1 }).limit(20);
    res.json(records);
  } catch (error) {
    res.status(500).json({ success: false, message: '無法取得紀錄', error: error.message });
  }
});

// 5.2 新增進貨紀錄 API (司機打卡端使用)
app.post('/api/records', async (req, res) => {
  try {
    const newRecord = new Record(req.body);
    await newRecord.save();
    res.status(201).json({ success: true, message: '紀錄新增成功', data: newRecord });
  } catch (error) {
    res.status(400).json({ success: false, message: '新增紀錄失敗', error: error.message });
  }
});

// SPA 退回機制 (找不到路徑時回傳 index.html)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 本地開發環境啟動伺服器
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`🚀 本地伺服器啟動於 http://localhost:${PORT}`));
}

module.exports = app;