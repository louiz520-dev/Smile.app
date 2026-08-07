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

// 設定靜態檔案資料夾 (對應 public 目錄裡的前端頁面)
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------------
// 3. 資料庫 Schema 定義 (User 與 Inventory)
// -------------------------------------------------------------------

// 使用者 Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { 
    type: String, 
    enum: ['developer', 'manager', 'staff'], 
    default: 'staff' 
  },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// 庫存 Schema
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
// 4. 初始化最高權限開發者帳號
// -------------------------------------------------------------------
async function initDeveloperAccount() {
  try {
    const devExists = await User.findOne({ username: 'smile_0222' });
    if (!devExists) {
      await User.create({
        username: 'smile_0222',
        password: 'password123', // 建議登入後修改
        role: 'developer'
      });
      console.log('✅ 已成功初始化最高開發者帳號：smile_0222');
    }
  } catch (error) {
    console.error('⚠️ 初始化開發者帳號時出錯:', error.message);
  }
}

// -------------------------------------------------------------------
// 5. API 路由 (API Routes)
// -------------------------------------------------------------------

// 5.1 使用者登入 API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username, password });
    if (!user) {
      return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }
    res.json({
      success: true,
      message: '登入成功',
      user: {
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '伺服器內部錯誤', error: error.message });
  }
});

// 5.2 取得所有庫存列表 API
app.get('/api/inventory', async (req, res) => {
  try {
    const items = await Inventory.find().sort({ updatedAt: -1 });
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: '無法取得庫存資料', error: error.message });
  }
});

// 5.3 新增庫存項目 API
app.post('/api/inventory', async (req, res) => {
  try {
    const newItem = new Inventory(req.body);
    await newItem.save();
    res.status(201).json({ success: true, message: '庫存項目新增成功', data: newItem });
  } catch (error) {
    res.status(400).json({ success: false, message: '新增失敗，可能貨號已存在或欄位錯誤', error: error.message });
  }
});

// 5.4 更新庫存項目 API
app.put('/api/inventory/:id', async (req, res) => {
  try {
    const updatedItem = await Inventory.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true }
    );
    res.json({ success: true, message: '庫存更新成功', data: updatedItem });
  } catch (error) {
    res.status(400).json({ success: false, message: '更新失敗', error: error.message });
  }
});

// 5.5 刪除庫存項目 API
app.delete('/api/inventory/:id', async (req, res) => {
  try {
    await Inventory.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: '庫存刪除成功' });
  } catch (error) {
    res.status(400).json({ success: false, message: '刪除失敗', error: error.message });
  }
});

// 前端單頁應用 (SPA) 退回機制
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------------------------------------------------------
// 6. 資料庫連線與伺服器啟動
// -------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

// 使用標準連線格式避免 SRV DNS 阻擋
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://louiz520_db_user:O2XQ61mjKHLMs3qg@smile.eudkfpx.mongodb.net:27017/warehouse_db?ssl=true&authSource=admin&appName=Smile';

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('🔗 已成功連接至 MongoDB Atlas 雲端資料庫！');
    initDeveloperAccount(); // 自動檢查並建立最高開發者帳號
    
    app.listen(PORT, () => {
      console.log(`🚀 伺服器成功啟動於 http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB 資料庫連線失敗:', err.message);
  });