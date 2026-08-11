const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// 1. 使用絕對路徑綁定 public 靜態目錄
app.use(express.static(path.join(__dirname, 'public')));

// 2. 專門處理 /favicon.ico 請求 (避免控制台 404 警告)
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), (err) => {
    if (err) res.status(204).end();
  });
});

// 3. 填入你的 Google Apps Script 部署網址
const GOOGLE_SHEET_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxnsJ34G9EV0dlNMsQBezIKaHQHnICvUI-eR_wRwYGfFb1HPDT-Qck5ElPxF8hCf9iEHw/exec';

// 取得台灣時間 (Asia/Taipei) YYYY-MM-DD 日期字串
function getTaiwanDateStr(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

// 剖析試算表內的棧板明細字串 (例如 "中華綠板 (單面) x15")
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

// 1. 司機端提交 API (POST /api/scan) -> 寫入 Google 試算表
app.post('/api/scan', async (req, res) => {
  try {
    const { driver, barcode, status, pallets } = req.body;
    
    if (!barcode || !pallets || !Array.isArray(pallets) || pallets.length === 0) {
      return res.status(400).json({ error: '缺少條碼或棧板資訊' });
    }

    // 轉發給 Google 試算表 (GAS)
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

// 2. 後台動態分析 API (GET /api/analytics) -> 從 Google 試算表讀取歷史與最新資料
app.get('/api/analytics', async (req, res) => {
  try {
    // 呼叫 GAS 讀取試算表全量資料
    const sheetResponse = await fetch(GOOGLE_SHEET_WEB_APP_URL, { redirect: 'follow' });
    const rawRecords = await sheetResponse.json();

    const todayStr = getTaiwanDateStr(new Date());

    // 格式化資料結構
    const records = (Array.isArray(rawRecords) ? rawRecords : []).map((r, index) => ({
      id: r.timestamp || Date.now() - index,
      driver: r.driver || '測試司機',
      barcode: r.barcode || '',
      status: r.status || '',
      pallets: parsePalletString(r.palletStr || r.pallets),
      created_at: r.timestamp
    }));

    // 篩選出今日在台灣時間下的紀錄
    const todayRecords = records.filter(r => getTaiwanDateStr(r.created_at) === todayStr);

    const dailyInMap = {};
    const dailyOutMap = {};
    const stockMap = {};

    // 追朔全歷史紀錄運算動態總庫存，並統計今日進出量
    records.forEach(r => {
      const recordDateStr = getTaiwanDateStr(r.created_at);
      const isToday = (recordDateStr === todayStr);
      const isOut = r.status.includes('出倉') || r.status.includes('提貨') || r.status.includes('越庫');

      (r.pallets || []).forEach(p => {
        const pName = p.name;
        const pCount = p.count;

        // 計算歷史動態總庫存
        if (!stockMap[pName]) stockMap[pName] = 0;
        if (isOut) {
          stockMap[pName] = Math.max(0, stockMap[pName] - pCount);
        } else {
          stockMap[pName] += pCount;
        }

        // 計算今日進出量
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
    console.error('讀取 Google 試算表失敗:', error);
    res.status(500).json({ error: '無法讀取 Google 試算表歷史資料' });
  }
});

// 3. 備用讀取全紀錄 API
app.get('/api/records', async (req, res) => {
  try {
    const sheetResponse = await fetch(GOOGLE_SHEET_WEB_APP_URL, { redirect: 'follow' });
    const rawRecords = await sheetResponse.json();
    res.status(200).json(rawRecords);
  } catch (error) {
    res.status(500).json({ error: '讀取失敗' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;