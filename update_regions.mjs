import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const fullRegions = [
  { id: '1', name: 'القاهرة', fee: 50, enabled: true, districts: [
    { name: 'مدينة نصر', enabled: true },
    { name: 'المعادي', enabled: true },
    { name: 'هليوبوليس (مصر الجديدة)', enabled: true },
    { name: 'الزيتون', enabled: true },
    { name: 'شبرا', enabled: true },
    { name: 'المطرية', enabled: true },
    { name: 'عين شمس', enabled: true },
    { name: 'النزهة', enabled: true },
    { name: 'المرج', enabled: true },
    { name: 'الأميرية', enabled: true },
    { name: 'السيدة زينب', enabled: true },
    { name: 'الخليفة', enabled: true },
    { name: 'مصر القديمة', enabled: true },
    { name: 'حلوان', enabled: true },
    { name: 'المقطم', enabled: true },
    { name: 'التجمع الأول', enabled: true },
    { name: 'التجمع الخامس', enabled: true },
    { name: 'القاهرة الجديدة', enabled: true },
    { name: 'الرحاب', enabled: true },
    { name: 'مدينتي', enabled: true },
    { name: 'بدر', enabled: true },
    { name: 'العبور', enabled: true },
    { name: 'الشروق', enabled: true },
    { name: 'الزمالك', enabled: true },
    { name: 'جاردن سيتي', enabled: true },
    { name: 'بولاق', enabled: true },
    { name: 'الوايلي', enabled: true },
    { name: 'عابدين', enabled: true },
    { name: 'الأزبكية', enabled: true },
    { name: 'الموسكي', enabled: true },
    { name: 'الجمالية', enabled: true },
    { name: 'الدرب الأحمر', enabled: true },
    { name: 'منشأة ناصر', enabled: true },
    { name: 'دار السلام', enabled: true },
    { name: 'طره', enabled: true },
    { name: 'المعصرة', enabled: true },
    { name: 'التبين', enabled: true },
    { name: '15 مايو', enabled: true },
    { name: 'البساتين', enabled: true },
    { name: 'حدائق القبة', enabled: true },
    { name: 'الساحل', enabled: true },
    { name: 'الشرابية', enabled: true },
    { name: 'روض الفرج', enabled: true },
    { name: 'الزاوية الحمراء', enabled: true },
    { name: 'وسط البلد', enabled: true },
    { name: 'غرب القاهرة', enabled: true },
    { name: 'باب الشعرية', enabled: true },
  ] },
  { id: '2', name: 'الجيزة', fee: 50, enabled: true, districts: [
    { name: 'الدقي', enabled: true },
    { name: 'العجوزة', enabled: true },
    { name: 'المهندسين', enabled: true },
    { name: 'إمبابة', enabled: true },
    { name: 'بولاق الدكرور', enabled: true },
    { name: 'فيصل', enabled: true },
    { name: 'الهرم', enabled: true },
    { name: 'العمرانية', enabled: true },
    { name: 'أوسيم', enabled: true },
    { name: 'كرداسة', enabled: true },
    { name: 'أبو النمرس', enabled: true },
    { name: 'الحوامدية', enabled: true },
    { name: 'البدرشين', enabled: true },
    { name: 'الصف', enabled: true },
    { name: 'أطفيح', enabled: true },
    { name: 'المنيب', enabled: true },
    { name: 'الشيخ زايد', enabled: true },
    { name: '6 أكتوبر', enabled: true },
    { name: 'الحي الأول', enabled: true },
    { name: 'الحي الثاني', enabled: true },
    { name: 'الحي الثالث', enabled: true },
    { name: 'الحي الرابع', enabled: true },
    { name: 'الحي الخامس', enabled: true },
    { name: 'الحي السادس', enabled: true },
    { name: 'الحي السابع', enabled: true },
    { name: 'الحي الثامن', enabled: true },
    { name: 'الحي التاسع', enabled: true },
    { name: 'الحي العاشر', enabled: true },
    { name: 'الحي الحادي عشر', enabled: true },
    { name: 'الحي الثاني عشر', enabled: true },
    { name: 'الواحات البحرية', enabled: true },
    { name: 'سقارة', enabled: true },
    { name: 'أبو رواش', enabled: true },
    { name: 'الوراق', enabled: true },
    { name: 'منشأة القناطر', enabled: true },
  ] },
  { id: '3', name: 'القليوبية', fee: 60, enabled: true, districts: [
    { name: 'شبرا الخيمة', enabled: true },
    { name: 'قليوب', enabled: true },
    { name: 'بنها', enabled: true },
    { name: 'طوخ', enabled: true },
    { name: 'قها', enabled: true },
    { name: 'الخانكة', enabled: true },
    { name: 'الخصوص', enabled: true },
    { name: 'كفر شكر', enabled: true },
    { name: 'أبو زعبل', enabled: true },
    { name: 'مسطرد', enabled: true },
    { name: 'العبور', enabled: true },
    { name: 'القناطر الخيرية', enabled: true },
    { name: 'شبين القناطر', enabled: true },
    { name: 'الإبراهيمية', enabled: true },
  ] },
];

async function main() {
  // Check if settings_regions exists
  const { data: existing } = await supabase
    .from('turath_masr_settings')
    .select('*')
    .eq('key', 'settings_regions')
    .single();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('turath_masr_settings')
      .update({ value: JSON.stringify(fullRegions) })
      .eq('key', 'settings_regions');
    
    if (error) {
      console.error('Update error:', error);
    } else {
      console.log('✅ Updated settings_regions with full data');
    }
  } else {
    // Insert new
    const { error } = await supabase
      .from('turath_masr_settings')
      .insert({ key: 'settings_regions', value: JSON.stringify(fullRegions) });
    
    if (error) {
      console.error('Insert error:', error);
    } else {
      console.log('✅ Inserted settings_regions with full data');
    }
  }

  // Verify
  const { data: verify } = await supabase
    .from('turath_masr_settings')
    .select('value')
    .eq('key', 'settings_regions')
    .single();
  
  if (verify) {
    const regions = JSON.parse(verify.value);
    regions.forEach(r => {
      console.log(`  ${r.name}: ${r.districts.length} منطقة - ${r.fee} ج.م`);
    });
  }
}

main().catch(console.error);
