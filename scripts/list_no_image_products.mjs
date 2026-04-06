import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fmjwatcjqkhzgaecbokn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtandhdGNqcWtoemdhZWNib2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NjQ1MzgsImV4cCI6MjA5MDE0MDUzOH0.328hdsbhrgvFO4e3fNizOlNSJEBEFkFTeZDhb-xv28Y';
const supabase = createClient(supabaseUrl, supabaseKey);

async function listItems() {
  const { data, error } = await supabase
    .from('turath_masr_inventory')
    .select('id, name, images');

  if (error) {
    console.error('Error fetching inventory:', error);
    return;
  }

  const noImages = data.filter(item => !item.images || item.images.length === 0);
  console.log(`Found ${noImages.length} products without images:`);
  noImages.forEach(item => {
    console.log(`- [${item.id}] ${item.name}`);
  });
}

listItems();
