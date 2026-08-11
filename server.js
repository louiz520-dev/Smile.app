const express = require('express');
const path = require('path'); // 新增：匯入路徑模組
const app = express();

app.use(express.json());

// 1. 使用絕對路徑綁定 public 靜態目錄 (確保不同環境載入路徑都正確)
app.use(express.static(path.join(__dirname, 'public')));

// 2. 專門處理 /favicon.ico 請求 (雙重保障防止 404 錯誤)
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), (err) => {
    if (err) {
      // 若檔案不存在，回傳 204 No Content，避免瀏覽器持續跳出紅色 404 警告
      res.status(204).end();
    }
  });
});

// 記憶體儲存打卡紀錄 (生產環境可替換為資料庫)
let records = [];

// 1. 司機端提交 API (POST /api/scan)
app.post('/api/scan', (req, res) => {
  const { driver, barcode, status, pallets } = req.body;
  
  if (!barcode || !pallets || !Array.isArray(pallets) || pallets.length === 0) {
    return res.status(400).json({ error: '缺少條碼或棧板資訊' });
  }

  const newRecord = {
    id: Date.now(),
    driver: driver || '測試司機',
    barcode: barcode,
    status: status || '卸貨/入倉',
    pallets: pallets,
    created_at: new Date().toISOString()
  };

  records.unshift(newRecord);
  res.status(200).json({ success: true, message: '記錄寫入成功', data: newRecord });
});

// 2. 後台動態分析 API (GET /api/analytics)
app.get('/api/analytics', (req, res) => {
  const todayStr = new Date().toISOString().split('T')[0];

  // 篩選當日紀錄
  const todayRecords = records.filter(r => r.created_at.startsWith(todayStr));

  const dailyInMap = {};
  const dailyOutMap = {};
  const stockMap = {};

  // 運算全歷史紀錄的動態庫存與當日進出量
  records.forEach(r => {
    const isToday = r.created_at.startsWith(todayStr);
    const isOut = r.status.includes('出倉') || r.status.includes('提貨');

    (r.pallets || []).forEach(p => {
      const pName = typeof p === 'object' && p.name ? p.name : p;
      const pCount = typeof p === 'object' && p.count ? parseInt(p.count) : 1;

      // 運算總庫存
      if (!stockMap[pName]) stockMap[pName] = 0;
      if (isOut) {
        stockMap[pName] = Math.max(0, stockMap[pName] - pCount);
      } else {
        stockMap[pName] += pCount;
      }

      // 運算當日進出量
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
});

// 3. 備用讀取全紀錄 API
app.get('/api/records', (req, res) => {
  res.status(200).json(records);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;