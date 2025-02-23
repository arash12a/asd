const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// تنظیمات توکن و ادمین اصلی
const TOKEN = '7425488957:AAFeb261yt9_KgkVy2VsExLtUfsFj7EiRZs';
const ADMIN_ID = 6489801125;  // آی‌دی عددی ادمین اصلی

// محدود کردن تعداد درخواست‌های کاربران
let userRequests = {};
const REQUEST_LIMIT = 10;  // حداکثر درخواست در دقیقه

// اتصال به دیتابیس
const db = new sqlite3.Database('bot_data.db');

// ایجاد جدول‌های دیتابیس (در صورت وجود نداشتن)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      invited_by INTEGER DEFAULT NULL,
      blocked INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      user_id INTEGER PRIMARY KEY,
      can_block INTEGER DEFAULT 0,
      can_message INTEGER DEFAULT 0,
      can_manage_orders INTEGER DEFAULT 0,
      can_add_admin INTEGER DEFAULT 0,
      can_generate_discount INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      user_id INTEGER,
      service_type TEXT,
      purchase_date TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS discount_codes (
      code TEXT PRIMARY KEY,
      discount_amount INTEGER,
      used_by INTEGER DEFAULT NULL
    )
  `);
});

// تنظیمات ربات تلگرام
const bot = new TelegramBot(TOKEN, { polling: true });

// تابع دریافت موجودی کیف پول
function getBalance(userId, callback) {
  db.get('SELECT balance FROM users WHERE user_id = ?', [userId], (err, row) => {
    callback(row ? row.balance : 0);
  });
}

// تابع ضد اسپم
function antiSpam(userId) {
  const currentTime = Date.now();
  if (!userRequests[userId]) {
    userRequests[userId] = [];
  }
  userRequests[userId] = userRequests[userId].filter(t => t > currentTime - 60000);
  
  if (userRequests[userId].length >= REQUEST_LIMIT) {
    return false;
  }

  userRequests[userId].push(currentTime);
  return true;
}

// تابع شروع ربات
bot.onText(/\/start/, (msg) => {
  const userId = msg.chat.id;
  if (!antiSpam(userId)) {
    bot.sendMessage(userId, '🚫 شما بیش از حد درخواست ارسال کرده‌اید. لطفا کمی صبر کنید.');
    return;
  }

  db.run('INSERT OR IGNORE INTO users (user_id) VALUES (?)', [userId]);

  const options = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🛒 خرید سرویس', callback_data: 'buy_service' }],
        [{ text: '💰 کیف پول', callback_data: 'wallet' }],
        [{ text: '📢 پشتیبانی', callback_data: 'support' }],
        [{ text: '📜 لیست سرویس‌ها', callback_data: 'list_services' }],
        [{ text: '👥 زیرمجموعه‌گیری', callback_data: 'referral' }]
      ]
    }
  };

  if (userId === ADMIN_ID || isAdmin(userId)) {
    options.reply_markup.inline_keyboard.push([{ text: '🔧 مدیریت ربات', callback_data: 'admin_panel' }]);
  }

  bot.sendMessage(userId, '👋 به ربات فروش فیلترشکن خوش آمدید!', options);
});

// بررسی ادمین بودن
function isAdmin(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM admins WHERE user_id = ?', [userId], (err, row) => {
      resolve(row ? true : false);
    });
  });
}

// اضافه کردن گزارشات و داشبورد برای ادمین
bot.on('callback_query', async (query) => {
  const userId = query.from.id;

  if (query.data === 'admin_panel') {
    if (userId !== ADMIN_ID && !(await isAdmin(userId))) {
      bot.sendMessage(userId, '🚫 شما دسترسی به این بخش را ندارید.');
      return;
    }

    db.get('SELECT COUNT(*) AS total_users FROM users', (err, row) => {
      const totalUsers = row.total_users;
      db.get('SELECT COUNT(*) AS total_transactions FROM services', (err, row) => {
        const totalTransactions = row.total_transactions;
        db.get('SELECT SUM(balance) AS total_balance FROM users', (err, row) => {
          const totalBalance = row.total_balance || 0;

          const report = `📊 **گزارشات ربات**\n\n` +
                         `👥 تعداد کاربران: ${totalUsers}\n` +
                         `💳 تعداد تراکنش‌ها: ${totalTransactions}\n` +
                         `💰 موجودی کل: ${totalBalance} تومان`;

          bot.sendMessage(userId, report);
        });
      });
    });
  }
});

// مسدود کردن و فعال‌سازی کاربران
bot.onText(/\/block_user (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const targetUserId = match[1];

  if (userId !== ADMIN_ID && !isAdmin(userId)) {
    bot.sendMessage(userId, '🚫 شما دسترسی به این بخش را ندارید.');
    return;
  }

  db.run('UPDATE users SET blocked = 1 WHERE user_id = ?', [targetUserId], () => {
    bot.sendMessage(userId, `✅ کاربر با ID ${targetUserId} مسدود شد.`);
  });
});

bot.onText(/\/unblock_user (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const targetUserId = match[1];

  if (userId !== ADMIN_ID && !isAdmin(userId)) {
    bot.sendMessage(userId, '🚫 شما دسترسی به این بخش را ندارید.');
    return;
  }

  db.run('UPDATE users SET blocked = 0 WHERE user_id = ?', [targetUserId], () => {
    bot.sendMessage(userId, `✅ کاربر با ID ${targetUserId} فعال شد.`);
  });
});

// ارسال پیام‌های عمومی به کاربران
bot.onText(/\/broadcast_message (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const message = match[1];

  if (userId !== ADMIN_ID && !isAdmin(userId)) {
    bot.sendMessage(userId, '🚫 شما دسترسی به این بخش را ندارید.');
    return;
  }

  db.all('SELECT user_id FROM users', (err, rows) => {
    rows.forEach(row => {
      bot.sendMessage(row.user_id, message).catch(() => {});
    });
    bot.sendMessage(userId, `✅ پیام به ${rows.length} کاربر ارسال شد.`);
  });
});

// اضافه کردن کد تخفیف
bot.onText(/\/add_discount_code (.+)/, (msg, match) => {
  const userId = msg.chat.id;
  const args = match[1].split(' ');

  if (userId !== ADMIN_ID && !isAdmin(userId)) {
    bot.sendMessage(userId, '🚫 شما دسترسی به این بخش را ندارید.');
    return;
  }

  if (args.length < 2) {
    bot.sendMessage(userId, '❗ لطفاً فرمت صحیح را وارد کنید: /add_discount_code <کد> <مقدار تخفیف>');
    return;
  }

  const code = args[0];
  const discountAmount = parseInt(args[1]);

  db.run('INSERT INTO discount_codes (code, discount_amount) VALUES (?, ?)', [code, discountAmount], () => {
    bot.sendMessage(userId, `✅ کد تخفیف ${code} با میزان تخفیف ${discountAmount}% اضافه شد.`);
  });
});

// بکاپ‌گیری از دیتابیس
bot.onText(/\/backup_database/, (msg) => {
  const userId = msg.chat.id;

  if (userId !== ADMIN_ID && !isAdmin(userId)) {
    bot.sendMessage(userId, '🚫 شما دسترسی به این بخش را ندارید.');
    return;
  }

  const backup = fs.createWriteStream('backup.db');
  const dump = db.prepare('SELECT * FROM sqlite_master');

  dump.each((err, row) => {
    if (err) {
      bot.sendMessage(userId, '❗ خطا در بکاپ‌گیری: ' + err.message);
    } else {
      backup.write(row.sql + '\n');
    }
  });

  backup.end(() => {
    bot.sendMessage(userId, '✅ بکاپ دیتابیس با موفقیت گرفته شد.');
  });
});
