// server.js (الإصدار الاحترافي الكامل - جاهز للنشر)

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio'); // مكتبة كشط الويب
const cors = require('cors'); // <-- لاستقبال الطلبات من مواقع أخرى

// --- إعدادات الخادم ---
const app = express();
// Render سيعطينا البوابة (Port) في 'process.env.PORT'
// إذا كنا نشغله محلياً، سيستخدم 3000
const PORT = process.env.PORT || 3000; 

// --- تفعيل الكورس ---
// هذا سيسمح لموقعك (الذي سننشره لاحقاً) بالتحدث مع هذا الـ API
app.use(cors());

// --- الوحدة 1: جالب بيانات البنك الأهلي (NBE) ---
async function fetchNBE() {
    try {
        const apiUrl = 'https://www.nbe.com.eg/NBE/Services/Prices/CurrencyPrices.asmx/GetCurrentCurrencyPrices';
        const response = await axios.post(apiUrl, {});
        const rates = JSON.parse(response.data.d);
        
        // تحويل البيانات للتنسيق الموحد
        return rates.map(rate => ({
            bankName: "البنك الأهلي المصري",
            currencyCode: rate.CurrencyCode,
            buy: parseFloat(rate.PurchaseRate) || 0,
            sell: parseFloat(rate.SaleRate) || 0
        }));
    } catch (error) {
        console.error("فشل جلب بيانات البنك الأهلي:", error.message);
        return []; // إرجاع مصفوفة فارغة عند الفشل
    }
}

// --- الوحدة 2: جالب بيانات بنك مصر (Banque Misr) ---
async function fetchBanqueMisr() {
    try {
        const apiUrl = 'https://www.banquemisr.com/bm/Services/Prices/CurrencyPrices.asmx/GetCurrencyPrices';
        const response = await axios.post(apiUrl, {});
        const rates = JSON.parse(response.data.d);

        // تحويل البيانات للتنسيق الموحد
        return rates.map(rate => ({
            bankName: "بنك مصر",
            currencyCode: rate.CurrencyCode,
            buy: parseFloat(rate.PurchaseRate) || 0,
            sell: parseFloat(rate.SaleRate) || 0
        }));
    } catch (error) {
        console.error("فشل جلب بيانات بنك مصر:", error.message);
        return [];
    }
}

// --- الوحدة 3: جالب بيانات بنك CIB (مع بوت مراقبة مدمج) ---
async function fetchCIB() {
    try {
        const targetUrl = 'https://www.cibeg.com/ar/rates-and-fees/currency-rates';
        const response = await axios.get(targetUrl);
        const html = response.data;
        const $ = cheerio.load(html);

        const rates = [];
        let validationError = false; // (متغير لمراقبة الأخطاء المنطقية)
        const tableRows = $('table.table.rates tbody tr'); 
        
        tableRows.each((index, element) => {
            const row = $(element);
            const currencyName = row.find('td').eq(0).text().trim();
            const buyPrice = row.find('td').eq(1).text().trim();
            const sellPrice = row.find('td').eq(2).text().trim();

            let currencyCode = '';
            if (currencyName.includes('دولار أمريكى')) currencyCode = 'USD';
            if (currencyName.includes('يورو')) currencyCode = 'EUR';
            // (يمكن إضافة باقي العملات هنا)

            if (currencyCode) {
                const buy = parseFloat(buyPrice) || 0;
                const sell = parseFloat(sellPrice) || 0;

                // --- 🚨 هذا هو "بوت المراقبة" 🚨 ---
                if (buy === 0 || sell === 0) {
                    validationError = true; 
                }
                // --- نهاية البوت ---

                rates.push({
                    bankName: "بنك CIB",
                    currencyCode: currencyCode,
                    buy: buy,
                    sell: sell
                });
            }
        });

        if (tableRows.length === 0) {
            throw new Error("فشل كاشط CIB (بوت): لم يتم العثور على جدول الأسعار.");
        }
        if (validationError) {
             throw new Error("فشل كاشط CIB (بوت): الأسعار أصبحت صفر.");
        }

        return rates;

    } catch (error) {
        console.error("خطأ فادح في وحدة CIB:", error.message);
        throw new Error(`فشل تحديث بيانات CIB: ${error.message}`); 
    }
}

