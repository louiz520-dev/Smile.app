require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 使用標準 MongoDB Atlas SRV 連線字串，確保 Vercel 雲端相容性
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://louiz520_db_user:O2XQ61mjKHLMs3qg@smile.eudkfpx.mongodb.net/warehouse_db?retryWrites=true&w=majority';

// Serverless 連線快取
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb && mongoose.connection.readyState === 1) {
    return cachedDb;
  }
  
  // 建立新連線
  mongoose.set('strictQuery', false);
  const db = await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000
  });
  cachedDb = db;
  return db;
}

// -------------------------------------------------------------------
// 資料庫 Schema 定義
// -------------------------------------------------------------------
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
// API 路由
// -------------------------------------------------------------------
app.get('/api/records', async (req, res) => {
  try {
    await connectToDatabase();
    const records = await Record.find().sort({ createdAt: -1 }).limit(20);
    res.json(records);
  } catch (error) {
    console.error('API /api/records 錯誤:', error);
    // 連線失敗時回傳空陣列，避免前端 JavaScript 崩潰
    res.status(500).json([]);
  }
});

app.post('/api/records', async (req, res) => {
  try {
    await connectToDatabase();
    const newRecord = new Record(req.body);
    await newRecord.save();
    res.status(201).json({ success: true, message: '紀錄新增成功', data: newRecord });
  } catch (error) {
    res.status(400).json({ success: false, message: '新增紀錄失敗', error: error.message });
  }
});

// SPA 退回機制
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 本地開發測試啟動
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => console.log(`🚀 本地伺服器啟動於 http://localhost:${PORT}`));
}

module.exports = app;