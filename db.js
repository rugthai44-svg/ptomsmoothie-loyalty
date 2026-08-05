// P'Tom's Smoothie Shop Local Storage Database & Logic Engine with Supabase Sync
// Full Architecture supporting Phase 1, Phase 2, and Phase 3 integrations

// Supabase Configuration
const SUPABASE_CONFIG = {
  url: 'https://bjddvnpdjqoicyprjojw.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqZGR2bnBkanFvaWN5cHJqb2p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NDIwOTEsImV4cCI6MjA5OTUxODA5MX0._iGBnLbb7o3JStH6dE4KaqC-k36bSyEvsPq3nFBrPw4'
};

// Global variables for Supabase SDK
let supabaseClient = null;
const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

// Async Script Loader for Supabase Client SDK
async function loadSupabaseSDK() {
  if (window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
    return;
  }
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SUPABASE_CDN;
    script.onload = () => {
      try {
        if (window.supabase) {
          supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
          console.log("Supabase Client SDK initialized successfully via CDN.");
        }
      } catch (e) {
        console.error("Failed to initialize Supabase client:", e);
      }
      resolve();
    };
    script.onerror = () => {
      console.warn("Supabase CDN failed to load. Operating in offline LocalStorage mode.");
      resolve();
    };
    document.head.appendChild(script);
  });
}

// Automatically load Supabase library in background
loadSupabaseSDK();

// --- DATA MAPPING HELPERS FOR SUPABASE ---
function mapUserToLocal(u) {
  if (!u) return null;
  return {
    username: u.username,
    fullName: u.full_name !== undefined ? u.full_name : (u.fullname !== undefined ? u.fullname : u.fullName),
    email: u.email,
    passwordHash: u.passwordhash !== undefined ? u.passwordhash : u.passwordHash,
    points: u.points_balance !== undefined ? u.points_balance : (u.points !== undefined ? u.points : 0),
    totalLifetimePoints: u.total_lifetime_points !== undefined ? u.total_lifetime_points : 0,
    phone: u.phone || '',
    birthDate: u.birth_date || '',
    role: u.role || 'customer',
    lineUserId: u.line_user_id || '',
    lineNotifyToken: u.line_notify_token !== undefined ? u.line_notify_token : (u.lineNotifyToken || ''),
    createdAt: u.created_at !== undefined ? u.created_at : u.createdAt
  };
}

function mapUserToSupabase(u) {
  if (!u) return null;
  return {
    username: u.username,
    full_name: u.fullName,
    email: u.email,
    passwordhash: u.passwordHash,
    points_balance: u.points,
    total_lifetime_points: u.totalLifetimePoints || u.points,
    phone: u.phone,
    birth_date: u.birthDate || null,
    role: u.role || 'customer',
    line_user_id: u.lineUserId || null,
    line_notify_token: u.lineNotifyToken || null,
    created_at: u.createdAt
  };
}

// REST Helper as fallback
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

// Background Synchronization
async function syncFromSupabase() {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.key) return;
  try {
    console.log('Background Syncing with Supabase...');
    
    // 1. Sync users
    const users = await sbQuery('ptom_users?select=*');
    if (users) {
      if (users.length === 0) {
        console.log('Supabase users table is empty, seeding...');
        const localUsers = JSON.parse(localStorage.getItem('ptom_users')) || [];
        for (const u of localUsers) {
          await sbQuery('ptom_users', 'POST', mapUserToSupabase(u));
        }
      } else {
        const mappedUsers = users.map(mapUserToLocal);
        localStorage.setItem('ptom_users', JSON.stringify(mappedUsers));
        
        // Sync current active user
        const curUser = localStorage.getItem('ptom_current_user');
        if (curUser) {
          const parsed = JSON.parse(curUser);
          const fresh = mappedUsers.find(u => u.username === parsed.username);
          if (fresh) {
            localStorage.setItem('ptom_current_user', JSON.stringify(fresh));
          }
        }
      }
    }

    // 2. Sync scans
    const scans = await sbQuery('ptom_scans?select=*&order=timestamp.desc');
    if (scans) {
      localStorage.setItem('ptom_scans', JSON.stringify(scans));
    }

    // 3. Sync redemptions
    const redemptions = await sbQuery('ptom_redemptions?select=*&order=timestamp.desc');
    if (redemptions) {
      localStorage.setItem('ptom_redemptions', JSON.stringify(redemptions));
    }

    // 4. Sync orders
    const orders = await sbQuery('ptom_orders?select=*&order=created_at.desc');
    if (orders) {
      // Map properties back
      const mappedOrders = orders.map(o => ({
        id: o.id,
        username: o.username,
        items: o.items,
        totalPrice: parseFloat(o.total_price),
        costPaid: parseFloat(o.cost_paid),
        pointsEarned: o.points_earned,
        pickupTime: o.pickup_time,
        notes: o.notes,
        status: o.status,
        slipImage: o.slip_url || '',
        pointsAwarded: o.points_awarded,
        isGroupOrder: o.is_group_order,
        timestamp: o.created_at
      }));
      localStorage.setItem('ptom_orders', JSON.stringify(mappedOrders));
    }

    // 5. Sync coupons
    const coupons = await sbQuery('ptom_user_coupons?select=*');
    if (coupons) {
      const mappedCoupons = coupons.map(c => ({
        id: c.id,
        username: c.username,
        title: c.title,
        couponType: c.coupon_type,
        isUsed: c.is_used,
        unlockedAt: c.unlocked_at,
        expiresAt: c.expires_at
      }));
      localStorage.setItem('ptom_user_coupons', JSON.stringify(mappedCoupons));
    }

    // 6. Sync gifts
    const gifts = await sbQuery('ptom_gifts?select=*');
    if (gifts) {
      const mappedGifts = gifts.map(g => ({
        id: g.id,
        senderUsername: g.sender_username,
        recipientEmail: g.recipient_email,
        giftCardTheme: g.gift_card_theme,
        items: g.items,
        isRedeemed: g.is_redeemed,
        redeemedBy: g.redeemed_by,
        redeemedAt: g.redeemed_at,
        createdAt: g.created_at
      }));
      localStorage.setItem('ptom_gifts', JSON.stringify(mappedGifts));
    }

    // 7. Sync products
    const products = await sbQuery('ptom_products?select=*');
    if (products && products.length > 0) {
      localStorage.setItem('ptom_products', JSON.stringify(products));
    }

    // Trigger UI updates
    window.dispatchEvent(new Event('storage'));
    console.log('Successfully synchronized with Supabase!');
  } catch (err) {
    console.error('Failed to background sync with Supabase:', err);
  }
}

