import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fmjwatcjqkhzgaecbokn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtandhdGNqcWtoemdhZWNib2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NjQ1MzgsImV4cCI6MjA5MDE0MDUzOH0.328hdsbhrgvFO4e3fNizOlNSJEBEFkFTeZDhb-xv28Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function debug() {
  const [inv, ords] = await Promise.all([
    supabase.from('turath_masr_inventory').select('name'),
    supabase.from('turath_masr_orders').select('products, status').order('created_at', { ascending: false }).limit(20)
  ]);

  const inventoryNames = inv.data.map(i => i.name);
  console.log('--- Inventory Names ---');
  inventoryNames.forEach(n => console.log(`"${n}"`));

  console.log('\n--- Recent Orders Products String ---');
  ords.data.forEach((o, i) => {
    console.log(`Order ${i} [${o.status}]: "${o.products}"`);
    if (o.status === 'cancelled' || o.status === 'returned') return;
    if (!o.products) return;

    const parts = o.products.split('+').map(s => s.trim());
    parts.forEach(p => {
      const match = p.match(/(.*?)\s*([x×\*]\s*(\d+)|(\d+)\s*[x×\*])$/i);
      let name = p;
      let qty = 1;
      if (match) {
        name = match[1].trim();
        qty = parseInt(match[3] || match[4], 10) || 1;
      }
      
      const found = inventoryNames.find(inName => inName.trim() === name.trim());
      if (found) {
        console.log(` ✅ MATCH: "${name}" matched in inventory. Qty: ${qty}`);
      } else {
        console.log(` ❌ NO MATCH: "${name}" was not found in inventory list.`);
      }
    });
  });
}

debug();
