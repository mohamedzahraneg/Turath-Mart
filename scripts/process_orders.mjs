import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        env[key] = value;
    }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const rawData = `30/03/2026 13:29:14	عمر عبدالعاطي	01011711521	01065599222	المهندسين	: ٣١ شارع جول جمال متفرع من جامعة الدول العربية الدور ال ٤ شقة ٢٠ - المهندسين	بني	1				2400			
25/03/2026 22:10:38	اسماء صلاح	+20 11 48337361		فيصل	Giza ٨ شارع مسجد بلال متفرع من شارع الدكتور فيصل الطوابق بجوار نادي شيراتون فيصل	صدف	1				2760			
30/03/2026 21:35:27	راندا سعيد	01002965268		فيصل	العنوان  1 شارع الهداية متفرع من ش كعابيش الطوابق فيصل .. محافظة الجيزة  الدور ال 3 الشقة اللى فى النص	بني	1				2000			
20/03/2026 14:12:38	شيماء احمد مجاهد	01005256195		الشيخ زايد	B79 الاجريا بفرلي هيلز الشيخ زايد٠	بني كشاف	1				2800			
30/03/2026 13:19:28	Hayat Muhammad	01200722860		الشيخ زايد	Giza Villa 345 beverly hills El sheikh zayed	بني	1				2400			
27/03/2026 1:08:34	صلاح محمد جمال	01280880603		٦أكتوبر	. 6 اكتوبر ، غرب سوميد ،مجاوره ١٢ ،بلوك ١/١٥, فيلا ١٤.	مصحف , صدف كشاف	1	1			3600			
29/03/2026 11:55:51	محمد جيزاوي	01031001311		التجمع الاول	التجمع الاول  البنفسج ٧  فيلا ١٢٢ ارضي ١	بني	1				100	استبدال حامل بني بدال الابيض وشحن 100		
30/03/2026 21:33:04	علا شكر	+20 12 28761860		التجمع الاول	Cairo الياسمين ٧ فيلا ٧٥ شقة ٥ التجمع الأول القاهرة	بني	1				2400			
30/03/2026 13:24:35	مايسه الكيالي	01117976544		التجمع الاول	Cairo فيلا ١٤٥ كايروفستيفال سيتي اوريانا ٣ بوابه ٤ امام المركز الطبي لاكاديميه الشرطهد التجمع الاول	صدف	1				0			
30/03/2026 11:30:32	Shereen Mohamed	01006526623		التجمع الخامس	Cairo Fifth Settlement.compound The Square .behind Hydepark Compound Cairo	ذهبي كشاف	1				2760			
30/03/2026 13:16:53	Hilda Omar	01010648570		التجمع الخامس	Cairo كمبوند ازاد التجمع الخامس دور تاني شقة واحد B37 ٠	أبيض , مصحف	2	1			5300			
01/04/2026 15:44:33	ماجده امين	+20 11 22225786		التجمع الخامس	Cairo التجمع الخامس عرب الجولف فيلا ٥٦٨ التجمع الخامس	أسود	1				2000	مساء الخير 2424 ماجده امين Cairo ٠ 👇👇👇 دي كانت متاكد ع ٢٤٠٠ ولغت عشان السر شوفها ع ٢٠٠٠ يمكن تستلم		
01/04/2026 15:46:22	شريف يحيي	01009234672		التجمع الخامس	القاهرة النرجس 1 - التجمع الخامس - القاهرة الجديدة, القاهرة, القاهرة	أبيض	1				2400			
01/04/2026 15:43:13	Amal Mustafa	01003080010		التجمع التالت	Cairo ١٣٩ ستون ريزيدنس كمبوند - القطاميه - التجمع الثالث Cairo	صدف	1				2760			
23/03/2026 6:43:49	Karim Megahed	01027802400		حلميه الزيتون	Cairo 14 شارع محطه مترو حلميه الزيتون Cairo	أسود كشاف	1				2700			
18/03/2026 0:12:00	شريف نصير	01008792277		المعادي	Cairo تقاطع ش ٨٤ مع ش ١٦ - المعادى دجلة المعادى	ذهبي كشاف	1				2760	استأذنك بس التوصيل بعد الساعه 2ظهرا		
23/03/2026 6:46:15	امال محمد عبدالقادر	01060620708		مدينه نصر	Cairo 6 شارع حسن المامون مدينه نصر القاهره مدينه نصر القاهره	بني , مصحف	1	1			3000			
18/03/2026 0:10:33	استاذ ناجح	01225340422		الزمالك	٥ سارع النقريدي الزمالك متفرع ش ٢٦ يوليو	كرسي صدف			1		600			
23/03/2026 12:00:27	علا بدر	01011524333		الشروق	Cairo المنطقه السادسه عمارات المجاوره الاولي امام المعادي فيو عماره ٩٥ الدور الأول شقه ٥ الشروق	كرسي صدف			1		600			
27/03/2026 0:31:46	Sanagik Ibrahim	+20 10 05693580		المرج	Cairo ٤ شارع النور المحمدى متفرع من شارع الشريف الرفاعى خلف مستشفى اليوم الواحد المرج	أسود	1				2400			
27/03/2026 1:24:44	Lamis Amr	01019558559		المهندسين	Cairo جمعيه احمد عرابي بوابه ٤ فيلا عمرو صالح Cairo	صدف , مصحف	1	1			3360	العميل محتاجه الاوردر بعد اسبوع		
20/03/2026 14:14:19	علاء الجندي	01015552563		مدينه نصر	Cairo ١٧ شارع الطيران - مدينة نصر اول - بجوار فندق جويل النصر وامام وزارة الدفع واعلي معرض كويست اوتو للسيارات مدينة  نصر	كرسي صدف			2		1200			
30/03/2026 13:14:52	Madina NafiKova	+20 12 03222433		النزهه الجديدة	Cairo ١٢ أ شارع القدس الشريف النزهه الجديدة  الدور الثامن شقة ١٤  ( متفرع من شارع طة حسين ، خلف معهد حاسبات القوات المسلحة )    Cairo	أبيض , مصحف	1	1			3000			
24/03/2026 20:48:26	ايه البطران	01005441855		الهرم	Giza شارع عباس حمزه البطران متفرع مش شارع زغلقول الهرم من رقم ٢ بجوار قهوه شقاوه القاهره	بني كشاف	1				2760			
02/04/2026 6:20:03	Hazem Badawi	01000115116		الهرم	Giza 79 خاتم المرسلين الهرم القاهر	بني	1				2400	أكد تاني		
02/04/2026 6:21:32	محمد عمرو	01018321891		مساكن شيراتون	Cairo مساكن شيراتون عماره ١ ن مربع ١١٨٤ دور ٢ شقه ٢٠٥ بجانب الاكادميه البحريه وخلف مسجد الصديق مساكن شيراتون	ذهبي	1				2400			
02/04/2026 6:23:08	أستاذ	01026155509	#ERROR!	التجمع الاول	٣٧٧ الياسمين ١ التجمع الاول القاهرة الجديدة	صدف	1				2760			
02/04/2026 6:24:36	عزه علي	01223008722		التجمع الاول	Cairo التجمع الاول - الياسمين ٤ - فيلا ٣٧٢ - الدور الاول - شقه ٤ القاهرة	بني	1				2400			
02/04/2026 6:25:47	استاذ	01226047884		الرحاب	العنوان الرحاب 1 مجموعة 9 فيلا 73 شارع عبدالله بن عباس	بني , مصحف	1	1			3000			
02/04/2026 6:27:10	انس لاشين	01222108020		مدينة نصر	Cairo شارع سبيل المؤمنين قطعة ١١ بلوك ١٣ حي السفارات  مدينة نصر القاهرة  شركة عمائر العقارية امام المنطقة الحره       - القاهره	بني	1				2400	من الساعه 11ص  حتي 3م		`;

