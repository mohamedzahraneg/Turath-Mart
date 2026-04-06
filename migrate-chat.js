const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://fmjwatcjqkhzgaecbokn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtandhdGNqcWtoemdhZWNib2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NjQ1MzgsImV4cCI6MjA5MDE0MDUzOH0.328hdsbhrgvFO4e3fNizOlNSJEBEFkFTeZDhb-xv28Y'
);

async function migrate() {
  // Try to add chat_type column using rpc
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: "ALTER TABLE turath_masr_crm_chat ADD COLUMN IF NOT EXISTS chat_type text DEFAULT 'support';"
  });
  console.log('Result:', data, error);
  
  // If rpc doesn't work, we'll try another approach
  if (error) {
    console.log('RPC failed, trying alternative...');
    // Try inserting a test row with chat_type to see if column exists
    const { data: testData, error: testError } = await supabase
      .from('turath_masr_crm_chat')
      .select('*')
      .limit(1);
    console.log('Current columns:', testData ? Object.keys(testData[0] || {}) : 'no data');
  }
}

migrate();
