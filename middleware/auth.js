const jwt = require('jsonwebtoken');

// 1. 通用 JWT Token 驗證中間件
const authenticateToken = (req, res, next) => {
  // 從 Header 取得 Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: '未提供 Token，存取被拒絕！' 
    });
  }

  // 驗證 Token 是否合法/過期
  jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret_key', (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Token 無效或已過期！' 
      });
    }

    // 將解析出來的使用者 payload (userId, username, role) 綁定到 req.user
    req.user = user;
    next(); // 通過驗證，繼續執行下一個控制器
  });
};

// 2. 角色權限檢查中間件（如：限制僅 admin 可操作）
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: '您的帳號權限不足，無法存取此 API！' 
      });
    }
    next();
  };
};

module.exports = { authenticateToken, authorizeRoles };