// Minimal debug test
console.log('🧪 Debug Test Starting...');

try {
  // Test dotenv loading
  require('dotenv').config();
  console.log('✅ dotenv loaded');

  // Test token
  if (process.env.DISCORD_TOKEN) {
    console.log('✅ DISCORD_TOKEN found, length:', process.env.DISCORD_TOKEN.length);
    console.log('🔐 Token starts with:', process.env.DISCORD_TOKEN.substring(0, 10) + '...');
  } else {
    console.log('❌ DISCORD_TOKEN not found');
    console.log('Available env vars:', Object.keys(process.env));
    process.exit(1);
  }

  // Test Discord.js import
  const { Client, GatewayIntentBits } = require('discord.js');
  console.log('✅ Discord.js imported successfully');

  // Test client creation
  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });
  console.log('✅ Discord client created');

  // Test login (but don't wait for ready)
  console.log('🔌 Attempting login...');
  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error('❌ Login failed:', error.message);
    console.log('💡 Possible issues:');
    console.log('   - Invalid bot token');
    console.log('   - Bot not invited to any servers');
    console.log('   - Token has expired');
    process.exit(1);
  });

  // Set a timeout to check if login succeeds
  setTimeout(() => {
    if (client.readyAt) {
      console.log('✅ Bot logged in successfully!');
      console.log('Bot tag:', client.user?.tag);
      console.log('Guilds:', client.guilds.cache.size);
      client.destroy();
      process.exit(0);
    } else {
      console.log('❌ Bot did not log in within 10 seconds');
      console.log('This usually means the token is invalid');
      client.destroy();
      process.exit(1);
    }
  }, 10000);

} catch (error) {
  console.error('❌ Unexpected error:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}
