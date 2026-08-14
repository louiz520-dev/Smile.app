const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), (err) => {
    if (err) res.status(204).end();
  });
});

// 最新 Google Apps Script 部署網址
const GOOGLE_SHEET_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbykSrETQ6iyaRaFB82aEX4VciYaHQhzAH9Pi3XzECPVERr9GTYsDQxFBotJ8Fur-q6I0Q/exec';

// 將各式各樣的試算表日期字串（2026/8/11 下午 3:12:23 或 ISO 格式）統一轉換為 YYYY-MM-DD
function normalizeDateStr(dateInput) {
  if (!dateInput) return '';
  
  // 處理台灣試算表常見的 "2026/8/11" 或 "2026/08/11"
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

// 1. 司機端提交 API (POST /api/scan)
app.post('/api/scan', async (req, res) => {
  try {
    const { driver, barcode, status, pallets } = req.body;
    
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

// 2. 後台動態分析 API (GET /api/analytics)
app.get('/api/analytics', async (req, res) => {
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

    // 精確比對當日日期
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

// 3. 讀取所有歷史紀錄 API
app.get('/api/records', async (req, res) => {
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

// 只有在「直接執行此檔 (node server.js)」時才會監聽 Port
// 部署至 Vercel 時此判斷為 false，可避免 Port 衝突與伺服器掛載失敗
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}