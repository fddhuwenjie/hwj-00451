const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { initDatabase, query, queryOne, run } = require('./database');

const app = express();
const PORT = 8451;
const JWT_SECRET = 'auction-secret-key-2024';

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未登录' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: '令牌无效' });
    req.user = user;
    next();
  });
}

function updateItemStatus(item) {
  const now = Date.now();
  const startTime = new Date(item.start_time).getTime();
  const endTime = new Date(item.end_time).getTime();
  if (item.status === 'ended') return item.status;
  if (now < startTime) return 'pending';
  if (now >= endTime) return 'ended';
  return 'active';
}

async function checkAndEndAuction(itemId) {
  const item = await queryOne('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!item) return;
  const now = Date.now();
  const endTime = new Date(item.end_time).getTime();
  if (now >= endTime && item.status !== 'ended') {
    const highestBid = await queryOne(
      'SELECT b.*, u.username FROM bids b JOIN users u ON b.user_id = u.id WHERE b.item_id = ? ORDER BY b.amount DESC LIMIT 1',
      [itemId]
    );
    if (highestBid) {
      await run(
        'UPDATE items SET status = ?, final_price = ?, winner_id = ? WHERE id = ?',
        ['ended', highestBid.amount, highestBid.user_id, itemId]
      );
      await run(
        'INSERT INTO notifications (user_id, item_id, type, message) VALUES (?, ?, ?, ?)',
        [highestBid.user_id, itemId, 'win', `恭喜！您赢得了《${item.title}》，成交价${highestBid.amount}积分`]
      );
      await run(
        'INSERT INTO notifications (user_id, item_id, type, message) VALUES (?, ?, ?, ?)',
        [item.seller_id, itemId, 'sold', `您的拍品《${item.title}》已成交，成交价${highestBid.amount}积分`]
      );
    } else {
      await run('UPDATE items SET status = ? WHERE id = ?', ['ended', itemId]);
    }
  }
}

app.get('/api/time', (req, res) => {
  res.json({ serverTime: Date.now() });
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    const exists = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (exists) return res.status(400).json({ error: '用户名已存在' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await run('INSERT INTO users (username, password, balance) VALUES (?, ?, 1000)', [username, hashed]);
    const user = await queryOne('SELECT id, username, balance, reputation FROM users WHERE id = ?', [result.lastID]);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(400).json({ error: '用户名或密码错误' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: '用户名或密码错误' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, balance: user.balance, reputation: user.reputation } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user', authenticateToken, async (req, res) => {
  try {
    const user = await queryOne('SELECT id, username, balance, reputation FROM users WHERE id = ?', [req.user.id]);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/items', async (req, res) => {
  try {
    let items = await query(`
      SELECT i.*, u.username as seller_name,
        (SELECT MAX(amount) FROM bids WHERE item_id = i.id) as current_price,
        (SELECT COUNT(*) FROM bids WHERE item_id = i.id) as bid_count
      FROM items i JOIN users u ON i.seller_id = u.id
      ORDER BY 
        CASE WHEN i.status = 'active' THEN 1 WHEN i.status = 'pending' THEN 2 ELSE 3 END,
        i.end_time ASC
    `);
    items = items.map(item => ({ ...item, status: updateItemStatus(item) }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/items/:id', async (req, res) => {
  try {
    let item = await queryOne(`
      SELECT i.*, u.username as seller_name,
        (SELECT MAX(amount) FROM bids WHERE item_id = i.id) as current_price,
        (SELECT COUNT(*) FROM bids WHERE item_id = i.id) as bid_count
      FROM items i JOIN users u ON i.seller_id = u.id WHERE i.id = ?
    `, [req.params.id]);
    if (!item) return res.status(404).json({ error: '拍品不存在' });
    item.status = updateItemStatus(item);
    const bids = await query(`
      SELECT b.*, u.username FROM bids b JOIN users u ON b.user_id = u.id
      WHERE b.item_id = ? ORDER BY b.created_at DESC
    `, [req.params.id]);
    const winner = item.winner_id ? await queryOne('SELECT id, username FROM users WHERE id = ?', [item.winner_id]) : null;
    const reviews = await query(`
      SELECT r.*, u.username FROM reviews r
      JOIN users u ON r.from_user_id = u.id
      WHERE r.item_id = ? ORDER BY r.created_at DESC
    `, [req.params.id]);
    res.json({ ...item, bids, winner, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', authenticateToken, async (req, res) => {
  try {
    const { title, description, image_url, start_price, min_increment, start_time, end_time } = req.body;
    if (!title || !start_price || !min_increment || !start_time || !end_time) {
      return res.status(400).json({ error: '请填写所有必填项' });
    }
    const result = await run(
      'INSERT INTO items (title, description, image_url, start_price, min_increment, start_time, end_time, seller_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [title, description || '', image_url || '', parseFloat(start_price), parseFloat(min_increment), start_time, end_time, req.user.id, 'pending']
    );
    const item = await queryOne('SELECT * FROM items WHERE id = ?', [result.lastID]);
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/items/:id', authenticateToken, async (req, res) => {
  try {
    const item = await queryOne('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: '拍品不存在' });
    if (item.seller_id !== req.user.id) return res.status(403).json({ error: '无权编辑此拍品' });
    const status = updateItemStatus(item);
    if (status !== 'pending') return res.status(400).json({ error: '只能编辑未开始的拍品' });
    const { title, description, image_url, start_price, min_increment, start_time, end_time } = req.body;
    await run(
      'UPDATE items SET title=?, description=?, image_url=?, start_price=?, min_increment=?, start_time=?, end_time=? WHERE id=?',
      [title || item.title, description !== undefined ? description : item.description,
        image_url !== undefined ? image_url : item.image_url,
        start_price !== undefined ? parseFloat(start_price) : item.start_price,
        min_increment !== undefined ? parseFloat(min_increment) : item.min_increment,
        start_time || item.start_time, end_time || item.end_time, req.params.id]
    );
    const updated = await queryOne('SELECT * FROM items WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items/:id/bid', authenticateToken, async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    const { amount } = req.body;
    const bidAmount = parseFloat(amount);

    await checkAndEndAuction(itemId);
    let item = await queryOne('SELECT * FROM items WHERE id = ?', [itemId]);
    if (!item) return res.status(404).json({ error: '拍品不存在' });

    const status = updateItemStatus(item);
    if (status !== 'active') return res.status(400).json({ error: '拍卖未进行中' });
    if (item.seller_id === req.user.id) return res.status(400).json({ error: '卖家不能对自己的商品出价' });

    const now = Date.now();
    const endTime = new Date(item.end_time).getTime();
    if (endTime - now < 1000) return res.status(400).json({ error: '距结束不足1秒，出价无效' });

    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (bidAmount > user.balance) return res.status(400).json({ error: '余额不足' });

    const currentPrice = (await queryOne('SELECT MAX(amount) as max FROM bids WHERE item_id = ?', [itemId])).max || item.start_price;
    const minBid = currentPrice + item.min_increment;
    if (bidAmount < minBid) return res.status(400).json({ error: `出价必须不低于 ${minBid}` });

    const lastBid = await queryOne('SELECT * FROM bids WHERE item_id = ? ORDER BY created_at DESC LIMIT 1', [itemId]);
    if (lastBid && lastBid.user_id === req.user.id) {
      return res.status(400).json({ error: '不能连续出价，请等待其他用户出价' });
    }

    const activeBids = await query(`
      SELECT b.* FROM bids b
      JOIN items i ON b.item_id = i.id
      WHERE b.user_id = ? AND i.status = 'active' AND i.id != ?
    `, [req.user.id, itemId]);
    
    let totalFrozen = 0;
    for (const b of activeBids) {
      const maxForItem = (await queryOne('SELECT MAX(amount) as max FROM bids WHERE item_id = ? AND user_id = ?', [b.item_id, req.user.id])).max || 0;
      const overallMax = (await queryOne('SELECT MAX(amount) as max FROM bids WHERE item_id = ?', [b.item_id])).max || 0;
      if (maxForItem === overallMax) totalFrozen += maxForItem;
    }
    if (totalFrozen + bidAmount > user.balance) {
      return res.status(400).json({ error: '可用余额不足（部分金额已被其他拍卖冻结）' });
    }

    await run('INSERT INTO bids (item_id, user_id, amount) VALUES (?, ?, ?)', [itemId, req.user.id, bidAmount]);

    const timeLeft = endTime - now;
    if (timeLeft < 5 * 60 * 1000) {
      const newEndTime = new Date(endTime + 3 * 60 * 1000).toISOString();
      await run('UPDATE items SET end_time = ? WHERE id = ?', [newEndTime, itemId]);
    }

    const bids = await query(`
      SELECT b.*, u.username FROM bids b JOIN users u ON b.user_id = u.id
      WHERE b.item_id = ? ORDER BY b.created_at DESC
    `, [itemId]);

    res.json({ success: true, bids, newEndTime: timeLeft < 5 * 60 * 1000 ? new Date(item.end_time).getTime() + 3 * 60 * 1000 : null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/bids', authenticateToken, async (req, res) => {
  try {
    const bids = await query(`
      SELECT b.*, i.title, i.status FROM bids b
      JOIN items i ON b.item_id = i.id
      WHERE b.user_id = ? ORDER BY b.created_at DESC
    `, [req.user.id]);
    res.json(bids);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/won', authenticateToken, async (req, res) => {
  try {
    const items = await query(`
      SELECT i.*, u.username as seller_name FROM items i
      JOIN users u ON i.seller_id = u.id
      WHERE i.winner_id = ? AND i.status = 'ended' ORDER BY i.end_time DESC
    `, [req.user.id]);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/sold', authenticateToken, async (req, res) => {
  try {
    let items = await query(`
      SELECT i.*, (SELECT username FROM users WHERE id = i.winner_id) as winner_name,
        (SELECT MAX(amount) FROM bids WHERE item_id = i.id) as current_price,
        (SELECT COUNT(*) FROM bids WHERE item_id = i.id) as bid_count
      FROM items i WHERE i.seller_id = ? ORDER BY i.end_time DESC
    `, [req.user.id]);
    items = items.map(item => ({ ...item, status: updateItemStatus(item) }));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const notifications = await query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    await run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items/:id/pay', authenticateToken, async (req, res) => {
  try {
    const item = await queryOne('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: '拍品不存在' });
    if (item.winner_id !== req.user.id) return res.status(403).json({ error: '只有赢家可以付款' });
    if (item.paid) return res.status(400).json({ error: '已付款' });
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (user.balance < item.final_price) return res.status(400).json({ error: '余额不足' });
    await run('UPDATE users SET balance = balance - ? WHERE id = ?', [item.final_price, req.user.id]);
    await run('UPDATE items SET paid = 1 WHERE id = ?', [req.params.id]);
    await run(
      'INSERT INTO notifications (user_id, item_id, type, message) VALUES (?, ?, ?, ?)',
      [item.seller_id, item.id, 'paid', `买家已付款，请尽快发货（拍品：${item.title}）`]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items/:id/ship', authenticateToken, async (req, res) => {
  try {
    const item = await queryOne('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: '拍品不存在' });
    if (item.seller_id !== req.user.id) return res.status(403).json({ error: '只有卖家可以确认发货' });
    if (!item.paid) return res.status(400).json({ error: '买家尚未付款' });
    if (item.shipped) return res.status(400).json({ error: '已发货' });
    await run('UPDATE items SET shipped = 1 WHERE id = ?', [req.params.id]);
    await run(
      'INSERT INTO notifications (user_id, item_id, type, message) VALUES (?, ?, ?, ?)',
      [item.winner_id, item.id, 'shipped', `卖家已发货（拍品：${item.title}）`]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/items/:id/reviews', async (req, res) => {
  try {
    const reviews = await query(`
      SELECT r.*, u.username FROM reviews r
      JOIN users u ON r.from_user_id = u.id
      WHERE r.item_id = ? ORDER BY r.created_at DESC
    `, [req.params.id]);
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items/:id/review', authenticateToken, async (req, res) => {
  try {
    const { to_user_id, rating, comment } = req.body;
    const item = await queryOne('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: '拍品不存在' });
    if (item.status !== 'ended') return res.status(400).json({ error: '拍卖未结束' });
    if (item.seller_id !== req.user.id && item.winner_id !== req.user.id) {
      return res.status(403).json({ error: '只有交易双方可以评价' });
    }
    if (rating < 1 || rating > 5) return res.status(400).json({ error: '评分必须在1-5之间' });
    const existing = await queryOne(
      'SELECT * FROM reviews WHERE item_id = ? AND from_user_id = ? AND to_user_id = ?',
      [req.params.id, req.user.id, to_user_id]
    );
    if (existing) return res.status(400).json({ error: '已评价过该用户' });
    await run(
      'INSERT INTO reviews (item_id, from_user_id, to_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, req.user.id, to_user_id, rating, comment || '']
    );
    const avgRating = await queryOne(
      'SELECT AVG(rating) as avg FROM reviews WHERE to_user_id = ?',
      [to_user_id]
    );
    await run('UPDATE users SET reputation = ? WHERE id = ?', [parseFloat(avgRating.avg.toFixed(1)), to_user_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function auctionChecker() {
  const items = await query("SELECT id FROM items WHERE status != 'ended'");
  for (const item of items) {
    await checkAndEndAuction(item.id);
  }
}

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`后端服务器运行在 http://localhost:${PORT}`);
  });
  setInterval(auctionChecker, 1000);
}).catch(err => {
  console.error('数据库初始化失败:', err);
});
