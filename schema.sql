-- ==========================================
-- P'Tom's Smoothie Loyalty Database Schema
-- Supabase PostgreSQL Script (Clean Schema Setup)
-- ==========================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop existing tables for a clean reset
DROP TABLE IF EXISTS ptom_activity_logs CASCADE;
-- Also drop ptom_scans if it exists
DROP TABLE IF EXISTS ptom_scans CASCADE;
DROP TABLE IF EXISTS ptom_redemptions CASCADE;
DROP TABLE IF EXISTS ptom_gifts CASCADE;
DROP TABLE IF EXISTS ptom_user_badges CASCADE;
DROP TABLE IF EXISTS ptom_badges CASCADE;
DROP TABLE IF EXISTS ptom_user_quests CASCADE;
DROP TABLE IF EXISTS ptom_quests CASCADE;
DROP TABLE IF EXISTS ptom_user_coupons CASCADE;
DROP TABLE IF EXISTS ptom_orders CASCADE;
DROP TABLE IF EXISTS ptom_products CASCADE;
DROP TABLE IF EXISTS ptom_users CASCADE;

-- 1. USERS TABLE
CREATE TABLE ptom_users (
    username TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    passwordhash TEXT NOT NULL,
    points_balance INTEGER DEFAULT 0 CHECK (points_balance >= 0),
    total_lifetime_points INTEGER DEFAULT 0 CHECK (total_lifetime_points >= 0),
    phone TEXT,
    birth_date DATE,
    role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
    line_user_id TEXT,
    line_notify_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PRODUCTS TABLE
CREATE TABLE ptom_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price NUMERIC NOT NULL CHECK (price >= 0),
    category TEXT,
    is_recommended BOOLEAN DEFAULT FALSE,
    is_out_of_stock BOOLEAN DEFAULT FALSE,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ORDERS TABLE
CREATE TABLE ptom_orders (
    id TEXT PRIMARY KEY, -- ORD-XXXXXX format
    username TEXT REFERENCES ptom_users(username) ON DELETE CASCADE,
    items JSONB NOT NULL,
    total_price NUMERIC NOT NULL CHECK (total_price >= 0),
    cost_paid NUMERIC DEFAULT 0,
    points_earned INTEGER DEFAULT 0,
    pickup_time TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Verifying', 'Preparing', 'Ready', 'Completed', 'Rejected')),
    slip_url TEXT,
    points_awarded BOOLEAN DEFAULT FALSE,
    is_group_order BOOLEAN DEFAULT FALSE,
    group_id TEXT, -- For grouping items
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. USER COUPONS TABLE
CREATE TABLE ptom_user_coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT REFERENCES ptom_users(username) ON DELETE CASCADE,
    title TEXT NOT NULL,
    coupon_type TEXT NOT NULL, -- 'free_topping', 'discount_10', 'free_smoothie'
    is_used BOOLEAN DEFAULT FALSE,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- 5. QUESTS TABLE
CREATE TABLE ptom_quests (
    id TEXT PRIMARY KEY, -- e.g., 'weekly_smoothie_5', 'daily_checkin'
    title TEXT NOT NULL,
    description TEXT,
    target_amount INTEGER NOT NULL DEFAULT 1,
    reward_points INTEGER NOT NULL DEFAULT 0,
    reward_exp INTEGER DEFAULT 0,
    quest_type TEXT DEFAULT 'daily' CHECK (quest_type IN ('daily', 'weekly', 'achievement')),
    reset_day TEXT
);

-- 6. USER QUESTS PROGRESS TABLE
CREATE TABLE ptom_user_quests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT REFERENCES ptom_users(username) ON DELETE CASCADE,
    quest_id TEXT REFERENCES ptom_quests(id) ON DELETE CASCADE,
    progress INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, quest_id)
);

-- 7. BADGES TABLE
CREATE TABLE ptom_badges (
    id TEXT PRIMARY KEY, -- e.g., 'smoothie_lover', 'early_bird'
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT, -- emoji or URL
    requirement_type TEXT NOT NULL,
    requirement_value INTEGER NOT NULL
);