// Database Seeding IIFE
(function initDatabase() {
  if (!localStorage.getItem('ptom_users')) {
    const seedUsers = [
      {
        username: 'somchai',
        fullName: 'สมชาย รักน้ำปั่น',
        email: 'somchai@gmail.com',
        passwordHash: '123456',
        points: 60,
        totalLifetimePoints: 60,
        phone: '0812345678',
        birthDate: '1995-08-15',
        role: 'customer',
        createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
      },
      {
        username: 'jane_healthy',
        fullName: 'เจน สายคลีน',
        email: 'jane@gmail.com',
        passwordHash: '123456',
        points: 150,
        totalLifetimePoints: 150,
        phone: '0898765432',
        birthDate: '1998-04-20',
        role: 'customer',
        createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
      }
    ];
    localStorage.setItem('ptom_users', JSON.stringify(seedUsers));
  }

  if (!localStorage.getItem('ptom_products')) {
    const seedProducts = [
      { id: '1', name: 'อะโวคาโดน้ำผึ้งปั่น', price: 75, category: 'Signature', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '2', name: 'สตรอว์เบอร์รีโยเกิร์ตปั่น', price: 65, category: 'Smoothies', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '3', name: 'มะม่วงเสาวรสปั่น', price: 60, category: 'Smoothies', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '4', name: 'มิกซ์เบอร์รีสมูทตี้', price: 70, category: 'Healthy', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '5', name: 'กล้วยหอมช็อกโกแลตโอ๊ตมิลค์', price: 80, category: 'Healthy', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '6', name: 'มะพร้าวน้ำหอมนมสดปั่น', price: 55, category: 'Smoothies', is_recommended: false, is_out_of_stock: false, image_url: '' }
    ];
    localStorage.setItem('ptom_products', JSON.stringify(seedProducts));
  }

  if (!localStorage.getItem('ptom_admin')) {
    localStorage.setItem('ptom_admin', JSON.stringify({
      email: 'admin@gmail.com',
      password: '1234',
      fullName: 'พี่ต้อม เจ้าของร้าน'
    }));
  }

  // Fallback defaults
  if (!localStorage.getItem('ptom_scans')) localStorage.setItem('ptom_scans', JSON.stringify([]));
  if (!localStorage.getItem('ptom_redemptions')) localStorage.setItem('ptom_redemptions', JSON.stringify([]));
  if (!localStorage.getItem('ptom_orders')) localStorage.setItem('ptom_orders', JSON.stringify([]));
  if (!localStorage.getItem('ptom_user_coupons')) localStorage.setItem('ptom_user_coupons', JSON.stringify([]));
  if (!localStorage.getItem('ptom_gifts')) localStorage.setItem('ptom_gifts', JSON.stringify([]));
  if (!localStorage.getItem('ptom_activity_logs')) localStorage.setItem('ptom_activity_logs', JSON.stringify([]));

  setTimeout(syncFromSupabase, 300);
})();

