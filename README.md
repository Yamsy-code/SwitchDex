# SwitchDex - Unified Nintendo Switch Update Monitor

A comprehensive Discord bot that combines homebrew application tracking, Pokémon game monitoring, and custom firmware ecosystem surveillance into a single, professional monitoring solution.

## 🚀 Quick Start (Executable)

### Download & Run
1. **Download** the executable for your platform from the [releases page](https://github.com/your-repo/releases)
2. **Create** a `.env` file with your Discord bot token:
   ```
   DISCORD_TOKEN=your_bot_token_here
   UPDATE_CHANNEL_ID=optional_channel_id
   GITHUB_TOKEN=optional_github_token
   ```
3. **Run** the executable:
   - **Windows**: `SwitchDex-windows.exe`
   - **Linux**: `./SwitchDex-linux`
   - **macOS**: `./SwitchDex-macos`

### Build Your Own Executable
If you want to build from source:

```bash
# Install dependencies
npm install

# Build executables for all platforms
npm run build

# Or build for specific platform
npm run build:win    # Windows
npm run build:linux  # Linux
npm run build:macos  # macOS
```

## 📦 Executable Advantages

### Why Use the Executable?
- 🚀 **Instant Deployment**: No installation required
- 🛡️ **Isolated Environment**: No dependency conflicts
- 📦 **Portable**: Run from any directory
- ⚡ **Fast Startup**: Optimized for performance
- 🔒 **Secure**: Self-contained, no external dependencies

### Standalone Operation
- ✅ **No Node.js Required**: Runs on any Windows/Linux/macOS system
- ✅ **Self-Contained**: All dependencies bundled inside
- ✅ **Data Persistence**: Saves configuration and update history
- ✅ **Automatic Updates**: Background monitoring continues

### Platform Support
- 🪟 **Windows**: `.exe` executable (64-bit)
- 🐧 **Linux**: Binary executable (64-bit)
- 🍎 **macOS**: App bundle (64-bit)

### File Structure (Bundled)
```
SwitchDex-executable
├── 📄 Configuration (.env)
├── 📊 Update Data (JSON files)
├── 🔧 Runtime Dependencies
└── 🚀 Discord Bot Logic
```

### Quick Build Script
```bash
# Run this to build executables for all platforms
node build-executable.js
```

This will create:
- `dist/SwitchDex-windows.exe` (Windows)
- `dist/SwitchDex-linux` (Linux)
- `dist/SwitchDex-macos` (macOS)

## 🛠️ Development Setup

## 🚀 Features

### Core Monitoring Capabilities
- **Homebrew Applications**: Track 20+ popular Nintendo Switch homebrew apps with automatic GitHub release monitoring
- **Pokémon Games**: Monitor 7 major Pokémon titles for version updates via Perfectly Nintendo
- **System Components**: Track firmware, Atmosphère (stable/prerelease), Hekate bootloader, and fusee.bin
- **Compatibility Analysis**: Real-time firmware/CFW compatibility assessment

### Unified Channel System
**Key Enhancement**: Unlike previous versions with separate channel configurations, SwitchDex now uses a unified system where channels receive **ALL** update types:

- ✅ **Single Configuration**: `/addchannel` adds channels for ALL updates (homebrew + games + CFW)
- ✅ **Simplified Management**: No more separate homebrew-channels vs game-channels
- ✅ **Comprehensive Coverage**: One channel gets notifications for everything

### Professional Interface
- **Conversational AI**: Responds to greetings with contextual, professional replies
- **Comprehensive Status Checks**: `/recent` command for 24-hour update summaries
- **Rich Embed Responses**: Beautiful, informative embeds for all update information
- **Multi-Channel Support**: Unified announcement channels for all update types

### Administrative Controls
- **Granular Permissions**: Separate admin controls for homebrew vs game/CFW channels
- **Flexible Intervals**: Configurable check frequencies (1-1440 minutes)
- **Diagnostic Logging**: Comprehensive logging with channel routing
- **Force Updates**: Manual trigger capabilities for immediate status checks
- **Access Control**: Complete ban system for users and servers
- **Auto-Leave**: Automatically leaves banned servers when added

## 📋 Available Commands

### Interactive Communication
```
/hi, /hello, /hey          # Professional greeting responses
/recent, /anu              # 24-hour comprehensive update summary
/help                      # Complete command reference
```

### Homebrew Application Suite
```
/homebrew app:<name>       # Detailed app information card
/hbstatus                  # Overview of all tracked homebrew
/hbhelp                    # Homebrew-specific help
```

### Game Software Management
```
/update game:<name>        # Game update information
# Text commands: /ShowUpdateZA, /ShowUpdateSCVI, etc.
```

### System Infrastructure Monitoring
```
/firmware                  # Current system firmware status
/cfwupdates                # CFW ecosystem update information
/dashboard                # Complete compatibility dashboard
```

### Unified Channel Management (NEW!)
```
/addchannel                # Add this channel to receive ALL update announcements
/removechannel             # Remove this channel from ALL update announcements
/listchannels              # List all unified announcement channels
```

### Administrative Configuration
```
/forceallupdates           # Force comprehensive update checks
/setinterval <minutes>     # Configure monitoring frequency
/loghere                   # Route logs to this channel
/checkpermissions          # Diagnose bot permissions
```

### Access Control Management
```
/banuser userid:<id>       # Ban user from bot features
/unbanuser userid:<id>     # Remove user ban
/listbannedusers           # Display banned users
/banserver serverid:<id>   # Ban server (auto-leave)
/unbanserver serverid:<id> # Remove server ban
/listbannedservers         # Display banned servers
```

## 🛠️ Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Create a `.env` file with:
   ```env
   DISCORD_TOKEN=your_bot_token_here
   UPDATE_CHANNEL_ID=optional_default_channel_id
   GITHUB_TOKEN=optional_for_higher_rate_limits
   ```

3. **Launch the Monitor**
   ```bash
   node index.js
   ```

## 📊 Monitored Components

### Homebrew Applications (20+ apps)
- Breeze, EdiZon, JKSV, ftpd, Goldleaf, Awoo Installer
- DBI, NX-Shell, nx-ovlloader, sys-clk, MissionControl
- emuiibo, NXThemesInstaller, NX Activity Log, NX-Update-Checker
- Sigpatch-Updater, UltraHand Overlay, Daybreak, NX-Save-Manager, Tinfoil

### Pokémon Games (7 titles)
- Legends: Z-A, Scarlet/Violet, Pokopia
- Legends: Arceus, Brilliant Diamond, Shining Pearl, Sword/Shield

### Core System Components
- Nintendo Switch System Firmware
- Atmosphère (Stable & Prerelease)
- Hekate Bootloader
- fusee.bin Payload

## 📢 Unified Channel System Explained

### Before vs After
```
BEFORE (Separate Systems):
├── homebrew-channels.json → Homebrew updates only
├── channels.json → Game + CFW updates only
└── Complex management of two systems

AFTER (Unified System):
└── announcement-channels.json → ALL updates in one place
    ├── Homebrew applications ✅
    ├── Pokémon games ✅
    ├── Firmware updates ✅
    └── CFW components ✅
```

### Benefits
- **Simplified Setup**: One command (`/addchannel`) configures everything
- **Complete Coverage**: No missing update notifications
- **Easier Management**: Single channel list to maintain
- **Backward Compatible**: Existing .env files still work

## 🚫 Access Control System

### User Ban Management
```
/banuser userid:<id> reason:<text>     # Ban a user from all bot features
/unbanuser userid:<id>                 # Remove user ban
/listbannedusers                       # Display banned user registry
```

### Server Ban Management
```
/banserver serverid:<id> reason:<text> # Ban a server (bot auto-leaves)
/unbanserver serverid:<id>             # Remove server ban
/listbannedservers                     # Display banned server registry
```

### Security Features
- **Automatic Enforcement**: Banned users cannot use any bot commands
- **Server Auto-Leave**: Bot immediately leaves when added to banned servers
- **Admin-Only**: All ban management requires Administrator permissions
- **Persistent Storage**: Ban lists saved to JSON files
- **Comprehensive Logging**: All ban actions logged for audit trail

## 🔧 Troubleshooting

### Permission Errors
If you see "Missing Access" errors, the bot lacks permissions in announcement channels.

**Quick Fix:**
1. Use `/checkpermissions` to diagnose issues
2. Ensure bot has these permissions in announcement channels:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ View Channel

**Automatic Cleanup:**
- Invalid channels are automatically removed from configuration
- Permission checks prevent sending to channels where bot lacks access
- Comprehensive error logging for debugging

## 🛡️ Security & Reliability Features

- **Multi-Layer Protection**: User bans + server bans + admin verification
- **Silent Rejection**: Banned entities receive no feedback (prevents spam)
- **Audit Trail**: Complete logging of all ban/unban operations
- **Fail-Safe Design**: Ban system cannot ban itself or critical administrators
- **Fallback Mechanisms**: Multiple data sources with automatic failover
- **Rate Limiting**: Respectful API usage with configurable delays
- **Error Recovery**: Automatic retry logic for transient failures
- **Data Integrity**: Atomic file operations with backup recovery

## 🚀 Deployment & Distribution

### Creating Executables
```bash
# Quick build for current platform
node build-executable.js

# Or use the provided scripts:
# Windows: double-click build.bat
# PowerShell: .\build.ps1

# Manual build commands:
npm run build:win    # Windows only
npm run build:linux  # Linux only
npm run build:macos  # macOS only
```

### Running the Executable
```bash
# Windows: Use the launcher script (recommended)
run.bat

# Or run directly (PowerShell)
.\run.ps1

# Manual run (not recommended - console closes on error)
SwitchDex-windows.exe
```

### First-Time Setup
1. **Build the executable**: Run `build.bat` or `.\build.ps1`
2. **Create `.env` file**: Edit with your Discord bot token
3. **Run the launcher**: Use `run.bat` to start with error visibility
4. **Configure channels**: Use `/addchannel` in Discord

### Distribution Package
When distributing the executable, include:
- ✅ The executable file for the target platform
- ✅ A `.env` file with user's configuration
- ✅ This README.md for instructions

### File Size Expectations
- **Windows**: ~25-30MB (includes all dependencies)
- **Linux**: ~20-25MB
- **macOS**: ~25-30MB

### System Requirements
- **Windows**: Windows 7+ (64-bit)
- **Linux**: Most modern distributions (64-bit)
- **macOS**: macOS 10.12+ (64-bit)

## 🐛 Troubleshooting

### "Command Window Opens and Closes Immediately"

**Cause**: The executable encountered an error during startup and exited.

**Solution**: Use the launcher scripts that keep the console open:

```bash
# Windows (recommended)
run.bat

# PowerShell
.\run.ps1
```

These scripts will:
- ✅ Keep the console window open
- ✅ Display error messages clearly
- ✅ Show startup progress
- ✅ Provide troubleshooting tips

### Common Startup Errors

#### ❌ "Missing Access" Error
```
Missing Access - DiscordAPIError[50001]
```
**Fix**: Bot lacks permissions in configured channels. Use `/checkpermissions` to diagnose.

#### ❌ ".env file not found"
**Fix**: Create a `.env` file with your Discord bot token:
```
DISCORD_TOKEN=your_bot_token_here
```

#### ❌ "DISCORD_TOKEN not configured"
**Fix**: Edit `.env` file and replace `your_bot_token_here` with actual token.

#### ❌ "Failed to login"
**Fix**:
- Verify token is correct
- Check bot has proper Discord permissions
- Ensure token hasn't expired

### Debug Mode
Run the executable with verbose logging:
```bash
# The launcher scripts already include error handling
run.bat  # Shows all startup messages and errors
```

### Getting Help
If issues persist:
1. Run `run.bat` and note the exact error message
2. Check that all required files are present
3. Verify `.env` configuration
4. Ensure bot has proper Discord permissions

### First Run Setup
1. Place the executable in a folder
2. Create `.env` file with your bot token
3. Run the executable
4. Use `/addchannel` to configure announcement channels

## 🤝 Support

For issues, feature requests, or contributions, please ensure your Nintendo Switch ecosystem stays current with SwitchDex - the unified professional monitoring solution.

---

*SwitchDex: Unified monitoring for the complete Nintendo Switch ecosystem. Now available as standalone executables!* 🚀📦