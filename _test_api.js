const http = require('http');

function apiGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:8451${path}`, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(new Error('Parse error: ' + d.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function apiPost(path, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data || {});
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request({
      hostname: 'localhost', port: 8451, path, method: 'POST', headers
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { reject(new Error('Parse error: ' + d.slice(0, 200))); }
      });
    }).on('error', reject);
    req.write(body);
    req.end();
  });
}

(async function test() {
  try {
    console.log('=== 1. 服务器时间 ===');
    const time = await apiGet('/api/time');
    console.log('服务器时间戳:', time.serverTime, '本地差:', time.serverTime - Date.now());

    console.log('\n=== 2. 拍品列表 ===');
    const items = await apiGet('/api/items');
    console.log('拍品数量:', items.length);
    items.forEach(i => {
      const p = i.current_price || i.start_price;
      console.log(` [${i.status}] ${i.title} - 当前价:${p} 出价:${i.bid_count}次 卖家:${i.seller_name}`);
    });

    console.log('\n=== 3. 登录测试(bob/123456) ===');
    const login = await apiPost('/api/login', { username: 'bob', password: '123456' });
    console.log('状态:', login.status, '用户:', login.data.user ? login.data.user.username : '失败', login.data.error || '');
    const token = login.data.token;

    console.log('\n=== 4. 拍品详情 ===');
    const activeItem = items.find(i => i.status === 'active');
    if (activeItem) {
      const detail = await apiGet(`/api/items/${activeItem.id}`);
      console.log(`拍品: ${detail.title}`);
      console.log(`  当前价: ${detail.current_price}, 出价次数: ${detail.bids.length}`);
      console.log(`  最低加价: ${detail.min_increment}, 下一出价最低: ${(detail.current_price || detail.start_price) + detail.min_increment}`);
      console.log(`  评价数: ${(detail.reviews || []).length}`);
      if (detail.bids.length) {
        console.log('  最新3条出价:');
        detail.bids.slice(0, 3).forEach(b => console.log(`    ${b.username} - ¥${b.amount} @ ${b.created_at}`));
      }

      console.log('\n=== 5. 出价测试 ===');
      const minBid = (detail.current_price || detail.start_price) + detail.min_increment;
      const bid1 = await apiPost(`/api/items/${activeItem.id}/bid`, { amount: minBid }, token);
      console.log('出价状态:', bid1.status, bid1.data.error || '出价成功');

      console.log('\n=== 6. 个人出价记录 ===');
      const bids = await apiGet('/api/user/bids', token);
      // Manually add token to header
      const myBidsRes = await new Promise((res, rej) => {
        const req = http.request({
          hostname: 'localhost', port: 8451, path: '/api/user/bids', method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => res({ status: r.statusCode, data: JSON.parse(d) }));
        }).on('error', rej);
        req.end();
      });
      console.log('我的出价数:', Array.isArray(myBidsRes.data) ? myBidsRes.data.length : '失败', myBidsRes.data.error || '');

      console.log('\n=== 7. 我发布的拍品 ===');
      const mySoldRes = await new Promise((res, rej) => {
        const req = http.request({
          hostname: 'localhost', port: 8451, path: '/api/user/sold', method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => res({ status: r.statusCode, data: JSON.parse(d) }));
        }).on('error', rej);
        req.end();
      });
      console.log('我发布的拍品数:', Array.isArray(mySoldRes.data) ? mySoldRes.data.length : '失败');
      if (Array.isArray(mySoldRes.data)) {
        mySoldRes.data.forEach(i => console.log(`  ${i.title} [${i.status}]`));
      }

      console.log('\n=== 8. 通知消息 ===');
      const notifRes = await new Promise((res, rej) => {
        const req = http.request({
          hostname: 'localhost', port: 8451, path: '/api/notifications', method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => res({ status: r.statusCode, data: JSON.parse(d) }));
        }).on('error', rej);
        req.end();
      });
      console.log('通知数量:', Array.isArray(notifRes.data) ? notifRes.data.length : '失败');
      if (Array.isArray(notifRes.data)) {
        notifRes.data.slice(0, 3).forEach(n => console.log(`  [${n.type}] ${n.message} (${n.is_read ? '已读' : '未读'})`));
      }
    }

    console.log('\n✅ 所有测试完成！');
  } catch(e) {
    console.error('❌ 测试出错:', e.message);
    process.exit(1);
  }
})();