// --- الوحدة 4: جالب بيانات السوق الموازية (مثال توضيحي) ---
async function fetchParallelMarket() {
    try {
        // (هام: هذا الرابط والـ selectors هي أمثلة افتراضية!)
        const targetUrl = 'https://some-parallel-aggregator.com/usd';
        const sourceName = "ExampleAggregator.com"; 

        const response = await axios.get(targetUrl);
        const html = response.data;
        const $ = cheerio.load(html);

        const buySelector = 'div.buy-price-parallel > span.rate';
        const sellSelector = 'div.sell-price-parallel > span.rate';

        const buyPrice = $(buySelector).text().trim();
        const sellPrice = $(sellSelector).text().trim();
        
        const buy = parseFloat(buyPrice) || 0;
        const sell = parseFloat(sellPrice) || 0;

        if (buy === 0 || sell === 0) {
            throw new Error("فشل كاشط السوق الموازية (بوت): الأسعار صفر.");
        }
        
        return [{
            bankName: `السوق الموازية (${sourceName})`, 
            currencyCode: "USD",
            buy: buy,
            sell: sell
        }];

    } catch (error) {
        console.warn("🚨 إنذار: فشلت وحدة السوق الموازية. سيتم الاستمرار بالبنوك فقط.");
        return []; 
    }
}


// --- نقطة النهاية (Endpoint) الرئيسية الجديدة: جلب ومقارنة الكل ---
app.get('/api/all-rates', async (req, res) => {
    
    const requestedCurrency = req.query.currency || 'USD'; 
    console.log(`\nيتم جلب ومقارنة أسعار: ${requestedCurrency}`);

    const results = await Promise.allSettled([
        fetchNBE(),
        fetchBanqueMisr(),
        fetchCIB(),
        fetchParallelMarket()
    ]);

    let allRates = [];
    results.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
            allRates.push(...result.value); 
        } else if (result.status === 'rejected') {
            console.warn("🚨 إنذار فشل وحدة جلب:", result.reason.message);
        }
    });

    const filteredRates = allRates.filter(rate => rate.currencyCode === requestedCurrency);

    // الترتيب لأفضل (أنت تشتري) = أقل سعر بيع
    const topBuyList = [...filteredRates].sort((a, b) => a.sell - b.sell);
    // الترتيب لأفضل (أنت تبيع) = أعلى سعر شراء
    const topSellList = [...filteredRates].sort((a, b) => b.buy - a.buy);

    res.json({
        currency: requestedCurrency,
        bestToBuy: topBuyList,
        bestToSell: topSellList,
        last_updated: new Date()
    });
});

// --- نقطة نهاية (Endpoint) لأسعار الذهب (الإصدار المطور) ---
app.get('/api/gold-rates', async (req, res) => {
    console.log("يتم جلب أسعار الذهب (Scraping)...");
    try {
        const targetUrl = 'https_//some-real-gold-site.com/prices'; // (رابط افتراضي)
        const sourceName = "SomeGoldSite.com";

        const response = await axios.get(targetUrl);
        const html = response.data;
        const $ = cheerio.load(html);

        const selector24k = 'div.price-card-24k > span.price'; // (محدد افتراضي)
        const selector21k = 'div.price-card-21k > span.price'; // (محدد افتراضي)
        const selector18k = 'div.price-card-18k > span.price'; // (محدد افتراضي)
        
        const price24k = parseFloat($(selector24k).text().replace(/[^0-9.]/g, '')) || 0;
        const price21k = parseFloat($(selector21k).text().replace(/[^0-9.]/g, '')) || 0;
        const price18k = parseFloat($(selector18k).text().replace(/[^0-9.]/g, '')) || 0;

        if (price21k === 0) {
            throw new Error("فشل كاشط الذهب (بوت): سعر عيار 21 هو صفر.");
        }

        res.json({
            source: sourceName,
            prices: [
                { carat: "عيار 24", price: price24k },
                { carat: "عيار 21", price: price21k },
                { carat: "عيار 18", price: price18k }
            ],
            last_updated: new Date()
        });

    } catch (error) {
        console.error("خطأ في كشط الذهب:", error.message);
        res.status(500).json({ error: "فشل كشط أسعار الذهب", details: error.message });
    }
});


// --- تشغيل الخادم ---
app.listen(PORT, () => {
    console.log(`الـ API يعمل الآن على البوابة ${PORT}`);
});