// Core DB Wrapper
const DB = {
  // --- AUTHENTICATION & SECURITY (PHASE 1) ---
  getUsers() {
    return JSON.parse(localStorage.getItem('ptom_users')) || [];
  },

  saveUsers(users) {
    localStorage.setItem('ptom_users', JSON.stringify(users));
    window.dispatchEvent(new Event('storage'));
  },

  signUp(fullName, username, email, password, phone = '', birthDate = '') {
    const users = this.getUsers();
    const formattedUsername = username.toLowerCase().trim();
    const formattedEmail = email.toLowerCase().trim();

    if (users.find(u => u.username === formattedUsername)) {
      throw new Error('ชื่อผู้ใช้งานนี้ถูกใช้ไปแล้ว');
    }
    if (users.find(u => u.email === formattedEmail)) {
      throw new Error('อีเมลนี้ถูกใช้ไปแล้ว');
    }

    const newUser = {
      username: formattedUsername,
      fullName: fullName.trim(),
      email: formattedEmail,
      passwordHash: password, 
      points: 0,
      totalLifetimePoints: 0,
      phone: phone.trim(),
      birthDate: birthDate,
      role: 'customer',
      lineUserId: '',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    this.saveUsers(users);
    this.logActivity(newUser.username, 'สมัครสมาชิก', 'เปิดบัญชีสมาชิกใหม่สำเร็จ (ลงทะเบียนข้อมูลพื้นฐาน)');

    // Award sign up coupon
    this.addCoupon(newUser.username, 'คูปองเลือกท็อปปิ้งฟรี 1 อย่าง (ต้อนรับสมาชิกใหม่)', 'free_topping', 30);

    // Supabase REST Call
    sbQuery('ptom_users', 'POST', mapUserToSupabase(newUser));
    
    // Automatically trigger quest progress
    this.updateQuestProgress(newUser.username, 'achievement_first_order', 0); // Initialize

    return newUser;
  },

  login(usernameOrEmail, password) {
    const users = this.getUsers();
    const normalizedInput = usernameOrEmail.toLowerCase().trim();
    const user = users.find(u => 
      (u.username === normalizedInput || u.email === normalizedInput) && 
      u.passwordHash === password
    );

    if (!user) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    localStorage.setItem('ptom_current_user', JSON.stringify(user));
    this.logActivity(user.username, 'เข้าสู่ระบบ', 'เข้าสู่ระบบสำเร็จ');
    
    // Trigger daily quest updates
    this.checkAndAwardBadges(user.username);
    
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
    const user = JSON.parse(userJson);
    const users = this.getUsers();
    const latestUser = users.find(u => u.username === user.username);
    if (latestUser) {
      localStorage.setItem('ptom_current_user', JSON.stringify(latestUser));
      return latestUser;
    }
    return user;
  },

  updateCurrentUserProfile(fullName, email, newPassword = null, phone = '', birthDate = '', lineUserId = '', lineNotifyToken = '') {
    const currentUser = this.getCurrentUser();
    if (!currentUser) throw new Error('กรุณาเข้าสู่ระบบก่อน');

    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === currentUser.username);
    if (userIdx === -1) throw new Error('ไม่พบข้อมูลผู้ใช้');

    if (email.toLowerCase().trim() !== currentUser.email.toLowerCase().trim()) {
      const emailDup = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim() && u.username !== currentUser.username);
      if (emailDup) throw new Error('อีเมลนี้ถูกใช้ไปแล้ว');
    }

    users[userIdx].fullName = fullName.trim();
    users[userIdx].email = email.toLowerCase().trim();
    users[userIdx].phone = phone.trim();
    users[userIdx].birthDate = birthDate;
    users[userIdx].lineUserId = lineUserId.trim();
    users[userIdx].lineNotifyToken = lineNotifyToken.trim();
    
    if (newPassword) {
      users[userIdx].passwordHash = newPassword;
    }

    this.saveUsers(users);
    localStorage.setItem('ptom_current_user', JSON.stringify(users[userIdx]));
    this.logActivity(currentUser.username, 'แก้ไขโปรไฟล์', 'อัปเดตข้อมูลส่วนตัวและวันเกิดสำเร็จ');

    // Supabase PATCH write
    const updatedFields = {
      full_name: users[userIdx].fullName,
      email: users[userIdx].email,
      phone: users[userIdx].phone,
      birth_date: users[userIdx].birthDate || null,
      line_user_id: users[userIdx].lineUserId || null,
      line_notify_token: users[userIdx].lineNotifyToken || null
    };
    if (newPassword) {
      updatedFields.passwordhash = newPassword;
    }
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(currentUser.username)}`, 'PATCH', updatedFields);
  },

  // --- LOYALTY POINTS & RANKS (PHASE 1 & 2) ---
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
    const oldLifetime = users[userIdx].totalLifetimePoints || oldPoints;
    
    users[userIdx].points += pointsGained;
    users[userIdx].totalLifetimePoints = oldLifetime + pointsGained;
    
    const newPoints = users[userIdx].points;
    const newLifetime = users[userIdx].totalLifetimePoints;

    this.saveUsers(users);

    // Save points log (using scans table)
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
      // Award achievement points
      if (newRank === 'Radiant (พี่ต้อมตัวจริง)') {
        this.updateQuestProgress(username, 'achievement_radiant_rank', 800);
      }
    }
    
    this.logActivity(username, 'ได้รับคะแนนสะสม', desc);

    // LINE Notification for Points Earned
    this.sendLineNotification(username, `ยินดีด้วย! คุณได้รับ +${pointsGained} แต้มสะสมจากกิจกรรม: "${description}" ตอนนี้คุณมียอดคะแนนสะสมรวมทั้งหมด ${newPoints} แต้มแล้วครับ! 🌟`);

    // Milestone Rewards trigger
    this.checkMilestoneRewards(username, oldLifetime, newLifetime);

    // Sync current user if logged in
    const curUser = this.getCurrentUser();
    if (curUser && curUser.username === username) {
      localStorage.setItem('ptom_current_user', JSON.stringify(users[userIdx]));
    }

    // Supabase patching
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(username)}`, 'PATCH', { 
      points_balance: newPoints,
      total_lifetime_points: newLifetime
    });
    
    sbQuery('ptom_scans', 'POST', {
      id: scanId,
      username,
      pointsgained: pointsGained,
      status: 'Success',
      description,
      photodata: photoData,
      timestamp: new Date().toISOString()
    });

    // Award Badges Check
    this.checkAndAwardBadges(username);

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

    const redeemId = 'REDEEM-' + Math.floor(100000 + Math.random() * 90000);
    const newRedemption = {
      id: redeemId,
      username,
      timestamp: new Date().toISOString(),
      pointsDeducted: 100,
      status: 'Redeemed',
      photoData
    };
    
    const redemptions = JSON.parse(localStorage.getItem('ptom_redemptions')) || [];
    redemptions.unshift(newRedemption);
    localStorage.setItem('ptom_redemptions', JSON.stringify(redemptions));

    this.logActivity(username, 'แลกรับรางวัล', 'แลกน้ำปั่นฟรี 1 แก้วสำเร็จ (ใช้ 100 แต้ม)');

    // LINE Notification for Reward Redemption
    this.sendLineNotification(username, `คุณได้ใช้แต้มสะสมแลกรางวัลคูปองน้ำปั่นฟรี 1 แก้วเรียบร้อยแล้ว! 🎁 รหัสการรับรางวัลของคุณคือ: ${redeemId} (กรุณาแสดงรหัสนี้ให้บาริสต้าหน้าร้านเพื่อรับเครื่องดื่ม)`);

    const curUser = this.getCurrentUser();
    if (curUser && curUser.username === username) {
      localStorage.setItem('ptom_current_user', JSON.stringify(users[userIdx]));
    }

    // Supabase integration
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(username)}`, 'PATCH', { points_balance: users[userIdx].points });
    
    sbQuery('ptom_redemptions', 'POST', {
      id: redeemId,
      username,
      points_deducted: 100,
      status: 'Redeemed',
      photo_data: photoData,
      timestamp: new Date().toISOString()
    });

    return redeemId;
  },

  // --- SMART ORDERING & SLIP VERIFICATION (PHASE 1) ---
  getPromptPayQR(amount) {
    const promptPayNumber = '0812345678'; // ร้านน้ำปั่นพี่ต้อม
    return `https://promptpay.io/${promptPayNumber}/${parseFloat(amount).toFixed(2)}.png`;
  },

  submitOrder(username, items, totalPrice, pointsEarned, pickupTime, notes = '', isGroupOrder = false, groupId = null) {
    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === username);
    if (userIdx === -1) throw new Error('ไม่พบข้อมูลผู้ใช้งาน');

    const orders = this.getOrders();
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 90000);
    
    const newOrder = {
      id: orderId,
      username,
      items,
      totalPrice: parseFloat(totalPrice),
      costPaid: 0, 
      pointsEarned: parseInt(pointsEarned),
      pickupTime,
      notes,
      status: 'Pending', 
      slipImage: '',     
      pointsAwarded: false, 
      isGroupOrder,
      groupId,
      timestamp: new Date().toISOString()
    };
    
    orders.unshift(newOrder);
    this.saveOrders(orders);

    // LINE Notification for Order Placed
    this.sendLineNotification(username, `คุณส่งคำสั่งจองเครื่องดื่มคิวใหม่สำเร็จแล้ว! 🍹 หมายเลขออร์เดอร์: ${orderId}\nยอดชำระรวม: ฿${totalPrice}\nเวลานัดรับ: ${pickupTime}\nกรุณาแนบภาพสลิปโอนเงินผ่านระบบเพื่อให้แอดมินเริ่มจัดเตรียมเครื่องดื่มครับ!`);
    
    this.logActivity(username, 'สั่งซื้อเครื่องดื่ม', `ส่งรายการสั่งซื้อออร์เดอร์ ${orderId} ยอดรวม ฿${totalPrice} (รับของเวลา ${pickupTime})`);

    // Supabase
    sbQuery('ptom_orders', 'POST', {
      id: orderId,
      username,
      items,
      total_price: totalPrice,
      cost_paid: 0,
      points_earned: pointsEarned,
      pickup_time: pickupTime,
      notes,
      status: 'Pending',
      is_group_order: isGroupOrder,
      group_id: groupId,
      created_at: new Date().toISOString()
    });

    // Alert Admin
    this.playAlertSound();

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
    this.logActivity(username, 'อัปโหลดสลิปชำระเงิน', `อัปโหลดสลิปสำหรับออร์เดอร์ ${orderId} และเรียกใช้ระบบตรวจสอบสลิปอัตโนมัติ`);

    // Trigger API Auto Slip Verification
    this.verifySlip(orderId, slipImage);

    // Supabase Async Write
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      slip_url: slipImage,
      status: 'Verifying'
    });

    return orders[orderIdx];
  },

  async verifySlip(orderId, slipImage) {
    // 1. Simulate API connection (SlipOK / EasySlip)
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const orders = this.getOrders();
    const orderIdx = orders.findIndex(o => o.id === orderId);
    if (orderIdx === -1) return;
    
    const order = orders[orderIdx];
    
    if (order.status !== 'Verifying') return;
    
    if (!slipImage) {
      order.status = 'Rejected';
      this.saveOrders(orders);
      this.logActivity(order.username, 'ตรวจสอบสลิปล้มเหลว', `ออร์เดอร์ ${orderId} ปฏิเสธเนื่องจากไม่มีรูปภาพสลิป`);
      return;
    }
    
    // Simulate transaction validation match
    const mockTxnNo = 'TXN' + Math.floor(100000000 + Math.random() * 900000000);
    order.status = 'Preparing';
    order.costPaid = order.totalPrice;
    
    // Auto award loyalty points
    if (!order.pointsAwarded) {
      const pointsEarned = order.pointsEarned || 10;
      this.addPoints(order.username, pointsEarned, `สะสมแต้มอัตโนมัติจากออร์เดอร์ ${orderId} (สลิปผ่านการอนุมัติอัตโนมัติ)`, slipImage);
      order.pointsAwarded = true;
    }
    
    this.saveOrders(orders);
    
    // Log Activity
    this.logActivity(order.username, 'ตรวจสอบสลิปสำเร็จ', `ออร์เดอร์ ${orderId} ตรวจพบรหัสธุรกรรม ${mockTxnNo} ยอดโอน ฿${order.totalPrice} ตรงตามยอดสั่งซื้อ`);
    
    // Send LINE messaging alerts
    this.sendLineNotification(order.username, `สลิปออร์เดอร์ ${orderId} ตรวจสอบสำเร็จ! บาริสต้ากำลังดำเนินการเตรียมเครื่องดื่มให้ท่าน 🥤`);

    // Trigger Quest
    this.updateQuestProgress(order.username, 'achievement_first_order', 1);
    this.updateQuestProgress(order.username, 'weekly_smoothie_5', 1);

    // Update Supabase
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      status: 'Preparing',
      cost_paid: order.totalPrice,
      points_awarded: true
    });
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
      const pointsEarned = order.pointsEarned || 10;
      this.addPoints(order.username, pointsEarned, `สะสมแต้มจากออร์เดอร์ ${orderId} (แอดมินอนุมัติสลิปด้วยตนเอง)`);
      order.pointsAwarded = true;
      pointsAwardedNew = true;
    }

    this.saveOrders(orders);
    this.logActivity('admin', 'เปลี่ยนสถานะออร์เดอร์', `อัปเดตออร์เดอร์ ${orderId} ของ @${order.username} จาก [${oldStatus}] เป็น [${nextStatus}]`);

    // LINE notification on ready/completed
    if (nextStatus === 'Ready') {
      this.sendLineNotification(order.username, `น้ำปั่นออร์เดอร์ ${orderId} ของคุณเสร็จเรียบร้อยแล้ว! มารับได้เลยที่เคาน์เตอร์ของร้านครับ 🏁`);
    } else if (nextStatus === 'Completed') {
      this.sendLineNotification(order.username, `ขอบคุณที่มาอุดหนุนร้านพี่ต้อมครับ! ออร์เดอร์ ${orderId} ได้รับเครื่องดื่มเรียบร้อยแล้ว หวังว่าจะชื่นชอบน้ำปั่นของเรานะคร้าบ 🥭`);
    }

    // Supabase Async Write
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      status: nextStatus,
      points_awarded: pointsAwardedNew
    });

    return order;
  },

  adminRejectOrder(orderId) {
    const orders = this.getOrders();
    const orderIdx = orders.findIndex(o => o.id === orderId);
    if (orderIdx === -1) throw new Error('ไม่พบคำสั่งซื้อนี้ในระบบ');

    const order = orders[orderIdx];
    order.status = 'Rejected';

    let pointsAwardedNew = order.pointsAwarded;
    if (order.pointsAwarded) {
      const users = this.getUsers();
      const userIdx = users.findIndex(u => u.username === order.username);
      if (userIdx !== -1) {
        users[userIdx].points = Math.max(0, users[userIdx].points - order.pointsEarned);
        this.saveUsers(users);
        sbQuery(`ptom_users?username=eq.${encodeURIComponent(order.username)}`, 'PATCH', { points_balance: users[userIdx].points });
      }
      order.pointsAwarded = false;
      pointsAwardedNew = false;
      this.logActivity('admin', 'หักแต้มคืนจากยกเลิกคำสั่งซื้อ', `หักคืนคะแนนสะสม -${order.pointsEarned} แต้ม ของลูกค้า @${order.username} จากการคืนออร์เดอร์ ${orderId}`);
    }

    this.saveOrders(orders);
    this.logActivity('admin', 'ปฏิเสธคำสั่งซื้อ', `ปฏิเสธออร์เดอร์ ${orderId} ของ @${order.username}`);
    this.syncCurrentUser(order.username);

    this.sendLineNotification(order.username, `ขออภัยด้วยครับ ออร์เดอร์ ${orderId} ของคุณไม่ได้รับอนุมัติเนื่องจากข้อมูลการโอนเงินไม่ถูกต้อง กรุณาติดต่อแอดมินหรือสั่งใหม่อีกครั้งครับ`);

    // Supabase
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      status: 'Rejected',
      points_awarded: pointsAwardedNew
    });

    return order;
  },

  // --- Real-time Alerts / Sound Generator ---
  playAlertSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // Note A5
      gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
      
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.35);
    } catch (e) {
      console.warn("AudioContext block by user interaction. Visual alerts still blinking.");
    }
  },

  // --- LINE Messaging Service ---
  async sendLineNotification(username, message) {
    console.log(`[LINE Notify API] @${username} <- "${message}"`);
    const logs = JSON.parse(localStorage.getItem('ptom_line_notifications')) || [];
    logs.unshift({
      username,
      message,
      timestamp: new Date().toISOString()
    });
    localStorage.setItem('ptom_line_notifications', JSON.stringify(logs));
    
    // Increment unread count for simulator
    const unreadKey = `ptom_line_unread_${username}`;
    const curUnread = parseInt(localStorage.getItem(unreadKey)) || 0;
    localStorage.setItem(unreadKey, (curUnread + 1).toString());
    
    window.dispatchEvent(new Event('storage'));

    const user = this.getUsers().find(u => u.username === username);

    // 1. Real LINE Notify API Integration (via CORS Proxy)
    if (user && user.lineNotifyToken && user.lineNotifyToken.trim().length > 0 && user.lineNotifyToken.trim().length < 60) {
      const notifyUrl = 'http://localhost:8080/?url=' + encodeURIComponent('https://notify-api.line.me/api/notify');
      try {
        const response = await fetch(notifyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${user.lineNotifyToken.trim()}`
          },
          body: new URLSearchParams({
            message: message
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }
        console.log(`[LINE Notify API] Successfully sent real message via LINE Notify Token.`);
      } catch (err) {
        console.error('[LINE Notify API] Failed to send notification via LINE Notify:', err);
        alert('ส่ง LINE Notify ไม่สำเร็จ: ' + err.message);
      }
    }

    // 2. Real LINE Messaging API Integration (via CORS Proxy)
    const token = localStorage.getItem('ptom_line_channel_access_token');
    if (user && user.lineUserId && token && token.trim().length > 60) {
      const lineUrl = 'http://localhost:8080/?url=' + encodeURIComponent('https://api.line.me/v2/bot/message/push');
      try {
        const response = await fetch(lineUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token.trim()}`
          },
          body: JSON.stringify({
            to: user.lineUserId.trim(),
            messages: [
              {
                type: 'text',
                text: message
              }
            ]
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }
        console.log(`[LINE Real API] Successfully sent real message to LINE User ID: ${user.lineUserId}`);
      } catch (err) {
        console.error('[LINE Real API] Failed to send real message to LINE API:', err);
        alert('ส่ง LINE Bot ไม่สำเร็จ: ' + err.message);
      }
    }
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
    sbQuery('ptom_activity_logs', 'POST', {
      username,
      action,
      details,
      timestamp: new Date().toISOString()
    });
  },

  getActivityLogs() {
    return JSON.parse(localStorage.getItem('ptom_activity_logs')) || [];
  },

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

  getOrders(username = null) {
    return JSON.parse(localStorage.getItem('ptom_orders')) || [];
  },

  saveOrders(orders) {
    localStorage.setItem('ptom_orders', JSON.stringify(orders));
    window.dispatchEvent(new Event('storage'));
  },

  // --- MILESTONE REWARDS & COUPONS (PHASE 2) ---
  getUserCoupons(username) {
    const coupons = JSON.parse(localStorage.getItem('ptom_user_coupons')) || [];
    return coupons.filter(c => c.username === username);
  },

  addCoupon(username, title, couponType, expiresAfterDays) {
    const coupons = JSON.parse(localStorage.getItem('ptom_user_coupons')) || [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresAfterDays);

    const newCoupon = {
      id: 'CPN-' + Math.floor(100000 + Math.random() * 90000),
      username,
      title,
      couponType,
      isUsed: false,
      unlockedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    coupons.unshift(newCoupon);
    localStorage.setItem('ptom_user_coupons', JSON.stringify(coupons));

    // Supabase Sync
    sbQuery('ptom_user_coupons', 'POST', {
      username,
      title,
      coupon_type: couponType,
      is_used: false,
      expires_at: expiresAt.toISOString()
    });

    return newCoupon;
  },

  useCoupon(couponId) {
    const coupons = JSON.parse(localStorage.getItem('ptom_user_coupons')) || [];
    const idx = coupons.findIndex(c => c.id === couponId);
    if (idx === -1) throw new Error('ไม่พบข้อมูลคูปองดังกล่าว');

    if (coupons[idx].isUsed) throw new Error('คูปองนี้ถูกใช้งานไปแล้ว');
    
    // Check expiry
    if (new Date() > new Date(coupons[idx].expiresAt)) {
      throw new Error('คูปองนี้หมดอายุการใช้งานแล้ว');
    }

    coupons[idx].isUsed = true;
    localStorage.setItem('ptom_user_coupons', JSON.stringify(coupons));

    this.logActivity(coupons[idx].username, 'ใช้งานคูปอง', `นำคูปอง [${coupons[idx].title}] มาแลกรับสิทธิ์ที่ร้าน`);

    // Supabase Update
    sbQuery(`ptom_user_coupons?id=eq.${encodeURIComponent(couponId)}`, 'PATCH', {
      is_used: true
    });

    return coupons[idx];
  },

  checkMilestoneRewards(username, oldLifetime, newLifetime) {
    if (oldLifetime < 5 && newLifetime >= 5) {
      this.addCoupon(username, 'เลือกท็อปปิ้งฟรี 1 อย่าง (สะสมครบ 5 แต้ม)', 'free_topping', 14);
      this.logActivity(username, 'ปลดล็อคคูปองพิเศษ', 'ปลดล็อคคูปอง Milestone 5 แต้มสำเร็จ');
    }
    if (oldLifetime < 9 && newLifetime >= 9) {
      // 2 days expiry countdown coupon
      this.addCoupon(username, 'ส่วนลด 10% (สะสมครบ 9 แต้ม - ใช้ภายใน 2 วัน)', 'discount_10', 2);
      this.logActivity(username, 'ปลดล็อคคูปองพิเศษ', 'ปลดล็อคคูปองส่วนลดด่วน Milestone 9 แต้มสำเร็จ (มีเวลาใช้ 2 วัน)');
    }
    if (oldLifetime < 10 && newLifetime >= 10) {
      this.addCoupon(username, 'น้ำปั่นฟรี 1 แก้ว (สะสมครบ 10 แต้ม)', 'free_smoothie', 30);
      this.logActivity(username, 'ปลดล็อคคูปองพิเศษ', 'ปลดล็อคคูปองแก้วฟรี Milestone 10 แต้มสำเร็จ');
    }
  },

  // --- QUESTS SYSTEM (PHASE 2) ---
  getQuests() {
    // Standard system static quests
    return [
      { id: 'daily_checkin', title: 'เช็คอินประจำวัน', desc: 'รับแต้มฟรีง่ายๆ เพียงกดปุ่มเช็คอินรายวัน', target: 1, points: 2, type: 'daily' },
      { id: 'weekly_smoothie_5', title: 'สั่งน้ำปั่นครบ 5 แก้ว', desc: 'สะสมการกินน้ำปั่นให้ครบ 5 แก้วในสัปดาห์นี้', target: 5, points: 15, type: 'weekly' },
      { id: 'achievement_first_order', title: 'จุดเริ่มต้นคนรักน้ำปั่น', desc: 'สั่งน้ำปั่นแก้วแรกผ่านแอปพลิเคชัน', target: 1, points: 5, type: 'achievement' },
      { id: 'achievement_radiant_rank', title: 'แรงค์สูงสุดของร้าน (Radiant)', desc: 'สะสมแต้มให้ถึง 800 เพื่อขึ้นสู่ระดับสูงสุด', target: 800, points: 100, type: 'achievement' }
    ];
  },

  getUserQuests(username) {
    const quests = this.getQuests();
    const userProgress = JSON.parse(localStorage.getItem(`ptom_quests_${username}`)) || {};
    
    return quests.map(q => {
      const progress = userProgress[q.id] || 0;
      return {
        ...q,
        progress: Math.min(progress, q.target),
        isCompleted: progress >= q.target
      };
    });
  },

  updateQuestProgress(username, questId, amount = 1) {
    const userProgress = JSON.parse(localStorage.getItem(`ptom_quests_${username}`)) || {};
    const quests = this.getQuests();
    const quest = quests.find(q => q.id === questId);
    if (!quest) return;

    const oldProgress = userProgress[questId] || 0;
    if (oldProgress >= quest.target) return; // Already finished

    const newProgress = oldProgress + amount;
    userProgress[questId] = newProgress;
    localStorage.setItem(`ptom_quests_${username}`, JSON.stringify(userProgress));

    // Sync to Supabase User Quests
    const users = this.getUsers();
    const user = users.find(u => u.username === username);
    if (user) {
      sbQuery('ptom_user_quests', 'POST', {
        username,
        quest_id: questId,
        progress: Math.min(newProgress, quest.target),
        is_completed: newProgress >= quest.target
      }, { 'Prefer': 'resolution=merge-duplicates' });
    }

    if (newProgress >= quest.target && oldProgress < quest.target) {
      // Quest Completed! Reward points
      this.addPoints(username, quest.points, `สำเร็จภารกิจ [${quest.title}] รับรางวัลพิเศษ`);
    }
  },

  dailyCheckin(username) {
    const streakKey = `ptom_streak_${username}`;
    const lastCheckinKey = `ptom_last_checkin_${username}`;
    
    const now = new Date();
    const lastCheckinStr = localStorage.getItem(lastCheckinKey);
    let streak = parseInt(localStorage.getItem(streakKey)) || 0;

    if (lastCheckinStr) {
      const lastCheckin = new Date(lastCheckinStr);
      const diffTime = now.getTime() - lastCheckin.getTime();
      const diffDays = diffTime / (1000 * 3600 * 24);
      
      if (diffDays < 1 && now.getDate() === lastCheckin.getDate()) {
        throw new Error('คุณเช็คอินวันนี้ไปแล้ว กรุณากลับมาใหม่พรุ่งนี้นะครับ!');
      } else if (diffDays < 2) {
        streak = (streak % 7) + 1; // Day 1 to 7
      } else {
        streak = 1; // Broken streak
      }
    } else {
      streak = 1;
    }

    localStorage.setItem(lastCheckinKey, now.toISOString());
    localStorage.setItem(streakKey, streak.toString());

    let pts = 2;
    let message = `เช็คอินสำเร็จวันที่ ${streak}/7 ได้รับ +2 แต้ม`;
    if (streak === 7) {
      pts = 7; // Bonus on day 7
      message = `โบนัสพิเศษ! เช็คอินต่อเนื่องครบ 7 วัน ได้รับรวม +7 แต้ม 🏆`;
    }

    this.addPoints(username, pts, `เช็คอินสะสมแต้มรายวัน วันที่ ${streak}`);
    this.updateQuestProgress(username, 'daily_checkin', 1);

    return { success: true, streak, pointsGained: pts, message };
  },

  luckySpin(username) {
    const lastSpinKey = `ptom_last_spin_${username}`;
    const now = new Date();
    const lastSpinStr = localStorage.getItem(lastSpinKey);

    if (lastSpinStr) {
      const lastSpin = new Date(lastSpinStr);
      if (now.toDateString() === lastSpin.toDateString()) {
        throw new Error('วันนี้คุณหมุนวงล้อไปแล้ว สิทธิ์สุ่มจะรีเซ็ตในวันพรุ่งนี้ครับ!');
      }
    }

    localStorage.setItem(lastSpinKey, now.toISOString());

    const prizes = [
      { type: 'points', value: 1, label: '+1 คะแนน' },
      { type: 'points', value: 3, label: '+3 คะแนน' },
      { type: 'points', value: 5, label: '+5 คะแนน' },
      { type: 'coupon', value: 'free_topping', label: 'คูปองแถมท็อปปิ้งฟรี' },
      { type: 'points', value: 10, label: 'บิ๊กแจ็กพอต +10 คะแนน! 🎉' },
      { type: 'points', value: 0, label: 'ขอบคุณที่ร่วมสนุก (สุ่มใหม่วันพรุ่งนี้)' }
    ];

    const spinValue = Math.random();
    let index = 0;
    if (spinValue < 0.40) index = 0;      // 1 Pt (40%)
    else if (spinValue < 0.70) index = 1; // 3 Pts (30%)
    else if (spinValue < 0.85) index = 2; // 5 Pts (15%)
    else if (spinValue < 0.93) index = 3; // Topping Coupon (8%)
    else if (spinValue < 0.98) index = 4; // Jackpot 10 Pts (5%)
    else index = 5;                       // Lose (2%)

    const prize = prizes[index];
    if (prize.type === 'points' && prize.value > 0) {
      this.addPoints(username, prize.value, `หมุนวงล้อนำโชคประจำวัน ได้รับรางวัล`);
    } else if (prize.type === 'coupon') {
      this.addCoupon(username, 'คูปองฟรีท็อปปิ้ง (รางวัลจากวงล้อนำโชค)', 'free_topping', 7);
    }

    this.logActivity(username, 'หมุนวงล้อสุ่มดวง', `หมุนวงล้อนำโชคสำเร็จ ได้รับ [${prize.label}]`);

    return prize;
  },

  // --- ACHIEVEMENT BADGES (PHASE 2) ---
  getBadges() {
    return [
      { id: 'smoothie_lover', title: 'แฟนพันธุ์แท้น้ำปั่น', desc: 'สั่งน้ำปั่นครบ 5 แก้วขึ้นไป', icon: '🥤' },
      { id: 'early_bird', title: 'ตื่นเช้ามาเติมวิตามิน', desc: 'สั่งน้ำปั่นก่อนเวลา 10:00 น. สำเร็จ', icon: '🌅' },
      { id: 'big_spender', title: 'สายเปย์พรีเมียม', desc: 'มียอดซื้อเครื่องดื่มสะสมทะลุ ฿500', icon: '💰' },
      { id: 'radiant_champion', title: 'ตระกูลพี่ต้อมตัวจริง', desc: 'ก้าวสู่ระดับ Radiant Rank', icon: '👑' }
    ];
  },

  getUserBadges(username) {
    const badges = this.getBadges();
    const unlocked = JSON.parse(localStorage.getItem(`ptom_badges_${username}`)) || [];
    return badges.map(b => ({
      ...b,
      isUnlocked: unlocked.includes(b.id)
    }));
  },

  checkAndAwardBadges(username) {
    const orders = this.getOrders().filter(o => o.username === username && o.status === 'Completed');
    const user = this.getUsers().find(u => u.username === username);
    if (!user) return;

    const unlocked = JSON.parse(localStorage.getItem(`ptom_badges_${username}`)) || [];
    const newlyUnlocked = [];

    // Check 1: Smoothie Lover
    if (!unlocked.includes('smoothie_lover') && orders.length >= 5) {
      newlyUnlocked.push('smoothie_lover');
    }

    // Check 2: Big Spender
    const totalSpend = orders.reduce((sum, o) => sum + o.totalPrice, 0);
    if (!unlocked.includes('big_spender') && totalSpend >= 500) {
      newlyUnlocked.push('big_spender');
    }

    // Check 3: Radiant Champion
    if (!unlocked.includes('radiant_champion') && user.points >= 800) {
      newlyUnlocked.push('radiant_champion');
    }

    if (newlyUnlocked.length > 0) {
      const merged = [...unlocked, ...newlyUnlocked];
      localStorage.setItem(`ptom_badges_${username}`, JSON.stringify(merged));
      
      newlyUnlocked.forEach(badgeId => {
        const bInfo = this.getBadges().find(b => b.id === badgeId);
        this.logActivity(username, 'ปลดล็อคเหรียญตราเกียรติยศ', `ได้รับเหรียญตรา ${bInfo.icon} ${bInfo.title} ติดตัวเรียบร้อย!`);
        
        // Supabase Badge Logging
        sbQuery('ptom_user_badges', 'POST', {
          username,
          badge_id: badgeId,
          unlocked_at: new Date().toISOString()
        });
      });
    }
  },

  // --- SOCIAL ORDERING & GIFTS (PHASE 3) ---
  createGroupOrder(username) {
    const groupId = 'GRP-' + Math.floor(100000 + Math.random() * 90000);
    this.logActivity(username, 'ตั้งกลุ่มสั่งเครื่องดื่ม', `สร้างลิงก์สั่งซื้อรวมกลุ่มออฟฟิศ รหัสกลุ่ม: ${groupId}`);
    return groupId;
  },

  sendGift(senderUsername, recipientEmail, items, theme = 'Standard') {
    const sender = this.getUsers().find(u => u.username === senderUsername);
    if (!sender) throw new Error('ไม่พบข้อมูลผู้ส่งในระบบ');

    const gifts = JSON.parse(localStorage.getItem('ptom_gifts')) || [];
    const giftId = 'GIFT-' + Math.floor(100000 + Math.random() * 90000);

    const newGift = {
      id: giftId,
      senderUsername,
      recipientEmail: recipientEmail.toLowerCase().trim(),
      giftCardTheme: theme,
      items,
      isRedeemed: false,
      redeemedBy: null,
      redeemedAt: null,
      createdAt: new Date().toISOString()
    };

    gifts.unshift(newGift);
    localStorage.setItem('ptom_gifts', JSON.stringify(gifts));

    this.logActivity(senderUsername, 'ส่งของขวัญให้นมสั่น', `ทำการซื้อเครื่องดื่มเพื่อส่งของขวัญให้เพื่อน E-mail: ${recipientEmail}`);

    // Supabase
    sbQuery('ptom_gifts', 'POST', {
      id: giftId,
      sender_username: senderUsername,
      recipient_email: recipientEmail,
      gift_card_theme: theme,
      items,
      is_redeemed: false,
      created_at: new Date().toISOString()
    });

    return newGift;
  },

  claimGift(giftId, recipientUsername) {
    const gifts = JSON.parse(localStorage.getItem('ptom_gifts')) || [];
    const idx = gifts.findIndex(g => g.id === giftId);
    if (idx === -1) throw new Error('ไม่พบรหัสของขวัญดังกล่าว');

    const gift = gifts[idx];
    if (gift.isRedeemed) throw new Error('ของขวัญนี้ถูกแลกรับไปเรียบร้อยแล้ว');

    const user = this.getUsers().find(u => u.username === recipientUsername);
    if (!user) throw new Error('ไม่พบข้อมูลบัญชีผู้รับสิทธิ์');

    // Redeem
    gift.isRedeemed = true;
    gift.redeemedBy = recipientUsername;
    gift.redeemedAt = new Date().toISOString();
    localStorage.setItem('ptom_gifts', JSON.stringify(gifts));

    // Submit automatic free order
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 90000);
    const orders = this.getOrders();
    const newOrder = {
      id: orderId,
      username: recipientUsername,
      items: gift.items,
      totalPrice: 0, 
      costPaid: 0,
      pointsEarned: 0, 
      pickupTime: 'รับทันทีหน้าร้าน',
      notes: `ของขวัญพิเศษจากแคมเปญส่งให้เพื่อนโดย @${gift.senderUsername}`,
      status: 'Ready', // Instant pickup
      slipImage: 'GIFT_CARD',
      pointsAwarded: true,
      timestamp: new Date().toISOString()
    };

    orders.unshift(newOrder);
    this.saveOrders(orders);

    this.logActivity(recipientUsername, 'แลกสิทธิ์ของขวัญ', `แลกของขวัญจากการส่งต่อของ @${gift.senderUsername} ออกเป็นออร์เดอร์สำเร็จ`);

    // Supabase Gift redemption
    sbQuery(`ptom_gifts?id=eq.${encodeURIComponent(giftId)}`, 'PATCH', {
      is_redeemed: true,
      redeemed_by: user.username,
      redeemed_at: new Date().toISOString()
    });

    sbQuery('ptom_orders', 'POST', {
      id: orderId,
      username: recipientUsername,
      items: gift.items,
      total_price: 0,
      cost_paid: 0,
      pickup_time: 'รับทันทีหน้าร้าน',
      notes: `ของขวัญพิเศษจากแคมเปญส่งให้เพื่อนโดย @${gift.senderUsername}`,
      status: 'Ready',
      slip_url: 'GIFT_CARD',
      points_awarded: true,
      created_at: new Date().toISOString()
    });

    return newOrder;
  },

  // --- ADMIN MARKETING & PRODUCT CONTROL (PHASE 3) ---
  getProducts() {
    return JSON.parse(localStorage.getItem('ptom_products')) || [];
  },

  saveProducts(products) {
    localStorage.setItem('ptom_products', JSON.stringify(products));
    window.dispatchEvent(new Event('storage'));
  },

  toggleProductStock(productId) {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === productId);
    if (idx === -1) throw new Error('ไม่พบเมนูนี้ในระบบ');

    products[idx].is_out_of_stock = !products[idx].is_out_of_stock;
    this.saveProducts(products);

    this.logActivity('admin', 'แก้ไขสถานะสต็อกเมนู', `เปลี่ยนสินค้า [${products[idx].name}] เป็น [${products[idx].is_out_of_stock ? 'หมดชั่วคราว' : 'พร้อมขาย'}]`);

    // Supabase PATCH
    sbQuery(`ptom_products?id=eq.${encodeURIComponent(productId)}`, 'PATCH', {
      is_out_of_stock: products[idx].is_out_of_stock
    });

    return products[idx];
  },

  toggleProductRecommendation(productId) {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === productId);
    if (idx === -1) throw new Error('ไม่พบเมนูนี้ในระบบ');

    products[idx].is_recommended = !products[idx].is_recommended;
    this.saveProducts(products);

    this.logActivity('admin', 'แก้ไขสินค้าแนะนำประจำวัน', `เปลี่ยนเมนูแนะนำ [${products[idx].name}] เป็น [${products[idx].is_recommended ? 'แนะนำ' : 'ทั่วไป'}]`);

    // Supabase PATCH
    sbQuery(`ptom_products?id=eq.${encodeURIComponent(productId)}`, 'PATCH', {
      is_recommended: products[idx].is_recommended
    });

    return products[idx];
  },

  // --- MOCK LINE NOTIFICATION SIMULATOR ---
  initLineSimulator() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    const path = window.location.pathname.toLowerCase();
    if (path.includes('admin-') || path.includes('login.html') || path.includes('forgot-password.html') || path.includes('create-account.html')) {
      return;
    }
    
    const currentUser = this.getCurrentUser();
    if (!currentUser) return;
    
    if (document.getElementById('line-simulator-container')) return;

    const container = document.createElement('div');
    container.id = 'line-simulator-container';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '24px';
    container.style.zIndex = '9999';

    const style = document.createElement('style');
    style.innerHTML = `
      #line-simulator-btn {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: #06C755;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 16px rgba(6, 199, 85, 0.4);
        position: relative;
        transition: transform 0.2s ease, background-color 0.2s ease;
        border: none;
        outline: none;
      }
      #line-simulator-btn:hover {
        transform: scale(1.05);
        background: #05b24c;
      }
      #line-simulator-btn:active {
        transform: scale(0.95);
      }
      #line-simulator-btn svg {
        width: 28px;
        height: 28px;
        fill: #fff;
      }
      #line-simulator-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        background: #ff3860;
        color: #fff;
        font-size: 0.65rem;
        font-weight: bold;
        padding: 3px 7px;
        border-radius: 10px;
        box-shadow: 0 2px 6px rgba(255, 56, 96, 0.4);
        display: none;
      }
      #line-simulator-chat {
        position: absolute;
        bottom: 72px;
        right: 0;
        width: 320px;
        height: 420px;
        border-radius: 16px;
        background: #abc3d2;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        display: none;
        flex-direction: column;
        overflow: hidden;
      }
      #line-simulator-header {
        background: #2b3b4c;
        color: #fff;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      #line-simulator-header-title {
        font-weight: bold;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #line-simulator-header-close {
        cursor: pointer;
        color: rgba(255,255,255,0.6);
        font-size: 1.25rem;
        transition: color 0.2s;
        background: none;
        border: none;
      }
      #line-simulator-header-close:hover {
        color: #fff;
      }
      #line-simulator-body {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .line-msg-bubble {
        background: #fff;
        color: #1c1c1e;
        padding: 10px 14px;
        border-radius: 14px;
        max-width: 80%;
        font-size: 0.82rem;
        align-self: flex-start;
        box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        line-height: 1.4;
        position: relative;
      }
      .line-msg-bubble::before {
        content: '';
        position: absolute;
        top: 10px;
        left: -6px;
        width: 0;
        height: 0;
        border-right: 8px solid #fff;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
      }
      .line-msg-time {
        font-size: 0.6rem;
        color: #8e8e93;
        margin-top: 5px;
        text-align: right;
      }
      #line-simulator-empty {
        text-align: center;
        color: #556;
        font-size: 0.8rem;
        margin: auto;
        padding: 0 20px;
        line-height: 1.5;
      }
    `;
    document.head.appendChild(style);

    container.innerHTML = `
      <div id="line-simulator-chat">
        <div id="line-simulator-header">
          <div id="line-simulator-header-title">
            <span style="display:inline-block; width:8px; height:8px; background:#39ff14; border-radius:50%; box-shadow:0 0 6px #39ff14;"></span>
            LINE Notify (จำลอง)
          </div>
          <button id="line-simulator-header-close">×</button>
        </div>
        <div id="line-simulator-body">
          <!-- Messages loaded here -->
        </div>
      </div>
      <button id="line-simulator-btn">
        <div id="line-simulator-badge">0</div>
        <svg viewBox="0 0 24 24">
          <path d="M22 10.3c0-4.3-4.5-7.8-10-7.8S2 6 2 10.3c0 3.8 3.6 7 8.5 7.7.3.1.8.2.9.5l.2 1.3c0 .3.1.8-.1.9-.2.2-.5.1-.7 0l-1.4-.9c-3-1.6-4.6-4.1-4.6-6.6 0-3.8 3.8-6.8 8.7-6.8s8.7 3 8.7 6.8c0 3.7-3.7 6.8-8.7 6.8h-.1l-.1-.1v1c0 2 1.7 3.5 3.5 3.5.7 0 1.3-.2 1.8-.6 2.8-2 4.4-4.8 4.4-8zm-12.7.2v-3.2c0-.3-.2-.5-.5-.5s-.5.2-.5.5v3.2c0 .3.2.5.5.5s.5-.2.5-.5zm2.7-3.2c0-.3-.2-.5-.5-.5h-1.5c-.3 0-.5.2-.5.5v3.2c0 .3.2.5.5.5h1.5c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-1v-.6h1c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-1v-.6h1c.3 0 .5-.2.5-.5zm2.6 0c0-.3-.2-.5-.5-.5h-1c-.3 0-.5.2-.5.5v3.2c0 .3.2.5.5.5h1c.3 0 .5-.2.5-.5s-.2-.5-.5-.5h-.5v-2.2h.5c.3 0 .5-.2.5-.5zm2.8 0c0-.3-.2-.5-.5-.5h-1c-.3 0-.5.2-.5.5v3.2c0 .3.2.5.5.5s.5-.2.5-.5v-1l.7 1c.2.2.4.3.6.3s.5-.2.5-.5c0-.2-.1-.4-.2-.5l-.8-1.1.8-1.1c.1-.1.2-.3.2-.5 0-.3-.2-.5-.5-.5s-.4.1-.6.3l-.7 1v-1.3c0-.3-.2-.5-.5-.5z"/>
        </svg>
      </button>
    `;

    document.body.appendChild(container);

    const btn = document.getElementById('line-simulator-btn');
    const chat = document.getElementById('line-simulator-chat');
    const closeBtn = document.getElementById('line-simulator-header-close');
    const body = document.getElementById('line-simulator-body');
    const badge = document.getElementById('line-simulator-badge');

    btn.addEventListener('click', () => {
      const isVisible = chat.style.display === 'flex';
      chat.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible) {
        localStorage.setItem(`ptom_line_unread_${currentUser.username}`, '0');
        badge.style.display = 'none';
        body.scrollTop = body.scrollHeight;
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chat.style.display = 'none';
    });

    const updateMessages = () => {
      const allLogs = JSON.parse(localStorage.getItem('ptom_line_notifications')) || [];
      const userLogs = allLogs.filter(l => l.username === currentUser.username);
      
      body.innerHTML = '';
      
      if (userLogs.length === 0) {
        body.innerHTML = `
          <div id="line-simulator-empty">
            <div style="font-size: 2.2rem; margin-bottom: 8px;">💬</div>
            ไม่มีข้อความแจ้งเตือนใหม่ในขณะนี้<br>สถานะคิวน้ำปั่นจะแจ้งเตือนผ่านตรงนี้ครับ
          </div>
        `;
        return;
      }

      userLogs.slice().reverse().forEach(log => {
        const time = new Date(log.timestamp);
        const timeStr = time.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
        
        const bubble = document.createElement('div');
        bubble.className = 'line-msg-bubble';
        bubble.innerHTML = `
          <div>${log.message.replace(/\n/g, '<br>')}</div>
          <div class="line-msg-time">${timeStr}</div>
        `;
        body.appendChild(bubble);
      });
      body.scrollTop = body.scrollHeight;
    };

    const updateBadge = () => {
      const unread = parseInt(localStorage.getItem(`ptom_line_unread_${currentUser.username}`)) || 0;
      if (unread > 0) {
        badge.textContent = unread;
        badge.style.display = 'block';
      } else {
        badge.style.display = 'none';
      }
    };

    updateMessages();
    updateBadge();

    window.addEventListener('storage', () => {
      updateMessages();
      updateBadge();
    });
  }
};

// Auto-initialize LINE simulator on DOMContentLoaded
if (typeof window !== 'undefined') {
  const initLineSim = () => {
    setTimeout(() => {
      if (typeof DB !== 'undefined' && DB.initLineSimulator) {
        DB.initLineSimulator();
      }
    }, 150);
  };
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initLineSim);
  } else {
    initLineSim();
  }
}