const areaToGov = {
    'المهندسين': 'الجيزة',
    'فيصل': 'الجيزة',
    'الشيخ زايد': 'الجيزة',
    '٦أكتوبر': 'الجيزة',
    'التجمع الاول': 'القاهرة',
    'التجمع الخامس': 'القاهرة',
    'التجمع التالت': 'القاهرة',
    'حلميه الزيتون': 'القاهرة',
    'المعادي': 'القاهرة',
    'مدينه نصر': 'القاهرة',
    'الزمالك': 'القاهرة',
    'الشروق': 'القاهرة',
    'المرج': 'القاهرة',
    'النزهه الجديدة': 'القاهرة',
    'الهرم': 'الجيزة',
    'مساكن شيراتون': 'القاهرة',
    'الرحاب': 'القاهرة'
};

function getGov(area) {
    for (let key in areaToGov) {
        if (area.includes(key)) return areaToGov[key];
    }
    return 'القاهرة'; // Default
}

function parseRow(row) {
    const cols = row.split('\t');
    if (cols.length < 12) return null;

    const [dateTimeStr, customer, phone, phone2, area, address, typeStr, hCount, mCount, cCount, kCount, totalStr, notes] = cols;

    const dateParts = dateTimeStr.split(' ');
    const date = dateParts[0];
    const time = dateParts[1] || '00:00:00';

    const h = parseInt(hCount) || 0;
    const m = parseInt(mCount) || 0;
    const c = parseInt(cCount) || 0;
    const k = parseInt(kCount) || 0;
    const total = parseFloat(totalStr) || 0;

    let products = [];
    if (h > 0) products.push(`حامل ${typeStr.includes('بني') ? 'بني' : typeStr.includes('صدف') ? 'صدف' : typeStr.includes('ذهبي') ? 'ذهبي' : typeStr.includes('أبيض') ? 'أبيض' : typeStr.includes('أسود') ? 'أسود' : typeStr} x ${h}`);
    if (m > 0) products.push(`مصحف x ${m}`);
    if (c > 0) products.push(`كرسي x ${c}`);
    if (k > 0) products.push(`كعبة x ${k}`);

    return {
        id: `order-batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        created_by: 'النظام (Bulk Upload)',
        customer: customer.trim(),
        phone: phone.trim().replace(/\s+/g, ''),
        phone2: phone2.trim() === '#ERROR!' ? null : (phone2.trim() || null),
        region: getGov(area),
        district: area.trim(),
        address: address.trim(),
        products: products.join(' + ') || 'منتجات متنوعة',
        quantity: h + m + c + k,
        total: total,
        status: 'new',
        date: date,
        time: time,
        day: null,
        notes: notes ? notes.trim() : null,
        lines: null, // Could expand this to full lines JSON if needed
    };
}

async function run() {
    const rows = rawData.trim().split('\n');
    console.log(`Processing ${rows.length} rows...`);

    const orders = rows.map(parseRow).filter(o => o !== null);

    // Group orders by date to manage sequential numbering
    const ordersByDate = {};
    orders.forEach(o => {
        if (!ordersByDate[o.date]) ordersByDate[o.date] = [];
        ordersByDate[o.date].push(o);
    });

    const finalOrders = [];

    for (let date in ordersByDate) {
        // Get prefix YYMMDD
        const [d, m, y] = date.split('/');
        const yy = y.slice(-2);
        const prefix = `${yy}${m}${d}`;

        // Get existing count from DB for this prefix
        const { count } = await supabase
            .from('turath_masr_orders')
            .select('*', { count: 'exact', head: true })
            .like('order_num', `${prefix}%`);

        let seq = (count || 0) + 1;

        ordersByDate[date].forEach(o => {
            o.order_num = `${prefix}${seq++}`;
            finalOrders.push(o);
        });
    }

    console.log(`Finalizing ${finalOrders.length} orders for insertion...`);

    // Bulk insert
    const { data, error } = await supabase
        .from('turath_masr_orders')
        .insert(finalOrders);

    if (error) {
        console.error("Error inserting orders:", error);
    } else {
        console.log("Orders inserted successfully!");
    }

    // Also update customers
    console.log("Updating customers...");
    for (let o of finalOrders) {
        const { data: custData, error: custError } = await supabase
            .from('turath_masr_customers')
            .upsert({
                phone: o.phone,
                full_name: o.customer,
                address: o.address,
                updated_at: new Date().toISOString()
            }, { onConflict: 'phone' });
        
        if (custError) console.error(`Error updating customer ${o.phone}:`, custError);
    }
    console.log("Customer update completed.");
}

run();
