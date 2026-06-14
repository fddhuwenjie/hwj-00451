const API_BASE = 'http://localhost:8451/api';
let currentUser = null;
let serverTimeOffset = 0;
const CATEGORIES = ['全部', '古董', '珠宝', '艺术品', '电子', '其他'];

function getToken() { return localStorage.getItem('token'); }
function setToken(t) { localStorage.setItem('token', t); }
function removeToken() { localStorage.removeItem('token'); }

function highlightText(text, keyword) {
  if (!keyword || !text) return text;
  const safeKw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${safeKw})`, 'gi');
  return text.toString().replace(regex, '<span class="highlight">$1</span>');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

async function apiRequest(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function formatTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function formatMoney(n) { return `¥${parseFloat(n).toFixed(0)}`; }

function nowTime() { return Date.now() + serverTimeOffset; }

function getCountdown(endTime) {
  const end = new Date(endTime).getTime();
  let diff = Math.max(0, end - nowTime());
  const days = Math.floor(diff / 86400000); diff -= days * 86400000;
  const hours = Math.floor(diff / 3600000); diff -= hours * 3600000;
  const mins = Math.floor(diff / 60000); diff -= mins * 60000;
  const secs = Math.floor(diff / 1000);
  return { days, hours, mins, secs, total: Math.max(0, end - nowTime()) };
}

function formatCountdown(cd) {
  return `${String(cd.days).padStart(2,'0')}:${String(cd.hours).padStart(2,'0')}:${String(cd.mins).padStart(2,'0')}:${String(cd.secs).padStart(2,'0')}`;
}

function statusText(s) {
  return { pending: '未开始', active: '进行中', ended: '已结束' }[s] || s;
}

function statusClass(s) { return `status-${s}`; }

function route() {
  const hash = location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);
  if (!parts.length) return renderHome();
  if (parts[0] === 'login') return renderAuth('login');
  if (parts[0] === 'register') return renderAuth('register');
  if (parts[0] === 'item' && parts[1]) return renderItemDetail(parts[1]);
  if (parts[0] === 'profile') return renderProfile();
  if (parts[0] === 'publish') return renderPublish();
  renderHome();
}

function renderHeader() {
  const header = document.getElementById('header');
  const unread = notifCache.filter(n => !n.is_read).length;
  if (!currentUser) {
    header.innerHTML = `
      <div class="header-inner">
        <div class="logo" onclick="location.hash='/'">🏛️ 珍品拍卖</div>
        <div class="nav">
          <a onclick="location.hash='/'">首页</a>
          <a onclick="location.hash='#/login'">登录</a>
          <a onclick="location.hash='#/register'">注册</a>
        </div>
      </div>`;
  } else {
    loadNotifications();
    header.innerHTML = `
      <div class="header-inner">
        <div class="logo" onclick="location.hash='/'">🏛️ 珍品拍卖</div>
        <div class="nav">
          <a onclick="location.hash='/'">首页</a>
          <a onclick="location.hash='#/publish'">发布拍品</a>
          <a onclick="location.hash='#/profile'" style="position:relative">个人中心${unread > 0 ? `<span class="notif-dot" id="headerNotifDot">${unread}</span>` : ''}</a>
          <span class="balance-badge">💰 ${formatMoney(currentUser.balance)}</span>
          <span onclick="logout()" style="cursor:pointer">退出 (${currentUser.username})</span>
        </div>
      </div>`;
  }
}

let notifCache = [];
async function loadNotifications() {
  if (!currentUser) return;
  try {
    notifCache = await apiRequest('/notifications');
    updateNotifBadge();
  } catch (e) {}
}
function updateNotifBadge() {
  const unread = notifCache.filter(n => !n.is_read).length;
  const dot = document.getElementById('headerNotifDot');
  if (dot) {
    if (unread > 0) dot.textContent = unread;
    else dot.remove();
  } else if (unread > 0 && currentUser) {
    renderHeader();
  }
}

async function refreshUser() {
  if (!getToken()) return;
  try {
    currentUser = await apiRequest('/user');
    renderHeader();
  } catch (e) { currentUser = null; removeToken(); renderHeader(); }
}

function logout() {
  currentUser = null;
  removeToken();
  location.hash = '/';
  renderHeader();
  showToast('已退出登录', 'info');
}

async function renderHome() {
  document.getElementById('app').innerHTML = '<div class="container"><div style="text-align:center;padding:40px">加载中...</div></div>';
  try {
    let filter = localStorage.getItem('filter') || 'all';
    let category = localStorage.getItem('category') || '全部';
    let sort = localStorage.getItem('sort') || 'default';
    let keyword = localStorage.getItem('searchKeyword') || '';
    let minPrice = localStorage.getItem('minPrice') || '';
    let maxPrice = localStorage.getItem('maxPrice') || '';

    let items;
    const useSearch = keyword || category !== '全部' || minPrice || maxPrice || sort === 'hot';
    if (useSearch) {
      const params = new URLSearchParams();
      if (keyword) params.append('q', keyword);
      if (category !== '全部') params.append('category', category);
      if (minPrice) params.append('min_price', minPrice);
      if (maxPrice) params.append('max_price', maxPrice);
      if (filter !== 'all') params.append('status', filter);
      if (sort === 'hot') params.append('sort', 'hot');
      items = await apiRequest(`/items/search?${params.toString()}`);
    } else {
      items = await apiRequest('/items');
    }
    const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
    document.getElementById('app').innerHTML = `
      <div class="container">
        <div class="page-title">
          <span>拍品列表</span>
          <span class="action-row">
            ${currentUser ? `<button class="btn btn-primary" onclick="location.hash='#/publish'">+ 发布拍品</button>` : ''}
          </span>
        </div>
        <div class="search-bar">
          <div class="search-row">
            <input class="search-input" id="searchInput" placeholder="搜索拍品名称或描述..." value="${escapeHtml(keyword)}">
            <input type="number" class="search-input search-price" id="minPriceInput" placeholder="最低价" value="${minPrice}">
            <span style="color:#888">-</span>
            <input type="number" class="search-input search-price" id="maxPriceInput" placeholder="最高价" value="${maxPrice}">
            <button class="btn btn-primary" onclick="doSearch()">搜索</button>
            ${keyword || minPrice || maxPrice ? `<button class="btn btn-secondary" onclick="clearSearch()">清除</button>` : ''}
          </div>
        </div>
        <div class="category-tabs">
          ${CATEGORIES.map(c => `<span class="category-tab ${category===c?'active':''}" onclick="setCategory('${c}')">${c}</span>`).join('')}
        </div>
        <div class="filter-bar">
          <span class="filter-chip ${filter==='all'?'active':''}" onclick="setFilter('all')">全部</span>
          <span class="filter-chip ${filter==='active'?'active':''}" onclick="setFilter('active')">进行中</span>
          <span class="filter-chip ${filter==='pending'?'active':''}" onclick="setFilter('pending')">即将开始</span>
          <span class="filter-chip ${filter==='ended'?'active':''}" onclick="setFilter('ended')">已结束</span>
          <span style="flex:1"></span>
          <span class="sort-label">排序：</span>
          <span class="filter-chip ${sort==='default'?'active':''}" onclick="setSort('default')">默认</span>
          <span class="filter-chip ${sort==='hot'?'active':''}" onclick="setSort('hot')">🔥 热门</span>
        </div>
        <div class="card-grid" id="itemGrid">
          ${filtered.length ? filtered.map(item => renderItemCard(item, keyword)).join('') : '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📭</div>暂无拍品</div>'}
        </div>
      </div>`;
    startHomeCountdown();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="container"><div class="empty-state">加载失败: ${e.message}</div></div>`;
  }
}

