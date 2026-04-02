// No dotenv
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  console.log('Testing login...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'admin@turath-mart.com',
    password: 'password123',
  });

  if (authError) {
    console.error('Login Failed!', authError.message);
    return;
  }
  
  console.log('Login Succeeded! User:', authData.user.email);

  console.log('Fetching profile...');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single();

  if (profileError) {
    console.error('Profile Fetch Failed!', profileError.message, profileError);
    return;
  }

  console.log('Profile Fetch Succeeded!', profile);
}

main();
