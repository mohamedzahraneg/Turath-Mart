const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://fmjwatcjqkhzgaecbokn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtandhdGNqcWtoemdhZWNib2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NjQ1MzgsImV4cCI6MjA5MDE0MDUzOH0.328hdsbhrgvFO4e3fNizOlNSJEBEFkFTeZDhb-xv28Y'
);

async function migrate() {
  // Test if chat_type column exists
  const { data, error } = await supabase
    .from('turath_masr_crm_chat')
    .select('chat_type')
    .limit(1);
    
  console.log('Test chat_type column:', JSON.stringify({ data, error }));
  
  if (error && error.message && error.message.includes('chat_type')) {
    console.log('Column does not exist - need to add it');
    
    // Try to use the Supabase SQL endpoint
    // We need to create an RPC function first or use the management API
    console.log('Attempting to use management API...');
    
    // Try the Supabase Management API
    const resp = await fetch('https://api.supabase.com/v1/projects/fmjwatcjqkhzgaecbokn/database/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN
      },
      body: JSON.stringify({
        query: "ALTER TABLE turath_masr_crm_chat ADD COLUMN IF NOT EXISTS chat_type text DEFAULT 'support';"
      })
    });
    console.log('Management API status:', resp.status);
    const body = await resp.text();
    console.log('Management API response:', body);
  } else {
    console.log('Column already exists or table is empty');
  }
}

migrate().catch(console.error);