function doSearch() {
  const kw = document.getElementById('searchInput').value.trim();
  const minP = document.getElementById('minPriceInput').value.trim();
  const maxP = document.getElementById('maxPriceInput').value.trim();
  localStorage.setItem('searchKeyword', kw);
  localStorage.setItem('minPrice', minP);
  localStorage.setItem('maxPrice', maxP);
  renderHome();
}

function clearSearch() {
  localStorage.removeItem('searchKeyword');
  localStorage.removeItem('minPrice');
  localStorage.removeItem('maxPrice');
  renderHome();
}

function setCategory(c) {
  localStorage.setItem('category', c);
  renderHome();
}

function setSort(s) {
  localStorage.setItem('sort', s);
  renderHome();
}

function setFilter(f) {
  localStorage.setItem('filter', f);
  renderHome();
}

function renderItemCard(item, keyword) {
  const currentPrice = item.current_price || item.start_price;
  const kw = keyword || localStorage.getItem('searchKeyword') || '';
  const displayTitle = kw ? highlightText(escapeHtml(item.title), kw) : escapeHtml(item.title);
  const displayDesc = kw ? highlightText(escapeHtml(item.description || '暂无描述'), kw) : escapeHtml(item.description || '暂无描述');
  return `
    <div class="card item-card" onclick="location.hash='#/item/${item.id}'">
      <img src="${item.image_url}" alt="${escapeHtml(item.title)}" class="item-image" onerror="this.src='https://via.placeholder.com/400x200?text=No+Image'">
      <div class="item-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="status-badge ${statusClass(item.status)}">${statusText(item.status)}</span>
          <span class="countdown" data-end="${item.end_time}" data-start="${item.start_time}" data-status="${item.status}">
            ${item.status === 'active' ? formatCountdown(getCountdown(item.end_time)) : item.status === 'pending' ? `距开始: ${formatCountdown(getCountdown(item.start_time))}` : '已结束'}
          </span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0">
          <span class="item-category">${escapeHtml(item.category || '其他')}</span>
          ${item.buy_now_price && item.status !== 'ended' ? `<span style="font-size:12px;color:#d97706;font-weight:600">⚡ ${formatMoney(item.buy_now_price)}</span>` : ''}
        </div>
        <div class="item-title">${displayTitle}</div>
        <div class="item-desc">${displayDesc}</div>
        <div class="item-meta">
          <span>卖家: ${escapeHtml(item.seller_name)}</span>
          <span>${item.bid_count || 0} 次出价</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="price-label">${item.status === 'ended' ? '成交价' : '当前价'}</span>
            <span class="price"> ${formatMoney(currentPrice)}</span>
          </div>
          ${item.status === 'ended' && item.winner_id ? `<span style="font-size:12px;color:#888">赢家: ${item.winner_id ? '已成交' : ''}</span>` : ''}
        </div>
      </div>
    </div>`;
}

