const http = require('http');
const url = require('url');

function apiRequest(path, options = {}) {
  const base = 'http://localhost:8451';
  const parsed = new url.URL(base + '/api' + path);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 8451,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

async function test() {
  try {
    const loginBob = await apiRequest('/login', { method: 'POST', body: { username: 'bob', password: '123456' }});
    console.log('1. 登录Bob结果:', loginBob.user ? loginBob.user.username : '失败', '余额:', loginBob.user ? loginBob.user.balance : '');
    const bobToken = loginBob.token;
    const bobHeaders = { 'Authorization': 'Bearer ' + bobToken };

    const items = await apiRequest('/items');
    console.log('2. 拍品列表数量:', items.length);
    items.slice(0, 3).forEach(i => {
      console.log(`   - [${i.category}] ${i.title} 状态:${i.status} 当前价:${i.current_price || i.start_price} 出价:${i.bid_count}次`);
    });
    const activeItem = items.find(i => i.status === 'active');
    console.log('   进行中拍品ID:', activeItem ? activeItem.id : '无');

    const searchAntique = await apiRequest('/items/search?category=古董');
    console.log('3. 搜索\"古董\"分类:', searchAntique.length, '条');
    const searchWatch = await apiRequest('/items/search?q=腕表');
    console.log('4. 搜索关键词\"腕表\":', searchWatch.length, '条');
    const searchHot = await apiRequest('/items/search?sort=hot');
    console.log('5. 热门排序前3:');
    searchHot.slice(0, 3).forEach(i => console.log(`   - ${i.bid_count || 0}次出价: ${i.title}`));

    if (activeItem) {
      const itemDetail = await apiRequest('/items/' + activeItem.id);
      console.log('6. 拍品详情:');
      console.log('   - 分类:', itemDetail.category);
      console.log('   - 保证金:', itemDetail.deposit_amount);
      console.log('   - 一口价:', itemDetail.buy_now_price);
      console.log('   - 近2条出价:');
      itemDetail.bids.slice(0, 2).forEach(b => console.log(`     * ${b.username} ¥${b.amount} ${b.is_proxy ? '(代理出价)' : ''}`));

      const proxyBefore = await apiRequest('/items/' + activeItem.id + '/proxy', { headers: bobHeaders });
      console.log('7. Bob设置代理前状态:', proxyBefore ? '已有 ' + proxyBefore.max_amount + (proxyBefore.is_active ? ' 启用' : ' 未启用') : '无');

      const setProxy = await apiRequest('/items/' + activeItem.id + '/proxy', {
        method: 'POST',
        headers: bobHeaders,
        body: { max_amount: 5000 }
      });
      console.log('8. Bob设置代理¥5000:', setProxy.success ? '成功 ' + (setProxy.proxy ? setProxy.proxy.max_amount : '') : ('失败: ' + setProxy.error));

      const loginCharlie = await apiRequest('/login', { method: 'POST', body: { username: 'charlie', password: '123456' }});
      const charlieToken = loginCharlie.token;
      const charlieHeaders = { 'Authorization': 'Bearer ' + charlieToken };
      console.log('9. 登录Charlie余额:', loginCharlie.user.balance);

      const currentPrice = activeItem.current_price || activeItem.start_price;
      const bidAmount = currentPrice + activeItem.min_increment;
      console.log('   当前价:', currentPrice, 'Charlie尝试出价:', bidAmount);

      const bid = await apiRequest('/items/' + activeItem.id + '/bid', {
        method: 'POST',
        headers: charlieHeaders,
        body: { amount: bidAmount }
      });
      console.log('10. Charlie出价结果:', bid.success ? '成功' : ('失败: ' + bid.error));

      if (bid.success) {
        const afterBids = await apiRequest('/items/' + activeItem.id);
        console.log('   最新出价列表(前3):');
        afterBids.bids.slice(0, 3).forEach(b => console.log(`     * ${b.username} ¥${b.amount} ${b.is_proxy ? '(代理出价)' : ''}`));
      }

      const userAfter = await apiRequest('/user', { headers: charlieHeaders });
      const deposit = activeItem.deposit_amount || activeItem.start_price * 0.1;
      console.log('11. Charlie出价后余额:', userAfter.balance, '(预计减少保证金:' + deposit + ' + 出价:' + bidAmount + ' = ' + (deposit + bidAmount) + ')');
    }

    console.log('\n✓ 全部API测试完成');
  } catch(e) {
    console.error('测试过程错误:', e.message, e.stack);
  }
}

test();
