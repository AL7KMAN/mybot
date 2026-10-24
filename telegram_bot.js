const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const {
    Deobfuscator,
    Detector,
    VMAnalyzer,
    fetchCodeFromUrl
} = require('./engines.js');

const TOKEN = '8860603316:AAFB__2w2U_UL0Wl0gj6jSidhINv_Ria7Zc';
const bot = new TelegramBot(TOKEN, { polling: true });

console.log("Telegram Bot is running...");

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "أهلاً بك في بوت فك التشفير LM7H (نسخة تليجرام).\n\nأرسل /help لعرض الأوامر.");
});

bot.onText(/\/help/, (msg) => {
    bot.sendMessage(msg.chat.id, "الأوامر المتاحة:\n\n/deobf <الكود> - فك تشفير كود مباشر.\n/url <الرابط> - فك تشفير من رابط Raw.\n/detect <الكود> - كشف نوع التشفير.\n\n(يمكنك إرسال ملف .lua أو .txt وسأقوم بفكه فوراً!)");
});

bot.onText(/\/deobf (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1];
    
    if (code.length > 3500) return bot.sendMessage(chatId, "الكود طويل جداً. أرسله كملف.");
    
    bot.sendMessage(chatId, "⏳ جاري فك التشفير...");
    
    try {
        const deobf = new Deobfuscator(code, { beautify: true });
        await deobf.run();
        
        const outputText = `✅ تم الفك بنجاح!\n\n🔓 عمليات رياضية: ${deobf.stats.mathSimplified}\n📦 نصوص مفكوكة: ${deobf.stats.stringsDecoded}\n\nالكود:\n\`\`\`lua\n${deobf.code.slice(0, 3500)}\n\`\`\``;
        
        if (deobf.code.length > 3500) {
            bot.sendDocument(chatId, Buffer.from(deobf.code), {}, { filename: 'deobfuscated.lua', contentType: 'text/plain' });
            bot.sendMessage(chatId, `تم الفك! الكود طويل، أرسلته كملف.\nعمليات رياضية: ${deobf.stats.mathSimplified}`);
        } else {
            bot.sendMessage(chatId, outputText, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        bot.sendMessage(chatId, `❌ خطأ: ${e.message}`);
    }
});

bot.onText(/\/url (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const url = match[1];
    
    bot.sendMessage(chatId, "⏳ جاري جلب الكود من الرابط وفكه...");
    
    try {
        const code = await fetchCodeFromUrl(url);
        const deobf = new Deobfuscator(code, { beautify: true });
        await deobf.run();
        
        bot.sendMessage(chatId, `✅ تم الفك من الرابط!\nعمليات رياضية: ${deobf.stats.mathSimplified}`);
        bot.sendDocument(chatId, Buffer.from(deobf.code), {}, { filename: 'deobfuscated.lua', contentType: 'text/plain' });
    } catch (e) {
        bot.sendMessage(chatId, `❌ خطأ: ${e.message}`);
    }
});

bot.onText(/\/detect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match[1];
    
    try {
        const detector = new Detector(code);
        const detection = detector.detect();
        const vm = VMAnalyzer.analyze(code);
        
        let text = `🔍 نتائج الكشف:\n\n🎯 النوع: ${detection.name}\n📊 الثقة: ${detection.confidence}%\n🖥️ هل هو VM؟ ${vm.isVM ? "نعم" : "لا"}`;
        if (detection.signals.length > 0) {
            text += `\n\n🔖 البصمات:\n${detection.signals.slice(0, 5).join("\n")}`;
        }
        bot.sendMessage(chatId, text);
    } catch (e) {
        bot.sendMessage(chatId, `❌ خطأ: ${e.message}`);
    }
});

bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name;
    
    if (!fileName.endsWith('.lua') && !fileName.endsWith('.txt')) {
        return bot.sendMessage(chatId, "❌ أرسل ملف .lua أو .txt فقط.");
    }
    
    bot.sendMessage(chatId, "⏳ جاري تحميل الملف وفك التشفير...");
    
    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await fetch(fileLink);
        const code = await response.text();
        
        const deobf = new Deobfuscator(code, { beautify: true });
        await deobf.run();
        
        bot.sendMessage(chatId, `✅ تم فك الملف!\nعمليات رياضية: ${deobf.stats.mathSimplified}\nنصوص مفكوكة: ${deobf.stats.stringsDecoded}`);
        bot.sendDocument(chatId, Buffer.from(deobf.code), {}, { filename: 'deobfuscated.lua', contentType: 'text/plain' });
    } catch (e) {
        bot.sendMessage(chatId, `❌ خطأ: ${e.message}`);
    }
});
