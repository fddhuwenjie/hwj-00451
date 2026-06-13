const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'auction.db');
const db = new sqlite3.Database(dbPath);

function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        await run(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          balance REAL DEFAULT 1000,
          reputation REAL DEFAULT 5,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        await run(`CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT,
          image_url TEXT,
          start_price REAL NOT NULL,
          min_increment REAL NOT NULL DEFAULT 10,
          start_time DATETIME NOT NULL,
          end_time DATETIME NOT NULL,
          seller_id INTEGER NOT NULL,
          status TEXT DEFAULT 'pending',
          final_price REAL,
          winner_id INTEGER,
          paid INTEGER DEFAULT 0,
          shipped INTEGER DEFAULT 0,
          FOREIGN KEY (seller_id) REFERENCES users(id),
          FOREIGN KEY (winner_id) REFERENCES users(id)
        )`);

        await run(`CREATE TABLE IF NOT EXISTS bids (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          amount REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (item_id) REFERENCES items(id),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        await run(`CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          item_id INTEGER,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          is_read INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          FOREIGN KEY (item_id) REFERENCES items(id)
        )`);

        await run(`CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item_id INTEGER NOT NULL,
          from_user_id INTEGER NOT NULL,
          to_user_id INTEGER NOT NULL,
          rating INTEGER NOT NULL,
          comment TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (item_id) REFERENCES items(id),
          FOREIGN KEY (from_user_id) REFERENCES users(id),
          FOREIGN KEY (to_user_id) REFERENCES users(id)
        )`);

        const row = await queryOne("SELECT COUNT(*) as count FROM users");
        if (row.count === 0) {
          await seedData();
        }
        resolve();
      } catch(err) {
        reject(err);
      }
    });
  });
}

function stmtRun(stmt, params = []) {
  return new Promise((resolve, reject) => {
    stmt.run(params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function seedData() {
  return new Promise(async (resolve, reject) => {
    try {
      const now = Date.now();
      const hashedPassword = await bcrypt.hash('123456', 10);

      const users = [
        { username: 'alice', password: hashedPassword, balance: 1500, reputation: 4.8 },
        { username: 'bob', password: hashedPassword, balance: 2000, reputation: 4.5 },
        { username: 'charlie', password: hashedPassword, balance: 1000, reputation: 4.2 },
        { username: 'diana', password: hashedPassword, balance: 3000, reputation: 4.9 },
        { username: 'eve', password: hashedPassword, balance: 800, reputation: 3.8 }
      ];

      const userStmt = db.prepare("INSERT INTO users (username, password, balance, reputation) VALUES (?, ?, ?, ?)");
      const userIds = [];
      for (const user of users) {
        const result = await stmtRun(userStmt, [user.username, user.password, user.balance, user.reputation]);
        userIds.push(result.lastID);
      }
      userStmt.finalize();

      const items = [
        {
          title: '复古机械腕表',
          description: '1960年代瑞士制造，全机械机芯，走时精准，收藏佳品。',
          image_url: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=600',
          start_price: 500,
          min_increment: 50,
          start_time: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(now + 30 * 60 * 1000).toISOString(),
          seller_id_idx: 0,
          status: 'active'
        },
        {
          title: '限量版签名版画',
          description: '当代著名艺术家限量签名版画，全球仅50幅，附真品证书。',
          image_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=600',
          start_price: 2000,
          min_increment: 100,
          start_time: new Date(now + 1 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(now + 25 * 60 * 60 * 1000).toISOString(),
          seller_id_idx: 1,
          status: 'pending'
        },
        {
          title: '经典黑胶唱片套装',
          description: '披头士全套原版黑胶唱片，品相极佳，音质完美。',
          image_url: 'https://images.unsplash.com/photo-1539375665275-f9de415ef9ac?w=600',
          start_price: 300,
          min_increment: 20,
          start_time: new Date(now - 48 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
          seller_id_idx: 2,
          status: 'ended',
          final_price: 580,
          winner_id_idx: 3
        }
      ];

      const itemStmt = db.prepare("INSERT INTO items (title, description, image_url, start_price, min_increment, start_time, end_time, seller_id, status, final_price, winner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const itemIds = [];
      for (const item of items) {
        const result = await stmtRun(itemStmt, [
          item.title, item.description, item.image_url,
          item.start_price, item.min_increment, item.start_time,
          item.end_time, userIds[item.seller_id_idx], item.status,
          item.final_price || null, item.winner_id_idx !== undefined ? userIds[item.winner_id_idx] : null
        ]);
        itemIds.push(result.lastID);
      }
      itemStmt.finalize();

      const activeItemId = itemIds[0];
      const endedItemId = itemIds[2];

      const bids = [
        { item_id_idx: 0, user_id_idx: 1, amount: 500, offset: -7000 },
        { item_id_idx: 0, user_id_idx: 2, amount: 550, offset: -6000 },
        { item_id_idx: 0, user_id_idx: 3, amount: 600, offset: -5000 },
        { item_id_idx: 0, user_id_idx: 1, amount: 650, offset: -4000 },
        { item_id_idx: 0, user_id_idx: 4, amount: 700, offset: -3000 },
        { item_id_idx: 0, user_id_idx: 2, amount: 750, offset: -2000 },
        { item_id_idx: 0, user_id_idx: 3, amount: 800, offset: -1000 },
        { item_id_idx: 0, user_id_idx: 1, amount: 850, offset: -500 }
      ];

      const bidStmt = db.prepare("INSERT INTO bids (item_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)");
      for (const bid of bids) {
        const bidTime = new Date(now + bid.offset).toISOString();
        await stmtRun(bidStmt, [itemIds[bid.item_id_idx], userIds[bid.user_id_idx], bid.amount, bidTime]);
      }

      await stmtRun(bidStmt, [endedItemId, userIds[4], 300, new Date(now - 47 * 60 * 60 * 1000).toISOString()]);
      await stmtRun(bidStmt, [endedItemId, userIds[3], 350, new Date(now - 46 * 60 * 60 * 1000).toISOString()]);
      await stmtRun(bidStmt, [endedItemId, userIds[1], 420, new Date(now - 40 * 60 * 60 * 1000).toISOString()]);
      await stmtRun(bidStmt, [endedItemId, userIds[3], 500, new Date(now - 20 * 60 * 60 * 1000).toISOString()]);
      await stmtRun(bidStmt, [endedItemId, userIds[3], 580, new Date(now - 3 * 60 * 60 * 1000).toISOString()]);
      bidStmt.finalize();

      const notifStmt = db.prepare("INSERT INTO notifications (user_id, item_id, type, message) VALUES (?, ?, ?, ?)");
      await stmtRun(notifStmt, [userIds[3], endedItemId, 'win', '恭喜！您赢得了《经典黑胶唱片套装》']);
      await stmtRun(notifStmt, [userIds[2], endedItemId, 'sold', '您的拍品《经典黑胶唱片套装》已成交']);
      notifStmt.finalize();

      const reviewStmt = db.prepare("INSERT INTO reviews (item_id, from_user_id, to_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)");
      await stmtRun(reviewStmt, [endedItemId, userIds[3], userIds[2], 5, '卖家发货很快，唱片品相很好！']);
      await stmtRun(reviewStmt, [endedItemId, userIds[2], userIds[3], 5, '买家付款迅速，交易愉快！']);
      reviewStmt.finalize();

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function queryOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

module.exports = { initDatabase, query, queryOne, run, db };
