const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  console.log('Clearing zahranship_orders...');
  const { error: orderError } = await supabase
    .from('zahranship_orders')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
    
  if (orderError) {
    console.error('Failed to clear orders:', orderError.message);
  } else {
    console.log('Orders cleared successfully.');
  }

  console.log('Clearing deposits...');
  const { error: depError } = await supabase
    .from('deposits')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
    
  if (depError) {
    console.error('Failed to clear deposits:', depError.message);
  } else {
    console.log('Deposits cleared successfully.');
  }
}
main();