let homeTimer = null;
function startHomeCountdown() {
  if (homeTimer) clearInterval(homeTimer);
  homeTimer = setInterval(() => {
    document.querySelectorAll('.countdown').forEach(el => {
      const status = el.dataset.status;
      const endTime = status === 'pending' ? el.dataset.start : el.dataset.end;
      if (!endTime) return;
      const cd = getCountdown(endTime);
      if (status === 'active') {
        el.textContent = formatCountdown(cd);
        if (cd.total < 5 * 60 * 1000) el.classList.add('countdown-urgent');
        else el.classList.remove('countdown-urgent');
      } else if (status === 'pending') {
        el.textContent = `距开始: ${formatCountdown(cd)}`;
      }
    });
  }, 1000);
}

function renderAuth(mode) {
  const isLogin = mode === 'login';
  document.getElementById('app').innerHTML = `
    <div class="container">
      <div class="card auth-container">
        <div class="auth-title">${isLogin ? '登录' : '注册'}</div>
        <div class="form-group">
          <label class="form-label">用户名</label>
          <input class="form-input" id="authUsername" placeholder="请输入用户名">
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <input type="password" class="form-input" id="authPassword" placeholder="请输入密码">
        </div>
        <button class="btn btn-primary form-btn" onclick="doAuth('${mode}')">${isLogin ? '登录' : '注册并送1000积分'}</button>
        <div class="auth-switch">
          ${isLogin ? '还没有账号？<a onclick="location.hash=\'#/register\'">立即注册</a>' : '已有账号？<a onclick="location.hash=\'#/login\'">立即登录</a>'}
        </div>
        ${isLogin ? `<div style="margin-top:16px;padding:12px;background:#f9fafb;border-radius:8px;font-size:12px;color:#666">
          <b>测试账号：</b><br>
          alice / 123456（卖家）<br>
          bob / 123456（买家）<br>
          charlie / 123456<br>
          diana / 123456<br>
          eve / 123456
        </div>` : ''}
      </div>
    </div>`;
}

