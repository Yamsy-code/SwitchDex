SwitchDex – Unified Nintendo Switch Update Monitor
SwitchDex is a Discord bot that monitors Nintendo Switch homebrew, firmware, Pokémon games, and custom GitHub repositories. It supports per-server customization, unified announcement channels, and per-guild logging.
Features
Homebrew updates (GitHub releases)
Firmware/CFW updates (Atmosphère, Hekate, fusee, Switch system firmware)
Pokémon game updates
Custom GitHub repo tracking (/addtracking)
Unified announcement channels (/addchannel for all update types)
Per-guild logging routes (/loghere)
Per-guild subscriptions, mention roles, quiet hours, and digest mode
Ban system for users/servers; whitelist option
Command registration on new guilds automatically
Requirements
Node.js 18+
Discord bot token with the applications.commands scope
Recommended: GITHUB_TOKEN (avoids rate limits, required for heavy tracking)
Quick Start
1) Install dependencies:
npm install
2) Create .env in the project root:
DISCORD_TOKEN=your_bot_tokenGITHUB_TOKEN=your_github_token   # recommendedUPDATE_CHANNEL_ID=optional_global_log_channelBOT_OWNER_ID=your_user_id        # for owner-only commands
3) Run:
node index.js
The bot will log in, register commands for all current guilds, and re-register commands for any new guild it joins.
Configuration Files (JSON)
config.json — check interval, global log channel
announcement-channels.json — unified announcement channels {channelId, guildId, addedBy, addedAt}
guild-settings.json — per-guild settings (subscriptions, mention roles, quiet hours, digest)
server-log-routes.json — per-guild log routes set by /loghere
homebrew-versions.json — built-in homebrew metadata
core-versions.json — built-in firmware/CFW metadata
tracked-releases.json — custom tracked repos (via /addtracking, guild-scoped)
update-history.json — recent updates history
Backups: *.backup.* are auto-rotated; keep or prune as needed.
Commands (highlights)
/addchannel — add current channel for all announcements (global)
/removechannel, /listchannels
/loghere — set this guild’s log channel (per-guild)
/checkpermissions — verify channel perms
/subscribe, /unsubscribe, /mysubs
/setmentionrole, /removementionrole
/setinterval <minutes> — monitoring interval
/recent — last 24h updates
/firmware, /ecosystem, /hbstatus, /update game:<name>
/addtracking, /removetracking — custom GitHub repos (per-guild scoped)
/banuser, /banserver, /maintenance (owner/admin)
Owner-only (owner guild): /loghere (global), /broadcast, /purgeserver, etc.
Multi-Server Behavior
Announcement delivery: Built-in updates go to every channel in announcement-channels.json. Custom tracked repos send only to channels in the repo’s guildId.
Logging: /loghere stores a per-guild log route in server-log-routes.json. When no guild is specified, logs broadcast to all routes (and optionally the global log channel).
Command registration: On startup, commands are registered to all current guilds; when the bot joins a new guild, commands are registered immediately in that guild.
Tracking Logic (GitHub)
Homebrew, firmware components, and custom tracked repos all fetch recent releases via .../releases?per_page=5, consider prereleases as applicable, and compare versions.
Atmosphère stable prefers non-prerelease; Atmosphère prerelease accepts prerelease.
Requires GITHUB_TOKEN for reliable operation.
Permissions
Ensure the bot has in target channels:
View Channel
Send Messages
Embed Links
Read Message History
Use Slash Commands
Use /checkpermissions if unsure.
Troubleshooting
Missing commands in a new server: re-invite or restart; the bot auto-registers on guildCreate.
No logs in some servers: run /loghere in each server; ensure the bot can send in that channel.
Missed GitHub updates: set GITHUB_TOKEN; ensure the repo has releases; prereleases are now considered.
Rate limits: reduce interval or keep GITHUB_TOKEN set.
Permissions errors: run /checkpermissions in the target channel.
Data Safety
JSON writes create timestamped backups (keeps the 5 most recent).
Do not delete primary JSON files; prune backups if space is an issue.
Development
Start: node index.js
Main file: index.js
Min Node: 18
Dependencies: discord.js, axios, dotenv
Support
Re-run with GITHUB_TOKEN to avoid rate limits.
For logs, check your per-guild log channel and (optionally) the global log channel in config.json.
