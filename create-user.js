const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function main() {
  console.log('Ensure tables are created in Supabase first!');
  
  let user = null;
  
  // Try to signIn first to get the user ID
  let { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'admin@turath-mart.com',
    password: 'password123',
  });
  
  if (signInData?.user) {
    user = signInData.user;
  } else {
    // If signin fails, try signup
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: 'admin@turath-mart.com',
      password: 'password123',
      options: { data: { role: 'admin', full_name: 'مدير النظام' } }
    });
    user = signUpData?.user;
  }
  
  if (!user) {
    console.log('Failed to get or create user.');
    return;
  }
  
  console.log('User identity verified:', user.email);
  
  // Directly insert into profiles table
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, email: user.email, role: 'admin', full_name: 'مدير النظام' });
    
  if (profileError) {
    console.error('Error setting profile role (Did you run the SQL migration?):', profileError.message);
  } else {
    console.log('Profile role set to admin successfully!');
    console.log('==> Please login with admin@turath-mart.com / password123');
  }
}
main();