async function doAuth(mode) {
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!username || !password) return showToast('请填写用户名和密码', 'error');
  try {
    const res = await apiRequest(mode === 'login' ? '/login' : '/register', {
      method: 'POST', body: JSON.stringify({ username, password })
    });
    setToken(res.token);
    currentUser = res.user;
    renderHeader();
    location.hash = '/';
    showToast(mode === 'login' ? '登录成功' : '注册成功，赠送1000积分！', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

let detailTimer = null;
let itemDetailCache = null;
let proxyBidCache = null;
async function renderItemDetail(id) {
  if (detailTimer) clearInterval(detailTimer);
  document.getElementById('app').innerHTML = '<div class="container"><div style="text-align:center;padding:40px">加载中...</div></div>';
  try {
    const item = await apiRequest(`/items/${id}`);
    itemDetailCache = item;
    if (currentUser) {
      try { proxyBidCache = await apiRequest(`/items/${id}/proxy`); } catch(e) { proxyBidCache = null; }
    }
    const currentPrice = item.current_price || item.start_price;
    const minBid = currentPrice + item.min_increment;
    const categoryOptions = ['古董', '珠宝', '艺术品', '电子', '其他'];
    document.getElementById('app').innerHTML = `
      <div class="container">
        <div class="detail-layout">
          <div>
            <div class="card" style="padding:20px">
              <img src="${item.image_url}" class="detail-image" onerror="this.src='https://via.placeholder.com/600x400?text=No+Image'">
              <div style="margin-top:20px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                  <h1 style="font-size:24px">${escapeHtml(item.title)}</h1>
                  <span class="status-badge ${statusClass(item.status)}">${statusText(item.status)}</span>
                </div>
                <div style="display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap">
                  <span class="item-category">${escapeHtml(item.category || '其他')}</span>
                  ${item.buy_now_price && item.status !== 'ended' ? `<span style="font-size:14px;color:#d97706;font-weight:600">⚡ 一口价 ${formatMoney(item.buy_now_price)}</span>` : ''}
                  ${item.deposit_amount ? `<span style="font-size:12px;color:#1e40af;padding:2px 10px;background:#eff6ff;border-radius:10px">🔒 保证金 ${formatMoney(item.deposit_amount)}</span>` : ''}
                </div>
                <p style="color:#555;line-height:1.8;margin-bottom:20px">${escapeHtml(item.description || '暂无描述')}</p>
                <div class="info-row"><span class="info-label">卖家</span><span class="info-value">${escapeHtml(item.seller_name)}</span></div>
                <div class="info-row"><span class="info-label">分类</span><span class="info-value">${escapeHtml(item.category || '其他')}</span></div>
                <div class="info-row"><span class="info-label">起拍价</span><span class="info-value">${formatMoney(item.start_price)}</span></div>
                <div class="info-row"><span class="info-label">最低加价</span><span class="info-value">${formatMoney(item.min_increment)}</span></div>
                <div class="info-row"><span class="info-label">保证金</span><span class="info-value">${formatMoney(item.deposit_amount || item.start_price * 0.1)}</span></div>
                ${item.buy_now_price ? `<div class="info-row"><span class="info-label">一口价</span><span class="info-value" style="color:#d97706;font-weight:600">${formatMoney(item.buy_now_price)}</span></div>` : ''}
                <div class="info-row"><span class="info-label">开始时间</span><span class="info-value">${formatTime(item.start_time)}</span></div>
                <div class="info-row"><span class="info-label">结束时间</span><span class="info-value" id="detailEndTime">${formatTime(item.end_time)}</span></div>
                ${item.status === 'ended' && item.winner_id ? `
                  <div class="info-row"><span class="info-label">最终成交价</span><span class="info-value" style="color:#ef4444;font-size:18px;font-weight:700">${formatMoney(item.final_price)}</span></div>
                  <div class="info-row"><span class="info-label">赢家</span><span class="info-value">${item.winner ? item.winner.username : '未知'}</span></div>
                ` : ''}
              </div>
            </div>
            ${item.status === 'ended' ? renderReviewSection(item) : ''}
            <div class="bid-history">
              <h3>📜 出价记录 (${item.bids.length} 条)</h3>
              <div class="bid-list" id="bidList">
                ${item.bids.length ? item.bids.map(b => `
                  <div class="bid-item">
                    <div>
                      <span class="bid-user">${escapeHtml(b.username)}</span>
                      ${b.is_proxy ? '<span class="proxy-tag">代理出价</span>' : ''}
                      <span style="margin-left:10px" class="bid-amount">${formatMoney(b.amount)}</span>
                    </div>
                    <span class="bid-time">${formatTime(b.created_at)}</span>
                  </div>
                `).join('') : '<div class="empty-state">暂无出价</div>'}
              </div>
            </div>
          </div>
          <div>
            <div class="bid-section" id="bidSection">
              ${renderBidPanel(item, currentPrice, minBid)}
            </div>
          </div>
        </div>
      </div>
      <div class="modal-overlay" id="editModal">
        <div class="modal">
          <div class="modal-title">编辑拍品</div>
          <div class="form-group"><label class="form-label">标题</label><input class="form-input" id="editTitle" value="${escapeHtml(item.title)}"></div>
          <div class="form-group"><label class="form-label">描述</label><textarea class="form-input" id="editDesc">${escapeHtml(item.description || '')}</textarea></div>
          <div class="form-group"><label class="form-label">图片URL</label><input class="form-input" id="editImage" value="${escapeHtml(item.image_url || '')}"></div>
          <div class="form-group">
            <label class="form-label">分类</label>
            <select class="category-select" id="editCategory">
              ${categoryOptions.map(c => `<option value="${c}" ${c===item.category?'selected':''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label class="form-label">起拍价</label><input type="number" class="form-input" id="editStartPrice" value="${item.start_price}"></div>
          <div class="form-group"><label class="form-label">最低加价</label><input type="number" class="form-input" id="editMinInc" value="${item.min_increment}"></div>
          <div class="form-group"><label class="form-label">保证金</label><input type="number" class="form-input" id="editDeposit" value="${item.deposit_amount || ''}"></div>
          <div class="form-group"><label class="form-label">一口价（可选）</label><input type="number" class="form-input" id="editBuyNow" value="${item.buy_now_price || ''}"></div>
          <div class="modal-actions">
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
            <button class="btn btn-primary" onclick="submitEdit(${item.id})">保存</button>
          </div>
        </div>
      </div>`;
    startDetailPolling(id);
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="container"><div class="empty-state">加载失败: ${e.message}</div></div>`;
  }
}

function renderBidPanel(item, currentPrice, minBid) {
  if (item.status === 'pending') {
    return `
      <h3 style="text-align:center">拍卖尚未开始</h3>
      <div style="text-align:center;margin:16px 0">
        <div class="price-label">距开始还有</div>
        <div class="countdown" style="font-size:24px" id="pendingCountdown">${formatCountdown(getCountdown(item.start_time))}</div>
      </div>
      <div class="deposit-info">
        🔒 参与出价需缴纳保证金 <b>${formatMoney(item.deposit_amount || item.start_price * 0.1)}</b><br>
        未中标将在拍卖结束后自动退还
      </div>
      ${currentUser && item.seller_id === currentUser.id ? `
        <button class="btn btn-secondary" style="width:100%;margin-top:12px" onclick="openModal()">编辑拍品</button>
      ` : ''}`;
  }
  if (item.status === 'ended') {
    return renderEndedPanel(item);
  }
  if (!currentUser) {
    return `
      <h3 style="text-align:center">请先登录参与竞拍</h3>
      <div class="current-price">${formatMoney(currentPrice)}</div>
      <div class="deposit-info">
        🔒 参与出价需缴纳保证金 <b>${formatMoney(item.deposit_amount || item.start_price * 0.1)}</b>
      </div>
      ${item.buy_now_price && currentPrice < item.buy_now_price ? `
        <div class="buy-now-section" style="margin-top:12px">
          <div class="buy-now-price">⚡ 一口价 ${formatMoney(item.buy_now_price)}</div>
        </div>` : ''}
      <button class="btn btn-primary bid-btn" style="margin-top:12px" onclick="location.hash='#/login'">登录参与竞拍</button>`;
  }
  if (item.seller_id === currentUser.id) {
    return `
      <h3 style="text-align:center">您是卖家</h3>
      <div class="current-price">${formatMoney(currentPrice)}</div>
      <div style="text-align:center;color:#888;font-size:14px">不能对自己的商品出价</div>
      <div style="text-align:center;margin-top:12px">
        <div class="price-label">距结束</div>
        <div class="countdown" style="font-size:24px" id="activeCountdown">${formatCountdown(getCountdown(item.end_time))}</div>
      </div>`;
  }
  const showBuyNow = item.buy_now_price && currentPrice < item.buy_now_price;
  const proxy = proxyBidCache;
  return `
    <h3 style="text-align:center">实时竞拍</h3>
    <div style="text-align:center">
      <div class="price-label">当前价格</div>
      <div class="current-price" id="currentPriceDisplay">${formatMoney(currentPrice)}</div>
    </div>
    <div style="text-align:center;margin:8px 0">
      <div class="price-label">距结束</div>
      <div class="countdown" style="font-size:20px" id="activeCountdown">${formatCountdown(getCountdown(item.end_time))}</div>
    </div>

    ${showBuyNow ? `
      <div class="buy-now-section">
        <div class="buy-now-price">⚡ 一口价 ${formatMoney(item.buy_now_price)}</div>
        <button class="btn btn-buy-now" onclick="confirmBuyNow(${item.id})">立即购买</button>
      </div>` : ''}

    <div class="bid-input-row">
      <input type="number" class="bid-input" id="bidInput" placeholder="最低 ${minBid}" min="${minBid}" value="${minBid}" step="${item.min_increment}">
    </div>
    <div class="quick-bids">
      <button class="quick-bid" onclick="addQuickBid(10, ${item.min_increment})">+10</button>
      <button class="quick-bid" onclick="addQuickBid(50, ${item.min_increment})">+50</button>
      <button class="quick-bid" onclick="addQuickBid(100, ${item.min_increment})">+100</button>
    </div>
    <button class="btn btn-primary bid-btn" id="placeBidBtn" onclick="placeBid(${item.id})">立即出价</button>

    <div class="proxy-section">
      <div class="proxy-section-title">
        🤖 代理出价
        ${proxy && proxy.is_active ? `
          <span style="margin-left:auto;font-weight:500;font-size:12px;color:#16a34a">
            已启用上限 ${formatMoney(proxy.max_amount)}
            <button class="btn-cancel-proxy" onclick="cancelProxyBid(${item.id})">取消</button>
          </span>` : ''}
      </div>
      <div class="proxy-input-row">
        <input type="number" class="proxy-input" id="proxyInput" placeholder="设置代理出价上限" min="${minBid}" value="${proxy && proxy.is_active ? proxy.max_amount : ''}">
        <button class="btn btn-proxy" onclick="setProxyBid(${item.id})">${proxy && proxy.is_active ? '修改' : '启用'}</button>
      </div>
      <div class="proxy-info">
        设置后系统将自动以最小加价幅度替您跟价，直到达到您设置的上限。<br>
        同一拍品最多只能设置一个代理出价，可随时修改或取消。
      </div>
    </div>

    <div class="deposit-info">
      🔒 参与出价需缴纳保证金 <b>${formatMoney(item.deposit_amount || item.start_price * 0.1)}</b><br>
      未中标将在拍卖结束后自动退还，中标则抵扣货款
    </div>
    <div style="margin-top:12px;font-size:12px;color:#888;text-align:center">
      每次加价不低于 ${formatMoney(item.min_increment)}<br>
      最后5分钟出价自动延时3分钟
    </div>`;
}

async function confirmBuyNow(itemId) {
  if (!confirm('确认以一口价购买此商品？')) return;
  try {
    await apiRequest(`/items/${itemId}/buy_now`, { method: 'POST' });
    showToast('购买成功！', 'success');
    refreshUser();
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

async function setProxyBid(itemId) {
  const input = document.getElementById('proxyInput');
  const maxAmount = parseFloat(input.value);
  if (!maxAmount || isNaN(maxAmount)) return showToast('请输入有效金额', 'error');
  try {
    const res = await apiRequest(`/items/${itemId}/proxy`, {
      method: 'POST',
      body: JSON.stringify({ max_amount: maxAmount })
    });
    proxyBidCache = res.proxy;
    showToast('代理出价已' + (res.message ? '取消' : '设置'), 'success');
    refreshUser();
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

async function cancelProxyBid(itemId) {
  try {
    await apiRequest(`/items/${itemId}/proxy`, {
      method: 'POST',
      body: JSON.stringify({ max_amount: 0 })
    });
    proxyBidCache = null;
    showToast('已取消代理出价', 'success');
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

function renderEndedPanel(item) {
  const isWinner = currentUser && item.winner_id === currentUser.id;
  const isSeller = currentUser && item.seller_id === currentUser.id;
  let html = `
    <h3 style="text-align:center">拍卖已结束</h3>
    <div class="current-price">${formatMoney(item.final_price || item.current_price || item.start_price)}</div>`;
  if (item.winner_id) {
    html += `<div style="text-align:center;margin-bottom:16px;color:#555">
      🏆 赢家: <b>${item.winner ? item.winner.username : '未知'}</b>
    </div>`;
  }
  if (isWinner) {
    html += `<div style="margin:12px 0">
      ${item.paid ? '<div style="text-align:center;color:#10b981;padding:8px;background:#d1fae5;border-radius:8px">✓ 已付款</div>' : 
        `<button class="btn btn-success bid-btn" onclick="confirmPay(${item.id})">确认付款 (${formatMoney(item.final_price)})</button>`}
    </div>`;
  }
  if (isSeller) {
    html += `<div style="margin:12px 0">
      ${!item.paid ? '<div style="text-align:center;color:#f59e0b;padding:8px;background:#fef3c7;border-radius:8px">等待买家付款</div>' :
        item.shipped ? '<div style="text-align:center;color:#10b981;padding:8px;background:#d1fae5;border-radius:8px">✓ 已发货</div>' :
        `<button class="btn btn-primary bid-btn" onclick="confirmShip(${item.id})">确认发货</button>`}
    </div>`;
  }
  return html;
}

function renderReviewSection(item) {
  let html = `<div class="bid-history"><h3>⭐ 交易评价</h3>`;
  if (item.reviews && item.reviews.length) {
    html += item.reviews.map(r => `
      <div class="review-item">
        <div class="review-header">
          <span><b>${r.username}</b> <span class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span></span>
          <span style="color:#999;font-size:12px">${formatTime(r.created_at)}</span>
        </div>
        <div class="review-comment">${r.comment || '无文字评价'}</div>
      </div>`).join('');
  }
  if (currentUser && (item.seller_id === currentUser.id || item.winner_id === currentUser.id)) {
    const otherId = item.seller_id === currentUser.id ? item.winner_id : item.seller_id;
    html += `
      <div style="margin-top:20px;padding-top:20px;border-top:1px solid #f0f0f0">
        <h4>发表评价</h4>
        <div class="star-rating" id="starRating">
          ${[1,2,3,4,5].map(i => `<span class="star" data-val="${i}" onclick="setStar(${i})">★</span>`).join('')}
        </div>
        <textarea class="form-input" id="reviewComment" placeholder="评价内容（可选）"></textarea>
        <button class="btn btn-primary" style="margin-top:10px" onclick="submitReview(${item.id}, ${otherId})">提交评价</button>
      </div>`;
  }
  if (!item.reviews || !item.reviews.length) {
    html += '<div class="empty-state" style="padding:20px">暂无评价</div>';
  }
  html += '</div>';
  return html;
}

let currentRating = 0;
function setStar(n) {
  currentRating = n;
  document.querySelectorAll('#starRating .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= n);
  });
}

async function submitReview(itemId, toUserId) {
  if (!currentRating) return showToast('请选择评分', 'error');
  const comment = document.getElementById('reviewComment').value;
  try {
    await apiRequest(`/items/${itemId}/review`, {
      method: 'POST',
      body: JSON.stringify({ to_user_id: toUserId, rating: currentRating, comment })
    });
    showToast('评价成功', 'success');
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

function addQuickBid(amount, minInc) {
  const input = document.getElementById('bidInput');
  const add = Math.max(amount, minInc);
  input.value = (parseFloat(input.value || 0) + add).toString();
}

async function placeBid(itemId) {
  if (!currentUser) return showToast('请先登录', 'error');
  const input = document.getElementById('bidInput');
  const amount = parseFloat(input.value);
  if (!amount || isNaN(amount)) return showToast('请输入有效金额', 'error');
  try {
    const res = await apiRequest(`/items/${itemId}/bid`, {
      method: 'POST', body: JSON.stringify({ amount })
    });
    showToast('出价成功！', 'success');
    refreshUser();
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

async function confirmPay(itemId) {
  if (!confirm('确认付款？')) return;
  try {
    await apiRequest(`/items/${itemId}/pay`, { method: 'POST' });
    showToast('付款成功！', 'success');
    refreshUser();
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

async function confirmShip(itemId) {
  if (!confirm('确认已发货？')) return;
  try {
    await apiRequest(`/items/${itemId}/ship`, { method: 'POST' });
    showToast('已确认发货', 'success');
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

function openModal() { document.getElementById('editModal').classList.add('active'); }
function closeModal() { document.getElementById('editModal').classList.remove('active'); }

async function submitEdit(itemId) {
  const data = {
    title: document.getElementById('editTitle').value,
    description: document.getElementById('editDesc').value,
    image_url: document.getElementById('editImage').value,
    category: document.getElementById('editCategory').value,
    start_price: document.getElementById('editStartPrice').value,
    min_increment: document.getElementById('editMinInc').value,
    deposit_amount: document.getElementById('editDeposit').value,
    buy_now_price: document.getElementById('editBuyNow').value || null
  };
  try {
    await apiRequest(`/items/${itemId}`, { method: 'PUT', body: JSON.stringify(data) });
    closeModal();
    showToast('修改成功', 'success');
    renderItemDetail(itemId);
  } catch (e) { showToast(e.message, 'error'); }
}

function startDetailPolling(id) {
  if (detailTimer) clearInterval(detailTimer);
  updateDetailCountdown();
  detailTimer = setInterval(async () => {
    updateDetailCountdown();
    try {
      const fresh = await apiRequest(`/items/${id}`);
      const old = itemDetailCache;
      if (!old || fresh.bids.length !== old.bids.length || fresh.current_price !== old.current_price || fresh.end_time !== old.end_time) {
        renderItemDetail(id);
        return;
      }
    } catch (e) {}
  }, 2000);
}

function updateDetailCountdown() {
  const pending = document.getElementById('pendingCountdown');
  const active = document.getElementById('activeCountdown');
  const item = itemDetailCache;
  if (!item) return;
  if (pending) {
    pending.textContent = formatCountdown(getCountdown(item.start_time));
  }
  if (active) {
    const cd = getCountdown(item.end_time);
    active.textContent = formatCountdown(cd);
    if (cd.total < 5 * 60 * 1000) active.classList.add('countdown-urgent');
    else active.classList.remove('countdown-urgent');
  }
}

async function renderProfile() {
  if (!currentUser) { location.hash = '#/login'; return; }
  document.getElementById('app').innerHTML = `
    <div class="container">
      <div class="page-title">
        <span>个人中心 - ${currentUser.username}</span>
        <span class="action-row">
          <span class="balance-badge" style="background:#667eea;color:white;padding:8px 16px;border-radius:20px">💰 余额 ${formatMoney(currentUser.balance)}</span>
          <span style="padding:8px 16px;background:#fef3c7;color:#92400e;border-radius:20px;font-size:14px">⭐ 信誉 ${currentUser.reputation}</span>
        </span>
      </div>
      <div class="card" style="padding:24px">
        <div class="tabs" id="profileTabs">
          <div class="tab active" data-tab="bids" onclick="switchProfileTab('bids')">我的出价</div>
          <div class="tab" data-tab="won" onclick="switchProfileTab('won')">赢得的拍品</div>
          <div class="tab" data-tab="sold" onclick="switchProfileTab('sold')">我发布的</div>
          <div class="tab" data-tab="notif" onclick="switchProfileTab('notif')">通知消息</div>
        </div>
        <div id="profileContent">加载中...</div>
      </div>
    </div>`;
  switchProfileTab('bids');
}

function switchProfileTab(tab) {
  document.querySelectorAll('#profileTabs .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  if (tab === 'bids') loadProfileBids();
  else if (tab === 'won') loadProfileWon();
  else if (tab === 'sold') loadProfileSold();
  else if (tab === 'notif') loadProfileNotifs();
}

async function loadProfileBids() {
  try {
    const bids = await apiRequest('/user/bids');
    document.getElementById('profileContent').innerHTML = bids.length ? `
      <table class="table">
        <thead><tr><th>拍品</th><th>出价金额</th><th>时间</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>${bids.map(b => `
          <tr>
            <td>${b.title}</td>
            <td style="color:#ef4444;font-weight:600">${formatMoney(b.amount)}</td>
            <td>${formatTime(b.created_at)}</td>
            <td><span class="status-badge ${statusClass(b.status)}">${statusText(b.status)}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="location.hash='#/item/${b.item_id}'">查看</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty-state">暂无出价记录</div>';
  } catch (e) { document.getElementById('profileContent').innerHTML = `<div class="empty-state">加载失败</div>`; }
}

async function loadProfileWon() {
  try {
    const items = await apiRequest('/user/won');
    document.getElementById('profileContent').innerHTML = items.length ? `
      <div class="card-grid">${items.map(i => `
        <div class="card item-card" onclick="location.hash='#/item/${i.id}'">
          <img src="${i.image_url}" class="item-image" onerror="this.src='https://via.placeholder.com/400x200'">
          <div class="item-body">
            <div class="item-title">${i.title}</div>
            <div class="item-meta">
              <span>卖家: ${i.seller_name}</span>
              <span>${i.paid ? '✓已付' : '待付款'}</span>
            </div>
            <div class="price">${formatMoney(i.final_price)}</div>
          </div>
        </div>`).join('')}</div>` : '<div class="empty-state">暂无赢得的拍品</div>';
  } catch (e) { document.getElementById('profileContent').innerHTML = `<div class="empty-state">加载失败</div>`; }
}

async function loadProfileSold() {
  try {
    const items = await apiRequest('/user/sold');
    document.getElementById('profileContent').innerHTML = items.length ? `
      <div class="card-grid">${items.map(i => {
        const p = i.current_price || i.start_price;
        return `
        <div class="card item-card" onclick="location.hash='#/item/${i.id}'">
          <img src="${i.image_url}" class="item-image" onerror="this.src='https://via.placeholder.com/400x200'">
          <div class="item-body">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="status-badge ${statusClass(i.status)}">${statusText(i.status)}</span>
              <span style="font-size:12px;color:#888">${i.bid_count || 0}次出价</span>
            </div>
            <div class="item-title">${i.title}</div>
            <div class="item-meta">
              ${i.status === 'ended' && i.winner_name ? `<span>赢家: ${i.winner_name}</span>` : '<span>&nbsp;</span>'}
              ${i.shipped ? '<span>✓已发货</span>' : (i.paid ? '<span>待发货</span>' : '')}
            </div>
            <div class="price">${i.status === 'ended' ? formatMoney(i.final_price || p) : formatMoney(p)}</div>
          </div>
        </div>`;
      }).join('')}</div>` : '<div class="empty-state">暂无发布的拍品</div>';
  } catch (e) { document.getElementById('profileContent').innerHTML = `<div class="empty-state">加载失败</div>`; }
}

async function loadProfileNotifs() {
  try {
    const notifs = await apiRequest('/notifications');
    notifCache = notifs;
    document.getElementById('profileContent').innerHTML = notifs.length ?
      notifs.map(n => `
        <div class="notification-item ${n.is_read ? '' : 'unread'}" onclick="readNotif(${n.id}, ${n.item_id})">
          <span class="notification-message">${n.message}</span>
          <span class="notification-time">${formatTime(n.created_at)}</span>
        </div>`).join('') : '<div class="empty-state">暂无消息</div>';
  } catch (e) { document.getElementById('profileContent').innerHTML = `<div class="empty-state">加载失败</div>`; }
}

async function readNotif(id, itemId) {
  try {
    await apiRequest(`/notifications/${id}/read`, { method: 'POST' });
    if (itemId) location.hash = `#/item/${itemId}`;
    else loadProfileNotifs();
  } catch (e) {}
}

function renderPublish() {
  if (!currentUser) { location.hash = '#/login'; return; }
  const now = new Date();
  const nowStr = now.toISOString().slice(0, 16);
  const later = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const categoryOptions = ['古董', '珠宝', '艺术品', '电子', '其他'];
  document.getElementById('app').innerHTML = `
    <div class="container">
      <div class="page-title">发布拍品</div>
      <div class="card" style="max-width:600px;margin:0 auto;padding:30px">
        <div class="form-group"><label class="form-label">拍品标题 *</label><input class="form-input" id="pTitle" placeholder="例：复古机械腕表"></div>
        <div class="form-group"><label class="form-label">描述</label><textarea class="form-input" id="pDesc" placeholder="详细介绍拍品..."></textarea></div>
        <div class="form-group"><label class="form-label">图片URL</label><input class="form-input" id="pImage" placeholder="https://..."></div>
        <div class="form-group">
          <label class="form-label">分类 *</label>
          <select class="category-select" id="pCategory">
            ${categoryOptions.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label class="form-label">起拍价 *</label><input type="number" class="form-input" id="pStart" placeholder="100" min="1"></div>
        <div class="form-group"><label class="form-label">每次最低加价 *</label><input type="number" class="form-input" id="pInc" placeholder="10" min="1"></div>
        <div class="form-group">
          <label class="form-label">保证金（默认起拍价的10%）</label>
          <input type="number" class="form-input" id="pDeposit" placeholder="留空则自动计算" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">一口价（可选，留空则不启用）</label>
          <input type="number" class="form-input" id="pBuyNow" placeholder="立即购买的一口价" min="0">
        </div>
        <div class="form-group"><label class="form-label">拍卖开始时间 *</label><input type="datetime-local" class="form-input" id="pStartT" value="${nowStr}"></div>
        <div class="form-group"><label class="form-label">拍卖结束时间 *</label><input type="datetime-local" class="form-input" id="pEndT" value="${later}"></div>
        <button class="btn btn-primary form-btn" onclick="submitPublish()">发布拍品</button>
      </div>
    </div>`;
}

async function submitPublish() {
  const data = {
    title: document.getElementById('pTitle').value.trim(),
    description: document.getElementById('pDesc').value,
    image_url: document.getElementById('pImage').value,
    category: document.getElementById('pCategory').value,
    start_price: document.getElementById('pStart').value,
    min_increment: document.getElementById('pInc').value,
    deposit_amount: document.getElementById('pDeposit').value,
    buy_now_price: document.getElementById('pBuyNow').value || null,
    start_time: new Date(document.getElementById('pStartT').value).toISOString(),
    end_time: new Date(document.getElementById('pEndT').value).toISOString()
  };
  if (!data.title || !data.start_price || !data.min_increment) return showToast('请填写必填项', 'error');
  try {
    const item = await apiRequest('/items', { method: 'POST', body: JSON.stringify(data) });
    showToast('发布成功！', 'success');
    location.hash = `#/item/${item.id}`;
  } catch (e) { showToast(e.message, 'error'); }
}

async function syncTime() {
  try {
    const res = await apiRequest('/time');
    serverTimeOffset = res.serverTime - Date.now();
  } catch (e) {}
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  await syncTime();
  setInterval(syncTime, 30000);
  await refreshUser();
  route();
});
