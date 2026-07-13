// P'Tom's Smoothie Shop Local Storage Database & Logic Engine with Supabase Sync

// Supabase Configuration
// Paste your Supabase Project URL and Anon Key here to enable online database.
// If left blank, it will automatically fallback to LocalStorage mode.
const SUPABASE_CONFIG = {
  url: 'https://bjddvnpdjqoicyprjojw.supabase.co', // e.g. 'https://xxxx.supabase.co'
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqZGR2bnBkanFvaWN5cHJqb2p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NDIwOTEsImV4cCI6MjA5OTUxODA5MX0._iGBnLbb7o3JStH6dE4KaqC-k36bSyEvsPq3nFBrPw4'
};

// Helper for Supabase HTTP REST API requests
async function sbQuery(path, method = 'GET', body = null, headers = {}) {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.key) return null;
  const cleanUrl = SUPABASE_CONFIG.url.replace(/\/$/, '');
  const url = `${cleanUrl}/rest/v1/${path}`;
  const defaultHeaders = {
    'apikey': SUPABASE_CONFIG.key,
    'Authorization': `Bearer ${SUPABASE_CONFIG.key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const options = {
    method,
    headers: { ...defaultHeaders, ...headers },
    keepalive: true
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Supabase API error (${response.status}):`, errText);
      throw new Error(errText || `HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    return await response.json();
  } catch (error) {
    console.error('Supabase fetch failed:', error);
    throw error;
  }
}

// Background sync from Supabase
async function syncFromSupabase() {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.key) return;
  try {
    console.log('Background Syncing with Supabase...');
    
    // 1. Sync users
    const users = await sbQuery('ptom_users?select=*');
    if (users) {
      if (users.length === 0) {
        // Seed Supabase with local users if empty
        console.log('Supabase users table is empty, seeding...');
        const localUsers = JSON.parse(localStorage.getItem('ptom_users')) || [];
        for (const u of localUsers) {
          await sbQuery('ptom_users', 'POST', u);
        }
      } else {
        localStorage.setItem('ptom_users', JSON.stringify(users));
        // Sync current active user
        const curUser = localStorage.getItem('ptom_current_user');
        if (curUser) {
          const parsed = JSON.parse(curUser);
          const fresh = users.find(u => u.username === parsed.username);
          if (fresh) {
            localStorage.setItem('ptom_current_user', JSON.stringify(fresh));
          }
        }
      }
    }

    // 2. Sync scans
    const scans = await sbQuery('ptom_scans?select=*&order=timestamp.desc');
    if (scans) {
      if (scans.length === 0) {
        console.log('Supabase scans table is empty, seeding...');
        const localScans = JSON.parse(localStorage.getItem('ptom_scans')) || [];
        for (const s of localScans) {
          await sbQuery('ptom_scans', 'POST', s);
        }
      } else {
        localStorage.setItem('ptom_scans', JSON.stringify(scans));
      }
    }

    // 3. Sync redemptions
    const redemptions = await sbQuery('ptom_redemptions?select=*&order=timestamp.desc');
    if (redemptions) {
      localStorage.setItem('ptom_redemptions', JSON.stringify(redemptions));
    }

    // 4. Sync orders (bookings)
    const orders = await sbQuery('ptom_orders?select=*&order=timestamp.desc');
    if (orders) {
      localStorage.setItem('ptom_orders', JSON.stringify(orders));
    }

    // 5. Sync activity logs
    const logs = await sbQuery('ptom_activity_logs?select=*&order=timestamp.desc&limit=200');
    if (logs) {
      localStorage.setItem('ptom_activity_logs', JSON.stringify(logs));
    }

    // 6. Sync fruit market
    const market = await sbQuery('ptom_fruit_market?select=*');
    if (market && market.length > 0) {
      localStorage.setItem('ptom_fruit_market', JSON.stringify(market));
    } else if (market && market.length === 0) {
      const localMarket = JSON.parse(localStorage.getItem('ptom_fruit_market')) || [];
      for (const f of localMarket) {
        await sbQuery('ptom_fruit_market', 'POST', f);
      }
    }

    // Trigger UI updates on all active tabs
    window.dispatchEvent(new Event('storage'));
    console.log('Successfully synchronized with Supabase!');
  } catch (err) {
    console.error('Failed to background sync with Supabase:', err);
  }
}

// Initialize Data Structures in LocalStorage
(function initDatabase() {
  if (!localStorage.getItem('ptom_users')) {
    const seedUsers = [
      {
        username: 'somchai',
        fullName: 'สมชาย รักน้ำปั่น',
        email: 'somchai@gmail.com',
        passwordHash: '123456',
        points: 60,
        createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      },
      {
        username: 'jane_healthy',
        fullName: 'เจน สายคลีน',
        email: 'jane@gmail.com',
        passwordHash: '123456',
        points: 150,
        createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
      }
    ];
    localStorage.setItem('ptom_users', JSON.stringify(seedUsers));
  }

  if (!localStorage.getItem('ptom_scans')) {
    const seedScans = [
      {
        id: 'PTS-87293',
        username: 'somchai',
        timestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        pointsGained: 10,
        status: 'Success',
        description: 'จองเครื่องดื่ม อะโวคาโดน้ำผึ้งปั่น',
        photoData: ''
      },
      {
        id: 'PTS-87294',
        username: 'jane_healthy',
        timestamp: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
        pointsGained: 10,
        status: 'Success',
        description: 'จองเครื่องดื่ม สตรอว์เบอร์รีโยเกิร์ตปั่น',
        photoData: ''
      }
    ];
    localStorage.setItem('ptom_scans', JSON.stringify(seedScans));
  }

  if (!localStorage.getItem('ptom_redemptions')) {
    localStorage.setItem('ptom_redemptions', JSON.stringify([]));
  }

  if (!localStorage.getItem('ptom_orders')) {
    localStorage.setItem('ptom_orders', JSON.stringify([]));
  }

  // Auto-clean any legacy DIY orders, scans, and logs containing "DIY" or "🧪"
  try {
    const ordersStr = localStorage.getItem('ptom_orders');
    if (ordersStr) {
      const orders = JSON.parse(ordersStr);
      const cleanOrders = orders.filter(o => o.items && Array.isArray(o.items) && !o.items.some(item => item && typeof item === 'string' && (item.includes('DIY') || item.includes('🧪'))));
      if (orders.length !== cleanOrders.length) {
        localStorage.setItem('ptom_orders', JSON.stringify(cleanOrders));
      }
    }

    const scansStr = localStorage.getItem('ptom_scans');
    if (scansStr) {
      const scans = JSON.parse(scansStr);
      let changed = false;
      const cleanScans = scans.map(s => {
        if (!s.description || typeof s.description !== 'string') {
          s.description = 'ได้รับคะแนนสะสม';
          changed = true;
        }
        return s;
      }).filter(s => !s.description.includes('DIY') && !s.description.includes('🧪'));
      if (changed || scans.length !== cleanScans.length) {
        localStorage.setItem('ptom_scans', JSON.stringify(cleanScans));
      }
    }

    const logsStr = localStorage.getItem('ptom_activity_logs');
    if (logsStr) {
      const logs = JSON.parse(logsStr);
      let changed = false;
      const cleanLogs = logs.map(l => {
        if (!l.details || typeof l.details !== 'string') {
          l.details = '';
          changed = true;
        }
        if (!l.action || typeof l.action !== 'string') {
          l.action = '';
          changed = true;
        }
        return l;
      }).filter(l => !l.details.includes('DIY') && !l.details.includes('🧪') && !l.action.includes('DIY') && !l.action.includes('🧪'));
      if (changed || logs.length !== cleanLogs.length) {
        localStorage.setItem('ptom_activity_logs', JSON.stringify(cleanLogs));
      }
    }
  } catch (e) {
    console.error('Error cleaning up DIY legacy data:', e);
  }

  // Admin Account (Defaults)
  if (!localStorage.getItem('ptom_admin')) {
    localStorage.setItem('ptom_admin', JSON.stringify({
      email: 'admin@gmail.com',
      password: '1234',
      fullName: 'พี่ต้อม เจ้าของร้าน'
    }));
  }

  // Fruit Market Prices Init (Static database fallback)
  const existingMarket = localStorage.getItem('ptom_fruit_market');
  if (!existingMarket || JSON.parse(existingMarket).length < 10) {
    const fruits = [
      { fruit: 'Avocado (อะโวคาโด)', currentPrice: 120, change: 0, history: [120, 120], forecast: [120, 120] },
      { fruit: 'Mango (มะม่วงอกร่อง)', currentPrice: 65, change: 0, history: [65, 65], forecast: [65, 65] },
      { fruit: 'Coconut (มะพร้าวน้ำหอม)', currentPrice: 45, change: 0, history: [45, 45], forecast: [45, 45] },
      { fruit: 'Strawberry (สตรอว์เบอร์รี)', currentPrice: 220, change: 0, history: [220, 220], forecast: [220, 220] },
      { fruit: 'Blueberry (บลูเบอร์รีป่า)', currentPrice: 180, change: 0, history: [180, 180], forecast: [180, 180] },
      { fruit: 'Kiwi (กีวี่สีทอง)', currentPrice: 95, change: 0, history: [95, 95], forecast: [95, 95] },
      { fruit: 'Passion Fruit (เสาวรส)', currentPrice: 55, change: 0, history: [55, 55], forecast: [55, 55] },
      { fruit: 'Orange (ส้มสายน้ำผึ้ง)', currentPrice: 40, change: 0, history: [40, 40], forecast: [40, 40] },
      { fruit: 'Pineapple (สับปะรดภูแล)', currentPrice: 30, change: 0, history: [30, 30], forecast: [30, 30] },
      { fruit: 'Banana (กล้วยหอมทอง)', currentPrice: 25, change: 0, history: [25, 25], forecast: [25, 25] },
      { fruit: 'Watermelon (แตงโมหวาน)', currentPrice: 20, change: 0, history: [20, 20], forecast: [20, 20] },
      { fruit: 'Apple (แอปเปิ้ลฟูจิ)', currentPrice: 80, change: 0, history: [80, 80], forecast: [80, 80] }
    ];
    localStorage.setItem('ptom_fruit_market', JSON.stringify(fruits));
  }

  // Trigger Supabase Background Sync
  setTimeout(syncFromSupabase, 100);
})();

// Helper Functions
const DB = {
  // --- AUTHENTICATION ---
  getUsers() {
    return JSON.parse(localStorage.getItem('ptom_users')) || [];
  },

  saveUsers(users) {
    localStorage.setItem('ptom_users', JSON.stringify(users));
    window.dispatchEvent(new Event('storage'));
  },

  signUp(fullName, username, email, password) {
    const users = this.getUsers();
    
    // Check if user exists
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
      throw new Error('ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว');
    }
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('อีเมลนี้ถูกใช้ไปแล้ว');
    }

    const newUser = {
      username: username.toLowerCase().trim(),
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash: password, // Simple store for demo purposes
      points: 0,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    this.saveUsers(users);
    this.logActivity(newUser.username, 'สมัครสมาชิก', 'เปิดบัญชีสมาชิกใหม่สำเร็จ');

    // Supabase Async Write
    sbQuery('ptom_users', 'POST', newUser);
    
    return newUser;
  },

  login(usernameOrEmail, password) {
    const users = this.getUsers();
    const user = users.find(u => 
      (u.username.toLowerCase() === usernameOrEmail.toLowerCase().trim() || 
       u.email.toLowerCase() === usernameOrEmail.toLowerCase().trim()) && 
      u.passwordHash === password
    );

    if (!user) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    localStorage.setItem('ptom_current_user', JSON.stringify(user));
    this.logActivity(user.username, 'เข้าสู่ระบบ', 'เข้าสู่ระบบสำเร็จ');
    return user;
  },

  logout() {
    const user = this.getCurrentUser();
    if (user) {
      this.logActivity(user.username, 'ออกจากระบบ', 'ออกจากระบบสำเร็จ');
    }
    localStorage.removeItem('ptom_current_user');
  },

  getCurrentUser() {
    const userJson = localStorage.getItem('ptom_current_user');
    if (!userJson) return null;
    
    // Sync with the main users array in case points or ranks changed
    const user = JSON.parse(userJson);
    const users = this.getUsers();
    const latestUser = users.find(u => u.username === user.username);
    if (latestUser) {
      localStorage.setItem('ptom_current_user', JSON.stringify(latestUser));
      return latestUser;
    }
    return user;
  },

  updateCurrentUserProfile(fullName, email, newPassword = null) {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('กรุณาเข้าสู่ระบบก่อน');

    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === currentUser.username);
    if (userIdx === -1) throw new Error('ไม่พบข้อมูลผู้ใช้');

    // Email duplicate check
    if (email.toLowerCase() !== currentUser.email.toLowerCase()) {
      const emailDup = users.find(u => u.email.toLowerCase() === email.toLowerCase() && u.username !== currentUser.username);
      if (emailDup) throw new Error('อีเมลนี้ถูกใช้ไปแล้ว');
    }

    users[userIdx].fullName = fullName;
    users[userIdx].email = email;
    if (newPassword) {
      users[userIdx].passwordHash = newPassword;
    }

    this.saveUsers(users);
    localStorage.setItem('ptom_current_user', JSON.stringify(users[userIdx]));
    this.logActivity(currentUser.username, 'แก้ไขโปรไฟล์', 'อัปเดตข้อมูลส่วนตัว');

    // Supabase Async Write
    const updatedFields = {
      fullName: users[userIdx].fullName,
      email: users[userIdx].email
    };
    if (newPassword) {
      updatedFields.passwordHash = newPassword;
    }
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(currentUser.username)}`, 'PATCH', updatedFields);
  },

  // --- LOYALTY POINTS & RANKS ---
  getRank(points) {
    if (points >= 800) return { name: 'Radiant (พี่ต้อมตัวจริง)', class: 'rank-radiant', logo: '💎', nextThreshold: Infinity };
    if (points >= 500) return { name: 'Platinum', class: 'rank-platinum', logo: '✨', nextThreshold: 800 };
    if (points >= 300) return { name: 'Gold', class: 'rank-gold', logo: '👑', nextThreshold: 500 };
    if (points >= 100) return { name: 'Silver', class: 'rank-silver', logo: '🥈', nextThreshold: 300 };
    return { name: 'Bronze', class: 'rank-bronze', logo: '🥉', nextThreshold: 100 };
  },

  addPoints(username, pointsGained, description, photoData = '') {
    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === username);
    if (userIdx === -1) return null;

    const oldPoints = users[userIdx].points;
    users[userIdx].points += pointsGained;
    const newPoints = users[userIdx].points;

    this.saveUsers(users);

    // Save points log record (using scans table)
    const scans = JSON.parse(localStorage.getItem('ptom_scans')) || [];
    const scanId = 'PTS-' + Math.floor(100000 + Math.random() * 90000);
    const newScan = {
      id: scanId,
      username,
      timestamp: new Date().toISOString(),
      pointsGained,
      status: 'Success',
      description,
      photoData
    };
    scans.unshift(newScan);
    localStorage.setItem('ptom_scans', JSON.stringify(scans));

    // Log Activity
    const oldRank = this.getRank(oldPoints).name;
    const newRank = this.getRank(newPoints).name;
    let desc = `${description} +${pointsGained} แต้ม (ยอดรวม: ${newPoints} แต้ม)`;
    if (oldRank !== newRank) {
      desc += ` เลื่อนระดับแรงค์เป็น ${newRank}!`;
    }
    this.logActivity(username, 'ได้รับคะแนนสะสม', desc);

    // If current logged-in user, sync current user
    const curUser = this.getCurrentUser();
    if (curUser && curUser.username === username) {
      localStorage.setItem('ptom_current_user', JSON.stringify(users[userIdx]));
    }

    // Supabase Async Write
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(username)}`, 'PATCH', { points: newPoints });
    sbQuery('ptom_scans', 'POST', newScan);

    return users[userIdx];
  },

  redeemReward(username, photoData = '') {
    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === username);
    if (userIdx === -1) throw new Error('ไม่พบชื่อผู้ใช้นี้');

    if (users[userIdx].points < 100) {
      throw new Error('แต้มสะสมไม่เพียงพอ ต้องใช้ 100 แต้ม (10 แก้ว) ในการแลกรางวัล');
    }

    users[userIdx].points -= 100;
    this.saveUsers(users);

    // Save redemption record
    const redemptions = JSON.parse(localStorage.getItem('ptom_redemptions')) || [];
    const redeemId = 'REDEEM-' + Math.floor(100000 + Math.random() * 90000);
    const newRedemption = {
      id: redeemId,
      username,
      timestamp: new Date().toISOString(),
      pointsDeducted: 100,
      status: 'Redeemed',
      photoData
    };
    redemptions.unshift(newRedemption);
    localStorage.setItem('ptom_redemptions', JSON.stringify(redemptions));

    // Log Activity
    this.logActivity(username, 'แลกรับรางวัล', 'แลกน้ำปั่นฟรี 1 แก้วสำเร็จ (ถ่ายภาพแก้วน้ำเพื่อบันทึกสิทธิ์)');

    // Sync current user
    const curUser = this.getCurrentUser();
    if (curUser && curUser.username === username) {
      localStorage.setItem('ptom_current_user', JSON.stringify(users[userIdx]));
    }

    // Supabase Async Write
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(username)}`, 'PATCH', { points: users[userIdx].points });
    sbQuery('ptom_redemptions', 'POST', newRedemption);

    return redeemId;
  },

  // --- LOG ACTIVITY ---
  logActivity(username, action, details) {
    const logs = JSON.parse(localStorage.getItem('ptom_activity_logs')) || [];
    const newLog = {
      username,
      action,
      details,
      timestamp: new Date().toISOString()
    };
    logs.unshift(newLog);
    if (logs.length > 200) logs.pop();
    localStorage.setItem('ptom_activity_logs', JSON.stringify(logs));
    window.dispatchEvent(new Event('storage'));

    // Supabase Async Write
    sbQuery('ptom_activity_logs', 'POST', newLog);
  },

  getActivityLogs() {
    return JSON.parse(localStorage.getItem('ptom_activity_logs')) || [];
  },

  // --- SCANS AND REDEMPTIONS ---
  getScans(username = null) {
    const scans = JSON.parse(localStorage.getItem('ptom_scans')) || [];
    if (username) {
      return scans.filter(s => s.username === username);
    }
    return scans;
  },

  getRedemptions(username = null) {
    const redemptions = JSON.parse(localStorage.getItem('ptom_redemptions')) || [];
    if (username) {
      return redemptions.filter(r => r.username === username);
    }
    return redemptions;
  },

  // --- ADMIN AUTH & CONTROL ---
  adminLogin(email, password) {
    const admin = JSON.parse(localStorage.getItem('ptom_admin'));
    if (admin.email === email && admin.password === password) {
      localStorage.setItem('ptom_admin_session', 'active');
      return true;
    }
    return false;
  },

  isAdminLoggedIn() {
    return localStorage.getItem('ptom_admin_session') === 'active';
  },

  adminLogout() {
    localStorage.removeItem('ptom_admin_session');
  },

  syncCurrentUser(username) {
    const curUser = this.getCurrentUser();
    if (curUser && curUser.username === username) {
      const users = this.getUsers();
      const latestUser = users.find(u => u.username === username);
      if (latestUser) {
        localStorage.setItem('ptom_current_user', JSON.stringify(latestUser));
      }
    }
  },

  // --- E-COMMERCE ORDERS SYSTEM ---
  getOrders(username = null) {
    let orders = JSON.parse(localStorage.getItem('ptom_orders')) || [];
    orders = orders.filter(o => o.items && Array.isArray(o.items) && !o.items.some(item => item && typeof item === 'string' && (item.includes('DIY') || item.includes('🧪'))));
    if (username) {
      return orders.filter(o => o.username === username);
    }
    return orders;
  },

  saveOrders(orders) {
    localStorage.setItem('ptom_orders', JSON.stringify(orders));
    window.dispatchEvent(new Event('storage'));
  },

  submitOrder(username, items, totalPrice, pointsEarned, pickupTime, notes = '') {
    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === username);
    if (userIdx === -1) throw new Error('ไม่พบข้อมูลผู้ใช้งาน');

    const orders = this.getOrders();
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 90000);
    const newOrder = {
      id: orderId,
      username,
      items,
      totalPrice,
      costPaid: totalPrice,
      pointsEarned,
      pickupTime,
      notes,
      status: 'Pending', 
      slipImage: '',     
      pointsAwarded: false, 
      timestamp: new Date().toISOString()
    };
    orders.unshift(newOrder);
    this.saveOrders(orders);

    // Supabase Async Write
    sbQuery('ptom_orders', 'POST', newOrder);

    return newOrder;
  },

  uploadOrderSlip(orderId, slipImage) {
    const orders = this.getOrders();
    const orderIdx = orders.findIndex(o => o.id === orderId);
    if (orderIdx === -1) throw new Error('ไม่พบคำสั่งซื้อนี้ในระบบ');

    orders[orderIdx].slipImage = slipImage;
    orders[orderIdx].status = 'Verifying';
    this.saveOrders(orders);

    const username = orders[orderIdx].username;
    this.logActivity(username, 'อัปโหลดสลิปชำระเงิน', `อัปโหลดสลิปชำระเงินสำหรับออร์เดอร์ ${orderId} เพื่อรอการตรวจสอบ`);

    // Supabase Async Write
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      slipImage: slipImage,
      status: 'Verifying'
    });

    return orders[orderIdx];
  },

  adminUpdateOrderStatus(orderId, nextStatus) {
    const orders = this.getOrders();
    const orderIdx = orders.findIndex(o => o.id === orderId);
    if (orderIdx === -1) throw new Error('ไม่พบคำสั่งซื้อนี้ในระบบ');

    const order = orders[orderIdx];
    const oldStatus = order.status;
    order.status = nextStatus;

    let pointsAwardedNew = order.pointsAwarded;
    if (['Preparing', 'Ready', 'Completed'].includes(nextStatus) && !order.pointsAwarded) {
      const username = order.username;
      const pointsEarned = order.pointsEarned || 10;
      const description = `สะสมแต้มจากออร์เดอร์ ${orderId} (อนุมัติสลิปสำเร็จ)`;
      this.addPoints(username, pointsEarned, description);
      order.pointsAwarded = true;
      pointsAwardedNew = true;
    }

    this.saveOrders(orders);

    const username = order.username;
    this.logActivity('admin', 'เปลี่ยนสถานะออร์เดอร์', `อัปเดตออร์เดอร์ ${orderId} ของ @${username} จาก [${oldStatus}] เป็น [${nextStatus}]`);

    // Supabase Async Write
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      status: nextStatus,
      pointsAwarded: pointsAwardedNew
    });

    return order;
  },

  adminRejectOrder(orderId) {
    const orders = this.getOrders();
    const orderIdx = orders.findIndex(o => o.id === orderId);
    if (orderIdx === -1) throw new Error('ไม่พบคำสั่งซื้อนี้ในระบบ');

    const order = orders[orderIdx];
    const oldStatus = order.status;
    order.status = 'Rejected';

    let pointsAwardedNew = order.pointsAwarded;
    if (order.pointsAwarded) {
      const users = this.getUsers();
      const userIdx = users.findIndex(u => u.username === order.username);
      if (userIdx !== -1) {
        users[userIdx].points = Math.max(0, users[userIdx].points - order.pointsEarned);
        this.saveUsers(users);
        
        // Supabase Async Write points rollback
        sbQuery(`ptom_users?username=eq.${encodeURIComponent(order.username)}`, 'PATCH', { points: users[userIdx].points });
      }
      order.pointsAwarded = false;
      pointsAwardedNew = false;
      this.logActivity('admin', 'หักแต้มคืนจากยกเลิกคำสั่งซื้อ', `หักคืนคะแนนสะสม -${order.pointsEarned} แต้ม ของลูกค้า @${order.username} จากออร์เดอร์ ${orderId}`);
    }

    this.saveOrders(orders);
    this.logActivity('admin', 'ปฏิเสธคำสั่งซื้อ', `ปฏิเสธออร์เดอร์ ${orderId} ของ @${order.username}`);
    this.syncCurrentUser(order.username);

    // Supabase Async Write
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      status: 'Rejected',
      pointsAwarded: pointsAwardedNew
    });

    return order;
  },

  // --- FRUIT MARKET ENGINE ---
  getFruitPrices() {
    return JSON.parse(localStorage.getItem('ptom_fruit_market'));
  }
};
