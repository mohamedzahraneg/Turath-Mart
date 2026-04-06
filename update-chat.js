const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  'https://fmjwatcjqkhzgaecbokn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZtandhdGNqcWtoemdhZWNib2tuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NjQ1MzgsImV4cCI6MjA5MDE0MDUzOH0.328hdsbhrgvFO4e3fNizOlNSJEBEFkFTeZDhb-xv28Y'
);
async function run() {
  const { data, error } = await supabase
    .from('turath_masr_crm_chat')
    .update({ chat_type: 'support' })
    .is('chat_type', null);
  console.log('Update result:', JSON.stringify({ data, error }));
  
  // Verify
  const { data: checkData, error: checkError } = await supabase
    .from('turath_masr_crm_chat')
    .select('id, chat_type')
    .limit(5);
  console.log('Check:', JSON.stringify({ checkData, checkError }));
}
run();