-- 8. USER BADGES TABLE
CREATE TABLE ptom_user_badges (
    username TEXT REFERENCES ptom_users(username) ON DELETE CASCADE,
    badge_id TEXT REFERENCES ptom_badges(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (username, badge_id)
);

-- 9. GIFTS TABLE (Send to Friend)
CREATE TABLE ptom_gifts (
    id TEXT PRIMARY KEY, -- GIFT-XXXXXX format
    sender_username TEXT REFERENCES ptom_users(username) ON DELETE SET NULL,
    recipient_email TEXT,
    gift_card_theme TEXT DEFAULT 'Standard',
    items JSONB NOT NULL,
    is_redeemed BOOLEAN DEFAULT FALSE,
    redeemed_by TEXT REFERENCES ptom_users(username) ON DELETE SET NULL,
    redeemed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. REDEMPTIONS TABLE (100 pt Free Drinks logs)
CREATE TABLE ptom_redemptions (
    id TEXT PRIMARY KEY, -- REDEEM-XXXXXX format
    username TEXT REFERENCES ptom_users(username) ON DELETE CASCADE,
    points_deducted INTEGER DEFAULT 100,
    status TEXT DEFAULT 'Redeemed',
    photo_data TEXT, -- Base64 slip/photo of cup
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 11. SCANS TABLE
CREATE TABLE ptom_scans (
    id TEXT PRIMARY KEY,
    username TEXT REFERENCES ptom_users(username) ON DELETE CASCADE,
    pointsgained INTEGER NOT NULL,
    status TEXT NOT NULL,
    description TEXT,
    photodata TEXT, -- Base64 scan slip/photo
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 12. ACTIVITY LOGS TABLE
CREATE TABLE ptom_activity_logs (
    id BIGSERIAL PRIMARY KEY,
    username TEXT REFERENCES ptom_users(username) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);


-- ==========================================
-- SEED DATA
-- ==========================================

-- Products
INSERT INTO ptom_products (name, price, category, is_recommended, is_out_of_stock, image_url) VALUES
('อะโวคาโดน้ำผึ้งปั่น', 75.00, 'Signature', true, false, ''),
('สตรอว์เบอร์รีโยเกิร์ตปั่น', 65.00, 'Smoothies', false, false, ''),
('มะม่วงเสาวรสปั่น', 60.00, 'Smoothies', true, false, ''),
('มิกซ์เบอร์รีสมูทตี้', 70.00, 'Healthy', false, false, ''),
('กล้วยหอมช็อกโกแลตโอ๊ตมิลค์', 80.00, 'Healthy', false, false, ''),
('มะพร้าวน้ำหอมนมสดปั่น', 55.00, 'Smoothies', false, false, ''),
('ชาเขียวมัทฉะเย็น', 35.00, 'Tea', true, false, ''),
('โกโก้ดาร์กพรีเมียมเย็น', 35.00, 'Cold', false, false, ''),
('อเมริกาโน่น้ำส้มเย็น', 45.00, 'Coffee', true, false, ''),
('นมสดคาราเมลเย็น', 35.00, 'Cold', false, false, ''),
('น้ำผึ้งมะนาวโซดา', 35.00, 'Soda', false, false, ''),
('โกโก้ร้อนเข้มข้น', 35.00, 'Hot', false, false, ''),
('เอสเพรสโซ่ร้อน', 30.00, 'Hot', false, false, ''),
('ลาเต้ร้อน', 35.00, 'Hot', false, false, ''),
('นมสดอุ่นน้ำผึ้ง', 30.00, 'Hot', false, false, '');

-- Quests
INSERT INTO ptom_quests (id, title, description, target_amount, reward_points, reward_exp, quest_type, reset_day) VALUES
('daily_checkin', 'เช็คอินประจำวัน', 'เปิดแอปและกดเช็คอินเพื่อรับคะแนนพิเศษสะสม', 1, 2, 10, 'daily', NULL),
('weekly_smoothie_5', 'นักดื่มตัวยงประจำสัปดาห์', 'สั่งซื้อน้ำปั่นครบ 5 แก้วภายในสัปดาห์นี้', 5, 15, 100, 'weekly', 'Monday'),
('achievement_first_order', 'จุดเริ่มต้นความอร่อย', 'สั่งซื้อเครื่องดื่มแก้วแรกสำเร็จ', 1, 5, 50, 'achievement', NULL),
('achievement_radiant_rank', 'แรงค์สูงสุดของร้าน', 'ก้าวสู่แรงค์ Radiant (พี่ต้อมตัวจริง) ด้วยคะแนนสะสม 800 แต้ม', 800, 100, 500, 'achievement', NULL);

-- Badges
INSERT INTO ptom_badges (id, title, description, icon, requirement_type, requirement_value) VALUES
('smoothie_lover', 'แฟนพันธุ์แท้น้ำปั่น', 'สั่งสมูทตี้รวม 5 แก้วขึ้นไป', '🥤', 'total_orders', 5),
('early_bird', 'ตื่นแต่เช้ามาดื่มปั่น', 'สั่งสมูทตี้ก่อนเวลา 10:00 น.', '🌅', 'early_orders', 1),
('big_spender', 'ราชาสายเปย์', 'มียอดซื้อสะสมเกิน 500 บาท', '💰', 'total_spend', 500),
('radiant_champion', 'พี่ต้อมตัวจริง', 'เข้าสู่ระดับแรงค์ Radiant (แต้มสะสม 800 แต้ม)', '👑', 'points', 800);
