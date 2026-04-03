#!/bin/bash
echo "🚀 جاري فك حزمة التحديث وبناء النسخة الجديدة لمشروع تراث مصر..."
cd /www/wwwroot/schools || exit 1

if [ ! -f turath_masr_update.zip ]; then
    echo "❌ خطأ: لم يتم العثور على ملف turath_masr_update.zip في السيرفر."
    exit 1
fi

echo "🧹 جاري تنظيف الملفات القديمة..."
rm -rf src public package.json .next

echo "📦 جاري فك الحزمة..."
unzip -o turath_masr_update.zip

echo "🏗️ جاري بناء المشروع (قد يستغرق دقائق)..."
npm install --no-audit --no-fund
npm run build

echo "🔄 إعادة التشغيل..."
/www/server/nodejs/v22.20.0/bin/pm2 restart turath-masr --update-env

echo "✅ مبروك! الموقع الآن يعمل بأحدث نسخة من مشروع تراث مصر."
