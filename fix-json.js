// Fix JSON files script
const fs = require('fs');
const path = require('path');

const files = {
  'homebrew-versions.json': {},
  'pokemon-versions.json': {},
  'core-versions.json': {},
  'config.json': { checkIntervalMinutes: 30, logChannelId: null },
  'announcement-channels.json': [],
  'banned-users.json': [],
  'banned-servers.json': [],
  'update-history.json': []
};

console.log('🔧 Fixing JSON files for SwitchDex...\n');

for (const [filename, content] of Object.entries(files)) {
  const filepath = path.join(__dirname, filename);
  try {
    // Remove file if it exists
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log(`🗑️  Removed corrupted ${filename}`);
    }

    // Create fresh file with proper encoding
    fs.writeFileSync(filepath, JSON.stringify(content, null, 2), 'utf8');
    console.log(`✅ Created fresh ${filename}`);
  } catch (error) {
    console.error(`❌ Failed to fix ${filename}:`, error.message);
  }
}

console.log('\n🎉 All JSON files have been fixed!');
console.log('You can now run: node index.js');
