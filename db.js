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
    exp: u.exp !== undefined ? u.exp : 0,
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
    exp: u.exp || 0,
    phone: u.phone,
    birth_date: u.birthDate || null,
    role: u.role || 'customer',
    line_user_id: u.lineUserId || null,
    line_notify_token: u.lineNotifyToken || null,
    created_at: u.createdAt
  };
}

// Image compression helper for Base64 (webcam photos / file uploads)
async function compressBase64Image(base64Str, maxWidth = 500, quality = 0.6) {
  if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image/')) {
    return base64Str;
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      resolve(base64Str);
    };
    img.src = base64Str;
  });
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
    
    const isAdmin = localStorage.getItem('ptom_admin_session') === 'active';
    const curUserJson = localStorage.getItem('ptom_current_user');
    const currentUser = curUserJson ? JSON.parse(curUserJson) : null;
    const filterSuffix = (!isAdmin && currentUser && currentUser.username) ? `&username=eq.${encodeURIComponent(currentUser.username)}` : '';
    
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
        
        // Self-healing merge: Keep local points if they are higher (e.g. from offline local checkin/spin)
        const localUsers = JSON.parse(localStorage.getItem('ptom_users')) || [];
        const mergedUsers = mappedUsers.map(remoteUser => {
          const localUser = localUsers.find(u => u.username.toLowerCase() === remoteUser.username.toLowerCase());
          if (localUser) {
            const keepLocal = (localUser.points > remoteUser.points) || (localUser.exp > remoteUser.exp);
            if (keepLocal) {
              console.log(`Sync: Keeping local points for @${localUser.username} (${localUser.points} vs remote ${remoteUser.points})`);
              // Sync back to Supabase in background
              sbQuery(`ptom_users?username=eq.${encodeURIComponent(localUser.username)}`, 'PATCH', {
                points_balance: localUser.points,
                total_lifetime_points: localUser.totalLifetimePoints,
                exp: localUser.exp
              });
              return localUser;
            }
          }
          return remoteUser;
        });

        localStorage.setItem('ptom_users', JSON.stringify(mergedUsers));
        
        // Sync current active user
        const curUser = localStorage.getItem('ptom_current_user');
        if (curUser) {
          const parsed = JSON.parse(curUser);
          const fresh = mergedUsers.find(u => u.username.toLowerCase() === parsed.username.toLowerCase());
          if (fresh) {
            localStorage.setItem('ptom_current_user', JSON.stringify(fresh));
          }
        }
      }
    }

    // 2. Sync scans
    const scans = await sbQuery('ptom_scans?select=*&order=timestamp.desc' + filterSuffix);
    if (scans) {
      const mappedScans = scans.map(s => ({
        id: s.id,
        username: s.username,
        pointsGained: s.pointsgained !== undefined ? s.pointsgained : s.pointsGained,
        status: s.status,
        description: s.description,
        photoData: s.photodata !== undefined ? s.photodata : s.photoData,
        timestamp: s.timestamp
      }));
      localStorage.setItem('ptom_scans', JSON.stringify(mappedScans));
    }

    // 3. Sync redemptions
    const redemptions = await sbQuery('ptom_redemptions?select=*&order=timestamp.desc' + filterSuffix);
    if (redemptions) {
      const mappedRedeems = redemptions.map(r => ({
        id: r.id,
        username: r.username,
        pointsDeducted: r.points_deducted !== undefined ? r.points_deducted : r.pointsDeducted,
        status: r.status,
        photoData: r.photo_data !== undefined ? r.photo_data : r.photoData,
        timestamp: r.timestamp
      }));
      localStorage.setItem('ptom_redemptions', JSON.stringify(mappedRedeems));
    }

    // 4. Sync orders
    const orders = await sbQuery('ptom_orders?select=*&order=created_at.desc' + filterSuffix);
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
    const coupons = await sbQuery('ptom_user_coupons?select=*' + filterSuffix);
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

    // 5b. Sync quests progress
    const userQuests = await sbQuery('ptom_user_quests?select=*' + filterSuffix);
    if (userQuests) {
      const progressByUsername = {};
      userQuests.forEach(uq => {
        if (!progressByUsername[uq.username]) {
          progressByUsername[uq.username] = {};
        }
        progressByUsername[uq.username][uq.quest_id] = uq.progress;
      });
      
      // Save for each user with self-healing merge (keeping higher progress)
      Object.keys(progressByUsername).forEach(uname => {
        const localProgress = JSON.parse(localStorage.getItem(`ptom_quests_${uname}`)) || {};
        const mergedProgress = { ...localProgress };
        
        Object.keys(progressByUsername[uname]).forEach(qid => {
          const remoteProg = progressByUsername[uname][qid];
          const localProg = localProgress[qid] || 0;
          mergedProgress[qid] = Math.max(localProg, remoteProg);
        });

        localStorage.setItem(`ptom_quests_${uname}`, JSON.stringify(mergedProgress));
      });
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
    if (products) {
      if (products.length > 0 && products.length <= 6) {
        // Seeding full list including Cold & Hot to Supabase
        const fullSeeds = [
          { name: 'ชาเขียวมัทฉะเย็น', price: 35.00, category: 'Tea', is_recommended: true, is_out_of_stock: false, image_url: '' },
          { name: 'โกโก้ดาร์กพรีเมียมเย็น', price: 35.00, category: 'Cold', is_recommended: false, is_out_of_stock: false, image_url: '' },
          { name: 'อเมริกาโน่น้ำส้มเย็น', price: 45.00, category: 'Coffee', is_recommended: true, is_out_of_stock: false, image_url: '' },
          { name: 'นมสดคาราเมลเย็น', price: 35.00, category: 'Cold', is_recommended: false, is_out_of_stock: false, image_url: '' },
          { name: 'น้ำผึ้งมะนาวโซดา', price: 35.00, category: 'Soda', is_recommended: false, is_out_of_stock: false, image_url: '' },
          { name: 'โกโก้ร้อนเข้มข้น', price: 35.00, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' },
          { name: 'เอสเพรสโซ่ร้อน', price: 30.00, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' },
          { name: 'ลาเต้ร้อน', price: 35.00, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' },
          { name: 'นมสดอุ่นน้ำผึ้ง', price: 30.00, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' }
        ];
        for (const item of fullSeeds) {
          const exists = products.some(p => p.name === item.name);
          if (!exists) {
            await sbQuery('ptom_products', 'POST', item);
          }
        }
        // Fetch again after POSTing
        const freshProducts = await sbQuery('ptom_products?select=*');
        if (freshProducts) {
          localStorage.setItem('ptom_products', JSON.stringify(freshProducts));
        }
      } else if (products.length > 0) {
        localStorage.setItem('ptom_products', JSON.stringify(products));
      }
    }

    // 8. Sync quests definition
    const remoteQuests = await sbQuery('ptom_quests?select=*');
    if (remoteQuests && remoteQuests.length > 0) {
      localStorage.setItem('ptom_quests_list', JSON.stringify(remoteQuests));
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
        exp: 60,
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
        exp: 150,
        phone: '0898765432',
        birthDate: '1998-04-20',
        role: 'customer',
        createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
      }
    ];
    localStorage.setItem('ptom_users', JSON.stringify(seedUsers));
  }

  if (!localStorage.getItem('ptom_products') || JSON.parse(localStorage.getItem('ptom_products')).length === 0) {
    const seedProducts = [
      { id: '1', name: 'อะโวคาโดน้ำผึ้งปั่น', price: 75, category: 'Signature', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '2', name: 'สตรอว์เบอร์รีโยเกิร์ตปั่น', price: 65, category: 'Smoothies', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '3', name: 'มะม่วงเสาวรสปั่น', price: 60, category: 'Smoothies', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '4', name: 'มิกซ์เบอร์รีสมูทตี้', price: 70, category: 'Healthy', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '5', name: 'กล้วยหอมช็อกโกแลตโอ๊ตมิลค์', price: 80, category: 'Healthy', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '6', name: 'มะพร้าวน้ำหอมนมสดปั่น', price: 55, category: 'Smoothies', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '7', name: 'ชาเขียวมัทฉะเย็น', price: 35, category: 'Tea', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '8', name: 'โกโก้ดาร์กพรีเมียมเย็น', price: 35, category: 'Cold', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '9', name: 'อเมริกาโน่น้ำส้มเย็น', price: 45, category: 'Coffee', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '10', name: 'นมสดคาราเมลเย็น', price: 35, category: 'Cold', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '11', name: 'น้ำผึ้งมะนาวโซดา', price: 35, category: 'Soda', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '12', name: 'โกโก้ร้อนเข้มข้น', price: 35, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '13', name: 'เอสเพรสโซ่ร้อน', price: 30, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '14', name: 'ลาเต้ร้อน', price: 35, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '15', name: 'นมสดอุ่นน้ำผึ้ง', price: 30, category: 'Hot', is_recommended: false, is_out_of_stock: false, image_url: '' },
      // Thai Seasonal Menu Addition
      { id: '16', name: 'สมูทตี้มะยงชิดโยเกิร์ต', price: 85, category: 'Seasonal', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '17', name: 'ทุเรียนหมอนทองน้ำกะทิปั่น', price: 120, category: 'Seasonal', is_recommended: true, is_out_of_stock: false, image_url: '' },
      { id: '18', name: 'ลิ้นจี่กุหลาบโซดาปั่น', price: 75, category: 'Seasonal', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '19', name: 'มะม่วงอกร่องน้ำกะทิปั่น', price: 80, category: 'Seasonal', is_recommended: false, is_out_of_stock: false, image_url: '' },
      { id: '20', name: 'กระท้อนลอยแก้วสมูทตี้', price: 79, category: 'Seasonal', is_recommended: false, is_out_of_stock: false, image_url: '' }
    ];
    localStorage.setItem('ptom_products', JSON.stringify(seedProducts));
  }

  if (!localStorage.getItem('ptom_admins')) {
    localStorage.setItem('ptom_admins', JSON.stringify([
      {
        admin_id: 1,
        admin_user: 'admin',
        admin_password: '1234',
        admin_name: 'สมชาย',
        admin_lastname: 'ใจดี',
        admin_idcard: '1234567890123',
        admin_tel: '0812345678',
        admin_address: 'ร้านสมูทตี้',
        admin_created: new Date().toISOString().split('T')[0]
      }
    ]));
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
    localStorage.removeItem('ptom_orders');
    localStorage.removeItem('ptom_scans');
    localStorage.removeItem('ptom_redemptions');
    localStorage.removeItem('ptom_user_coupons');
  },

  getCurrentUser() {
    const userJson = localStorage.getItem('ptom_current_user');
    if (!userJson) return null;
    const user = JSON.parse(userJson);
    const users = this.getUsers();
    const latestUser = users.find(u => u.username.toLowerCase() === user.username.toLowerCase());
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
    const userIdx = users.findIndex(u => u.username.toLowerCase() === currentUser.username.toLowerCase());
    if (userIdx === -1) throw new Error('ไม่พบข้อมูลผู้ใช้');

    if (email.toLowerCase().trim() !== currentUser.email.toLowerCase().trim()) {
      const emailDup = users.find(u => u.email.toLowerCase() === email.toLowerCase().trim() && u.username.toLowerCase() !== currentUser.username.toLowerCase());
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
    if (points >= 800) return { name: 'Radiant (ล้านน้ำปั่นตัวจริง)', class: 'rank-radiant', logo: '💎', nextThreshold: Infinity };
    if (points >= 500) return { name: 'Platinum', class: 'rank-platinum', logo: '✨', nextThreshold: 800 };
    if (points >= 300) return { name: 'Gold', class: 'rank-gold', logo: '👑', nextThreshold: 500 };
    if (points >= 100) return { name: 'Silver', class: 'rank-silver', logo: '🥈', nextThreshold: 300 };
    return { name: 'Bronze', class: 'rank-bronze', logo: '🥉', nextThreshold: 100 };
  },

  addPoints(username, pointsGained, description, photoData = '') {
    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
    if (userIdx === -1) return null;

    const oldPoints = users[userIdx].points;
    const oldLifetime = users[userIdx].totalLifetimePoints || oldPoints;
    const oldExp = users[userIdx].exp || 0;
    
    users[userIdx].points += pointsGained;
    users[userIdx].totalLifetimePoints = oldLifetime + pointsGained;
    users[userIdx].exp = oldExp + pointsGained;
    
    const newPoints = users[userIdx].points;
    const newLifetime = users[userIdx].totalLifetimePoints;
    const newExp = users[userIdx].exp;

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
    const oldRank = this.getRank(oldExp).name;
    const newRank = this.getRank(newExp).name;
    let desc = `${description} +${pointsGained} แต้ม (ยอดรวม: ${newPoints} แต้ม, EXP รวม: ${newExp} EXP)`;
    
    if (oldRank !== newRank) {
      desc += ` เลื่อนระดับแรงค์เป็น ${newRank}!`;
      // Award achievement points
      if (newRank === 'Radiant (ล้านน้ำปั่นตัวจริง)') {
        this.updateQuestProgress(username, 'achievement_radiant_rank', 800);
      }
    }
    
    this.logActivity(username, 'ได้รับคะแนนสะสม', desc);

    // LINE Notification for Points Earned
    this.sendLineNotification(username, `ยินดีด้วย! คุณได้รับ +${pointsGained} แต้มสะสม และ +${pointsGained} EXP จากกิจกรรม: "${description}" ตอนนี้คุณมี ${newPoints} แต้มสะสม และ ${newExp} EXP แล้วครับ! 🌟`);

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
      total_lifetime_points: newLifetime,
      exp: newExp
    });
    
    compressBase64Image(photoData).then(compressed => {
      sbQuery('ptom_scans', 'POST', {
        id: scanId,
        username,
        pointsgained: pointsGained,
        status: 'Success',
        description,
        photodata: compressed,
        timestamp: new Date().toISOString()
      });
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
    
    compressBase64Image(photoData).then(compressed => {
      sbQuery('ptom_redemptions', 'POST', {
        id: redeemId,
        username,
        points_deducted: 100,
        status: 'Redeemed',
        photo_data: compressed,
        timestamp: new Date().toISOString()
      });
    });

    return redeemId;
  },

  redeemCustomReward(username, rewardType) {
    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
    if (userIdx === -1) throw new Error('ไม่พบชื่อผู้ใช้นี้');

    let pointsCost = 0;
    let couponTitle = '';
    let couponType = '';
    let expiresDays = 30;

    const dynamicRewards = this.getRewardItems();
    const dynamicRew = dynamicRewards.find(r => r.id === rewardType);

    if (dynamicRew) {
      pointsCost = dynamicRew.cost;
      couponTitle = `คูปอง${dynamicRew.title} (แลกรับ)`;
      couponType = dynamicRew.id;
    } else if (rewardType === 'free_topping') {
      pointsCost = 20;
      couponTitle = 'คูปองฟรีท็อปปิ้ง (แลกรับ)';
      couponType = 'free_topping';
      expiresDays = 14;
    } else if (rewardType === 'free_bakery') {
      pointsCost = 30;
      couponTitle = 'คูปองฟรีขนมขบเคี้ยว (แลกรับ)';
      couponType = 'free_bakery';
      expiresDays = 30;
    } else if (rewardType === 'discount_15') {
      pointsCost = 40;
      couponTitle = 'คูปองส่วนลด 15 ฿ (แลกรับ)';
      couponType = 'discount_15';
      expiresDays = 30;
    } else if (rewardType === 'discount_10') {
      pointsCost = 50;
      couponTitle = 'คูปองส่วนลด 10% (แลกรับ)';
      couponType = 'discount_10';
      expiresDays = 30;
    } else if (rewardType === 'free_snack') {
      pointsCost = 60;
      couponTitle = 'คูปองฟรีแซนวิช/เบเกอรี่ (แลกรับ)';
      couponType = 'free_snack';
      expiresDays = 30;
    } else if (rewardType === 'free_smoothie') {
      pointsCost = 100;
      couponTitle = 'คูปองน้ำปั่นฟรี 1 แก้ว (แลกรับ)';
      couponType = 'free_smoothie';
      expiresDays = 30;
    } else {
      throw new Error('ไม่พบประเภทของรางวัลนี้');
    }

    if (users[userIdx].points < pointsCost) {
      throw new Error(`แต้มสะสมไม่เพียงพอ ต้องใช้ ${pointsCost} แต้ม สำหรับการแลกรางวัลนี้`);
    }

    // Deduct points
    users[userIdx].points -= pointsCost;
    this.saveUsers(users);

    // Create the user coupon directly!
    const newCoupon = this.addCoupon(username, couponTitle, couponType, expiresDays);

    // Log redemption history (so it shows in their reward list)
    const redeemId = 'REDEEM-' + Math.floor(100000 + Math.random() * 90000);
    const newRedemption = {
      id: redeemId,
      username,
      timestamp: new Date().toISOString(),
      pointsDeducted: pointsCost,
      status: 'Redeemed',
      photoData: '' // No photo needed for digital coupon redemptions
    };

    const redemptions = JSON.parse(localStorage.getItem('ptom_redemptions')) || [];
    redemptions.unshift(newRedemption);
    localStorage.setItem('ptom_redemptions', JSON.stringify(redemptions));

    this.logActivity(username, 'แลกรับรางวัล', `แลกคูปอง [${couponTitle}] สำเร็จ (ใช้ ${pointsCost} แต้ม)`);

    // Update current user session
    const curUser = this.getCurrentUser();
    if (curUser && curUser.username.toLowerCase() === username.toLowerCase()) {
      localStorage.setItem('ptom_current_user', JSON.stringify(users[userIdx]));
    }

    // Supabase sync
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(username)}`, 'PATCH', { points_balance: users[userIdx].points });
    sbQuery('ptom_redemptions', 'POST', {
      id: redeemId,
      username,
      points_deducted: pointsCost,
      status: 'Redeemed',
      photo_data: '',
      timestamp: new Date().toISOString()
    });

    return {
      redeemId,
      coupon: newCoupon,
      pointsCost,
      currentPoints: users[userIdx].points
    };
  },


  // --- SMART ORDERING & SLIP VERIFICATION (PHASE 1) ---
  getPromptPayQR(amount) {
    const promptPayNumber = '0812345678'; // ล้านน้ำปั่น
    return `https://promptpay.io/${promptPayNumber}/${parseFloat(amount).toFixed(2)}.png`;
  },

  submitOrder(username, items, totalPrice, pointsEarned, pickupTime, notes = '', isGroupOrder = false, groupId = null, originalPrice = null, appliedPromo = '', discountAmount = 0) {
    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === username);
    if (userIdx === -1) throw new Error('ไม่พบข้อมูลผู้ใช้งาน');

    // If it's a user coupon, mark it as used
    if (appliedPromo) {
      const coupons = this.getUserCoupons(username);
      const coupon = coupons.find(c => {
        const idLower = c.id.toLowerCase();
        const promoLower = appliedPromo.trim().toLowerCase();
        if (idLower === promoLower) return true;
        const isRealUuid = idLower.includes('-') && !idLower.startsWith('cpn-');
        if (isRealUuid && `cpn-${idLower.split('-')[0]}` === promoLower) return true;
        return false;
      });
      if (coupon && !coupon.isUsed) {
        this.useCoupon(coupon.id);
      }
    }

    const orders = this.getOrders();
    const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 90000);
    
    const newOrder = {
      id: orderId,
      username,
      items,
      totalPrice: parseFloat(totalPrice),
      originalPrice: originalPrice !== null ? parseFloat(originalPrice) : parseFloat(totalPrice),
      appliedPromo: appliedPromo || '',
      discountAmount: parseFloat(discountAmount) || 0,
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
      notes: notes + (appliedPromo ? ` (โค้ด: ${appliedPromo} -฿${discountAmount})` : ''),
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
    compressBase64Image(slipImage).then(compressed => {
      sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
        slip_url: compressed,
        status: 'Verifying'
      });
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
      
      // Update quests progress when order is approved by admin
      this.updateQuestProgress(order.username, 'achievement_first_order', 1);
      this.updateQuestProgress(order.username, 'weekly_smoothie_5', 1);
    }

    this.saveOrders(orders);
    this.logActivity('admin', 'เปลี่ยนสถานะออร์เดอร์', `อัปเดตออร์เดอร์ ${orderId} ของ @${order.username} จาก [${oldStatus}] เป็น [${nextStatus}]`);

    // LINE notification on ready/completed
    if (nextStatus === 'Ready') {
      this.sendLineNotification(order.username, `น้ำปั่นออร์เดอร์ ${orderId} ของคุณเสร็จเรียบร้อยแล้ว! มารับได้เลยที่เคาน์เตอร์ของร้านครับ 🏁`);
    } else if (nextStatus === 'Completed') {
      this.sendLineNotification(order.username, `ขอบคุณที่มาอุดหนุนล้านน้ำปั่นครับ! ออร์เดอร์ ${orderId} ได้รับเครื่องดื่มเรียบร้อยแล้ว หวังว่าจะชื่นชอบน้ำปั่นของเรานะคร้าบ 🥭`);
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

  getRewardItems() {
    const existing = localStorage.getItem('ptom_reward_items');
    if (!existing) {
      const defaultRewards = [
        { id: 'free_topping', icon: '🔮', title: 'ฟรี ท็อปปิ้งเสริม', cost: 20, desc: 'เลือกท็อปปิ้ง ไข่มุกบุก / เมล็ดเจีย / เจลลี่ผลไม้ หรือเปลี่ยนนมสดเป็นนมโอ๊ตฟรี', actionText: 'แลกรับ (20 แต้ม)' },
        { id: 'free_bakery', icon: '🍪', title: 'ฟรี ขนมขบเคี้ยว', cost: 30, desc: 'แลกรับขนมขบเคี้ยว / คุกกี้ หรือเบเกอรี่ฟรี 1 ซอง (มูลค่าสูงสุด 40 ฿)', actionText: 'แลกรับ (30 แต้ม)' },
        { id: 'discount_15', icon: '💵', title: 'ส่วนลด 15 บาท', cost: 40, desc: 'คูปองส่วนลดมูลค่า 15 บาท สำหรับสั่งซื้อเครื่องดื่มแก้วโปรด (ไม่มีขั้นต่ำ)', actionText: 'แลกรับ (40 แต้ม)' },
        { id: 'discount_10', icon: '🎟️', title: 'ส่วนลดท้ายบิล 10%', cost: 50, desc: 'คูปองลดราคาสินค้า 10% ทั้งเมนูเครื่องดื่มและท็อปปิ้งเพิ่มเติม', actionText: 'แลกรับ (50 แต้ม)' },
        { id: 'free_snack', icon: '🥪', title: 'ฟรี แซนวิชอบร้อน', cost: 60, desc: 'แลกรับแซนวิชอบร้อน / ครัวซองต์อบชีสฟรี 1 ชิ้น (มูลค่าสูงสุด 60 ฿)', actionText: 'แลกรับ (60 แต้ม)' },
        { id: 'free_smoothie', icon: '🥤', title: 'น้ำปั่นฟรี 1 แก้ว', cost: 100, desc: 'คูปองแลกเครื่องดื่มน้ำปั่นฟรี 1 แก้ว (แลกที่หน้าร้านโดยต้องใช้ภาพถ่ายแก้วยืนยัน)', actionText: 'แลกสิทธิ์ (100 แต้ม)', redirect: 'redemption.html' }
      ];
      localStorage.setItem('ptom_reward_items', JSON.stringify(defaultRewards));
      return defaultRewards;
    }
    return JSON.parse(existing);
  },
  saveRewardItems(list) {
    localStorage.setItem('ptom_reward_items', JSON.stringify(list));
    window.dispatchEvent(new Event('storage'));
  },
  addRewardItem(icon, title, cost, desc, actionText, redirect = '') {
    const list = this.getRewardItems();
    const id = 'rew-' + Math.floor(100000 + Math.random() * 900000);
    const newItem = { id, icon, title, cost: parseInt(cost) || 0, desc, actionText, redirect };
    list.push(newItem);
    this.saveRewardItems(list);
    this.logActivity('admin', 'เพิ่มของรางวัลใหม่', `เพิ่มรางวัล [${title}] ราคา ${cost} แต้ม`);
    return newItem;
  },
  deleteRewardItem(id) {
    const list = this.getRewardItems();
    const filtered = list.filter(item => item.id !== id);
    if (list.length === filtered.length) throw new Error('ไม่พบของรางวัลนี้ในระบบ');
    const title = list.find(item => item.id === id).title;
    this.saveRewardItems(filtered);
    this.logActivity('admin', 'ลบของรางวัล', `ลบของรางวัล [${title}] ออกจากระบบ`);
  },
  getNews() {
    const existing = localStorage.getItem('ptom_news_list');
    if (!existing) {
      const defaultNews = [
        {
          id: '1',
          icon: '🎉',
          title: 'ฉลองเปิดตัวระบบสะสมแต้มแบบใหม่!',
          date: '11 ส.ค. 2569',
          desc: 'เพิ่มระบบแรงค์สะสมแต้มอัจฉริยะ ซื้อน้ำปั่นแก้วโปรดพร้อมสะสม EXP เพื่อเลื่อนแรงค์รับสิทธิพิเศษที่เหนือกว่า!'
        },
        {
          id: '2',
          icon: '🥭',
          title: 'เมนูพิเศษต้อนรับฤดูกาล: มะม่วงอกร่องทองพรีเมียมปั่น',
          date: '10 ส.ค. 2569',
          desc: 'มะม่วงอกร่องทองคัดพิเศษ หวานหอมกลมกล่อม ปั่นคู่กับโยเกิร์ตแท้ชั้นดี ลองเลยวันนี้ที่เมนูน้ำปั่น!'
        },
        {
          id: '3',
          icon: '🧪',
          title: 'เปิดห้องทดลองใหม่ Smoothie Lab!',
          date: '08 ส.ค. 2569',
          desc: 'คิดสูตรน้ำปั่นในฝันของคุณเอง เลือกวัตถุดิบและปรับแต่งระดับความหวานได้ตามใจชอบในหน้า Smoothie Lab 🧪'
        }
      ];
      localStorage.setItem('ptom_news_list', JSON.stringify(defaultNews));
      return defaultNews;
    }
    return JSON.parse(existing);
  },
  saveNews(list) {
    localStorage.setItem('ptom_news_list', JSON.stringify(list));
    window.dispatchEvent(new Event('storage'));
  },
  addNews(icon, title, date, desc) {
    const list = this.getNews();
    const id = 'news-' + Math.floor(100000 + Math.random() * 900000);
    const newItem = { id, icon, title, date, desc };
    list.unshift(newItem);
    this.saveNews(list);
    this.logActivity('admin', 'เพิ่มข่าวประชาสัมพันธ์', `เพิ่มข่าว [${title}]`);
    return newItem;
  },
  deleteNews(id) {
    const list = this.getNews();
    const filtered = list.filter(item => item.id !== id);
    if (list.length === filtered.length) throw new Error('ไม่พบข่าวนี้ในระบบ');
    const title = list.find(item => item.id === id).title;
    this.saveNews(filtered);
    this.logActivity('admin', 'ลบข่าวประชาสัมพันธ์', `ลบข่าว [${title}]`);
  },
  adminApproveRedemption(redeemId) {
    const redeems = this.getRedemptions();
    const idx = redeems.findIndex(r => r.id === redeemId);
    if (idx === -1) throw new Error('ไม่พบรายการแลกของรางวัลนี้');

    const redeem = redeems[idx];
    redeems[idx].status = 'Approved';
    localStorage.setItem('ptom_redemptions', JSON.stringify(redeems));
    window.dispatchEvent(new Event('storage'));

    this.logActivity('admin', 'อนุมัติการแลกรางวัล', `อนุมัติคำขอแลกรางวัล [${redeemId}] ของ @${redeem.username}`);
    this.sendLineNotification(redeem.username, `คำขอแลกรางวัลรหัส [${redeemId}] ได้รับการอนุมัติโดยบาริสต้าแล้ว ยินดีต้อนรับเครื่องดื่มแถมฟรีของคุณครับ! 🎉`);

    // Supabase Sync
    sbQuery(`ptom_redemptions?id=eq.${encodeURIComponent(redeemId)}`, 'PATCH', { status: 'Approved' });
    return redeems[idx];
  },
  adminRejectRedemption(redeemId) {
    const redeems = this.getRedemptions();
    const idx = redeems.findIndex(r => r.id === redeemId);
    if (idx === -1) throw new Error('ไม่พบรายการแลกของรางวัลนี้');

    const redeem = redeems[idx];
    const oldStatus = redeem.status;
    if (oldStatus === 'Rejected') throw new Error('รายการนี้ถูกปฏิเสธไปแล้ว');

    redeems[idx].status = 'Rejected';
    localStorage.setItem('ptom_redemptions', JSON.stringify(redeems));
    window.dispatchEvent(new Event('storage'));

    // Refund points to user
    const users = this.getUsers();
    const uIdx = users.findIndex(u => u.username.toLowerCase() === redeem.username.toLowerCase());
    if (uIdx !== -1) {
      users[uIdx].points += redeem.pointsDeducted;
      this.saveUsers(users);
      // Supabase write
      sbQuery(`ptom_users?username=eq.${encodeURIComponent(redeem.username)}`, 'PATCH', { points_balance: users[uIdx].points });
      this.syncCurrentUser(redeem.username);
    }

    this.logActivity('admin', 'ปฏิเสธการแลกรางวัล', `ปฏิเสธคำขอ [${redeemId}] คืนแต้มให้ลูกค้า ${redeem.pointsDeducted} แต้ม`);
    this.sendLineNotification(redeem.username, `ขออภัยด้วยครับ คำขอแลกรางวัลรหัส [${redeemId}] ของคุณไม่ได้รับอนุมัติ ระบบได้ทำการคืนคะแนนจำนวน ${redeem.pointsDeducted} แต้ม กลับเข้าบัญชีของคุณเรียบร้อยแล้วครับ ❌`);

    // Supabase Sync
    sbQuery(`ptom_redemptions?id=eq.${encodeURIComponent(redeemId)}`, 'PATCH', { status: 'Rejected' });
    return redeems[idx];
  },
  deleteRedemption(redeemId) {
    const redeems = this.getRedemptions();
    const filtered = redeems.filter(r => r.id !== redeemId);
    if (redeems.length === filtered.length) throw new Error('ไม่พบรายการแลกของรางวัลนี้');
    localStorage.setItem('ptom_redemptions', JSON.stringify(filtered));
    window.dispatchEvent(new Event('storage'));

    this.logActivity('admin', 'ลบประวัติแลกรางวัล', `ลบประวัติการแลกรางวัลรหัส [${redeemId}] ออกจากระบบ`);

    // Supabase Sync
    sbQuery(`ptom_redemptions?id=eq.${encodeURIComponent(redeemId)}`, 'DELETE');
  },

  getSpinPrizes() {
    const existing = localStorage.getItem('ptom_spin_prizes');
    if (!existing) {
      const defaultPrizes = [
        { id: 'p1', label: '+1 คะแนน', type: 'points', value: 1, weight: 40, color: '#121e33' },
        { id: 'p2', label: '+3 คะแนน', type: 'points', value: 3, weight: 30, color: '#00f0ff22' },
        { id: 'p3', label: '+5 คะแนน', type: 'points', value: 5, weight: 15, color: '#121e33' },
        { id: 'p4', label: 'ฟรีท็อปปิ้ง', type: 'coupon', value: 'free_topping', weight: 8, color: '#39ff1422' },
        { id: 'p5', label: 'แจ็กพอต 10!', type: 'points', value: 10, weight: 5, color: '#ff386055' },
        { id: 'p6', label: 'ขอบคุณค่ะ', type: 'points', value: 0, weight: 2, color: '#060b13' }
      ];
      localStorage.setItem('ptom_spin_prizes', JSON.stringify(defaultPrizes));
      return defaultPrizes;
    }
    return JSON.parse(existing);
  },
  saveSpinPrizes(list) {
    localStorage.setItem('ptom_spin_prizes', JSON.stringify(list));
    window.dispatchEvent(new Event('storage'));
  },
  addSpinPrize(label, type, value, weight, color) {
    const list = this.getSpinPrizes();
    const id = 'prize-' + Math.floor(100000 + Math.random() * 900000);
    const newPrize = {
      id,
      label: label.trim(),
      type,
      value: type === 'points' ? parseInt(value) || 0 : value.trim(),
      weight: parseFloat(weight) || 0,
      color: color.trim()
    };
    list.push(newPrize);
    this.saveSpinPrizes(list);
    this.logActivity('admin', 'เพิ่มรางวัลวงล้อนำโชค', `เพิ่มรางวัล [${label}] น้ำหนัก ${weight}`);
    return newPrize;
  },
  deleteSpinPrize(id) {
    const list = this.getSpinPrizes();
    const filtered = list.filter(p => p.id !== id);
    if (list.length === filtered.length) throw new Error('ไม่พบของรางวัลวงล้อนี้ในระบบ');
    const label = list.find(p => p.id === id).label;
    this.saveSpinPrizes(filtered);
    this.logActivity('admin', 'ลบรางวัลวงล้อนำโชค', `ลบรางวัล [${label}] ออกจากระบบ`);
  },

  // --- PROMO CODES & DISCOUNTS ---
  validatePromoCode(code, originalPrice, username = '', currentItemPrice = 0, currentToppingsPrice = 0) {
    if (!code) return { valid: false, message: 'กรุณากรอกรหัสส่วนลด' };
    const cleanCode = code.trim().toLowerCase();
    
    // 1. Check if it matches any user coupon ID (either UUID or CPN- prefix)
    if (username) {
      const coupons = this.getUserCoupons(username);
      const coupon = coupons.find(c => {
        const idLower = c.id.toLowerCase();
        if (idLower === cleanCode) return true;
        const isRealUuid = idLower.includes('-') && !idLower.startsWith('cpn-');
        if (isRealUuid && `cpn-${idLower.split('-')[0]}` === cleanCode) return true;
        return false;
      });
      
      if (coupon) {
        if (coupon.isUsed) {
          return { valid: false, message: 'คูปองนี้ถูกใช้งานไปแล้ว' };
        }
        if (new Date() > new Date(coupon.expiresAt)) {
          return { valid: false, message: 'คูปองนี้หมดอายุการใช้งานแล้ว' };
        }
        
        // Calculate coupon discount depending on type
        let discount = 0;
        let label = coupon.title;
        
        if (coupon.couponType === 'discount_10') {
          discount = originalPrice * 0.10;
          label = `ส่วนลด 10% (${coupon.title})`;
        } else if (coupon.couponType === 'discount_15') {
          discount = 15;
          label = `ส่วนลด 15 ฿ (${coupon.title})`;
        } else if (coupon.couponType === 'free_topping') {
          discount = currentToppingsPrice > 0 ? currentToppingsPrice : 10;
          label = `ฟรีท็อปปิ้ง (${coupon.title})`;
        } else if (coupon.couponType === 'free_bakery') {
          discount = currentItemPrice > 0 ? currentItemPrice : Math.min(originalPrice, 40);
          label = `ฟรีขนมขบเคี้ยว (${coupon.title})`;
        } else if (coupon.couponType === 'free_snack') {
          discount = currentItemPrice > 0 ? currentItemPrice : Math.min(originalPrice, 60);
          label = `ฟรีแซนวิช/เบเกอรี่ (${coupon.title})`;
        } else if (coupon.couponType === 'free_smoothie') {
          discount = currentItemPrice > 0 ? currentItemPrice : Math.min(originalPrice, 80);
          label = `ฟรีเครื่องดื่ม (${coupon.title})`;
        } else {
          discount = 10;
        }
        
        discount = Math.min(discount, originalPrice);
        const finalPrice = Math.max(0, originalPrice - discount);
        
        return {
          valid: true,
          discount,
          finalPrice,
          label,
          code: coupon.id, // Return exact coupon ID
          isUserCoupon: true,
          couponId: coupon.id
        };
      }
    }
    
    // 2. Static public promo codes
    const promoCodes = {
      'LAN10': { type: 'percent', value: 10, minPrice: 0, label: 'ส่วนลด 10%' },
      'SWEET20': { type: 'fixed', value: 20, minPrice: 40, label: 'ส่วนลด 20 ฿ (ขั้นต่ำ 40 ฿)' },
      'LAN': { type: 'fixed', value: 15, minPrice: 30, label: 'ส่วนลดพิเศษล้านน้ำปั่น 15 ฿' },
      'FREE50': { type: 'percent', value: 50, minPrice: 0, label: 'ส่วนลด 50%' },
      'NEWUSER': { type: 'percent', value: 15, minPrice: 0, label: 'ส่วนลดสำหรับลูกค้าใหม่ 15%' }
    };
    
    const promo = promoCodes[cleanCode.toUpperCase()];
    if (!promo) {
      return { valid: false, message: 'รหัสส่วนลดไม่ถูกต้อง' };
    }

    // Check if this user has already used this public promo code in their orders
    if (username) {
      const orders = this.getOrders(username);
      const alreadyUsed = orders.some(o => o.appliedPromo && o.appliedPromo.trim().toUpperCase() === cleanCode.toUpperCase() && o.status !== 'Rejected');
      if (alreadyUsed) {
        return { valid: false, message: `คุณเคยใช้งานรหัสส่วนลด [${cleanCode.toUpperCase()}] นี้ไปแล้ว` };
      }
    }
    
    if (originalPrice < promo.minPrice) {
      return { valid: false, message: `ยอดสั่งซื้อขั้นต่ำสำหรับการใช้รหัสนี้คือ ฿${promo.minPrice}` };
    }
    
    let discount = 0;
    if (promo.type === 'percent') {
      discount = originalPrice * (promo.value / 100);
    } else if (promo.type === 'fixed') {
      discount = promo.value;
    }
    
    discount = Math.min(discount, originalPrice);
    const finalPrice = Math.max(0, originalPrice - discount);
    
    return {
      valid: true,
      discount,
      finalPrice,
      label: promo.label,
      code: cleanCode,
      isUserCoupon: false
    };
  },

  applyPromoToOrder(orderId, code) {
    const orders = this.getOrders();
    const orderIdx = orders.findIndex(o => o.id === orderId);
    if (orderIdx === -1) throw new Error('ไม่พบคำสั่งซื้อนี้');
    
    const order = orders[orderIdx];
    if (order.status !== 'Pending') {
      throw new Error('ไม่สามารถใช้โค้ดส่วนลดกับออเดอร์นี้ได้เนื่องจากเลยขั้นตอนการจองแล้ว');
    }
    
    if (order.appliedPromo && order.appliedPromo.trim().length > 0) {
      throw new Error(`ออเดอร์นี้ได้ใช้โค้ดส่วนลด [${order.appliedPromo}] ไปแล้ว ไม่สามารถใช้ซ้ำได้`);
    }

    let currentItemPrice = order.totalPrice;
    let currentToppingsPrice = 0;
    
    const originalPrice = order.originalPrice || order.totalPrice;
    const result = this.validatePromoCode(code, originalPrice, order.username, currentItemPrice, currentToppingsPrice);
    if (!result.valid) {
      throw new Error(result.message);
    }
    
    // If it's a user coupon, mark it as used
    if (result.isUserCoupon && result.couponId) {
      this.useCoupon(result.couponId);
    }
    
    // Update order details
    order.originalPrice = originalPrice;
    order.totalPrice = result.finalPrice;
    order.appliedPromo = result.code;
    order.discountAmount = result.discount;
    
    const promoNote = `(โค้ด: ${result.code} -฿${result.discount.toFixed(2)})`;
    order.notes = order.notes ? `${order.notes} ${promoNote}` : promoNote;
    
    this.saveOrders(orders);
    
    this.logActivity(order.username, 'ใช้งานรหัสส่วนลด', `ใช้รหัสส่วนลด ${result.code} กับออร์เดอร์ ${orderId} ได้รับส่วนลด ฿${result.discount.toFixed(2)} ยอดชำระใหม่คือ ฿${result.finalPrice.toFixed(2)}`);
    
    // Supabase PATCH
    sbQuery(`ptom_orders?id=eq.${encodeURIComponent(orderId)}`, 'PATCH', {
      total_price: result.finalPrice,
      notes: order.notes
    });
    
    return {
      order,
      discount: result.discount,
      finalPrice: result.finalPrice,
      label: result.label
    };
  },

  // --- ADMIN AUTH & CONTROL ---
  adminLogin(username, password) {
    const admins = JSON.parse(localStorage.getItem('ptom_admins')) || [];
    const admin = admins.find(a => a.admin_user === username && a.admin_password === password);
    if (admin) {
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
    if (curUser && curUser.username.toLowerCase() === username.toLowerCase()) {
      const users = this.getUsers();
      const latestUser = users.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (latestUser) {
        localStorage.setItem('ptom_current_user', JSON.stringify(latestUser));
      }
    }
  },

  getOrders(username = null) {
    const orders = JSON.parse(localStorage.getItem('ptom_orders')) || [];
    if (username) {
      return orders.filter(o => o.username === username);
    }
    return orders;
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
    const existing = localStorage.getItem('ptom_quests_list');
    if (!existing) {
      const defaultQuests = [
        { id: 'daily_checkin', title: 'เช็คอินประจำวัน', desc: 'รับแต้มฟรีง่ายๆ เพียงกดปุ่มเช็คอินรายวัน', target_amount: 1, reward_points: 2, quest_type: 'daily' },
        { id: 'weekly_smoothie_5', title: 'สั่งน้ำปั่นครบ 5 แก้ว', desc: 'สะสมการกินน้ำปั่นให้ครบ 5 แก้วในสัปดาห์นี้', target_amount: 5, reward_points: 15, quest_type: 'weekly' },
        { id: 'achievement_first_order', title: 'จุดเริ่มต้นคนรักน้ำปั่น', desc: 'สั่งน้ำปั่นแก้วแรกผ่านแอปพลิเคชัน', target_amount: 1, reward_points: 5, quest_type: 'achievement' },
        { id: 'achievement_radiant_rank', title: 'แรงค์สูงสุดของร้าน (Radiant)', desc: 'สะสมแต้มให้ถึง 800 เพื่อขึ้นสู่ระดับสูงสุด', target_amount: 800, reward_points: 100, quest_type: 'achievement' }
      ];
      localStorage.setItem('ptom_quests_list', JSON.stringify(defaultQuests));
      return defaultQuests;
    }
    const list = JSON.parse(existing);
    return list.map(q => ({
      id: q.id,
      title: q.title,
      desc: q.description || q.desc,
      target: q.target_amount !== undefined ? q.target_amount : (q.target || 1),
      points: q.reward_points !== undefined ? q.reward_points : (q.points || 0),
      type: q.quest_type !== undefined ? q.quest_type : (q.type || 'daily')
    }));
  },
  saveQuests(list) {
    localStorage.setItem('ptom_quests_list', JSON.stringify(list));
    window.dispatchEvent(new Event('storage'));
  },
  addQuest(id, title, desc, target, points, type) {
    const list = JSON.parse(localStorage.getItem('ptom_quests_list')) || [];
    if (list.some(q => q.id === id)) throw new Error('มีรหัสเควสนี้อยู่แล้วในระบบ');
    const newQuest = {
      id: id.trim(),
      title: title.trim(),
      description: desc.trim(),
      target_amount: parseInt(target) || 1,
      reward_points: parseInt(points) || 0,
      quest_type: type
    };
    list.push(newQuest);
    this.saveQuests(list);
    this.logActivity('admin', 'เพิ่มเควสกิจกรรมใหม่', `เพิ่มเควส [${title}] รางวัล +${points} แต้ม`);
    
    // Supabase Sync
    sbQuery('ptom_quests', 'POST', newQuest);
    return newQuest;
  },
  deleteQuest(id) {
    const list = JSON.parse(localStorage.getItem('ptom_quests_list')) || [];
    const filtered = list.filter(q => q.id !== id);
    if (list.length === filtered.length) throw new Error('ไม่พบเควสนี้ในระบบ');
    const title = list.find(q => q.id === id).title;
    this.saveQuests(filtered);
    this.logActivity('admin', 'ลบเควสกิจกรรม', `ลบเควส [${title}] ออกจากระบบ`);
    
    // Supabase Sync
    sbQuery(`ptom_quests?id=eq.${encodeURIComponent(id)}`, 'DELETE');
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
    const streakKey = `ptom_streak_${username.toLowerCase()}`;
    const lastCheckinKey = `ptom_last_checkin_${username.toLowerCase()}`;
    
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
    const lastSpinKey = `ptom_last_spin_${username.toLowerCase()}`;
    const now = new Date();
    const lastSpinStr = localStorage.getItem(lastSpinKey);

    if (lastSpinStr) {
      const lastSpin = new Date(lastSpinStr);
      if (now.toDateString() === lastSpin.toDateString()) {
        throw new Error('วันนี้คุณหมุนวงล้อไปแล้ว สิทธิ์สุ่มจะรีเซ็ตในวันพรุ่งนี้ครับ!');
      }
    }

    localStorage.setItem(lastSpinKey, now.toISOString());

    const prizes = this.getSpinPrizes();
    if (prizes.length === 0) throw new Error('ระบบวงล้อยังไม่มีรายการของรางวัล');

    const totalWeight = prizes.reduce((acc, p) => acc + (parseFloat(p.weight) || 0), 0);
    if (totalWeight <= 0) throw new Error('ค่าน้ำหนักโอกาสสุ่มรวมต้องมากกว่า 0');

    let roll = Math.random() * totalWeight;
    let selectedPrize = null;
    let selectedIndex = 0;

    for (let i = 0; i < prizes.length; i++) {
      roll -= (parseFloat(prizes[i].weight) || 0);
      if (roll <= 0) {
        selectedPrize = prizes[i];
        selectedIndex = i;
        break;
      }
    }

    if (!selectedPrize) {
      selectedPrize = prizes[prizes.length - 1];
      selectedIndex = prizes.length - 1;
    }

    if (selectedPrize.type === 'points' && selectedPrize.value > 0) {
      this.addPoints(username, parseInt(selectedPrize.value) || 0, `หมุนวงล้อนำโชคประจำวัน ได้รับรางวัล`);
    } else if (selectedPrize.type === 'coupon') {
      this.addCoupon(username, `คูปอง${selectedPrize.label} (รางวัลจากวงล้อนำโชค)`, selectedPrize.value || 'free_topping', 7);
    }

    this.logActivity(username, 'หมุนวงล้อสุ่มดวง', `หมุนวงล้อนำโชคสำเร็จ ได้รับ [${selectedPrize.label}]`);

    return {
      label: selectedPrize.label,
      index: selectedIndex,
      type: selectedPrize.type,
      value: selectedPrize.value
    };
  },

  // --- ACHIEVEMENT BADGES (PHASE 2) ---
  getBadges() {
    return [
      { id: 'smoothie_lover', title: 'แฟนพันธุ์แท้น้ำปั่น', desc: 'สั่งน้ำปั่นครบ 5 แก้วขึ้นไป', icon: '🥤' },
      { id: 'early_bird', title: 'ตื่นเช้ามาเติมวิตามิน', desc: 'สั่งน้ำปั่นก่อนเวลา 10:00 น. สำเร็จ', icon: '🌅' },
      { id: 'big_spender', title: 'สายเปย์พรีเมียม', desc: 'มียอดซื้อเครื่องดื่มสะสมทะลุ ฿500', icon: '💰' },
      { id: 'radiant_champion', title: 'ล้านน้ำปั่นตัวจริง', desc: 'ก้าวสู่ระดับ Radiant Rank', icon: '👑' }
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

  addProduct(name, price, category, isRecommended = false, isOutOfStock = false, imageUrl = '') {
    const products = this.getProducts();
    const newProduct = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15),
      name: name.trim(),
      price: parseFloat(price),
      category: category.trim(),
      is_recommended: !!isRecommended,
      is_out_of_stock: !!isOutOfStock,
      image_url: imageUrl.trim(),
      created_at: new Date().toISOString()
    };

    products.push(newProduct);
    this.saveProducts(products);

    this.logActivity('admin', 'เพิ่มเมนูน้ำปั่นใหม่', `เพิ่มเมนู [${newProduct.name}] ราคา ฿${newProduct.price}`);

    // Supabase POST
    sbQuery('ptom_products', 'POST', newProduct);

    return newProduct;
  },

  deleteProduct(productId) {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === productId);
    if (idx === -1) throw new Error('ไม่พบเมนูนี้ในระบบ');

    const name = products[idx].name;
    products.splice(idx, 1);
    this.saveProducts(products);

    this.logActivity('admin', 'ลบเมนูน้ำปั่น', `ลบเมนู [${name}] ออกจากระบบ`);

    // Supabase DELETE
    sbQuery(`ptom_products?id=eq.${encodeURIComponent(productId)}`, 'DELETE');
  },

  updateProduct(productId, name, price, category, isRecommended, isOutOfStock, imageUrl = '') {
    const products = this.getProducts();
    const idx = products.findIndex(p => p.id === productId);
    if (idx === -1) throw new Error('ไม่พบเมนูนี้ในระบบ');

    products[idx].name = name.trim();
    products[idx].price = parseFloat(price);
    products[idx].category = category.trim();
    products[idx].is_recommended = !!isRecommended;
    products[idx].is_out_of_stock = !!isOutOfStock;
    products[idx].image_url = imageUrl.trim();

    this.saveProducts(products);

    this.logActivity('admin', 'แก้ไขข้อมูลเมนูน้ำปั่น', `แก้ไขเมนู [${products[idx].name}] ราคา ฿${products[idx].price}`);

    // Supabase PATCH
    sbQuery(`ptom_products?id=eq.${encodeURIComponent(productId)}`, 'PATCH', {
      name: products[idx].name,
      price: products[idx].price,
      category: products[idx].category,
      is_recommended: products[idx].is_recommended,
      is_out_of_stock: products[idx].is_out_of_stock,
      image_url: products[idx].image_url
    });

    return products[idx];
  },

  addCustomer(fullName, username, email, password, phone = '', birthDate = '') {
    const users = this.getUsers();
    const exists = users.some(u => u.username === username.toLowerCase().trim() || u.email === email.toLowerCase().trim());
    if (exists) throw new Error('ชื่อผู้ใช้งานหรืออีเมลนี้ถูกใช้งานไปแล้ว');

    const newUser = {
      username: username.toLowerCase().trim(),
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      passwordHash: password,
      points: 0,
      totalLifetimePoints: 0,
      phone: phone.trim(),
      birthDate: birthDate || null,
      role: 'customer',
      lineUserId: '',
      lineNotifyToken: '',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    this.saveUsers(users);

    this.logActivity('admin', 'สร้างบัญชีลูกค้าใหม่', `แอดมินสร้างบัญชีสมาชิกให้ @${newUser.username}`);

    // Supabase POST
    sbQuery('ptom_users', 'POST', mapUserToSupabase(newUser));

    return newUser;
  },

  deleteUser(username) {
    let users = this.getUsers();
    users = users.filter(u => u.username !== username);
    this.saveUsers(users);

    this.logActivity('admin', 'ลบผู้ใช้', `แอดมินลบบัญชีสมาชิก @${username} สำเร็จ`);

    // Supabase DELETE
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(username)}`, 'DELETE');
  },

  updateUserPoints(username, points) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.username === username);
    if (idx === -1) throw new Error('ไม่พบข้อมูลผู้ใช้งาน');

    const oldPoints = users[idx].points;
    users[idx].points = points;
    
    if (points > oldPoints) {
      users[idx].totalLifetimePoints = (users[idx].totalLifetimePoints || 0) + (points - oldPoints);
      users[idx].exp = (users[idx].exp || 0) + (points - oldPoints);
    }
    
    this.saveUsers(users);

    // Supabase PATCH
    sbQuery(`ptom_users?username=eq.${encodeURIComponent(username)}`, 'PATCH', {
      points_balance: points,
      total_lifetime_points: users[idx].totalLifetimePoints,
      exp: users[idx].exp || 0
    });
  },

  saveScans(scans) {
    localStorage.setItem('ptom_scans', JSON.stringify(scans));
    window.dispatchEvent(new Event('storage'));
  },

  updateScanPoints(scanId, newPointsGained) {
    const scans = this.getScans();
    const scanIdx = scans.findIndex(s => s.id === scanId);
    if (scanIdx === -1) throw new Error('ไม่พบรายการสะสมแต้มนี้');

    const scan = scans[scanIdx];
    const oldPoints = scan.pointsGained;
    const diff = newPointsGained - oldPoints;

    scans[scanIdx].pointsGained = newPointsGained;
    this.saveScans(scans);

    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === scan.username);
    if (userIdx !== -1) {
      users[userIdx].points = Math.max(0, users[userIdx].points + diff);
      if (diff > 0) {
        users[userIdx].totalLifetimePoints = (users[userIdx].totalLifetimePoints || 0) + diff;
        users[userIdx].exp = (users[userIdx].exp || 0) + diff;
      }
      this.saveUsers(users);

      sbQuery(`ptom_users?username=eq.${encodeURIComponent(scan.username)}`, 'PATCH', {
        points_balance: users[userIdx].points,
        total_lifetime_points: users[userIdx].totalLifetimePoints,
        exp: users[userIdx].exp || 0
      });
    }

    this.logActivity('admin', 'แก้ไขแต้มจากรหัสสะสม', `แก้ไขแต้มรหัสสะสม [${scanId}] ของ @${scan.username} จากเดิม ${oldPoints} เป็น ${newPointsGained} แต้ม`);

    sbQuery(`ptom_scans?id=eq.${encodeURIComponent(scanId)}`, 'PATCH', {
      pointsgained: newPointsGained
    });

    return scans[scanIdx];
  },

  deleteScan(scanId) {
    const scans = this.getScans();
    const scanIdx = scans.findIndex(s => s.id === scanId);
    if (scanIdx === -1) throw new Error('ไม่พบรายการสะสมแต้มนี้');

    const scan = scans[scanIdx];
    const oldPoints = scan.pointsGained;

    scans.splice(scanIdx, 1);
    this.saveScans(scans);

    const users = this.getUsers();
    const userIdx = users.findIndex(u => u.username === scan.username);
    if (userIdx !== -1) {
      users[userIdx].points = Math.max(0, users[userIdx].points - oldPoints);
      this.saveUsers(users);

      sbQuery(`ptom_users?username=eq.${encodeURIComponent(scan.username)}`, 'PATCH', {
        points_balance: users[userIdx].points
      });
    }

    this.logActivity('admin', 'ลบประวัติสะสมแต้ม', `ลบประวัติสะสมแต้มรหัส [${scanId}] ของ @${scan.username} หักคืน ${oldPoints} แต้ม`);

    sbQuery(`ptom_scans?id=eq.${encodeURIComponent(scanId)}`, 'DELETE');
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
            การแจ้งเตือนของระบบนี้
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
  },

  // --- SMOOTHIE INGREDIENTS LAB DB ---
  initIngredients() {
    const existing = localStorage.getItem('ptom_ingredients');
    // If ingredients list is empty or is the old short list, initialize/overwrite it with the comprehensive list
    if (!existing || JSON.parse(existing).length < 105) {
      const defaultIngredients = [
        // 1. bases
        { id: 'b-milk', name: 'นมสด (Fresh Milk)', emoji: '🥛', price: 0, color: 'rgba(255, 255, 255, 0.85)', category: 'bases' },
        { id: 'b-yogurt', name: 'โยเกิร์ต (Yogurt)', emoji: '🍦', price: 10, color: 'rgba(254, 250, 236, 0.9)', category: 'bases' },
        { id: 'b-coconut', name: 'น้ำมะพร้าว (Coconut Water)', emoji: '🥥', price: 10, color: 'rgba(240, 248, 255, 0.55)', category: 'bases' },
        { id: 'b-almond', name: 'นมอัลมอนด์ (Almond Milk)', emoji: '🧃', price: 15, color: 'rgba(245, 235, 215, 0.85)', category: 'bases' },
        { id: 'b-oat', name: 'นมโอ๊ต (Oat Milk)', emoji: '🌾', price: 15, color: 'rgba(242, 232, 213, 0.85)', category: 'bases' },
        { id: 'b-pistachio', name: 'นมพิสตาชิโอ (Pistachio Milk)', emoji: '🥜', price: 18, color: 'rgba(235, 240, 215, 0.85)', category: 'bases' },
        { id: 'b-soy', name: 'นมถั่วเหลือง (Soy Milk)', emoji: '🥛', price: 10, color: 'rgba(250, 245, 230, 0.85)', category: 'bases' },
        { id: 'b-orange', name: 'น้ำส้มสด (Fresh Orange Juice)', emoji: '🍊', price: 15, color: 'rgba(255, 152, 0, 0.7)', category: 'bases' },
        { id: 'b-apple', name: 'น้ำแอปเปิ้ล (Apple Juice)', emoji: '🍎', price: 15, color: 'rgba(255, 235, 175, 0.6)', category: 'bases' },
        { id: 'b-pineapple', name: 'น้ำสับปะรด (Pineapple Juice)', emoji: '🍍', price: 15, color: 'rgba(255, 235, 59, 0.6)', category: 'bases' },
        { id: 'b-pomegranate', name: 'น้ำทับทิม (Pomegranate Juice)', emoji: '🥤', price: 25, color: 'rgba(183, 28, 28, 0.6)', category: 'bases' },
        { id: 'b-watermelon', name: 'น้ำแตงโม (Watermelon Juice)', emoji: '🍉', price: 12, color: 'rgba(244, 67, 54, 0.6)', category: 'bases' },
        { id: 'b-greentea', name: 'น้ำชาเขียวมะลิ (Jasmine Green Tea)', emoji: '🍵', price: 10, color: 'rgba(200, 230, 201, 0.6)', category: 'bases' },
        { id: 'b-oolong', name: 'ชาอูหลง (Oolong Tea)', emoji: '☕', price: 10, color: 'rgba(215, 204, 200, 0.6)', category: 'bases' },
        { id: 'b-roselle', name: 'น้ำชากระเจี๊ยบ (Roselle Tea)', emoji: '🥤', price: 10, color: 'rgba(136, 14, 79, 0.6)', category: 'bases' },
        { id: 'b-water', name: 'น้ำเปล่า/น้ำแร่ (Mineral Water)', emoji: '💧', price: 0, color: 'rgba(224, 247, 250, 0.3)', category: 'bases' },
        { id: 'b-coconutmilk', name: 'กะทิสด/กะทิธัญพืช (Coconut Milk)', emoji: '🥥', price: 12, color: 'rgba(255, 255, 255, 0.95)', category: 'bases' },
        { id: 'b-greekyogurt', name: 'กรีกโยเกิร์ต (Greek Yogurt)', emoji: '🥛', price: 20, color: 'rgba(255, 253, 245, 0.98)', category: 'bases' },
        { id: 'b-cocyogurt', name: 'โยเกิร์ตมะพร้าว (Coconut Yogurt - Plant-based)', emoji: '🥥', price: 22, color: 'rgba(255, 255, 250, 0.95)', category: 'bases' },
        { id: 'b-kombucha', name: 'Kombucha / ชาหมัก (Kombucha Base)', emoji: '🍾', price: 25, color: 'rgba(230, 200, 160, 0.6)', category: 'bases' },

        // 2. fruits
        { id: 'f-strawberry', name: 'สตรอเบอร์รี่ (Strawberry)', emoji: '🍓', price: 15, color: 'rgba(255, 56, 96, 0.95)', category: 'fruits' },
        { id: 'f-blueberry', name: 'บลูเบอร์รี่ (Blueberry)', emoji: '🫐', price: 20, color: 'rgba(74, 20, 140, 0.95)', category: 'fruits' },
        { id: 'f-raspberry', name: 'ราสเบอร์รี่ (Raspberry)', emoji: '🍒', price: 20, color: 'rgba(233, 30, 99, 0.95)', category: 'fruits' },
        { id: 'f-blackberry', name: 'แบล็กเบอร์รี่ (Blackberry)', emoji: '🍇', price: 22, color: 'rgba(49, 27, 146, 0.95)', category: 'fruits' },
        { id: 'f-mango', name: 'มะม่วงสุก (Mango)', emoji: '🥭', price: 15, color: 'rgba(255, 193, 7, 0.95)', category: 'fruits' },
        { id: 'f-banana', name: 'กล้วยหอม (Banana)', emoji: '🍌', price: 10, color: 'rgba(255, 235, 131, 0.95)', category: 'fruits' },
        { id: 'f-avocado', name: 'อะโวคาโด (Avocado)', emoji: '🥑', price: 25, color: 'rgba(164, 222, 2, 0.95)', category: 'fruits' },
        { id: 'f-pineapple', name: 'สับปะรด (Pineapple)', emoji: '🍍', price: 10, color: 'rgba(255, 215, 0, 0.95)', category: 'fruits' },
        { id: 'f-kiwi', name: 'กีวี่เขียว (Green Kiwi)', emoji: '🥝', price: 15, color: 'rgba(139, 195, 74, 0.95)', category: 'fruits' },
        { id: 'f-goldkiwi', name: 'กีวี่ทอง (Gold Kiwi)', emoji: '🥝', price: 18, color: 'rgba(255, 202, 40, 0.95)', category: 'fruits' },
        { id: 'f-dragon', name: 'แก้วมังกรแดง (Red Dragon Fruit)', emoji: '🐉', price: 15, color: 'rgba(194, 24, 91, 0.95)', category: 'fruits' },
        { id: 'f-passion', name: 'เสาวรส (Passion Fruit)', emoji: '🍊', price: 15, color: 'rgba(255, 112, 67, 0.95)', category: 'fruits' },
        { id: 'f-orange', name: 'ส้มสายน้ำผึ้ง (Orange)', emoji: '🍊', price: 12, color: 'rgba(255, 152, 0, 0.95)', category: 'fruits' },
        { id: 'f-gapple', name: 'แอปเปิ้ลเขียว (Green Apple)', emoji: '🍏', price: 12, color: 'rgba(118, 255, 3, 0.95)', category: 'fruits' },
        { id: 'f-rapple', name: 'แอปเปิ้ลแดง (Red Apple)', emoji: '🍎', price: 12, color: 'rgba(229, 57, 53, 0.95)', category: 'fruits' },
        { id: 'f-peach', name: 'พีช (Peach)', emoji: '🍑', price: 18, color: 'rgba(255, 171, 145, 0.95)', category: 'fruits' },
        { id: 'f-watermelon', name: 'แตงโม (Watermelon)', emoji: '🍉', price: 10, color: 'rgba(244, 67, 54, 0.95)', category: 'fruits' },
        { id: 'f-cantaloupe', name: 'แคนตาลูป (Cantaloupe)', emoji: '🍈', price: 12, color: 'rgba(220, 237, 200, 0.95)', category: 'fruits' },
        { id: 'f-papaya', name: 'มะละกอ (Papaya)', emoji: '🥭', price: 10, color: 'rgba(255, 112, 67, 0.95)', category: 'fruits' },
        { id: 'f-grape', name: 'องุ่นไร้เมล็ด (Seedless Grapes)', emoji: '🍇', price: 18, color: 'rgba(123, 31, 162, 0.95)', category: 'fruits' },
        // Thai Seasonal Fruits Addition
        { id: 'f-durian', name: 'ทุเรียนหมอนทอง (Durian)', emoji: '🥭', price: 35, color: 'rgba(255, 235, 59, 0.95)', category: 'fruits' },
        { id: 'f-mangosteen', name: 'มังคุดคัด (Mangosteen)', emoji: '🍇', price: 20, color: 'rgba(74, 20, 140, 0.95)', category: 'fruits' },
        { id: 'f-marianplum', name: 'มะยงชิดหวาน (Marian Plum)', emoji: '🍊', price: 25, color: 'rgba(255, 152, 0, 0.95)', category: 'fruits' },
        { id: 'f-rambutan', name: 'เงาะโรงเรียน (Rambutan)', emoji: '🍒', price: 15, color: 'rgba(255, 205, 210, 0.95)', category: 'fruits' },
        { id: 'f-lychee', name: 'ลิ้นจี่จักรพรรดิ (Lychee)', emoji: '🍓', price: 20, color: 'rgba(255, 240, 240, 0.95)', category: 'fruits' },
        { id: 'f-longan', name: 'ลำไยอีดอ (Longan)', emoji: '🍈', price: 15, color: 'rgba(255, 243, 224, 0.95)', category: 'fruits' },
        { id: 'f-custardapple', name: 'น้อยหน่าปากช่อง (Custard Apple)', emoji: '🍈', price: 20, color: 'rgba(240, 248, 240, 0.95)', category: 'fruits' },
        { id: 'f-santol', name: 'กระท้อนปุยฝ้าย (Santol)', emoji: '🍑', price: 18, color: 'rgba(255, 224, 178, 0.95)', category: 'fruits' },
        { id: 'f-starfruit', name: 'มะเฟือง (Star Fruit)', emoji: '⭐️', price: 12, color: 'rgba(255, 238, 88, 0.95)', category: 'fruits' },
        { id: 'f-sapodilla', name: 'ละมุด (Sapodilla)', emoji: '🥥', price: 15, color: 'rgba(161, 136, 127, 0.95)', category: 'fruits' },

        // 3. greens
        { id: 'g-spinach', name: 'ผักโขม (Spinach)', emoji: '🥬', price: 10, color: 'rgba(46, 125, 50, 0.95)', category: 'greens' },
        { id: 'g-kale', name: 'เคล / ผักคะน้าใบหยิก (Kale)', emoji: '🌿', price: 15, color: 'rgba(27, 94, 32, 0.95)', category: 'greens' },
        { id: 'g-romaine', name: 'ผักสลัดคอส (Romaine Lettuce)', emoji: '🥬', price: 10, color: 'rgba(76, 175, 80, 0.95)', category: 'greens' },
        { id: 'g-bokchoy', name: 'กวางตุ้งไต้หวัน (Bok Choy)', emoji: '🥬', price: 10, color: 'rgba(139, 195, 74, 0.95)', category: 'greens' },
        { id: 'g-rocket', name: 'ผักร็อกเก็ต (Arugula / Rocket)', emoji: '🌿', price: 12, color: 'rgba(56, 142, 60, 0.95)', category: 'greens' },
        { id: 'g-mint', name: 'ใบมินต์ / สเปียร์มินต์ (Fresh Mint)', emoji: '🍃', price: 5, color: 'rgba(165, 214, 167, 0.95)', category: 'greens' },
        { id: 'g-basil', name: 'ใบโหระพา / กะเพราเม็กซิกัน (Sweet Basil)', emoji: '🌿', price: 5, color: 'rgba(102, 187, 106, 0.95)', category: 'greens' },
        { id: 'g-celery', name: 'เซเลอรี / ขึ้นฉ่ายฝรั่ง (Celery)', emoji: '🥦', price: 10, color: 'rgba(129, 199, 132, 0.95)', category: 'greens' },
        { id: 'g-cucumber', name: 'แตงกวาญี่ปุ่น (Japanese Cucumber)', emoji: '🥒', price: 10, color: 'rgba(200, 230, 201, 0.95)', category: 'greens' },
        { id: 'g-broccoli', name: 'บรอกโคลี (Broccoli)', emoji: '🥦', price: 10, color: 'rgba(56, 142, 60, 0.95)', category: 'greens' },
        { id: 'g-redspinach', name: 'ผักโขมแดง (Red Spinach)', emoji: '🥬', price: 12, color: 'rgba(136, 14, 79, 0.95)', category: 'greens' },
        { id: 'g-babykale', name: 'ก้านคะน้าอ่อน (Baby Kale)', emoji: '🌿', price: 15, color: 'rgba(27, 94, 32, 0.95)', category: 'greens' },
        { id: 'g-parsley', name: 'ใบผักชีฝรั่ง / พาร์สลีย์ (Parsley)', emoji: '🌿', price: 5, color: 'rgba(129, 199, 132, 0.95)', category: 'greens' },
        { id: 'g-wheatgrass', name: 'ใบต้นอ่อนข้าวสาลี (Wheatgrass)', emoji: '🌾', price: 20, color: 'rgba(76, 175, 80, 0.95)', category: 'greens' },
        { id: 'g-sunflower', name: 'ต้นอ่อนทานตะวัน (Sunflower Sprouts)', emoji: '🌱', price: 10, color: 'rgba(197, 225, 165, 0.95)', category: 'greens' },
        { id: 'g-pumpkin', name: 'ฟักทองนึ่ง (Steamed Pumpkin)', emoji: '🎃', price: 12, color: 'rgba(255, 167, 38, 0.95)', category: 'greens' },
        { id: 'g-carrot', name: 'แครอท (Carrot)', emoji: '🥕', price: 10, color: 'rgba(255, 112, 67, 0.95)', category: 'greens' },
        { id: 'g-beetroot', name: 'บีทรูท (Beetroot)', emoji: '🍠', price: 12, color: 'rgba(186, 104, 200, 0.95)', category: 'greens' },
        { id: 'g-tomato', name: 'มะเขือเทศเชอร์รี่ (Cherry Tomato)', emoji: '🍅', price: 10, color: 'rgba(229, 57, 53, 0.95)', category: 'greens' },
        { id: 'g-zucchini', name: 'ซูกินี (Zucchini)', emoji: '🥒', price: 12, color: 'rgba(165, 214, 167, 0.95)', category: 'greens' },

        // 4. sweeteners
        { id: 's-honey', name: 'น้ำผึ้งแท้ (Pure Honey)', emoji: '🍯', price: 5, color: 'rgba(255, 179, 0, 0.95)', category: 'sweeteners' },
        { id: 's-monk', name: 'ไซรับหล่อฮังก๊วย (Monk Fruit Syrup)', emoji: '🧉', price: 10, color: 'rgba(109, 76, 65, 0.95)', category: 'sweeteners' },
        { id: 's-agave', name: 'น้ำเซรัปอากาเว่ (Agave Nectar)', emoji: '🍯', price: 10, color: 'rgba(255, 236, 179, 0.95)', category: 'sweeteners' },
        { id: 's-cocsugar', name: 'น้ำตานดอกมะพร้าว (Coconut Sugar)', emoji: '🥥', price: 8, color: 'rgba(215, 204, 200, 0.95)', category: 'sweeteners' },
        { id: 's-datesyrup', name: 'น้ำเชื่อมอินทผาลัม (Date Syrup)', emoji: '🧉', price: 10, color: 'rgba(93, 64, 55, 0.95)', category: 'sweeteners' },
        { id: 's-maple', name: 'น้ำเชื่อมเมเปิ้ล (Maple Syrup)', emoji: '🍁', price: 10, color: 'rgba(141, 110, 99, 0.95)', category: 'sweeteners' },
        { id: 's-stevia', name: 'ไซรัปหญ้าหวาน (Stevia Drops)', emoji: '🍃', price: 5, color: 'rgba(255, 255, 255, 0.1)', category: 'sweeteners' },
        { id: 's-dates', name: 'อินทผาลัมอบแห้ง (Dried Dates)', emoji: '🍇', price: 10, color: 'rgba(93, 64, 55, 0.95)', category: 'sweeteners' },
        { id: 's-vanilla', name: 'น้ำเชื่อมวานิลลา (Vanilla Syrup)', emoji: '🧪', price: 5, color: 'rgba(255, 248, 225, 0.95)', category: 'sweeteners' },
        { id: 's-milk', name: 'นมข้นหวาน (Condensed Milk)', emoji: '🍼', price: 0, color: 'rgba(255, 253, 230, 0.95)', category: 'sweeteners' },
        { id: 's-cocmilk', name: 'นมข้นมะพร้าว (Coconut Condensed Milk)', emoji: '🥥', price: 10, color: 'rgba(255, 255, 240, 0.95)', category: 'sweeteners' },
        { id: 's-caramel', name: 'ไซรัปคาราเมล (Caramel Syrup)', emoji: '🍯', price: 8, color: 'rgba(244, 143, 177, 0.95)', category: 'sweeteners' },
        { id: 's-hazelnut', name: 'ไซรัปเฮเซลนัท (Hazelnut Syrup)', emoji: '🌰', price: 8, color: 'rgba(215, 204, 200, 0.95)', category: 'sweeteners' },
        { id: 's-choc', name: 'ซอสช็อกโกแลต (Chocolate Sauce)', emoji: '🍫', price: 8, color: 'rgba(62, 39, 35, 0.95)', category: 'sweeteners' },
        { id: 's-strawsauce', name: 'ซอสสตอเบอร์รี่ (Strawberry Sauce)', emoji: '🍓', price: 8, color: 'rgba(216, 27, 96, 0.95)', category: 'sweeteners' },
        { id: 's-passsauce', name: 'ซอสเสาวรส (Passion Fruit Puree)', emoji: '🍊', price: 8, color: 'rgba(251, 140, 0, 0.95)', category: 'sweeteners' },
        { id: 's-sugarfree', name: 'ไซรัปชูการ์ฟรี (Sugar-Free Syrup)', emoji: '🧪', price: 5, color: 'rgba(255, 255, 255, 0.1)', category: 'sweeteners' },
        { id: 's-rawcane', name: 'น้ำตาลอ้อยไม่ขัดสี (Raw Cane Sugar)', emoji: '🍬', price: 0, color: 'rgba(255, 243, 224, 0.95)', category: 'sweeteners' },
        { id: 's-rose', name: 'น้ำเชื่อมกลิ่นกุหลาบ (Rose Syrup)', emoji: '🌹', price: 5, color: 'rgba(240, 98, 146, 0.95)', category: 'sweeteners' },
        { id: 's-yuzu', name: 'น้ำเชื่อมยูซุ (Yuzu Syrup)', emoji: '🍋', price: 10, color: 'rgba(255, 241, 118, 0.95)', category: 'sweeteners' },

        // 5. boosters
        { id: 't-wheyvan', name: 'เวย์โปรตีนรสวานิลลา (Whey Protein Vanilla)', emoji: '💪', price: 25, color: 'rgba(236, 239, 241, 0.95)', category: 'boosters' },
        { id: 't-wheychoc', name: 'เวย์โปรตีนรสช็อกโกแลต (Whey Protein Chocolate)', emoji: '💪', price: 25, color: 'rgba(141, 110, 99, 0.95)', category: 'boosters' },
        { id: 't-plantprot', name: 'พลานต์โปรตีน / โปรตีนพืช (Plant Protein)', emoji: '🌱', price: 25, color: 'rgba(200, 230, 201, 0.95)', category: 'boosters' },
        { id: 't-chia', name: 'เมล็ดเจีย (Chia Seeds)', emoji: '🌱', price: 10, color: 'rgba(38, 50, 56, 0.95)', category: 'boosters' },
        { id: 't-flax', name: 'เมล็ดแฟลกซ์บด (Flax Seeds)', emoji: '🌾', price: 10, color: 'rgba(141, 110, 99, 0.95)', category: 'boosters' },
        { id: 't-collagen', name: 'ผงคอลลาเจน (Collagen Powder)', emoji: '🥛', price: 20, color: 'rgba(255, 255, 255, 0.95)', category: 'boosters' },
        { id: 't-matcha', name: 'ผงมัจฉะ (Matcha Powder)', emoji: '🍵', price: 15, color: 'rgba(76, 175, 80, 0.95)', category: 'boosters' },
        { id: 't-acai', name: 'ผงอาซาอิ (Acai Powder)', emoji: '🍇', price: 25, color: 'rgba(74, 20, 140, 0.95)', category: 'boosters' },
        { id: 't-spirulina', name: 'ผงสปิรูลิน่า (Spirulina Powder)', emoji: '🧪', price: 25, color: 'rgba(0, 77, 64, 0.95)', category: 'boosters' },
        { id: 't-maca', name: 'ผงมาค่า (Maca Powder)', emoji: '🍠', price: 25, color: 'rgba(215, 204, 200, 0.95)', category: 'boosters' },
        { id: 't-cacao', name: 'ผงโกโก้แท้ (Raw Cacao Powder)', emoji: '🍫', price: 15, color: 'rgba(93, 64, 55, 0.95)', category: 'boosters' },
        { id: 't-granola', name: 'กราโนล่า (Granola)', emoji: '🥣', price: 10, color: 'rgba(161, 136, 127, 0.95)', category: 'boosters' },
        { id: 't-pumpkin', name: 'เมล็ดฟักทองอบ (Pumpkin Seeds)', emoji: '🎃', price: 10, color: 'rgba(139, 195, 74, 0.95)', category: 'boosters' },
        { id: 't-sunflower', name: 'เมล็ดทานตะวัน (Sunflower Seeds)', emoji: '🌻', price: 10, color: 'rgba(255, 241, 118, 0.95)', category: 'boosters' },
        { id: 't-almond', name: 'อัลมอนด์สไลซ์ (Sliced Almonds)', emoji: '🌰', price: 12, color: 'rgba(188, 170, 164, 0.95)', category: 'boosters' },
        { id: 't-cashew', name: 'เม็ดมะม่วงหิมพานต์ (Cashew Nuts)', emoji: '🌰', price: 12, color: 'rgba(215, 204, 200, 0.95)', category: 'boosters' },
        { id: 't-peanutbutter', name: 'เนยถั่วปอนด์ (Peanut Butter)', emoji: '🥜', price: 15, color: 'rgba(255, 183, 77, 0.95)', category: 'boosters' },
        { id: 't-almondbutter', name: 'เนยอัลมอนด์ (Almond Butter)', emoji: '🥜', price: 20, color: 'rgba(215, 125, 45, 0.95)', category: 'boosters' },
        { id: 't-cocoflake', name: 'มะพร้าวอบกรอบ (Toasted Coconut Flakes)', emoji: '🥥', price: 10, color: 'rgba(255, 255, 255, 0.95)', category: 'boosters' },
        { id: 't-cacaonibs', name: 'คาเคานิบส์ (Cacao Nibs)', emoji: '🍫', price: 15, color: 'rgba(62, 39, 35, 0.95)', category: 'boosters' }
      ];
      localStorage.setItem('ptom_ingredients', JSON.stringify(defaultIngredients));
    }
  },
  getIngredients() {
    this.initIngredients();
    return JSON.parse(localStorage.getItem('ptom_ingredients')) || [];
  },
  saveIngredients(list) {
    localStorage.setItem('ptom_ingredients', JSON.stringify(list));
  },
  addIngredient(name, emoji, price, color, category) {
    const list = this.getIngredients();
    const id = 'ing-' + Math.floor(100000 + Math.random() * 900000);
    const newItem = { id, name, emoji, price: parseFloat(price) || 0, color, category, is_out_of_stock: false };
    list.push(newItem);
    this.saveIngredients(list);
    return newItem;
  },
  updateIngredient(id, name, emoji, price, color, category, isOutOfStock = false) {
    const list = this.getIngredients();
    const idx = list.findIndex(item => item.id === id);
    if (idx === -1) throw new Error('ไม่พบวัตถุดิบนี้ในระบบ');
    list[idx] = { ...list[idx], name, emoji, price: parseFloat(price) || 0, color, category, is_out_of_stock: !!isOutOfStock };
    this.saveIngredients(list);
    return list[idx];
  },
  toggleIngredientStock(id) {
    const list = this.getIngredients();
    const idx = list.findIndex(item => item.id === id);
    if (idx === -1) throw new Error('ไม่พบวัตถุดิบนี้ในระบบ');
    list[idx].is_out_of_stock = !list[idx].is_out_of_stock;
    this.saveIngredients(list);
    return list[idx];
  },
  deleteIngredient(id) {
    const list = this.getIngredients();
    const filtered = list.filter(item => item.id !== id);
    if (list.length === filtered.length) throw new Error('ไม่พบวัตถุดิบนี้ในระบบ');
    this.saveIngredients(filtered);
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
