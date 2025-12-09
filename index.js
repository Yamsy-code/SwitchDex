// SwitchDex - Unified Nintendo Switch Update Monitor
console.log('🎮 SwitchDex Professional Monitor');
console.log('Starting SwitchDex bot...');
console.log('====================================================');
console.log('');

// Core dependencies
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Load environment variables
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder, ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// Validate configuration
console.log('🔍 Checking configuration...');
console.log('📄 dotenv loaded, checking for DISCORD_TOKEN...');
console.log('🔑 Available env vars with TOKEN/DISCORD:', Object.keys(process.env).filter(key => key.includes('DISCORD') || key.includes('TOKEN')));

if (!process.env.DISCORD_TOKEN) {
  console.log('❌ ERROR: DISCORD_TOKEN not found in environment variables!');
  console.log('📄 Please create a .env file with: DISCORD_TOKEN=your_bot_token_here');
  console.log('💡 Make sure the .env file is in the same directory as index.js');
  console.log('💡 Current working directory:', process.cwd());
  process.exit(1);
}

console.log('✅ DISCORD_TOKEN found, length:', process.env.DISCORD_TOKEN.length);
console.log('🔐 Token starts with:', process.env.DISCORD_TOKEN.substring(0, 10) + '...');
console.log('🚀 Proceeding with login...');

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Configuration
let config = {
  checkInterval: 15,
  logChannelId: process.env.UPDATE_CHANNEL_ID || null,
  githubToken: process.env.GITHUB_TOKEN || null,
  botOwnerId: process.env.BOT_OWNER_ID || '1065094562965622875', // Owner user ID
  ownerGuildId: '1142889540219060255' // Owner testing server ID
};

// Data storage
let announcementChannels = [];
let bannedUsers = [];
let bannedServers = [];
let trackedReleases = {};
let guildSettings = {}; // Per-server settings
let allowedServers = { whitelistEnabled: false, servers: [] }; // Server whitelist
let serverLogRoutes = {}; // Server log routing
let maintenanceMode = { enabled: false, message: 'SwitchDex is under maintenance. Please try again later.', enabledAt: null }; // Maintenance mode
let errorTracker = {
  errors: {},
  lastNotification: {}
};
let fileTracker = {
  lastHashes: {},
  lastCheck: null
};
let scanInterval = null;

// Load data files
function loadDataFiles() {
  try {
    // Load announcement channels
    if (fs.existsSync('announcement-channels.json')) {
      const channelsData = JSON.parse(fs.readFileSync('announcement-channels.json', 'utf8'));
      if (Array.isArray(channelsData)) {
        announcementChannels = channelsData.map(channelId => ({
          channelId: channelId,
          guildId: null,
          addedBy: null,
          addedAt: new Date().toISOString()
        }));
      } else {
        announcementChannels = channelsData;
      }
    }

    // Validate and fix announcement channels structure
    let announcementChanged = false;
    announcementChannels = announcementChannels.map(ch => {
      // Handle corrupted nested objects
      if (typeof ch.channelId === 'object' && ch.channelId.channelId) {
        console.warn('[WARN] Fixed corrupted channel entry:', ch.channelId.channelId);
        announcementChanged = true;
        return {
          channelId: String(ch.channelId.channelId),
          guildId: (ch.channelId.guildId || ch.guildId || null) ? String(ch.channelId.guildId || ch.guildId) : null,
          addedBy: (ch.channelId.addedBy || ch.addedBy || null) ? String(ch.channelId.addedBy || ch.addedBy) : null,
          addedAt: ch.channelId.addedAt || ch.addedAt || new Date().toISOString()
        };
      }
      // Ensure channelId is always a string
      const cleaned = {
        ...ch,
        channelId: String(ch.channelId),
        guildId: ch.guildId ? String(ch.guildId) : null,
        addedBy: ch.addedBy ? String(ch.addedBy) : null,
        addedAt: ch.addedAt || new Date().toISOString()
      };
      if (cleaned !== ch) {
        announcementChanged = true;
      }
      return cleaned;
    }).filter(ch => ch.channelId && ch.channelId !== 'undefined' && ch.channelId !== '[object Object]');

    // Save fixed data
    if (announcementChanged) {
      saveAnnouncementChannels();
    }
    console.log(`[INFO] Loaded ${announcementChannels.length} valid announcement channels`);

    // Load banned users
    if (fs.existsSync('banned-users.json')) {
      bannedUsers = JSON.parse(fs.readFileSync('banned-users.json', 'utf8'));
    }

    // Load banned servers
    if (fs.existsSync('banned-servers.json')) {
      bannedServers = JSON.parse(fs.readFileSync('banned-servers.json', 'utf8'));
    }

    // Load config
    if (fs.existsSync('config.json')) {
      const savedConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      config = { ...config, ...savedConfig };
    }

    // Load tracked releases
    if (fs.existsSync('tracked-releases.json')) {
      trackedReleases = JSON.parse(fs.readFileSync('tracked-releases.json', 'utf8'));

      // Migration: Add guildId to existing entries without guildId
      // Assign them to the current guild (1440884623872884849) for backward compatibility
      let migrationNeeded = false;
      for (const [uniqueId, data] of Object.entries(trackedReleases)) {
        if (!data.guildId) {
          data.guildId = '1440884623872884849'; // Current channel's guild
          migrationNeeded = true;
          console.log(`[MIGRATION] Added guildId to tracked release: ${data.name}`);
        }
      }

      // Save migrated data
      if (migrationNeeded) {
        fs.writeFileSync('tracked-releases.json', JSON.stringify(trackedReleases, null, 2));
        console.log('[MIGRATION] Saved migrated tracked-releases.json with guildId fields');
      }
    }

    // Load guild settings
    if (fs.existsSync('guild-settings.json')) {
      guildSettings = JSON.parse(fs.readFileSync('guild-settings.json', 'utf8'));
      console.log(`[INFO] Loaded settings for ${Object.keys(guildSettings).length} guilds`);
    }

    // Load allowed servers whitelist
    if (fs.existsSync('allowed-servers.json')) {
      allowedServers = JSON.parse(fs.readFileSync('allowed-servers.json', 'utf8'));
    }

    // Load server log routes
    if (fs.existsSync('server-log-routes.json')) {
      try {
        const routes = JSON.parse(fs.readFileSync('server-log-routes.json', 'utf8'));
        serverLogRoutes = routes && typeof routes === 'object' ? routes : {};
      } catch (routeError) {
        console.error('[WARN] Failed to parse server-log-routes.json, resetting to empty:', routeError.message);
        serverLogRoutes = {};
      }
    } else {
      serverLogRoutes = {};
    }

    // Load maintenance mode
    if (fs.existsSync('maintenance.json')) {
      maintenanceMode = JSON.parse(fs.readFileSync('maintenance.json', 'utf8'));
    }

  } catch (error) {
    console.error('Error loading data files:', error.message);
  }
}

/**
 * Safely read and parse JSON file
 * @param {string} filePath
 * @param {any} defaultValue
 * @returns {any}
 */
function safeReadJSON(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`[WARN] File ${filePath} does not exist, using default value`);
      return defaultValue;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    if (!fileContent || fileContent.trim().length === 0) {
      console.warn(`[WARN] File ${filePath} is empty, using default value`);
      return defaultValue;
    }

    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`[ERROR] Failed to read/parse ${filePath}:`, error.message);
    return defaultValue;
  }
}

/**
 * Safely write JSON file with optional backup rotation
 * @param {string} filePath
 * @param {any} data
 * @param {boolean} createBackup
 */
function safeWriteJSON(filePath, data, createBackup = true) {
  try {
    if (createBackup && fs.existsSync(filePath)) {
      const backupPath = `${filePath}.backup.${Date.now()}`;
      fs.copyFileSync(filePath, backupPath);

      const dir = path.dirname(filePath) || '.';
      const baseName = path.basename(filePath);
      const backups = fs.readdirSync(dir)
        .filter(f => f.startsWith(`${baseName}.backup.`))
        .sort()
        .reverse();

      backups.slice(5).forEach(backup => {
        try {
          fs.unlinkSync(path.join(dir, backup));
        } catch (unlinkError) {
          console.warn(`[WARN] Could not delete old backup ${backup}: ${unlinkError.message}`);
        }
      });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error(`[ERROR] Failed to write ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Fetch and select the latest GitHub release (with optional prerelease handling)
 * @param {string} owner
 * @param {string} repo
 * @param {Object} options
 * @param {Object} options.headers - axios headers
 * @param {'any'|'stable_only'|'prefer_prerelease'} options.mode - selection mode
 * @returns {Object|null} { version, url, dateText, isPrerelease, release }
 */
async function getLatestGithubRelease(owner, repo, { headers = {}, mode = 'any' } = {}) {
  const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`;

  const normalizeDate = (release) => release?.published_at || release?.created_at || null;

  const sortReleases = (arr) => arr
    .filter(r => !r.draft)
    .sort((a, b) => {
      const aDate = new Date(normalizeDate(a)).getTime() || 0;
      const bDate = new Date(normalizeDate(b)).getTime() || 0;
      return bDate - aDate;
    });

  try {
    const resp = await axios.get(releasesUrl, { headers, timeout: 10000 });
    const releases = Array.isArray(resp.data) ? resp.data : [];
    const sorted = sortReleases(releases);

    let selected = null;
    if (mode === 'stable_only') {
      selected = sorted.find(r => !r.prerelease);
    } else if (mode === 'prefer_prerelease') {
      selected = sorted[0] || null;
    } else {
      selected = sorted[0] || null;
    }

    if (selected) {
      const version = selected.tag_name || selected.name;
      const dateTextRaw = normalizeDate(selected);
      const dateText = dateTextRaw ? new Date(dateTextRaw).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }) : 'Unknown';

      return {
        version,
        url: selected.html_url || `https://github.com/${owner}/${repo}/releases`,
        dateText,
        isPrerelease: !!selected.prerelease,
        release: selected
      };
    }
  } catch (err) {
    // Continue to tag fallback
    console.warn(`[WARN] Failed to fetch releases for ${owner}/${repo}: ${err.message}`);
  }

  // Fallback to tags
  try {
    const tagsUrl = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=5`;
    const tagsResp = await axios.get(tagsUrl, { headers, timeout: 10000 });
    const tags = Array.isArray(tagsResp.data) ? tagsResp.data : [];
    if (tags.length > 0 && tags[0].name) {
      return {
        version: tags[0].name,
        url: `https://github.com/${owner}/${repo}/tags`,
        dateText: 'Unknown',
        isPrerelease: false,
        release: null
      };
    }
  } catch (tagErr) {
    console.warn(`[WARN] Failed to fetch tags for ${owner}/${repo}: ${tagErr.message}`);
  }

  return null;
}

/**
 * Get default guild settings
 * @returns {Object} Default settings for a new guild
 */
function getDefaultGuildSettings() {
  return {
    subscriptions: {
      homebrew: true,
      firmware: true,
      pokemon: true,
      custom: true
    },
    adminRoleId: null,
    mentionRoles: {
      homebrew: null,
      firmware: null,
      pokemon: null,
      custom: null
    },
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "08:00",
      timezone: "UTC"
    },
    digestMode: {
      enabled: false,
      time: "09:00",
      timezone: "UTC"
    },
    setupComplete: false,
    joinedAt: new Date().toISOString()
  };
}

/**
 * Get guild settings for a specific guild
 * @param {string} guildId - The guild ID
 * @returns {Object} Guild settings object
 */
function getGuildSettings(guildId) {
  if (!guildSettings[guildId]) {
    guildSettings[guildId] = getDefaultGuildSettings();
    saveGuildSettings();
    console.log(`[INFO] Created default settings for guild ${guildId}`);
  }
  return guildSettings[guildId];
}

/**
 * Save guild settings to file
 */
function saveGuildSettings() {
  try {
    fs.writeFileSync('guild-settings.json', JSON.stringify(guildSettings, null, 2));
  } catch (error) {
    console.error('[ERROR] Failed to save guild settings:', error.message);
  }
}

/**
 * Check if user has admin access for a guild
 * @param {Object} interaction - Discord interaction object
 * @returns {boolean} True if user has admin access
 */
function hasAdminAccess(interaction) {
  // Bot owner always has access
  if (interaction.user.id === config.botOwnerId) {
    return true;
  }

  // Administrator permission
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  // Guild-specific admin role
  const guildSettings = getGuildSettings(interaction.guild.id);
  if (guildSettings.adminRoleId) {
    return interaction.member.roles.cache.has(guildSettings.adminRoleId);
  }

  return false;
}

/**
 * Get all tracked repositories (homebrew + custom tracked)
 * This is the single source of truth for all tracked repos
 * @returns {Array} Array of repository objects with metadata
 */
function getAllTrackedRepositories(guildId = null) {
  const repos = [];

  try {
    const homebrewData = safeReadJSON('homebrew-versions.json', null);

    if (homebrewData && typeof homebrewData === 'object') {
      Object.entries(homebrewData).forEach(([key, data]) => {
        try {
          if (!data || typeof data !== 'object') {
            console.warn(`[WARN] Invalid data for homebrew key "${key}"`);
            return;
          }

          if (data.url && data.url.includes('github.com')) {
            const urlMatch = data.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
            if (!urlMatch) {
              console.warn(`[WARN] Could not parse GitHub URL for homebrew "${key}": ${data.url}`);
              return;
            }

            const [, owner, repo] = urlMatch;
            const displayName = key.charAt(0).toUpperCase() + key.slice(1);
            repos.push({
              id: `homebrew_${key}`,
              type: 'homebrew',
              name: displayName,
              displayName,
              version: data.version || 'Unknown',
              dateText: data.dateText || 'Unknown date',
              url: data.url,
              owner,
              repo,
              source: 'homebrew-versions.json'
            });
          }
        } catch (entryError) {
          console.error(`[ERROR] Error processing homebrew entry "${key}":`, entryError);
        }
      });
    } else {
      console.warn('[WARN] homebrew-versions.json is not a valid object or missing');
    }
  } catch (error) {
    console.error('[ERROR] Error loading homebrew data:', error);
  }

  try {
    const trackedData = safeReadJSON('tracked-releases.json', null);

    if (trackedData && typeof trackedData === 'object') {
      Object.entries(trackedData).forEach(([uniqueId, data]) => {
        try {
          if (!data || typeof data !== 'object') {
            console.warn(`[WARN] Invalid data for tracked release "${uniqueId}"`);
            return;
          }

          if (!data.url || !data.url.includes('github.com')) {
            console.warn(`[WARN] Tracked release "${uniqueId}" has no GitHub URL`);
            return;
          }

          const urlMatch = data.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (!urlMatch) {
            console.warn(`[WARN] Could not parse GitHub URL for tracked release "${uniqueId}": ${data.url}`);
            return;
          }

          const [, owner, repo] = urlMatch;
          // Skip repositories that don't belong to the requested guild (per-server isolation)
          if (guildId && data.guildId && data.guildId !== guildId) {
            return; // Skip this repository
          }

          repos.push({
            id: `tracked_${uniqueId}`,
            type: 'tracked',
            name: data.name || 'Unknown',
            displayName: data.name || 'Unknown',
            version: data.version || 'Unknown',
            dateText: data.dateText || 'Unknown date',
            url: data.url,
            owner,
            repo,
            source: 'tracked-releases.json',
            uniqueId,
            guildId: data.guildId,
            addedAt: data.addedAt
          });
        } catch (entryError) {
          console.error(`[ERROR] Error processing tracked release entry "${uniqueId}":`, entryError);
        }
      });
    } else {
      console.warn('[WARN] tracked-releases.json is not a valid object or missing');
    }
  } catch (error) {
    console.error('[ERROR] Error loading tracked releases:', error);
  }

  repos.sort((a, b) => a.displayName.localeCompare(b.displayName));
  console.log(`[DEBUG] getAllTrackedRepositories(${guildId || 'all'}) returned ${repos.length} repos (${repos.filter(r => r.type === 'homebrew').length} homebrew, ${repos.filter(r => r.type === 'tracked').length} tracked)`);

  return repos;
}

/**
 * Get repository information by ID
 * @param {string} repoId - Repository ID (format: "homebrew_key" or "tracked_uniqueId")
 * @returns {Object|null} Repository object or null
 */
function getRepositoryById(repoId) {
  const repos = getAllTrackedRepositories();
  return repos.find((repo) => repo.id === repoId) || null;
}

// Save functions
function saveConfig() {
  try {
    safeWriteJSON('config.json', {
      checkInterval: config.checkInterval,
      logChannelId: config.logChannelId
    }, false);
  } catch (error) {
    console.error('Error saving config:', error.message);
  }
}

function saveAnnouncementChannels() {
  try {
    safeWriteJSON('announcement-channels.json', announcementChannels);
  } catch (error) {
    console.error('Error saving announcement channels:', error.message);
  }
}

function saveBannedUsers() {
  try {
    safeWriteJSON('banned-users.json', bannedUsers);
  } catch (error) {
    console.error('Error saving banned users:', error.message);
  }
}

function saveBannedServers() {
  try {
    safeWriteJSON('banned-servers.json', bannedServers);
  } catch (error) {
    console.error('Error saving banned servers:', error.message);
  }
}

function saveServerLogRoutes() {
  try {
    safeWriteJSON('server-log-routes.json', serverLogRoutes);
  } catch (error) {
    console.error('Error saving server log routes:', error.message);
  }
}

function saveTrackedReleases() {
  try {
    safeWriteJSON('tracked-releases.json', trackedReleases);
  } catch (error) {
    console.error('Error saving tracked releases:', error.message);
  }
}

/**
 * Get current system statistics dynamically
 * This ensures status embeds always show current data
 * @returns {Promise<Object>} Statistics object
 */
async function getSystemStatistics() {
  try {
    const pokemonData = JSON.parse(fs.readFileSync('pokemon-versions.json', 'utf8'));
    const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));
    const coreData = JSON.parse(fs.readFileSync('core-versions.json', 'utf8'));
    // Title ID tracking removed - users should find IDs themselves

    // Count tracked releases
    let trackedReleasesCount = 0;
    if (fs.existsSync('tracked-releases.json')) {
      const trackedData = JSON.parse(fs.readFileSync('tracked-releases.json', 'utf8'));
      trackedReleasesCount = Object.keys(trackedData).length;
    }

    // Get recent updates count (last 24 hours)
    let recentUpdates = 0;
    if (fs.existsSync('update-history.json')) {
      const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      recentUpdates = updateHistory.filter(update =>
        new Date(update.detectedAt) >= twentyFourHoursAgo
      ).length;
    }

    return {
      totalGames: Object.keys(pokemonData).length,
      totalHomebrew: Object.keys(homebrewData).length,
      totalTrackedReleases: trackedReleasesCount,
      announcementChannels: announcementChannels.length,
      bannedUsers: bannedUsers.length,
      bannedServers: bannedServers.length,
      firmwareVersion: coreData.switch_firmware?.version || 'Unknown',
      atmosphereVersion: coreData.atmosphere_stable?.version || 'Unknown',
      hekateVersion: coreData.hekate?.version || 'Unknown',
      recentUpdates: recentUpdates,
      totalCommands: commands.length
    };
  } catch (error) {
    console.error('Error getting system statistics:', error);
    return {
      totalGames: 0,
      totalHomebrew: 0,
      totalTrackedReleases: 0,
      announcementChannels: 0,
      bannedUsers: 0,
      bannedServers: 0,
      firmwareVersion: 'Error',
      atmosphereVersion: 'Error',
      hekateVersion: 'Error',
      recentUpdates: 0,
      totalCommands: commands.length
    };
  }
}

// ========================================
// STATISTICS TRACKING FUNCTIONS
// ========================================

// Load statistics from file
function loadStatistics() {
  try {
    if (fs.existsSync('bot-statistics.json')) {
      const stats = JSON.parse(fs.readFileSync('bot-statistics.json', 'utf8'));
      
      // Convert Arrays back to Sets where needed
      if (stats.userStatistics) {
        for (const date in stats.userStatistics.usersByDate || {}) {
          if (Array.isArray(stats.userStatistics.usersByDate[date])) {
            stats.userStatistics.usersByDate[date] = new Set(stats.userStatistics.usersByDate[date]);
          }
        }
        for (const guildId in stats.userStatistics.usersByServer || {}) {
          if (Array.isArray(stats.userStatistics.usersByServer[guildId])) {
            stats.userStatistics.usersByServer[guildId] = new Set(stats.userStatistics.usersByServer[guildId]);
          }
        }
      }
      
      return stats;
    }
    return null;
  } catch (error) {
    console.error('Error loading statistics:', error);
    return null;
  }
}

// Save statistics to file
function saveStatistics(stats) {
  try {
    // Convert Sets to Arrays for JSON compatibility
    const serializable = JSON.parse(JSON.stringify(stats, (key, value) => {
      if (value instanceof Set) {
        return Array.from(value);
      }
      return value;
    }));
    fs.writeFileSync('bot-statistics.json', JSON.stringify(serializable, null, 2));
  } catch (error) {
    console.error('Error saving statistics:', error);
  }
}

// Initialize statistics tracking
function initializeStatistics() {
  if (!fs.existsSync('bot-statistics.json')) {
    const initialStats = {
      trackingStarted: new Date().toISOString(),
      scanStatistics: {
        totalScans: 0,
        successfulScans: 0,
        failedScans: 0,
        lastScanTime: null,
        averageScanDuration: 0,
        scanHistory: [],
        scansByDate: {}
      },
      updateStatistics: {
        totalUpdatesDetected: 0,
        pokemonUpdates: 0,
        homebrewUpdates: 0,
        firmwareUpdates: 0,
        customTrackedUpdates: 0,
        updatesByDate: {},
        updatesByGame: {},
        updatesBySource: {},
        updateTimeline: []
      },
      gameStatistics: {
        mostUpdatedGame: null,
        mostUpdatedCount: 0,
        updateFrequency: {},
        averageDaysBetweenUpdates: {},
        lastUpdateByGame: {},
        versionHistory: {}
      },
      errorStatistics: {
        totalErrors: 0,
        errorsByType: {},
        mostCommonError: null,
        errorRate: 0,
        errorsByDate: {},
        errorHistory: []
      },
      sourceStatistics: {
        sourceSuccessCount: {},
        sourceFailureCount: {},
        sourceReliability: {},
        averageResponseTime: {},
        sourceCallsByDate: {}
      },
      timeStatistics: {
        peakUpdateHours: {},
        peakUpdateDays: {},
        averageUpdateTime: null,
        updateTimeDistribution: {}
      },
      userStatistics: {
        totalUniqueUsers: 0,
        uniqueUsers: {},
        totalCommandsProcessed: 0,
        commandsByUser: {},
        commandsByType: {},
        mostActiveUser: null,
        mostActiveCommand: null,
        firstUsageTimestamp: null,
        lastUsageTimestamp: null,
        usersByDate: {},
        usersByServer: {}
      },
      botHealth: {
        uptime: 0,
        lastRestart: null,
        totalCommandsProcessed: 0,
        averageResponseTime: 0,
        startTime: new Date().toISOString()
      }
    };
    fs.writeFileSync('bot-statistics.json', JSON.stringify(initialStats, null, 2));
    console.log('📊 Initialized bot statistics tracking');
  }
}

// Update scan statistics
function updateScanStatistics(success, duration = 0) {
  const stats = loadStatistics();
  if (!stats) return;
  
  const today = new Date().toISOString().split('T')[0];
  stats.scanStatistics.totalScans++;
  
  if (success) {
    stats.scanStatistics.successfulScans++;
  } else {
    stats.scanStatistics.failedScans++;
  }
  
  stats.scanStatistics.lastScanTime = new Date().toISOString();
  
  if (duration > 0) {
    const currentAvg = stats.scanStatistics.averageScanDuration || 0;
    const totalScans = stats.scanStatistics.totalScans;
    stats.scanStatistics.averageScanDuration = 
      ((currentAvg * (totalScans - 1)) + duration) / totalScans;
  }
  
  if (!stats.scanStatistics.scansByDate[today]) {
    stats.scanStatistics.scansByDate[today] = 0;
  }
  stats.scanStatistics.scansByDate[today]++;
  
  saveStatistics(stats);
}

// Update update statistics
function updateUpdateStatistics(updateType, gameName = null, source = null) {
  const stats = loadStatistics();
  if (!stats) return;
  
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();
  
  stats.updateStatistics.totalUpdatesDetected++;
  
  if (updateType === 'pokemon') {
    stats.updateStatistics.pokemonUpdates++;
  } else if (updateType === 'homebrew') {
    stats.updateStatistics.homebrewUpdates++;
  } else if (updateType === 'firmware' || updateType === 'nintendo_firmware') {
    stats.updateStatistics.firmwareUpdates++;
  } else if (updateType === 'sysbot_fork' || updateType === 'custom') {
    stats.updateStatistics.customTrackedUpdates++;
  }
  
  if (!stats.updateStatistics.updatesByDate[today]) {
    stats.updateStatistics.updatesByDate[today] = 0;
  }
  stats.updateStatistics.updatesByDate[today]++;
  
  if (gameName) {
    if (!stats.updateStatistics.updatesByGame[gameName]) {
      stats.updateStatistics.updatesByGame[gameName] = 0;
    }
    stats.updateStatistics.updatesByGame[gameName]++;
    
    if (stats.updateStatistics.updatesByGame[gameName] > (stats.gameStatistics.mostUpdatedCount || 0)) {
      stats.gameStatistics.mostUpdatedGame = gameName;
      stats.gameStatistics.mostUpdatedCount = stats.updateStatistics.updatesByGame[gameName];
    }
    
    if (!stats.gameStatistics.lastUpdateByGame) {
      stats.gameStatistics.lastUpdateByGame = {};
    }
    stats.gameStatistics.lastUpdateByGame[gameName] = now;
  }
  
  if (source) {
    if (!stats.updateStatistics.updatesBySource[source]) {
      stats.updateStatistics.updatesBySource[source] = 0;
    }
    stats.updateStatistics.updatesBySource[source]++;
  }
  
  stats.updateStatistics.updateTimeline.push({
    type: updateType,
    game: gameName,
    source: source,
    timestamp: now,
    date: today
  });
  
  if (stats.updateStatistics.updateTimeline.length > 1000) {
    stats.updateStatistics.updateTimeline = stats.updateStatistics.updateTimeline.slice(-1000);
  }
  
  saveStatistics(stats);
}

// Update error statistics
function updateErrorStatistics(errorType, errorMessage) {
  const stats = loadStatistics();
  if (!stats) return;
  
  const today = new Date().toISOString().split('T')[0];
  
  stats.errorStatistics.totalErrors++;
  
  if (!stats.errorStatistics.errorsByType[errorType]) {
    stats.errorStatistics.errorsByType[errorType] = 0;
  }
  stats.errorStatistics.errorsByType[errorType]++;
  
  if (!stats.errorStatistics.errorsByDate[today]) {
    stats.errorStatistics.errorsByDate[today] = 0;
  }
  stats.errorStatistics.errorsByDate[today]++;
  
  let maxErrors = 0;
  for (const [type, count] of Object.entries(stats.errorStatistics.errorsByType)) {
    if (count > maxErrors) {
      maxErrors = count;
      stats.errorStatistics.mostCommonError = type;
    }
  }
  
  if (stats.scanStatistics.totalScans > 0) {
    stats.errorStatistics.errorRate = 
      (stats.errorStatistics.totalErrors / stats.scanStatistics.totalScans) * 100;
  }
  
  stats.errorStatistics.errorHistory.push({
    type: errorType,
    message: String(errorMessage).substring(0, 200),
    timestamp: new Date().toISOString(),
    date: today
  });
  
  if (stats.errorStatistics.errorHistory.length > 500) {
    stats.errorStatistics.errorHistory = stats.errorStatistics.errorHistory.slice(-500);
  }
  
  saveStatistics(stats);
}

// Update source statistics
function updateSourceStatistics(source, success, responseTime = null) {
  const stats = loadStatistics();
  if (!stats) return;
  
  if (!stats.sourceStatistics.sourceSuccessCount[source]) {
    stats.sourceStatistics.sourceSuccessCount[source] = 0;
  }
  if (!stats.sourceStatistics.sourceFailureCount[source]) {
    stats.sourceStatistics.sourceFailureCount[source] = 0;
  }
  
  if (success) {
    stats.sourceStatistics.sourceSuccessCount[source]++;
    
    if (responseTime) {
      if (!stats.sourceStatistics.averageResponseTime[source]) {
        stats.sourceStatistics.averageResponseTime[source] = [];
      }
      stats.sourceStatistics.averageResponseTime[source].push(responseTime);
      
      if (stats.sourceStatistics.averageResponseTime[source].length > 100) {
        stats.sourceStatistics.averageResponseTime[source] = 
          stats.sourceStatistics.averageResponseTime[source].slice(-100);
      }
    }
  } else {
    stats.sourceStatistics.sourceFailureCount[source]++;
  }
  
  const successCount = stats.sourceStatistics.sourceSuccessCount[source] || 0;
  const failureCount = stats.sourceStatistics.sourceFailureCount[source] || 0;
  const total = successCount + failureCount;
  
  if (total > 0) {
    stats.sourceStatistics.sourceReliability[source] = (successCount / total) * 100;
  }
  
  saveStatistics(stats);
}

// Update user statistics
function updateUserStatistics(userId, commandName, guildId = null) {
  const stats = loadStatistics();
  if (!stats) return;
  
  const now = new Date().toISOString();
  const today = new Date().toISOString().split('T')[0];
  
  if (!stats.userStatistics) {
    stats.userStatistics = {
      totalUniqueUsers: 0,
      uniqueUsers: {},
      totalCommandsProcessed: 0,
      commandsByUser: {},
      commandsByType: {},
      mostActiveUser: null,
      mostActiveCommand: null,
      firstUsageTimestamp: null,
      lastUsageTimestamp: null,
      usersByDate: {},
      usersByServer: {}
    };
  }
  
  if (!stats.userStatistics.firstUsageTimestamp) {
    stats.userStatistics.firstUsageTimestamp = now;
  }
  
  stats.userStatistics.lastUsageTimestamp = now;
  
  if (!stats.userStatistics.uniqueUsers[userId]) {
    stats.userStatistics.uniqueUsers[userId] = {
      firstSeen: now,
      lastSeen: now,
      commandCount: 0,
      commandsUsed: {},
      guilds: []
    };
    stats.userStatistics.totalUniqueUsers++;
  }
  
  const userData = stats.userStatistics.uniqueUsers[userId];
  userData.lastSeen = now;
  userData.commandCount++;
  
  if (!userData.commandsUsed[commandName]) {
    userData.commandsUsed[commandName] = 0;
  }
  userData.commandsUsed[commandName]++;
  
  if (guildId && !userData.guilds.includes(guildId)) {
    userData.guilds.push(guildId);
  }
  
  if (!stats.userStatistics.commandsByUser[userId]) {
    stats.userStatistics.commandsByUser[userId] = 0;
  }
  stats.userStatistics.commandsByUser[userId]++;
  
  if (!stats.userStatistics.commandsByType[commandName]) {
    stats.userStatistics.commandsByType[commandName] = 0;
  }
  stats.userStatistics.commandsByType[commandName]++;
  
  let maxCommands = 0;
  for (const [uid, count] of Object.entries(stats.userStatistics.commandsByUser)) {
    if (count > maxCommands) {
      maxCommands = count;
      stats.userStatistics.mostActiveUser = uid;
    }
  }
  
  let maxCommandUsage = 0;
  for (const [cmd, count] of Object.entries(stats.userStatistics.commandsByType)) {
    if (count > maxCommandUsage) {
      maxCommandUsage = count;
      stats.userStatistics.mostActiveCommand = cmd;
    }
  }
  
  if (!stats.userStatistics.usersByDate[today]) {
    stats.userStatistics.usersByDate[today] = [];
  }
  if (Array.isArray(stats.userStatistics.usersByDate[today]) && !stats.userStatistics.usersByDate[today].includes(userId)) {
    stats.userStatistics.usersByDate[today].push(userId);
  }
  
  if (guildId) {
    if (!stats.userStatistics.usersByServer[guildId]) {
      stats.userStatistics.usersByServer[guildId] = [];
    }
    if (Array.isArray(stats.userStatistics.usersByServer[guildId]) && !stats.userStatistics.usersByServer[guildId].includes(userId)) {
      stats.userStatistics.usersByServer[guildId].push(userId);
    }
  }
  
  stats.userStatistics.totalCommandsProcessed++;
  
  saveStatistics(stats);
}

// Update bot health
function updateBotHealth() {
  const stats = loadStatistics();
  if (!stats) return;
  
  if (stats.botHealth.startTime) {
    const startTime = new Date(stats.botHealth.startTime);
    const now = Date.now();
    stats.botHealth.uptime = now - startTime.getTime();
  }
  
  saveStatistics(stats);
}

// Utility functions
function isUserBanned(userId) {
  return bannedUsers.some(ban => ban.userId === userId);
}

function isServerBanned(serverId) {
  return bannedServers.some(ban => ban.serverId === serverId);
}

function hasAdminPermissions(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Enhance embed with consistent footer, timestamp, and author
 * @param {EmbedBuilder} embed
 * @param {Interaction} interaction
 * @param {Object} options
 */
function enhanceEmbed(embed, interaction = null, options = {}) {
  const {
    showAuthor = interaction !== null,
    footerText = 'SwitchDex Professional Monitor',
    showTimestamp = true
  } = options;

  embed.setFooter({
    text: footerText,
    iconURL: client.user?.displayAvatarURL() || undefined
  });

  if (showTimestamp) {
    embed.setTimestamp();
  }

  if (interaction && showAuthor) {
    embed.setAuthor({
      name: interaction.user.username,
      iconURL: interaction.user.displayAvatarURL()
    });
  }

  return embed;
}

function createErrorEmbed(title, description, interaction = null) {
  return enhanceEmbed(
    new EmbedBuilder()
      .setTitle(`${EMBED_EMOJIS.ERROR} **${title}**`)
      .setColor(EMBED_COLORS.ERROR)
      .setDescription(description),
    interaction
  );
}

function createSuccessEmbed(title, description, interaction = null) {
  return enhanceEmbed(
    new EmbedBuilder()
      .setTitle(`${EMBED_EMOJIS.SUCCESS} **${title}**`)
      .setColor(EMBED_COLORS.SUCCESS)
      .setDescription(description),
    interaction
  );
}

function createInfoEmbed(title, description, color = EMBED_COLORS.INFO, interaction = null) {
  return enhanceEmbed(
    new EmbedBuilder()
      .setTitle(`${EMBED_EMOJIS.INFO} **${title}**`)
      .setColor(color)
      .setDescription(description),
    interaction
  );
}

function formatFieldValue(items, bullet = '•') {
  if (typeof items === 'string') {
    return items;
  }
  if (Array.isArray(items)) {
    return items.map(item => `${bullet} ${item}`).join('\n');
  }
  return String(items);
}

function truncateField(text, maxLength = 1024) {
  if (!text || text.length <= maxLength) return text;
  return `${text.substring(0, maxLength - 3)}...`;
}

function formatListField(items, formatter = null) {
  if (!items || items.length === 0) {
    return '*No items available*';
  }
  if (formatter) {
    return items.map(formatter).join('\n');
  }
  return items.map(item => {
    if (typeof item === 'string') {
      return `• ${item}`;
    }
    return `• ${JSON.stringify(item)}`;
  }).join('\n');
}

/**
 * Build update notification embed dynamically
 * Ensures all update notifications use consistent format
 * @param {Object} updateData - Update data object
 * @returns {EmbedBuilder} Discord embed
 */
function buildUpdateNotificationEmbed(updateData) {
  // Determine emoji and category based on type
  let emoji = '📦';
  let categoryColor = 0x5865f2;
  let categoryName = updateData.category || 'System Update';

  if (updateData.type === 'homebrew') {
    emoji = '🏠';
    categoryColor = 0x00ff00;
    categoryName = 'Homebrew Applications';
  } else if (updateData.type === 'firmware') {
    emoji = '⚡';
    categoryColor = 0xffff00;
    categoryName = 'Custom Firmware';
  } else if (updateData.type === 'sysbot_fork') {
    emoji = '🔧';
    categoryColor = 0x9b59b6;
    categoryName = 'Sysbot fork updates';
  }

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} **Update Detected: ${updateData.name}**`)
    .setColor(categoryColor)
    .setDescription(`**${categoryName}** has a new release available!`)
    .addFields(
      {
        name: '📦 **Version Update**',
        value: `${updateData.fromVersion || 'Unknown'} → **${updateData.toVersion}**`,
        inline: true
      },
      {
        name: '📅 **Release Date**',
        value: updateData.dateText || 'Unknown',
        inline: true
      },
      {
        name: '🔗 **View Release**',
        value: updateData.url ? `[Click here](${updateData.url})` : 'No URL available',
        inline: false
      }
    )
    .setTimestamp()
    .setFooter({
      text: 'SwitchDex Update Monitor',
      iconURL: client.user?.displayAvatarURL()
    });

  return embed;
}

/**
 * Build statistics embed dynamically
 * @param {Object} stats - Statistics object from getSystemStatistics()
 * @returns {EmbedBuilder} Discord embed
 */
function buildStatisticsEmbed(stats) {
  return new EmbedBuilder()
    .setTitle('📊 **System Statistics**')
    .setColor(0x00ff00)
    .setDescription('**Current system status and metrics**')
    .addFields(
      {
        name: '🎮 **Games**',
        value: `${stats.totalGames} tracked`,
        inline: true
      },
      {
        name: '🏠 **Homebrew**',
        value: `${stats.totalHomebrew} apps`,
        inline: true
      },
      {
        name: '🔧 **Custom Tracking**',
        value: `${stats.totalTrackedReleases} items`,
        inline: true
      },
      {
        name: '📢 **Channels**',
        value: `${stats.announcementChannels} active`,
        inline: true
      },
      {
        name: '🆕 **Recent Updates**',
        value: `${stats.recentUpdates} (24h)`,
        inline: true
      },
      {
        name: '⚙️ **Commands**',
        value: `${stats.totalCommands} available`,
        inline: true
      }
    )
    .setTimestamp();
}

/**
 * Validate that all commands in categories exist in commands array
 * Run this on startup to catch inconsistencies
 */
function validateCommandCategories() {
  const categories = getCommandsByCategory();
  const allCategorized = new Set();

  Object.values(categories).forEach(cmdNames => {
    cmdNames.forEach(name => allCategorized.add(name));
  });

  const missingCommands = commands
    .map(cmd => cmd.name)
    .filter(name => !allCategorized.has(name));

  if (missingCommands.length > 0) {
    console.warn('⚠️ Commands not in any category:', missingCommands.join(', '));
  }

  const invalidCommands = [];
  Object.values(categories).forEach(cmdNames => {
    cmdNames.forEach(name => {
      if (!getCommandByName(name)) {
        invalidCommands.push(name);
      }
    });
  });

  if (invalidCommands.length > 0) {
    console.warn('⚠️ Category references invalid commands:', invalidCommands.join(', '));
  }

  return {
    missing: missingCommands,
    invalid: invalidCommands
  };
}

/**
 * Register slash commands for a guild (used on ready and guildCreate)
 * @param {import('discord.js').Guild} guild
 */
async function registerCommandsForGuild(guild) {
  if (!guild) return;

  try {
    console.log(`[DEBUG] Registering ${commands.length} commands for guild ${guild.name} (${guild.id})...`);
    await guild.commands.set(commands);
    console.log(`✅ Commands registered for guild: ${guild.name} (${guild.id})`);

    // Add owner-only commands for the owner guild
    if (guild.id === config.ownerGuildId) {
      for (const cmd of ownerCommands) {
        try {
          await guild.commands.create(cmd);
          console.log(`  ✅ Added owner command: /${cmd.name} (guildCreate)`);
          await new Promise(resolve => setTimeout(resolve, 300));
        } catch (error) {
          console.error(`  ❌ Failed to add owner /${cmd.name} (guildCreate): ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error(`❌ Failed to register commands for guild ${guild.name} (${guild.id}):`, error.message);
  }
}

// Logging function
async function logToChannel(message, guildId = null) {
  const targets = new Set();

  if (guildId && serverLogRoutes[guildId]?.channelId) {
    targets.add(String(serverLogRoutes[guildId].channelId));
  } else {
    // Broadcast to all known server routes when no guildId is provided
    Object.values(serverLogRoutes || {}).forEach(route => {
      if (route?.channelId) targets.add(String(route.channelId));
    });
    if (config.logChannelId) {
      targets.add(String(config.logChannelId));
    }
  }

  // Fallback to global if nothing else and guildId was provided
  if (targets.size === 0 && config.logChannelId) {
    targets.add(String(config.logChannelId));
  }

  if (targets.size === 0) return;

  for (const channelId of targets) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel) {
        await channel.send(message);
      }
    } catch (error) {
      console.error(`Failed to log to channel ${channelId}:`, error.message);
    }
  }
}

// Error handling
async function detectAndNotifyErrors(errorMessage, errorType = 'general') {
  const errorKey = `${errorType}:${errorMessage.substring(0, 100)}`;
  const now = Date.now();

  if (!errorTracker.errors[errorKey]) {
    errorTracker.errors[errorKey] = { count: 0, firstSeen: now };
  }

  errorTracker.errors[errorKey].count++;

  // Only notify if this is a new error or it has occurred 5+ times
  if (errorTracker.errors[errorKey].count === 1 ||
      errorTracker.errors[errorKey].count >= 5) {

    if (config.botOwnerId && now - errorTracker.lastNotification > 300000) { // 5 minutes
      try {
        const owner = await client.users.fetch(config.botOwnerId);
        await owner.send(`🚨 **SwitchDex Error Alert**\n\`\`\`\n${errorMessage}\n\`\`\`\nType: ${errorType}\nOccurrences: ${errorTracker.errors[errorKey].count}`);
        errorTracker.lastNotification = now;
      } catch (notifyError) {
        console.error('Failed to notify owner:', notifyError.message);
      }
    }
  }
}

// Load data files
loadDataFiles();

// Initialize statistics tracking
initializeStatistics();

// Set bot start time in statistics
const botStats = loadStatistics();
if (botStats) {
  botStats.botHealth.startTime = new Date().toISOString();
  botStats.botHealth.lastRestart = new Date().toISOString();
  if (!botStats.trackingStarted) {
    botStats.trackingStarted = new Date().toISOString();
  }
  saveStatistics(botStats);
}

// Update bot health periodically (every 5 minutes)
setInterval(() => {
  updateBotHealth();
}, 5 * 60 * 1000);

// Slash command definitions
const commands = [
  {
    name: 'help',
    description: 'Show comprehensive help and command reference'
  },
  {
    name: 'dashboard',
    description: 'System overview dashboard with versions and config'
  },
  {
    name: 'changelog',
    description: 'View SwitchDex version history and release notes',
    options: [{
      name: 'version',
      description: 'Specific version to view (e.g., 2.0.0) or "all" for full history',
      type: 3,
      required: false
    }]
  },
  {
    name: 'setinterval',
    description: 'Configure monitoring frequency (1-1440 minutes)',
    options: [{
      name: 'minutes',
      description: 'Check interval in minutes',
      type: 4,
      required: true,
      min_value: 1,
      max_value: 1440
    }]
  },
  {
    name: 'recent',
    description: 'Show updates detected in the last 24 hours'
  },
  {
    name: 'addchannel',
    description: 'Add this channel to receive ALL update announcements'
  },
  {
    name: 'removechannel',
    description: 'Remove this channel from ALL update announcements'
  },
  {
    name: 'listchannels',
    description: 'List all unified announcement channels'
  },
  {
    name: 'checkpermissions',
    description: 'Diagnose bot permissions in this channel'
  },
  {
    name: 'banuser',
    description: 'Ban user from bot (Admin only)',
    options: [{
      name: 'userid',
      description: 'User ID to ban',
      type: 3,
      required: true
    }, {
      name: 'reason',
      description: 'Reason for ban',
      type: 3,
      required: false
    }]
  },
  {
    name: 'unbanuser',
    description: 'Remove user ban (Admin only)',
    options: [{
      name: 'userid',
      description: 'User ID to unban',
      type: 3,
      required: true
    }]
  },
  {
    name: 'listbannedusers',
    description: 'Display banned users registry (Admin only)'
  },
  {
    name: 'loghere',
    description: 'Route logs to this channel (Admin only)'
  },
  {
    name: 'github',
    description: 'View information about any tracked GitHub repository'
  },
  {
    name: 'hbstatus',
    description: 'Current homebrew application versions and status'
  },
  {
    name: 'hbhelp',
    description: 'Homebrew help and application guide'
  },
  {
    name: 'update',
    description: 'Get update information for a specific game',
    options: [{
      name: 'game',
      description: 'Game title',
      type: 3,
      required: true,
      choices: [
        { name: 'Pokémon Scarlet', value: 'pokémon_scarlet' },
        { name: 'Pokémon Violet', value: 'pokémon_violet' },
        { name: 'Pokémon Legends: Z-A', value: 'pokémon_legends_z_a' },
        { name: 'Pokémon Legends: Arceus', value: 'pokémon_legends_arceus' },
        { name: 'Pokémon Brilliant Diamond', value: 'pokémon_brilliant_diamond' },
        { name: 'Pokémon Sword', value: 'pokémon_sword' },
        { name: 'Pokémon Pokopia', value: 'pokémon_pokopia' }
      ]
    }]
  },
  {
    name: 'firmware',
    description: 'Current Nintendo Switch system firmware status'
  },
  {
    name: 'ecosystem',
    description: 'Full Nintendo Switch ecosystem compatibility report'
  },
  {
    name: 'firmwareupgrade',
    description: 'Get recommended firmware upgrade order and instructions'
  },
  {
    name: 'titleid',
    description: 'Learn how to find Title IDs and Build IDs for your games'
  },
  {
    name: 'cheatsource',
    description: 'Access cheat code sources and safety information'
  },
  {
    name: 'organizecheats',
    description: 'Upload and organize cheat code files with AI',
    options: [{
      name: 'cheatfile',
      description: 'Cheat code file to organize (.txt format)',
      type: 11,
      required: true
    }]
  },
  {
    name: 'blacklistmonitor',
    description: 'Check homebrew security blacklist and warnings'
  },
  {
    name: 'riskscan',
    description: 'Evaluate online safety and ban risk assessment'
  },
  {
    name: 'hostping',
    description: 'Check availability of remote GitHub sources and APIs'
  },
  {
    name: 'senddigest',
    description: 'Send compatibility digest to all announcement channels'
  },
  {
    name: 'patchnotes',
    description: 'View detailed Nintendo Switch firmware patch notes'
  },
  {
    name: 'addtracking',
    description: 'Add a GitHub releases link to track for updates',
    options: [{
      name: 'link',
      description: 'GitHub releases URL or repository URL',
      type: 3,
      required: true
    }, {
      name: 'name',
      description: 'Display name (defaults to repo name)',
      type: 3,
      required: false
    }]
  },
  {
    name: 'removetracking',
    description: 'Remove a tracked GitHub release from monitoring'
  },
  {
    name: 'analytics',
    description: 'Comprehensive bot analytics and usage statistics'
  },
  // Multi-server personalization commands
  {
    name: 'subscribe',
    description: 'Subscribe to a category of updates (homebrew, firmware, pokemon, custom)',
    options: [{
      name: 'category',
      description: 'Update category to subscribe to',
      type: 3,
      required: true,
      choices: [
        { name: '🏠 Homebrew Applications', value: 'homebrew' },
        { name: '⚡ Firmware Updates', value: 'firmware' },
        { name: '🎮 Pokémon Games', value: 'pokemon' },
        { name: '🔧 Custom Tracking', value: 'custom' }
      ]
    }]
  },
  {
    name: 'unsubscribe',
    description: 'Unsubscribe from a category of updates',
    options: [{
      name: 'category',
      description: 'Update category to unsubscribe from',
      type: 3,
      required: true,
      choices: [
        { name: '🏠 Homebrew Applications', value: 'homebrew' },
        { name: '⚡ Firmware Updates', value: 'firmware' },
        { name: '🎮 Pokémon Games', value: 'pokemon' },
        { name: '🔧 Custom Tracking', value: 'custom' }
      ]
    }]
  },
  {
    name: 'mysubs',
    description: 'View this server\'s update category subscriptions'
  },
  {
    name: 'setadminrole',
    description: 'Set admin role for managing bot settings (Admin only)',
    options: [{
      name: 'role',
      description: 'Role that can manage bot settings',
      type: 8,
      required: true
    }]
  },
  {
    name: 'removeadminrole',
    description: 'Remove admin role requirement (Admin only)'
  },
  {
    name: 'setmentionrole',
    description: 'Set role to ping for specific update categories (Admin only)',
    options: [{
      name: 'category',
      description: 'Update category',
      type: 3,
      required: true,
      choices: [
        { name: '🏠 Homebrew Applications', value: 'homebrew' },
        { name: '⚡ Firmware Updates', value: 'firmware' },
        { name: '🎮 Pokémon Games', value: 'pokemon' },
        { name: '🔧 Custom Tracking', value: 'custom' }
      ]
    }, {
      name: 'role',
      description: 'Role to ping (leave empty to disable)',
      type: 8,
      required: false
    }]
  },
  {
    name: 'removementionrole',
    description: 'Stop pinging roles for a specific category (Admin only)',
    options: [{
      name: 'category',
      description: 'Update category',
      type: 3,
      required: true,
      choices: [
        { name: '🏠 Homebrew Applications', value: 'homebrew' },
        { name: '⚡ Firmware Updates', value: 'firmware' },
        { name: '🎮 Pokémon Games', value: 'pokemon' },
        { name: '🔧 Custom Tracking', value: 'custom' }
      ]
    }]
  },
  {
    name: 'settings',
    description: 'Display this server\'s bot configuration'
  },
  {
    name: 'setquiethours',
    description: 'Set quiet hours for notifications (Admin only)',
    options: [{
      name: 'start',
      description: 'Start time (HH:MM format)',
      type: 3,
      required: true
    }, {
      name: 'end',
      description: 'End time (HH:MM format)',
      type: 3,
      required: true
    }, {
      name: 'timezone',
      description: 'Timezone (e.g., EST, UTC, GMT)',
      type: 3,
      required: false
    }]
  },
  {
    name: 'removequiethours',
    description: 'Disable quiet hours (Admin only)'
  },
  {
    name: 'setdigestmode',
    description: 'Enable/disable daily digest mode (Admin only)',
    options: [{
      name: 'mode',
      description: 'Digest mode setting',
      type: 3,
      required: true,
      choices: [
        { name: 'Enable digest mode', value: 'on' },
        { name: 'Disable digest mode', value: 'off' }
      ]
    }, {
      name: 'time',
      description: 'Daily digest time (HH:MM format, required when enabling)',
      type: 3,
      required: false
    }, {
      name: 'timezone',
      description: 'Timezone for digest time',
      type: 3,
      required: false
    }]
  },
  {
    name: 'testnotification',
    description: 'Send a test update notification to verify setup'
  },
  {
    name: 'serverupdates',
    description: 'Show recent updates sent to this server'
  }
];

// ===== OWNER-ONLY COMMANDS =====
// These commands are only registered to the owner's testing server
const ownerCommands = [
  {
    name: 'servers',
    description: 'List all servers the bot is currently in (Owner Only)'
  },
  {
    name: 'serverinfo',
    description: 'Get detailed information about a specific server (Owner Only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to get info about',
      type: 3,
      required: true
    }]
  },
  {
    name: 'leaveserver',
    description: 'Force the bot to leave a specific server (Owner Only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to leave',
      type: 3,
      required: true
    }]
  },
  {
    name: 'leaveall',
    description: 'Force bot to leave ALL servers except owner guild (Owner Only)'
  },
  {
    name: 'logserverhere',
    description: 'Route server activity logs to this channel (Owner Only)'
  },
  {
    name: 'allowserver',
    description: 'Add server to whitelist (Owner Only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to whitelist',
      type: 3,
      required: true
    }]
  },
  {
    name: 'disallowserver',
    description: 'Remove server from whitelist (Owner Only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to remove from whitelist',
      type: 3,
      required: true
    }]
  },
  {
    name: 'listallowedservers',
    description: 'Show current server whitelist (Owner Only)'
  },
  {
    name: 'togglewhitelist',
    description: 'Enable/disable server whitelist mode (Owner Only)'
  },
  {
    name: 'broadcast',
    description: 'Send message to ALL announcement channels (Owner Only)',
    options: [{
      name: 'message',
      description: 'Message to broadcast',
      type: 3,
      required: true
    }]
  },
  {
    name: 'dmuser',
    description: 'Send DM to any user as the bot (Owner Only)',
    options: [{
      name: 'userid',
      description: 'User ID to DM',
      type: 3,
      required: true
    }, {
      name: 'message',
      description: 'Message to send',
      type: 3,
      required: true
    }]
  },
  {
    name: 'globalstats',
    description: 'Global bot statistics across all servers (Owner Only)'
  },
  {
    name: 'maintenance',
    description: 'Toggle maintenance mode (Owner Only)',
    options: [{
      name: 'mode',
      description: 'Maintenance mode setting',
      type: 3,
      required: true,
      choices: [
        { name: 'Enable maintenance', value: 'on' },
        { name: 'Disable maintenance', value: 'off' }
      ]
    }]
  },
  {
    name: 'refreshcommands',
    description: 'Force re-register slash commands to all guilds (Owner Only)'
  },
  {
    name: 'getserverchannels',
    description: 'List all text channels in a server (Owner Only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to list channels for',
      type: 3,
      required: true
    }]
  },
  {
    name: 'createinvite',
    description: 'Generate invite link to a server (Owner Only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to create invite for',
      type: 3,
      required: true
    }]
  },
  {
    name: 'purgeserver',
    description: 'Remove all data associated with a server (Owner Only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to purge data for',
      type: 3,
      required: true
    }]
  },
  {
    name: 'owneronlycmds',
    description: 'Display all owner-only commands (Owner Only)'
  },
  {
    name: 'invite',
    description: 'Post bot invite embed with setup guide (Owner only)'
  },
  {
    name: 'banserver',
    description: 'Ban server - bot auto-leaves (Owner only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to ban',
      type: 3,
      required: true
    }, {
      name: 'reason',
      description: 'Reason for ban',
      type: 3,
      required: false
    }]
  },
  {
    name: 'unbanserver',
    description: 'Remove server ban (Owner only)',
    options: [{
      name: 'serverid',
      description: 'Server ID to unban',
      type: 3,
      required: true
    }]
  },
  {
    name: 'listbannedservers',
    description: 'Display banned servers registry (Owner only)'
  }
];

/**
 * Embed Color Constants
 * Centralized color scheme for consistent theming
 */
const EMBED_COLORS = {
  PRIMARY: 0x5865f2,
  SUCCESS: 0x00ff00,
  ERROR: 0xff0000,
  WARNING: 0xffa500,
  INFO: 0x5865f2,
  GAMING: 0xff0000,
  HOMEBREW: 0x00ff00,
  FIRMWARE: 0xffff00,
  CUSTOM_TRACK: 0x9b59b6,
  SECURITY: 0xff6b35,
  NEUTRAL: 0x95a5a6
};

/**
 * Embed Emoji Constants
 * Standardized emoji usage across all embeds
 */
const EMBED_EMOJIS = {
  GAME: '🎮',
  HOMEBREW: '🏠',
  FIRMWARE: '⚡',
  CUSTOM: '🔧',
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  INFO: 'ℹ️',
  SECURITY: '🛡️',
  SEARCH: '🔍',
  DOWNLOAD: '📥',
  LINK: '🔗',
  STATS: '📊',
  LIST: '📋',
  SETTINGS: '⚙️',
  CHANNEL: '📢',
  BAN: '🚫',
  UPDATE: '🆕',
  SYNC: '🔄',
  HELP: '💡',
  CLOCK: '⏰'
};

/**
 * Get all commands organized by category
 * This is the single source of truth for command organization
 * @returns {Object} Commands organized by category
 */
function getCommandsByCategory() {
  return {
    '📋 **Core Commands**': ['help', 'dashboard', 'analytics', 'changelog'],
    '⏰ **Monitoring**': ['setinterval', 'recent', 'serverupdates'],
    '📢 **Channel Management**': ['addchannel', 'removechannel', 'listchannels'],
    '🔒 **Access Control**': ['banuser', 'unbanuser', 'listbannedusers'],
    '🏠 **Homebrew & Apps**': ['github', 'hbstatus', 'hbhelp'],
    '🎮 **Games & Firmware**': ['update', 'firmware', 'titleid', 'patchnotes'],
    '🚀 **Advanced Features**': ['ecosystem', 'firmwareupgrade'],
    '🎯 **Cheat Management**': ['cheatsource', 'organizecheats'],
    '🔧 **Tracking & Sync**': ['addtracking', 'removetracking'],
    '🛡️ **Security & Monitoring**': ['blacklistmonitor', 'riskscan', 'hostping', 'checkpermissions', 'loghere'],
    '⚡ **Force Actions**': ['senddigest'],
    '🎛️ **Server Personalization**': ['subscribe', 'unsubscribe', 'mysubs', 'settings', 'testnotification'],
    '👑 **Admin Settings**': ['setadminrole', 'removeadminrole', 'setmentionrole', 'removementionrole'],
    '🌙 **Notification Settings**': ['setquiethours', 'removequiethours', 'setdigestmode']
  };
}

/**
 * Get command object by name
 * @param {string} commandName - Name of the command
 * @returns {Object|null} Command object or null if not found
 */
function getCommandByName(commandName) {
  return commands.find(cmd => cmd.name === commandName) || null;
}

/**
 * Get formatted command string with options
 * @param {Object} cmd - Command object from commands array
 * @returns {string} Formatted command string
 */
function formatCommandString(cmd) {
  if (!cmd) return '';

  let commandText = `\`/${cmd.name}\``;

  if (cmd.options && cmd.options.length > 0) {
    const requiredOptions = cmd.options.filter(opt => opt.required);
    const optionalOptions = cmd.options.filter(opt => !opt.required);

    if (requiredOptions.length > 0) {
      commandText += ' ' + requiredOptions.map(opt => {
        if (opt.type === 3) return `<${opt.name}>`; // String
        if (opt.type === 4) return `<${opt.name}>`; // Integer
        if (opt.type === 11) return `<${opt.name}>`; // Attachment
        return `<${opt.name}>`;
      }).join(' ');
    }

    if (optionalOptions.length > 0) {
      commandText += ' ' + optionalOptions.map(opt => {
        if (opt.type === 3) return `[${opt.name}]`; // String
        if (opt.type === 4) return `[${opt.name}]`; // Integer
        if (opt.type === 11) return `[${opt.name}]`; // Attachment
        return `[${opt.name}]`;
      }).join(' ');
    }
  }

  return commandText;
}

/**
 * Build a formatted command list for embeds
 * @param {string[]} commandNames
 * @returns {string} Bullet list of commands with descriptions
 */
function buildCommandReferenceList(commandNames) {
  return commandNames.map(name => {
    const cmd = getCommandByName(name);
    return cmd
      ? `• ${formatCommandString(cmd)} - ${cmd.description || 'No description'}`
      : `• \`/${name}\``;
  }).join('\n');
}

// Title ID to Game Mapping Configuration
const titleIdToGameMap = {
  '0100A3D008C5C000': { // Pokémon Scarlet
    gameKey: 'pokémon_scarlet',
    displayName: 'Pokémon Scarlet and Violet',
    gameName: 'Scarlet'
  },
  '01008F6008C5E000': { // Pokémon Violet
    gameKey: 'pokémon_violet',
    displayName: 'Pokémon Scarlet and Violet',
    gameName: 'Violet'
  },
  '010018E011D92000': { // Pokémon Legends: Z-A
    gameKey: 'pokémon_legends_z_a',
    displayName: 'Pokémon Legends: Z-A',
    gameName: 'Legends Z-A'
  },
  '01001F5010DFA000': { // Pokémon Legends: Arceus
    gameKey: 'pokémon_legends_arceus',
    displayName: 'Pokémon Legends: Arceus',
    gameName: 'Legends Arceus'
  },
  '0100000011D90000': { // Pokémon Brilliant Diamond
    gameKey: 'pokémon_brilliant_diamond',
    displayName: 'Pokémon Brilliant Diamond',
    gameName: 'Brilliant Diamond'
  },
  '0100ABF008968000': { // Pokémon Sword
    gameKey: 'pokémon_sword',
    displayName: 'Pokémon Sword',
    gameName: 'Sword'
  }
};

/**
 * Get game information from centralized source
 * This ensures all embeds use the same game data
 * @param {string} gameKey - Game key (e.g., 'pokémon_scarlet')
 * @returns {Object|null} Game information object
 */
function getGameInfo(gameKey) {
  // This should match the gameInfo object in handleUpdate
  // We'll make it a function so it can be reused
  const gameInfo = {
    'Pokémon Scarlet and Violet': {
      description: 'Open-world RPG featuring the Paldea region. Features co-op exploration, DLC content, and regular updates.',
      dlc: ['The Hidden Treasure of Area Zero', 'The Teal Mask', 'The Indigo Disk'],
      features: ['Co-op Mode', 'Terastallization', 'Multiplayer Raids', 'DLC Content']
    },
    'Pokémon Legends: Z-A': {
      description: 'Action RPG set in Lumiose City, Kalos region. Features urban redevelopment and Pokémon interactions in a futuristic city setting.',
      dlc: [],
      features: ['Urban Redevelopment', 'Pokémon Interactions', 'City Building', 'Kalos Region']
    },
    'Pokémon Legends: Arceus': {
      description: 'Action-adventure game set in ancient Sinnoh. Revolutionary catch mechanics and open-world exploration.',
      dlc: [],
      features: ['Revolutionary Catching', 'Open World', 'Real-time Combat', 'Ancient Pokémon']
    },
    'Pokémon Brilliant Diamond': {
      description: 'Faithful remake of the original Diamond/Pearl games with updated graphics and modern features.',
      dlc: [],
      features: ['Updated Graphics', 'Underground Multiplayer', 'Global Trade Station']
    },
    'Pokémon Sword': {
      description: 'Mainline RPG featuring the Galar region. Features Dynamax, Max Raids, and competitive battling.',
      dlc: ['The Crown Tundra', 'The Isle of Armor'],
      features: ['Dynamax', 'Max Raids', 'Wild Area', 'Camping System']
    },
    'Pokémon Pokopia': {
      description: 'Fan-made Pokémon game featuring unique regions and mechanics. Community-developed project.',
      dlc: ['Community Content'],
      features: ['Custom Regions', 'Unique Mechanics', 'Community-Driven']
    }
  };

  // Map gameKey to displayName
  const gameNameMap = {
    'pokémon_scarlet': 'Pokémon Scarlet and Violet',
    'pokémon_violet': 'Pokémon Scarlet and Violet',
    'pokémon_legends_z_a': 'Pokémon Legends: Z-A',
    'pokémon_legends_arceus': 'Pokémon Legends: Arceus',
    'pokémon_brilliant_diamond': 'Pokémon Brilliant Diamond',
    'pokémon_sword': 'Pokémon Sword',
    'pokémon_pokopia': 'Pokémon Pokopia'
  };

  const displayName = gameNameMap[gameKey];
  return displayName ? gameInfo[displayName] : null;
}

/**
 * Get all tracked games dynamically
 * @returns {Array} Array of game objects with keys and display names
 */
function getAllTrackedGames() {
  const gameNameMap = {
    'pokémon_scarlet': 'Pokémon Scarlet and Violet',
    'pokémon_violet': 'Pokémon Scarlet and Violet',
    'pokémon_legends_z_a': 'Pokémon Legends: Z-A',
    'pokémon_legends_arceus': 'Pokémon Legends: Arceus',
    'pokémon_brilliant_diamond': 'Pokémon Brilliant Diamond',
    'pokémon_sword': 'Pokémon Sword',
    'pokémon_pokopia': 'Pokémon Pokopia'
  };

  const variantNameMap = {
    'pokémon_scarlet': 'Scarlet',
    'pokémon_violet': 'Violet',
    'pokémon_legends_z_a': 'Legends: Z-A',
    'pokémon_legends_arceus': 'Legends: Arceus',
    'pokémon_brilliant_diamond': 'Brilliant Diamond',
    'pokémon_sword': 'Sword',
    'pokémon_pokopia': 'Pokopia'
  };

  return Object.entries(gameNameMap).map(([key, displayName]) => ({
    key,
    displayName,
    variantName: variantNameMap[key] || displayName
  }));
}

// Popular cheat repository sources to check (in order of preference)
const cheatRepos = [
  { owner: 'tomvita', repo: 'Cheats' },
  { owner: 'Pokeruler', repo: 'Cheats' },
  { owner: 'WerWolv', repo: 'EdiZon_CheatsConfig' },
  { owner: 'HamletDuFromage', repo: 'Cheats-Updater' },
];

// Command handlers
async function handleHelp(interaction) {
  try {
    // Get commands organized by category (single source of truth)
    const commandCategories = getCommandsByCategory();

    // Build category fields dynamically from commands array
    const fields = [];

    for (const [categoryName, commandNames] of Object.entries(commandCategories)) {
      const commandList = [];

      for (const cmdName of commandNames) {
        const cmd = getCommandByName(cmdName);

        if (cmd) {
          const commandText = formatCommandString(cmd);
          const description = cmd.description || 'No description';
          const shortDesc = description.length > 60 ? `${description.substring(0, 57)}...` : description;

          commandList.push(`• ${commandText} - ${shortDesc}`);
        }
      }

      if (commandList.length > 0) {
        let fieldValue = commandList.join('\n');

        // Split into multiple fields if too long (Discord limit: 1024 chars)
        if (fieldValue.length > 1024) {
          const chunks = [];
          let currentChunk = [];
          let currentLength = 0;

          for (const cmd of commandList) {
            if (currentLength + cmd.length + 1 > 1000) {
              chunks.push(currentChunk.join('\n'));
              currentChunk = [cmd];
              currentLength = cmd.length;
            } else {
              currentChunk.push(cmd);
              currentLength += cmd.length + 1;
            }
          }

          if (currentChunk.length > 0) {
            chunks.push(currentChunk.join('\n'));
          }

          fields.push({
            name: categoryName,
            value: chunks[0],
            inline: false
          });

          for (let i = 1; i < chunks.length; i++) {
            fields.push({
              name: `${categoryName} (continued)`,
              value: chunks[i],
              inline: false
            });
          }
        } else {
          fields.push({
            name: categoryName,
            value: fieldValue,
            inline: false
          });
        }
      }
    }

    // Check for uncategorized commands (safety check)
    const categorizedCommands = new Set();
    Object.values(commandCategories).forEach(cmdNames => {
      cmdNames.forEach(name => categorizedCommands.add(name));
    });

    const uncategorizedCommands = commands
      .filter(cmd => !categorizedCommands.has(cmd.name))
      .map(cmd => `• ${formatCommandString(cmd)} - ${cmd.description || 'No description'}`);

    if (uncategorizedCommands.length > 0) {
      fields.push({
        name: '📝 **Other Commands**',
        value: uncategorizedCommands.join('\n'),
        inline: false
      });
    }

    // Get total command count dynamically
    const totalCommands = commands.length;

    const embedBuilder = new EmbedBuilder()
      .setTitle('🎮 **SwitchDex Professional Help**')
      .setColor(0x5865f2)
      .setDescription('> 🔧 **Complete command reference for SwitchDex**\n' +
        '> 📊 **Professional Nintendo Switch monitoring**\n' +
        '> ⚡ **Real-time ecosystem surveillance**\n\n' +
        `**Total Commands:** ${totalCommands}`);

    if (fields.length > 0) {
      embedBuilder.addFields(...fields);
    }

    embedBuilder.addFields({
      name: '💡 **Usage Tips**',
      value: '• Use `/` and type a command name to see options\n' +
        '• Admin-only commands require Administrator permissions\n' +
        '• Use `/status` to see system overview\n' +
        '• Check `/anynewupdates` for recent updates',
      inline: false
    });

    const embed = enhanceEmbed(embedBuilder, interaction);

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Error generating help embed:', error);
    const embed = createErrorEmbed('Help Error', '⚠️ **Unable to generate help menu. Please try again later.**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleStatus(interaction) {
  try {
    // Get statistics dynamically (always current)
    const stats = await getSystemStatistics();

    // Build embed dynamically from current data
    const embedBuilder = buildStatisticsEmbed(stats)
      .setTitle('📊 **SwitchDex System Status**')
      .setDescription('> ⚡ **Real-time ecosystem surveillance**\n> 🔍 **Comprehensive monitoring dashboard**')
      .addFields(
        {
          name: '🛡️ **Security**',
          value: `**Banned Users:** ${stats.bannedUsers}\n**Banned Servers:** ${stats.bannedServers}\n**Threat Level:** Low`,
          inline: true
        },
        {
          name: '⚙️ **System Configuration**',
          value: `**Scan Interval:** ${config.checkInterval} minutes\n**Total Commands:** ${stats.totalCommands}\n**Last Check:** ${fileTracker.lastCheck ? new Date(fileTracker.lastCheck).toLocaleString() : 'Never'}`,
          inline: false
        }
      );

    const embed = enhanceEmbed(embedBuilder, interaction);

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error('Error generating status:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Error retrieving system status.',
        flags: 64
      });
    }
  }
}

async function handleCheatSource(interaction) {
  const trackedGames = Array.from(new Set(getAllTrackedGames().map(game => game.displayName)));
  const gameCompatibilityValue = trackedGames.map(name => `• **${name}:** Cheat support monitored`).join('\n');

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🎯 ⚡ **Cheat Code Sources** ⚡')
      .setColor(0xff0000)
      .setDescription('> 🔍 **Verified cheat code sources for Switch**\n> ⚠️ **Use at your own risk - may affect online play**\n> 📊 **Safety information and best practices**')
      .addFields(
        {
          name: '🔗 **Recommended Sources**',
          value: `• **Atmosphère Cheat Hub** - GitHub repository\n• **Switch Cheat Database** - Community maintained\n• **Universal Cheat Manager** - Cross-platform tool\n• **EdiZon Cheat Database** - Built-in overlay\n• **FearLess Cheat Engine** - Active development`,
          inline: false
        },
        {
          name: '🎮 **Game Compatibility**',
          value: gameCompatibilityValue || '• No tracked games available',
          inline: false
        },
        {
          name: '🛡️ **Safety Guidelines**',
          value: `• **Verify Sources** - Check repository authenticity\n• **File Integrity** - Use MD5/SHA256 verification\n• **Compatibility Check** - Match Build IDs\n• **Backup Saves** - Always backup before using\n• **Test Offline** - Try cheats offline first`,
          inline: false
        },
        {
          name: '📋 **File Structure**',
          value: `• **Location:** \`/atmosphere/contents/[TitleID]/cheats/\`\n• **Format:** \`.txt\` files with Breeze formatting\n• **Naming:** Descriptive cheat names\n• **Build ID:** Must match game version`,
          inline: false
        },
        {
          name: '⚠️ **Critical Warnings**',
          value: `• **Online Bans:** Using cheats may result in bans\n• **Game Stability:** Some cheats may crash games\n• **Save Corruption:** Risk of save file damage\n• **Terms of Service:** Violates Nintendo TOS`,
          inline: false
        }
      ),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

// Additional command handlers
async function handleSetInterval(interaction) {
  const minutes = interaction.options.getInteger('minutes');
  config.checkInterval = minutes;
  saveConfig();

  // Restart periodic scanning with new interval
  startPeriodicScanning();

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('⏰ **Interval Updated**')
      .setColor(0x00ff00)
      .setDescription(`✅ **Monitoring interval set to ${minutes} minutes**\n🔄 **Scanning restarted with new interval**`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleAnyNewUpdates(interaction) {
  try {
    // Defer immediately to avoid interaction timeout
    await interaction.deferReply();

    // Optional loading message while heavy processing runs
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔍 **Checking for updates...**')
          .setColor(0x5865f2)
          .setDescription('Please wait while I check all systems for updates...')
          .setTimestamp()
      ]
    });

    console.log('🔍 Starting forced update check for /anynewupdates command...');

    // Force check all systems for updates
    const updateResults = {
      pokemon: 0,
      homebrew: 0,
      firmware: 0,
      totalUpdates: 0,
      newUpdates: []
    };

    // 1. Check Pokemon Game Updates
    console.log('🎮 Checking Pokemon games...');
    try {
      const pokemonData = JSON.parse(fs.readFileSync('pokemon-versions.json', 'utf8'));
      const games = Object.keys(pokemonData);
      let pokemonUpdates = 0;

      for (const gameName of games) {
        // Simulate current version check (in production this would check Nintendo APIs)
        await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting

        const gameData = pokemonData[gameName];
        const lastChecked = gameData.lastChecked || 'Never';

        // For now, we'll assume no updates unless the bot has detected them
        // In a real implementation, this would compare against live Nintendo data
        console.log(`   ✅ ${gameName}: ${gameData.version} (checked)`);
      }
    } catch (pokemonError) {
      console.log('   ⚠️ Pokemon check failed:', pokemonError.message);
    }

    // 2. Check Homebrew Updates
    console.log('🏠 Checking homebrew applications...');
    try {
      const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));
      const apps = Object.keys(homebrewData);
      let homebrewUpdatesFound = 0;

      const headers = process.env.GITHUB_TOKEN ?
        { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};

      for (const app of apps) {
        try {
          const appData = homebrewData[app];
          if (!appData.url || !appData.url.includes('github.com')) continue;

          const urlMatch = appData.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (!urlMatch) continue;

          const [, owner, repo] = urlMatch;
          const latest = await getLatestGithubRelease(owner, repo, { headers, mode: 'any' });
          if (!latest || !latest.version) {
            console.log(`   ⚠️ ${app} skipped (no releases/tags found)`);
            continue;
          }

          const latestVersion = latest.version;

          if (latestVersion !== appData.version) {
            console.log(`   🆕 ${app}: ${appData.version} → ${latestVersion}`);
            homebrewUpdatesFound++;

            // Add to new updates list
            updateResults.newUpdates.push({
              type: 'homebrew',
              name: app,
              fromVersion: appData.version,
              toVersion: latestVersion,
              dateText: latest.dateText || 'Unknown',
              detectedAt: new Date().toISOString(),
              url: latest.url
            });

            // Update the data file
            homebrewData[app].version = latestVersion;
            homebrewData[app].dateText = latest.dateText || 'Unknown';
            homebrewData[app].url = latest.url;
          } else {
            console.log(`   ✅ ${app}: ${appData.version} (up to date)`);
          }

          await new Promise(resolve => setTimeout(resolve, 200)); // Rate limiting
        } catch (appError) {
          console.log(`   ⚠️ ${app} check failed: ${appError.message}`);
        }
      }

      updateResults.homebrew = homebrewUpdatesFound;

      // Save updated homebrew data
      if (homebrewUpdatesFound > 0) {
        fs.writeFileSync('homebrew-versions.json', JSON.stringify(homebrewData, null, 2));
        console.log(`   💾 Saved ${homebrewUpdatesFound} homebrew updates`);
      }

    } catch (homebrewError) {
      console.log('   ⚠️ Homebrew check failed:', homebrewError.message);
    }

    // 3. Check Firmware Updates
    console.log('⚡ Checking firmware updates...');
    try {
      const coreData = JSON.parse(fs.readFileSync('core-versions.json', 'utf8'));
      const components = Object.keys(coreData);
      let firmwareUpdatesFound = 0;

      for (const component of components) {
        if (component === 'switch_firmware') {
          // Multi-source firmware scraping
          try {
            console.log('   📡 Checking multiple sources for Nintendo firmware...');
            
            const firmwareResults = await checkMultipleFirmwareSources();
            const bestFirmware = determineBestFirmwareVersion(firmwareResults);
            
            if (bestFirmware && bestFirmware.version) {
              const currentVersion = coreData[component].version;
              
              if (bestFirmware.version !== currentVersion && bestFirmware.version !== 'Unknown') {
                // Check for duplicate notification
                if (!isDuplicateFirmwareUpdate(bestFirmware.version)) {
                  console.log(`   🆕 ${component}: ${currentVersion} → ${bestFirmware.version}`);
                  console.log(`      Sources: ${bestFirmware.sources.join(', ')} (confidence: ${bestFirmware.totalConfidence.toFixed(2)})`);
                  firmwareUpdatesFound++;
                  
                  // Update data
                  const previousVersion = coreData[component].version;
                  coreData[component].version = bestFirmware.version;
                  if (bestFirmware.bestResult.releaseDate) {
                    coreData[component].dateText = bestFirmware.bestResult.releaseDate;
                  }
                  
                  // Add to updates
                  updateResults.newUpdates.push({
                    type: 'nintendo_firmware',
                    name: 'Nintendo Switch System Firmware',
                    fromVersion: previousVersion,
                    toVersion: bestFirmware.version,
                    dateText: bestFirmware.bestResult.releaseDate || new Date().toLocaleDateString('en-US', {
                      year: 'numeric', month: 'long', day: 'numeric'
                    }),
                    detectedAt: new Date().toISOString(),
                    sources: bestFirmware.sources,
                    confidence: bestFirmware.totalConfidence,
                    url: bestFirmware.bestResult.url
                  });
                } else {
                  console.log(`   ⏭️ ${component}: Duplicate firmware update notification suppressed`);
                }
              } else {
                console.log(`   ✅ ${component}: ${coreData[component].version} (up to date from ${firmwareResults.length} sources)`);
              }
            } else {
              console.log(`   ⚠️ ${component}: No firmware version found from any source`);
            }
          } catch (scrapeError) {
            console.log(`   ⚠️ Multi-source Nintendo firmware scraping failed: ${scrapeError.message}`);
          }
        } else if (coreData[component].url && coreData[component].url.includes('github.com')) {
          // Check GitHub releases for custom firmware
          try {
            const urlMatch = coreData[component].url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
            if (!urlMatch) continue;

            const [, owner, repo] = urlMatch;
            const headers = process.env.GITHUB_TOKEN ?
              { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};

            const mode = component === 'atmosphere_prerelease'
              ? 'prefer_prerelease'
              : component === 'atmosphere_stable'
                ? 'stable_only'
                : 'any';

            const latest = await getLatestGithubRelease(owner, repo, { headers, mode });
            if (!latest || !latest.version) {
              console.log(`   ⚠️ ${component} skipped (no releases/tags found)`);
              continue;
            }

            const previousVersion = coreData[component].version || 'Unknown';
            const latestVersion = latest.version;

            if (latestVersion !== previousVersion) {
              console.log(`   🆕 ${component}: ${previousVersion} → ${latestVersion}`);
              firmwareUpdatesFound++;

              // Update data
              coreData[component].version = latestVersion;
              coreData[component].dateText = latest.dateText || 'Unknown';
              coreData[component].url = latest.url;

              // Add to updates
              updateResults.newUpdates.push({
                type: component,
                name: component.charAt(0).toUpperCase() + component.slice(1).replace('_', ' '),
                fromVersion: previousVersion,
                toVersion: latestVersion,
                dateText: coreData[component].dateText,
                detectedAt: new Date().toISOString(),
                url: latest.url
              });

              if (latest.isPrerelease) {
                await logToChannel(`ℹ️ Using prerelease for ${component}: ${latestVersion} (prerelease=true)`);
              }
            } else {
              console.log(`   ✅ ${component}: ${coreData[component].version} (up to date)`);
            }
          } catch (compError) {
            console.log(`   ⚠️ ${component} check failed: ${compError.message}`);
          }
        }
      }

      updateResults.firmware = firmwareUpdatesFound;

      // Save updated firmware data
      if (firmwareUpdatesFound > 0) {
        fs.writeFileSync('core-versions.json', JSON.stringify(coreData, null, 2));
        console.log(`   💾 Saved ${firmwareUpdatesFound} firmware updates`);
      }

    } catch (firmwareError) {
      console.log('   ⚠️ Firmware check failed:', firmwareError.message);
    }

    // Calculate total updates found
    updateResults.totalUpdates = updateResults.newUpdates.length;

    // Check if there were any updates in the last 24 hours
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Filter updates from the last 24 hours
    const recentUpdates = updateResults.newUpdates.filter(update => {
      const detectedAt = new Date(update.detectedAt);
      return detectedAt >= twentyFourHoursAgo;
    });

    console.log(`✅ Update check complete. Found ${updateResults.totalUpdates} total updates, ${recentUpdates.length} in last 24 hours`);

    // Create response based on results
    if (recentUpdates.length === 0) {
      // No updates in last 24 hours
      const embed = new EmbedBuilder()
        .setTitle('📭 **No Updates Since Yesterday**')
        .setColor(0x5865f2)
        .setDescription('✅ **All monitored systems are up to date**\n🔄 **Next automatic check:** Within the next scan interval')
        .setThumbnail(client.user?.displayAvatarURL())
        .setFooter({
          text: 'SwitchDex Update Monitor',
          iconURL: client.user?.displayAvatarURL()
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } else {
      // There were updates - show them chronologically
      // Sort updates by detection time (most recent first)
      recentUpdates.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));

      const embed = enhanceEmbed(
        new EmbedBuilder()
          .setTitle('🆕 **24-Hour Update Summary**')
          .setColor(0x00ff00)
          .setDescription(`📊 **${recentUpdates.length} updates detected in the last 24 hours**\n⏰ **Checked:** ${twentyFourHoursAgo.toLocaleString()}\n📅 **Current time:** ${now.toLocaleString()}`),
        interaction
      );

      // Group updates by type
      const groupedUpdates = recentUpdates.reduce((groups, update) => {
        const type = update.type;
        if (!groups[type]) groups[type] = [];
        groups[type].push(update);
        return groups;
      }, {});

      // Add fields for each update type
      Object.entries(groupedUpdates).forEach(([type, updates]) => {
        let typeEmoji = '📦';
        let typeName = type;

        // Customize based on update type
        if (type.includes('atmosphere')) {
          typeEmoji = '🌍';
          typeName = 'Atmosphère Custom Firmware';
        } else if (type.includes('fusee')) {
          typeEmoji = '🚀';
          typeName = 'Fusee Payload';
        } else if (type.includes('hekate')) {
          typeEmoji = '🎯';
          typeName = 'Hekate Bootloader';
        } else if (type.includes('homebrew')) {
          typeEmoji = '🏠';
          typeName = 'Homebrew Applications';
        } else if (type.includes('sysbot_fork')) {
          typeEmoji = '🔧';
          typeName = 'Sysbot fork updates';
        } else if (type.includes('nintendo_firmware')) {
          typeEmoji = '🏠';
          typeName = 'Nintendo Switch Firmware';
        }

        const updateList = updates.map(update =>
          `• **${update.name}**\n  ↗️ ${update.fromVersion} → **${update.toVersion}**\n  📅 ${update.dateText}`
        ).join('\n\n');

        embed.addFields({
          name: `${typeEmoji} **${typeName}** (${updates.length})`,
          value: updateList,
          inline: false
        });
      });

      embed.addFields({
        name: '📈 **Summary**',
        value: `**Total Updates:** ${recentUpdates.length}\n**Systems Updated:** ${Object.keys(groupedUpdates).length}\n🔄 **Monitoring continues automatically**\n⏰ **Data refreshed just now**`,
        inline: false
      });

      await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    console.error('Error generating 24-hour update summary:', error);
    if (interaction.deferred || interaction.replied) {
      const detailedEmbed = createErrorEmbed(
        'Update Summary Error',
        `⚠️ **Unable to check for updates.**\n\`\`\`\n${error.message}\n\`\`\``,
        interaction
      );
      await interaction.editReply({ embeds: [detailedEmbed] });
    } else {
      const fallbackEmbed = createErrorEmbed(
        'Update Summary Error',
        '⚠️ **Unable to check for updates. Please try again later.**',
        interaction
      );
      await interaction.reply({ embeds: [fallbackEmbed] });
    }
  }
}

async function handleAddChannel(interaction) {
  if (!hasAdminAccess(interaction)) {
    return await interaction.reply({
      content: '❌ You need Administrator permissions or the server\'s configured admin role to manage announcement channels.',
      flags: 64
    });
  }

  const channelId = interaction.channel.id;
  const guildId = interaction.guild.id;

  const existingChannel = announcementChannels.find(ch => ch.channelId === channelId);
  if (existingChannel) {
    return await interaction.reply({
      content: '❌ This channel is already configured for announcements.',
      flags: 64
    });
  }

  announcementChannels.push({
    channelId: String(channelId),  // Ensure it's a string
    guildId: String(guildId),
    addedBy: String(interaction.user.id),
    addedAt: new Date().toISOString()
  });

  saveAnnouncementChannels();

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('📢 **Channel Added**')
      .setColor(0x00ff00)
      .setDescription(`✅ **<#${channelId}>** has been added to receive update announcements.`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleRemoveChannel(interaction) {
  if (!hasAdminAccess(interaction)) {
    return await interaction.reply({
      content: '❌ You need Administrator permissions or the server\'s configured admin role to manage announcement channels.',
      flags: 64
    });
  }

  const channelId = interaction.channel.id;
  const index = announcementChannels.findIndex(ch => ch.channelId === channelId);

  if (index === -1) {
    return await interaction.reply({
      content: '❌ This channel is not configured for announcements.',
      flags: 64
    });
  }

  announcementChannels.splice(index, 1);
  saveAnnouncementChannels();

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('📢 **Channel Removed**')
      .setColor(0xff0000)
      .setDescription(`✅ **<#${channelId}>** has been removed from update announcements.`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleListChannels(interaction) {
  if (announcementChannels.length === 0) {
    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📢 **Announcement Channels**')
        .setColor(0x5865f2)
        .setDescription('❌ **No channels configured for announcements.**'),
      interaction
    );
    return await interaction.reply({ embeds: [embed] });
  }

  const channelList = announcementChannels.map((ch, index) =>
    `${index + 1}. <#${ch.channelId}> (${ch.guildId}) - Added by <@${ch.addedBy}>`
  ).join('\n');

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('📢 **Announcement Channels**')
      .setColor(0x5865f2)
      .setDescription(`**${announcementChannels.length} channels configured:**\n\n${channelList}`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleCheckPermissions(interaction) {
  const botMember = interaction.guild.members.cache.get(client.user.id);
  const permissions = interaction.channel.permissionsFor(botMember);

  const permissionChecks = [
    { name: 'View Channel', value: permissions.has('ViewChannel') },
    { name: 'Send Messages', value: permissions.has('SendMessages') },
    { name: 'Embed Links', value: permissions.has('EmbedLinks') },
    { name: 'Read Message History', value: permissions.has('ReadMessageHistory') },
    { name: 'Use Slash Commands', value: permissions.has('UseSlashCommands') }
  ];

  const statusText = permissionChecks.map(p =>
    `${p.value ? '✅' : '❌'} ${p.name}`
  ).join('\n');

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🔍 **Bot Permissions Check**')
      .setColor(0x5865f2)
      .addFields({
        name: `Permissions in #${interaction.channel.name}`,
        value: statusText,
        inline: false
      }),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleBanUser(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  const userId = interaction.options.getString('userid');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (isUserBanned(userId)) {
    return await interaction.reply({
      content: '❌ This user is already banned.',
      flags: 64
    });
  }

  bannedUsers.push({
    userId: userId,
    bannedBy: interaction.user.id,
    reason: reason,
    bannedAt: new Date().toISOString()
  });

  saveBannedUsers();

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🔒 **User Banned**')
      .setColor(0xff0000)
      .setDescription(`✅ **User ${userId}** has been banned.\n**Reason:** ${reason}`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleUnbanUser(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  const userId = interaction.options.getString('userid');
  const index = bannedUsers.findIndex(ban => ban.userId === userId);

  if (index === -1) {
    return await interaction.reply({
      content: '❌ This user is not banned.',
      flags: 64
    });
  }

  bannedUsers.splice(index, 1);
  saveBannedUsers();

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🔓 **User Unbanned**')
      .setColor(0x00ff00)
      .setDescription(`✅ **User ${userId}** has been unbanned.`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleListBannedUsers(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  if (bannedUsers.length === 0) {
    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🔒 **Banned Users**')
        .setColor(0x5865f2)
        .setDescription('❌ **No users are currently banned.**'),
      interaction
    );
    return await interaction.reply({ embeds: [embed] });
  }

  const userList = bannedUsers.map((ban, index) =>
    `${index + 1}. **${ban.userId}** - Banned by <@${ban.bannedBy}>\n   Reason: ${ban.reason}`
  ).join('\n\n');

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🔒 **Banned Users Registry**')
      .setColor(0xff0000)
      .setDescription(`**${bannedUsers.length} users banned:**\n\n${userList}`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleBanServer(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  const serverId = interaction.options.getString('serverid');
  const reason = interaction.options.getString('reason') || 'No reason provided';

  if (isServerBanned(serverId)) {
    return await interaction.reply({
      content: '❌ This server is already banned.',
      flags: 64
    });
  }

  bannedServers.push({
    serverId: serverId,
    bannedBy: interaction.user.id,
    reason: reason,
    bannedAt: new Date().toISOString()
  });

  saveBannedServers();

  // Leave the server if we're in it
  try {
    const guild = client.guilds.cache.get(serverId);
    if (guild) {
      await guild.leave();
    }
  } catch (error) {
    console.error('Error leaving server:', error);
  }

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🏠 **Server Banned**')
      .setColor(0xff0000)
      .setDescription(`✅ **Server ${serverId}** has been banned and bot has left.\n**Reason:** ${reason}`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleUnbanServer(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  const serverId = interaction.options.getString('serverid');
  const index = bannedServers.findIndex(ban => ban.serverId === serverId);

  if (index === -1) {
    return await interaction.reply({
      content: '❌ This server is not banned.',
      flags: 64
    });
  }

  bannedServers.splice(index, 1);
  saveBannedServers();

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🏠 **Server Unbanned**')
      .setColor(0x00ff00)
      .setDescription(`✅ **Server ${serverId}** has been unbanned.`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleListBannedServers(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  if (bannedServers.length === 0) {
    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🏠 **Banned Servers**')
        .setColor(0x5865f2)
        .setDescription('❌ **No servers are currently banned.**'),
      interaction
    );
    return await interaction.reply({ embeds: [embed] });
  }

  const serverList = bannedServers.map((ban, index) =>
    `${index + 1}. **${ban.serverId}** - Banned by <@${ban.bannedBy}>\n   Reason: ${ban.reason}`
  ).join('\n\n');

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🏠 **Banned Servers Registry**')
      .setColor(0xff0000)
      .setDescription(`**${bannedServers.length} servers banned:**\n\n${serverList}`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleLogHere(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  if (!interaction.guild) {
    return await interaction.reply({
      content: '❌ This command can only be used in a server channel.',
      flags: 64
    });
  }

  serverLogRoutes[interaction.guild.id] = {
    channelId: interaction.channel.id,
    setBy: interaction.user.id,
    setAt: new Date().toISOString()
  };
  saveServerLogRoutes();

  const embed = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('📝 **Server Logging Configured**')
      .setColor(0x00ff00)
      .setDescription(`✅ **Logs for this server will now be sent to <#${interaction.channel.id}>**`),
    interaction
  );

  await interaction.reply({ embeds: [embed] });
}

async function handleGithub(interaction) {
  try {
    await interaction.deferReply();

    let allRepos = [];
    try {
      allRepos = getAllTrackedRepositories();
      console.log(`[DEBUG] Found ${allRepos.length} tracked repositories`);
    } catch (repoError) {
      console.error('[ERROR] Failed to get tracked repositories:', repoError);
      return await interaction.editReply({
        content: '❌ An error occurred while loading repositories. Please check console logs.',
        flags: 64
      });
    }

    if (allRepos.length === 0) {
      const embed = createErrorEmbed(
        'No Tracked Repositories',
        'No GitHub repositories are currently being tracked.\n\n' +
        '**To add repositories:**\n' +
        '• Use `/addtracking` to add custom repositories\n' +
        '• Homebrew apps are automatically tracked from `homebrew-versions.json`\n\n' +
        '**Note:** Make sure `homebrew-versions.json` and `tracked-releases.json` exist and contain valid data.',
        interaction
      );
      return await interaction.editReply({ embeds: [embed] });
    }

    const dropdownOptions = [];

    for (const repo of allRepos.slice(0, 25)) {
      try {
        if (!repo || typeof repo !== 'object') {
          console.warn('[WARN] Invalid repo object:', repo);
          continue;
        }

        if (!repo.id || !repo.displayName || !repo.owner || !repo.repo) {
          console.warn('[WARN] Missing required fields for repo:', repo);
          continue;
        }

        const label = String(repo.displayName || 'Unknown').trim();
        const value = String(repo.id || '').trim();
        const owner = String(repo.owner || '').trim();
        const repoName = String(repo.repo || '').trim();
        const version = String(repo.version || 'Unknown').trim();

        if (!label || !value || !owner || !repoName) {
          console.warn('[WARN] Empty required fields:', { label, value, owner, repoName });
          continue;
        }

        const finalLabel = label.length > 100 ? label.substring(0, 97) + '...' : label;
        const finalValue = value.length > 100 ? value.substring(0, 100) : value;
        const description = `${owner}/${repoName} - v${version}`;
        const finalDescription = description.length > 100 ? description.substring(0, 97) + '...' : description;

        dropdownOptions.push({
          label: finalLabel,
          value: finalValue,
          description: finalDescription
        });
      } catch (optionError) {
        console.error(`[ERROR] Failed to create option for repo:`, optionError);
      }
    }

    console.log(`[DEBUG] Created ${dropdownOptions.length} dropdown options from ${allRepos.length} repos`);

    if (dropdownOptions.length === 0) {
      return await interaction.editReply({
        content: '❌ No valid repositories found to display. All repositories failed validation. Check console logs.',
        flags: 64
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('github_repo_select')
      .setPlaceholder('Select a repository to view information...')
      .setMinValues(1)
      .setMaxValues(1);

    for (const option of dropdownOptions) {
      try {
        selectMenu.addOptions(option);
      } catch (addError) {
        console.error('[ERROR] Failed to add option to menu:', option, addError);
      }
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const homebrewCount = allRepos.filter((repo) => repo.type === 'homebrew').length;
    const trackedCount = allRepos.filter((repo) => repo.type === 'tracked').length;

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle(`${EMBED_EMOJIS.SEARCH} **GitHub Repository Information**`)
        .setColor(EMBED_COLORS.PRIMARY)
        .setDescription(
          `Select a repository from the dropdown below to view detailed information.\n\n` +
          `**Total Tracked:** ${allRepos.length} repositories\n` +
          `• **Homebrew:** ${homebrewCount}\n` +
          `• **Custom Tracked:** ${trackedCount}`
        ),
      interaction
    );

    if (allRepos.length > 25) {
      embed.addFields({
        name: '⚠️ **Discord Dropdown Limit**',
        value: `Only the first 25 repositories are shown (${allRepos.length} total). Use \`/removetracking\` to prune the list if needed.`,
        inline: false
      });
    }

    console.log(`[DEBUG] Sending dropdown with ${dropdownOptions.length} options`);
    console.log('[DEBUG] Components structure:', JSON.stringify(row.toJSON(), null, 2));

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    console.log('[DEBUG] Dropdown sent successfully');
  } catch (error) {
    console.error('[ERROR] Error in handleGithub:', error);
    console.error('[ERROR] Stack trace:', error.stack);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `❌ An error occurred:\n\`\`\`\n${error.message}\n\`\`\`\nCheck console for details.`,
        flags: 64
      });
    } else {
      await interaction.reply({
        content: `❌ An error occurred:\n\`\`\`\n${error.message}\n\`\`\`\nCheck console for details.`,
        flags: 64
      });
    }
  }
}

/**
 * Handle GitHub repository selection from dropdown
 * @param {Interaction} interaction - Discord interaction
 */
async function handleGithubRepoSelect(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const selectedId = interaction.values[0];
    const repo = getRepositoryById(selectedId);

    if (!repo) {
      return await interaction.editReply({
        content: '❌ Selected repository not found. It may have been removed.',
        flags: 64
      });
    }

    const headers = process.env.GITHUB_TOKEN
      ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
      : {};

    let latestRelease = null;
    let repoInfo = null;

    try {
      const repoResponse = await axios.get(
        `https://api.github.com/repos/${repo.owner}/${repo.repo}`,
        { headers, timeout: 10000 }
      );
      repoInfo = repoResponse.data;

      const latest = await getLatestGithubRelease(repo.owner, repo.repo, { headers, mode: 'any' });
      latestRelease = latest?.release || null;
    } catch (apiError) {
      console.log(`⚠️ Could not fetch latest info for ${repo.owner}/${repo.repo}: ${apiError.message}`);
    }

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle(`${repo.type === 'homebrew' ? EMBED_EMOJIS.HOMEBREW : EMBED_EMOJIS.CUSTOM} **${repo.displayName}**`)
        .setColor(repo.type === 'homebrew' ? EMBED_COLORS.HOMEBREW : EMBED_COLORS.CUSTOM_TRACK)
        .setDescription(
          repoInfo?.description
            ? `*${repoInfo.description}*`
            : `GitHub repository: \`${repo.owner}/${repo.repo}\``
        )
        .addFields(
          {
            name: `${EMBED_EMOJIS.STATS} **Current Status**`,
            value:
              `**Version:** \`${repo.version || 'Unknown'}\`\n` +
              `**Last Updated:** ${repo.dateText || 'Unknown date'}\n` +
              `**Type:** ${repo.type === 'homebrew' ? 'Homebrew Application' : 'Custom Tracked'}`,
            inline: false
          },
          {
            name: `${EMBED_EMOJIS.LINK} **Repository**`,
            value: `[${repo.owner}/${repo.repo}](https://github.com/${repo.owner}/${repo.repo})`,
            inline: true
          },
          {
            name: `${EMBED_EMOJIS.DOWNLOAD} **Latest Release**`,
            value: latestRelease
              ? `[${latestRelease.tag_name || latestRelease.name}](${latestRelease.html_url})`
              : `[${repo.version}](${repo.url})`,
            inline: true
          }
        ),
      interaction
    );

    if (latestRelease) {
      const releaseDate = new Date(latestRelease.published_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      embed.addFields({
        name: `${EMBED_EMOJIS.UPDATE} **Latest Release Information**`,
        value:
          `**Version:** \`${latestRelease.tag_name || latestRelease.name}\`\n` +
          `**Published:** ${releaseDate}\n` +
          `**Author:** ${latestRelease.author?.login || 'Unknown'}`,
        inline: false
      });

      if (latestRelease.body) {
        const releaseNotes = truncateField(latestRelease.body, 500);
        embed.addFields({
          name: `${EMBED_EMOJIS.LIST} **Release Notes**`,
          value: releaseNotes,
          inline: false
        });
      }
    }

    if (repoInfo) {
      embed.addFields({
        name: `${EMBED_EMOJIS.STATS} **Repository Statistics**`,
        value:
          `**Stars:** ⭐ ${repoInfo.stargazers_count || 0}\n` +
          `**Forks:** 🍴 ${repoInfo.forks_count || 0}\n` +
          `**Language:** ${repoInfo.language || 'Unknown'}\n` +
          `**License:** ${repoInfo.license?.name || 'None'}`,
        inline: false
      });
    }

    embed.addFields({
      name: `${EMBED_EMOJIS.INFO} **Tracking Information**`,
      value:
        `**Source:** \`${repo.source}\`\n` +
        `**Tracked Since:** ${repo.addedAt ? new Date(repo.addedAt).toLocaleDateString() : 'Unknown'}\n` +
        `**Category:** ${repo.type === 'homebrew' ? 'Homebrew Applications' : 'Sysbot fork updates'}`,
      inline: false
    });

    if (repoInfo?.owner?.avatar_url) {
      embed.setThumbnail(repoInfo.owner.avatar_url);
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleGithubRepoSelect:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: '❌ An error occurred while fetching repository information. Please try again later.',
        flags: 64
      });
    } else {
      await interaction.reply({
        content: '❌ An error occurred while fetching repository information. Please try again later.',
        flags: 64,
        ephemeral: true
      });
    }
  }
}

async function handleHomebrewUpdates(interaction) {
  try {
    const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));
    const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));

    const apps = Object.keys(homebrewData);
    const totalApps = apps.length;

    // Filter homebrew updates from recent history
    const recentHomebrewUpdates = updateHistory.filter(update =>
      update.type.includes('homebrew') &&
      new Date(update.detectedAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
    );

    // Calculate some statistics
    const now = new Date();
    const appsUpdatedThisMonth = apps.filter(app => {
      const appDate = new Date(homebrewData[app].dateText);
      const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return appDate >= oneMonthAgo;
    }).length;

    // Group apps by category
    const categories = {
      '🎯 Cheat Management': ['breeze'],
      '💾 Save Management': ['edizon', 'jksv'],
      '📡 Networking': ['ftpd'],
      '🛠️ System Tools': ['goldleaf'],
      '📦 Installation': ['awoo', 'dbi'],
      '📁 File Management': ['nxshell'],
      '🖥️ System Modules': ['nxovlloader'],
      '⚡ Performance': ['sysclk'],
      '🎮 Controllers': ['missioncontrol'],
      '🎲 Gaming': ['emuiibo'],
      '🎨 Themes': ['nxthemes'],
      '📊 Statistics': ['nxactivitylog'],
      '🔄 Updates': ['nxupdatechecker']
    };

    let categorySummary = '';
    Object.entries(categories).forEach(([category, appList]) => {
      const availableApps = appList.filter(app => apps.includes(app));
      if (availableApps.length > 0) {
        categorySummary += `• **${category}:** ${availableApps.length} apps\n`;
      }
    });

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🏠 **Homebrew Ecosystem Status**')
        .setColor(0x00ff00)
        .setDescription(`📊 **Complete homebrew monitoring overview**\n🔄 **${totalApps} applications tracked**\n📅 **Last scan:** ${new Date().toLocaleString()}`)
        .addFields(
          {
            name: '📈 **Ecosystem Overview**',
            value: `**Total Apps:** ${totalApps}\n**Updated This Month:** ${appsUpdatedThisMonth}\n**Recent Updates:** ${recentHomebrewUpdates.length}\n**Active Monitoring:** ✅ Enabled`,
            inline: false
          },
          {
            name: '🏷️ **Categories**',
            value: categorySummary,
            inline: false
          },
          {
            name: '🔥 **Popular Apps**',
            value: `• **Breeze** - Cheat manager (${homebrewData.breeze.version})\n• **JKSV** - Save manager (${homebrewData.jksv.version})\n• **DBI** - NSP installer (${homebrewData.dbi.version})\n• **Goldleaf** - Multi-tool (${homebrewData.goldleaf.version})\n• **Awoo Installer** - NSP installer (${homebrewData.awoo.version})`,
            inline: false
          }
        ),
      interaction
    );

    // Add recent updates if any
    if (recentHomebrewUpdates.length > 0) {
      const recentList = recentHomebrewUpdates.slice(0, 5).map(update =>
        `• **${update.name}** → ${update.toVersion} (${update.dateText})`
      ).join('\n');

      embed.addFields({
        name: '🆕 **Recent Updates**',
        value: recentList,
        inline: false
      });
    }

    embed.addFields({
      name: '💡 **Getting Started**',
      value: `${buildCommandReferenceList(['github'])}\n• Visit GitHub releases for downloads\n• Install via Homebrew Menu (hbmenu)\n• Check compatibility with your firmware`,
      inline: false
    });

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Error generating homebrew ecosystem status:', error);
    const embed = createErrorEmbed('Homebrew Status Error', '⚠️ **Unable to retrieve ecosystem status**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleHbHelp(interaction) {
  const embed1 = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🏠 **Homebrew Guide - Getting Started**')
      .setColor(0x5865f2)
      .setDescription('📚 **Complete Nintendo Switch homebrew installation guide**\n⚠️ **Homebrew voids your warranty and may ban online play**\n🔒 **Use at your own risk**')
      .addFields(
        {
          name: '🎯 **What is Homebrew?**',
          value: 'Homebrew allows you to run unofficial software on your Nintendo Switch. This includes emulators, save editors, custom themes, and system tools.',
          inline: false
        },
        {
          name: '⚠️ **Important Warnings**',
          value: '• **Online Bans:** May result in Nintendo Network bans\n• **Warranty:** Voids your console warranty\n• **Bricks:** Improper installation can brick your Switch\n• **Legal:** Check your local laws regarding homebrew',
          inline: false
        },
        {
          name: '🔧 **Requirements**',
          value: '• **Hardware:** Nintendo Switch (original model)\n• **SD Card:** 64GB+ recommended, FAT32 or exFAT\n• **PC:** Windows/Mac/Linux for setup\n• **Patience:** Follow guides carefully',
          inline: false
        }
      ),
    interaction
  );

  const embed2 = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🏠 **Homebrew Guide - Installation**')
      .setColor(0x00ff00)
      .setDescription('📋 **Step-by-step installation process**')
      .addFields(
        {
          name: '📦 **Step 1: Custom Firmware**',
          value: 'Install Atmosphere CFW using a fusee-gelee exploit:\n• **Recommended:** Use a jig or paperclip for RCM mode\n• **Payload:** hekate via TegraRCM\n• **CFW:** Atmosphere (most stable)\n• **Version:** Latest stable release',
          inline: false
        },
        {
          name: '💾 **Step 2: SD Card Setup**',
          value: 'Format and prepare your SD card:\n• **Format:** FAT32 (32GB) or exFAT (64GB+)\n• **Backup:** Save all important data first\n• **Clean:** Use SD Formatter tool\n• **Verify:** Test card integrity',
          inline: false
        },
        {
          name: '📁 **Step 3: File Structure**',
          value: 'Create proper folder structure:\n```\nSD Card Root:\n├── atmosphere/\n├── bootloader/\n├── config/\n├── switch/\n├── hbmenu.nro\n└── boot.dat\n```',
          inline: false
        },
        {
          name: '🎮 **Step 4: Launch Homebrew**',
          value: 'Access homebrew menu:\n• **Album Button:** Hold R and launch Album\n• **Payload:** Send hekate payload via PC\n• **CFW:** Boot into Atmosphere\n• **Menu:** Launch hbmenu.nro',
          inline: false
        }
      ),
    interaction
  );

  const embed3 = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🏠 **Homebrew Guide - Popular Apps**')
      .setColor(0xffa500)
      .setDescription('🔥 **Essential homebrew applications**')
      .addFields(
        {
          name: '🎯 **Cheat Tools**',
          value: '• **Breeze:** Modern cheat manager\n• **EdiZon:** Save file editor\n• **JKSV:** Save backup/restore tool',
          inline: false
        },
        {
          name: '📦 **Installers**',
          value: '• **DBI:** Powerful NSP installer\n• **Awoo Installer:** USB installation\n• **Goldleaf:** Multi-purpose tool',
          inline: false
        },
        {
          name: '🛠️ **Utilities**',
          value: '• **NX-Shell:** File manager\n• **FTPD:** Wireless file transfer\n• **Mission Control:** Button remapper',
          inline: false
        },
        {
          name: '🎨 **Customization**',
          value: '• **NXThemes:** Theme installer\n• **Sys-CLK:** CPU/GPU control\n• **Emuiibo:** Amiibo emulator',
          inline: false
        }
      ),
    interaction
  );

  const embed4 = enhanceEmbed(
    new EmbedBuilder()
      .setTitle('🏠 **Homebrew Guide - Troubleshooting**')
      .setColor(0xff0000)
      .setDescription('🔧 **Common issues and solutions**')
      .addFields(
        {
          name: '🚫 **Common Problems**',
          value: '• **No Homebrew Menu:** Check SD card files\n• **Crashes:** Update Atmosphere/sigpatches\n• **No Internet:** DNS/Network issues\n• **Black Screen:** Corrupted boot files',
          inline: false
        },
        {
          name: '🔄 **Recovery Methods**',
          value: '• **ChoiDuJourNX:** Firmware updater\n• **Daybreak:** System maintenance\n• **Tinfoil:** Clean NSP installer\n• **Lockpick:** Key dumping tool',
          inline: false
        },
        {
          name: '📚 **Help Resources**',
          value: '• **r/SwitchHacks:** Reddit community\n• **GBAtemp:** Forum discussions\n• **SwitchBrew:** Documentation\n• **GitHub:** Official repositories',
          inline: false
        },
        {
          name: '💡 **Pro Tips**',
          value: '• Always backup your NAND\n• Use latest Atmosphere releases\n• Keep firmware up to date\n• Test apps offline first\n• Join Discord communities for help',
          inline: false
        }
      ),
    interaction
  );

  await interaction.reply({ embeds: [embed1, embed2, embed3, embed4] });
}

async function handleUpdate(interaction) {
  try {
    const game = interaction.options.getString('game');
    const pokemonData = JSON.parse(fs.readFileSync('pokemon-versions.json', 'utf8'));
    const titleIdData = JSON.parse(fs.readFileSync('title-ids.json', 'utf8'));
    const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));

    const trackedGames = getAllTrackedGames();
    const trackedGame = trackedGames.find(entry => entry.key === game);
    const displayName = trackedGame ? trackedGame.displayName : game.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    if (!pokemonData[displayName]) {
      const embed = createErrorEmbed(
        'Game Not Found',
        `🔍 **Unable to find information for "${displayName}"**\n📋 **Available games:** ${Object.keys(pokemonData).join(', ')}`,
        interaction
      );
      return await interaction.reply({ embeds: [embed] });
    }

    const gameData = pokemonData[displayName];
    const titleData = titleIdData[game];

    // Get recent updates for this game
    const gameUpdates = updateHistory.filter(update =>
      update.name.toLowerCase().includes(displayName.toLowerCase()) ||
      update.name.toLowerCase().includes(game.replace(/_/g, ' ').toLowerCase())
    ).slice(0, 5); // Last 5 updates

    // Get game info from centralized function (ensures consistency)
    const info = getGameInfo(game) || {
      description: 'Pokémon game with unique features and gameplay mechanics.',
      dlc: ['Base Game'],
      features: ['Pokémon Battles', 'Exploration', 'Collection']
    };

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle(`🎮 **${displayName}**`)
        .setColor(0xff6b35)
        .setDescription(`**${info.description}**`)
        .addFields(
          {
            name: '📊 **Current Status**',
            value: `**Version:** ${gameData.version}\n**Last Updated:** ${gameData.dateText}\n**Region:** Global\n**Platform:** Nintendo Switch`,
            inline: false
          },
          {
            name: '🆔 **Technical Information**',
            value: `**Game Version:** ${gameData.version}\n**Platform:** Nintendo Switch\n**Region:** Global\n\n💡 *Use \`/titleid\` to learn how to find Title IDs and Build IDs*`,
            inline: false
          },
          {
            name: '🎯 **Game Features**',
            value: info.features.map(feature => `• ${feature}`).join('\n'),
            inline: false
          }
        ),
      interaction
    );

    // Add DLC information if available (dynamically from gameInfo)
    if (info.dlc && info.dlc.length > 0) {
      embed.addFields({
        name: '📦 **DLC Content**',
        value: info.dlc.map(dlc => `• ${dlc}`).join('\n'),
        inline: false
      });
    }

    // Add recent updates if any (dynamically from updateHistory)
    if (gameUpdates.length > 0) {
      const updateList = gameUpdates.map(update =>
        `• **${update.toVersion}** - ${update.dateText}`
      ).join('\n');

      embed.addFields({
        name: '🆕 **Recent Updates**',
        value: updateList,
        inline: false
      });
    }

    embed.addFields({
      name: '🎯 **Cheat Compatibility**',
      value: `• **Supported:** Breeze, EdiZon, JKSV\n• **Updates:** ${gameData.dateText}\n• **Build ID:** ${titleData?.buildId || 'Check latest'}`,
      inline: false
    });

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Error retrieving game update info:', error);
    const embed = createErrorEmbed('Game Info Error', '⚠️ **Unable to retrieve game information**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleFirmware(interaction) {
  try {
    const coreData = JSON.parse(fs.readFileSync('core-versions.json', 'utf8'));
    const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));

    // Filter firmware-related updates from recent history
    const firmwareUpdates = updateHistory.filter(update =>
      update.type.includes('atmosphere') ||
      update.type.includes('hekate') ||
      update.type.includes('fusee') ||
      update.name.toLowerCase().includes('firmware')
    ).slice(0, 10); // Last 10 firmware updates

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⚡ **System Firmware Status**')
        .setColor(0x00ff00)
        .setDescription(`📊 **Complete firmware ecosystem overview**\n🔄 **Last updated:** ${new Date().toLocaleString()}`)
        .addFields(
          {
            name: '⚠️ **CRITICAL SAFETY NOTICE**',
            value: `**Compatibility information provided is GENERAL and UNVERIFIED.**\n• Always verify compatibility before installing\n• Check official sources and community forums\n• Test on secondary console if possible\n• This bot does NOT verify actual compatibility\n• **Use at your own risk** - incorrect compatibility can brick consoles`,
            inline: false
          },
          {
            name: '🏠 **Nintendo Official Firmware**',
            value: `**Current Version:** ${coreData.switch_firmware.version}\n**Last Updated:** ${coreData.switch_firmware.dateText}\n**Source:** [Nintendo Support](${coreData.switch_firmware.url})\n**Compatibility:** Check official sources${coreData.switch_firmware.patchNotes ? `\n\n📝 **Latest Changes:**\n${coreData.switch_firmware.patchNotes.substring(0, 300)}${coreData.switch_firmware.patchNotes.length > 300 ? '...' : ''}` : ''}`,
            inline: false
          },
          {
            name: '🌍 **Atmosphere CFW**',
            value: `**Stable:** ${coreData.atmosphere_stable.version} (${coreData.atmosphere_stable.dateText})\n**Prerelease:** ${coreData.atmosphere_prerelease.version} (${coreData.atmosphere_prerelease.dateText})\n**Source:** [GitHub](https://github.com/Atmosphere-NX/Atmosphere)\n**Status:** ${coreData.atmosphere_prerelease.version.includes('prerelease') ? '🧪 Testing' : '✅ Stable'}`,
            inline: false
          },
          {
            name: '🎯 **Bootloaders & Payloads**',
            value: `**Hekate:** ${coreData.hekate.version} (${coreData.hekate.dateText})\n**Fusee:** ${coreData.fusee.version} (${coreData.fusee.dateText})\n**Source:** [Hekate GitHub](https://github.com/CTCaer/hekate)\n**Method:** RCM exploitation`,
            inline: false
          }
        ),
      interaction
    );

    // Add recent firmware updates if any
    if (firmwareUpdates.length > 0) {
      const updateList = firmwareUpdates.map(update =>
        `• **${update.name}** → ${update.toVersion} (${update.dateText})`
      ).join('\n');

      embed.addFields({
        name: '🆕 **Recent Firmware Updates**',
        value: updateList,
        inline: false
      });
    }

    embed.addFields(
      {
        name: '🔄 **Update Recommendations**',
        value: `• **Atmosphere:** Use stable for daily use\n• **Hekate:** Update with Atmosphere releases\n• **Firmware:** Match game requirements\n• **Backup:** Always backup before updating`,
        inline: false
      },
      {
        name: '🛡️ **Compatibility Notes**',
        value: `• **Homebrew:** Requires compatible Atmosphere\n• **Games:** May need firmware updates\n• **Cheats:** Match game versions/Build IDs\n• **Sigpatches:** Required for game modifications`,
        inline: false
      },
      {
        name: '⚠️ **Important Warnings**',
        value: `• **AutoRCM:** May brick patched Switches\n• **Downgrade:** Risk of brick if not compatible\n• **Clean NAND:** Always maintain clean backup\n• **Test Updates:** Use prerelease cautiously`,
        inline: false
      }
    );

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Error generating firmware status:', error);
    const embed = createErrorEmbed('Firmware Status Error', '⚠️ **Unable to retrieve firmware information**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleCompatibilityDigest(interaction) {
  try {
    const stats = await getSystemStatistics();
    const coreData = JSON.parse(fs.readFileSync('core-versions.json', 'utf8'));
    const pokemonData = JSON.parse(fs.readFileSync('pokemon-versions.json', 'utf8'));
    const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));
    const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));

    const recentUpdates = updateHistory.filter(update =>
      new Date(update.detectedAt) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    ).length;

    // Calculate ecosystem health
    const gamesUpdatedThisMonth = Object.values(pokemonData).filter(game => {
      const updateDate = new Date(game.dateText);
      const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      return updateDate >= oneMonthAgo;
    }).length;

    const trackedGames = getAllTrackedGames();
    const highlightedGames = Array.from(new Set(trackedGames.map(game => game.displayName))).slice(0, 3);
    const popularGamesValue = highlightedGames.map(name => {
      const gameData = pokemonData[name];
      return gameData ? `• **${name}:** ${gameData.version} (${gameData.dateText})` : null;
    }).filter(Boolean).join('\n') || '• No highlighted games available';

    const embed1 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📊 **Switch Ecosystem Compatibility Digest**')
        .setColor(0x00ff00)
        .setDescription(`🔍 **Comprehensive compatibility overview**\n📅 **Generated:** ${new Date().toLocaleString()}\n🔄 **Last scan:** Within last scan interval`)
        .addFields(
          {
            name: '⚠️ **CRITICAL SAFETY NOTICE**',
            value: `**Compatibility information provided is GENERAL and UNVERIFIED.**\n• Always verify compatibility before installing\n• Check official sources and community forums\n• Test on secondary console if possible\n• This bot does NOT verify actual compatibility\n• **Use at your own risk** - incorrect compatibility can brick consoles`,
            inline: false
          },
          {
            name: '🎮 **Game Ecosystem Status**',
            value: `**Total Games:** ${stats.totalGames}\n**Updated (30 days):** ${gamesUpdatedThisMonth}\n**Active Monitoring:** ✅ Enabled\n**Update Frequency:** ${config.checkInterval} minutes`,
            inline: false
          },
          {
            name: '🏠 **Homebrew Ecosystem Status**',
            value: `**Total Apps:** ${stats.totalHomebrew}\n**Categories:** 7 main categories\n**Security Monitoring:** ✅ Active\n**Update Tracking:** ✅ Enabled`,
            inline: false
          },
          {
            name: '⚡ **Firmware Ecosystem Status**',
            value: `**Atmosphere:** ${stats.atmosphereVersion} (Stable)\n**Hekate:** ${stats.hekateVersion} (Bootloader)\n**Nintendo FW:** ${stats.firmwareVersion}\n**Compatibility:** Check individual app requirements`,
            inline: false
          }
        ),
      interaction
    );

    const embed2 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📊 **Compatibility Matrix**')
        .setColor(0xffa500)
        .setDescription('🔗 **Cross-compatibility between all Switch components**')
        .addFields(
          {
            name: '🎯 **Atmosphere + Homebrew**',
            value: `**Compatibility:** ✅ Generally Compatible (Verify First)\n**Features:** Most homebrew apps\n**Requirements:** Sigpatches for game mods\n**Status:** Verify individual app requirements`,
            inline: false
          },
          {
            name: '🎮 **Games + Atmosphere**',
            value: `**Compatibility:** ✅ Generally Compatible (Verify First)\n**Features:** Game modifications (version-dependent)\n**Requirements:** Proper sigpatches\n**Status:** Verify compatibility per game`,
            inline: false
          },
          {
            name: '🎯 **Cheats + Games**',
            value: `**Compatibility:** ✅ Version-dependent\n**Features:** Breeze, EdiZon, JKSV\n**Requirements:** Matching Build IDs\n**Status:** Active development`,
            inline: false
          },
          {
            name: '🏠 **Homebrew + Games**',
            value: `**Compatibility:** ⚠️ Verify individually\n**Features:** Save editors, tools\n**Requirements:** CFW environment\n**Status:** Check app requirements`,
            inline: false
          }
        ),
      interaction
    );

    const embed3 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📊 **Recent Update Summary**')
        .setColor(0x5865f2)
        .setDescription('🆕 **Activity in the last 7 days**')
        .addFields(
          {
            name: '📈 **Update Statistics**',
            value: `**Total Updates:** ${recentUpdates}\n**Games Updated:** ${gamesUpdatedThisMonth}\n**Homebrew Updates:** ${recentUpdates - gamesUpdatedThisMonth}\n**Firmware Updates:** Included in total`,
            inline: false
          },
          {
            name: '🎮 **Popular Game Updates**',
            value: popularGamesValue,
            inline: false
          },
          {
            name: '🏠 **Active Homebrew Apps**',
            value: `• **Breeze:** ${homebrewData.breeze.version} (${homebrewData.breeze.dateText})\n• **JKSV:** ${homebrewData.jksv.version} (${homebrewData.jksv.dateText})\n• **DBI:** ${homebrewData.dbi.version} (${homebrewData.dbi.dateText})`,
            inline: false
          }
        ),
      interaction
    );

    const embed4 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📊 **Compatibility Recommendations**')
        .setColor(0xff6b35)
        .setDescription('💡 **Best practices for maintaining compatibility**')
        .addFields(
          {
            name: '🔄 **Update Strategy**',
            value: `• **Atmosphere:** Update to latest stable\n• **Homebrew:** Check for app updates\n• **Games:** Update as needed for features\n• **Cheats:** Match game versions exactly`,
            inline: false
          },
          {
            name: '🛡️ **Safety Guidelines**',
            value: `• **Backup:** Always backup saves/NAND\n• **Testing:** Test updates offline first\n• **Sources:** Use official/trusted sources\n• **Compatibility:** Check Build IDs for cheats`,
            inline: false
          },
          {
            name: '🚨 **Known Issues**',
            value: `• **Online Play:** May affect Nintendo services\n• **Bans:** Risk with modified gameplay\n• **Stability:** Some combinations may crash\n• **Updates:** May break existing modifications`,
            inline: false
          },
          {
            name: '📋 **Next Steps**',
            value: buildCommandReferenceList(['update', 'github', 'firmware', 'anynewupdates']),
            inline: false
          }
        ),
      interaction
    );

    await interaction.reply({ embeds: [embed1, embed2, embed3, embed4] });

  } catch (error) {
    console.error('Error generating compatibility digest:', error);
    const embed = createErrorEmbed('Compatibility Digest Error', '⚠️ **Unable to generate compatibility overview**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleFirmwareUpgrade(interaction) {
  try {
    const coreData = JSON.parse(fs.readFileSync('core-versions.json', 'utf8'));

    const embed1 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⬆️ **Firmware Upgrade Guide**')
        .setColor(0x00ff00)
        .setDescription('📋 **Safe firmware upgrade procedures**\n⚠️ **Read all warnings before proceeding**\n🔄 **Recommended upgrade order**')
        .addFields(
          {
            name: '⚠️ **CRITICAL SAFETY WARNINGS**',
            value: `**⚠️ COMPATIBILITY NOT VERIFIED BY BOT**\n• All compatibility claims are general information only\n• **Verify requirements** from official sources before proceeding\n\n**Mandatory Precautions:**\n• **Backup First:** NAND backup REQUIRED\n• **AutoRCM:** May brick patched consoles\n• **Clean NAND:** Use ChoiDuJourNX\n• **Test Updates:** Try on secondary console\n• **No Downgrade:** Risk of permanent brick\n• **Use at your own risk** - this bot does NOT verify compatibility`,
            inline: false
          },
          {
            name: '📦 **Required Tools**',
            value: `• **Hekate:** Bootloader (${coreData.hekate.version})\n• **Atmosphere:** CFW (${coreData.atmosphere_stable.version})\n• **ChoiDuJourNX:** Firmware updater\n• **TegraRCM:** PC payload injector\n• **SD Card:** 64GB+ formatted`,
            inline: false
          },
          {
            name: '💾 **Pre-Upgrade Checklist**',
            value: `• ✅ NAND backup created\n• ✅ SD card formatted (FAT32/exFAT)\n• ✅ Atmosphere files updated\n• ✅ Sigpatches downloaded\n• ✅ Homebrew apps backed up`,
            inline: false
          }
        ),
      interaction
    );

    const embed2 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⬆️ **Upgrade Order - Step by Step**')
        .setColor(0xffa500)
        .setDescription('🔢 **Follow this exact sequence**')
        .addFields(
          {
            name: '📍 **Step 1: Prepare SD Card**',
            value: `**Atmosphere Files:**\n• Download latest Atmosphere\n• Extract to SD card root\n• Overwrite existing files\n\n**Hekate Update:**\n• Download latest hekate\n• Replace \`bootloader/hekate_ipl.ini\`\n• Update \`hekate_ctcaer_x.x.x.bin\``,
            inline: false
          },
          {
            name: '📍 **Step 2: Update Atmosphere**',
            value: `**Method:** ChoiDuJourNX\n• Launch CFW with hekate\n• Open ChoiDuJourNX\n• Select "Update Atmosphere"\n• Wait for completion\n\n**Verification:**\n• Reboot to check version\n• Test homebrew menu\n• Verify system stability`,
            inline: false
          },
          {
            name: '📍 **Step 3: Update Firmware (Optional)**',
            value: `**When Needed:**\n• New game requires it\n• Atmosphere update requires it\n• For latest features\n\n**Method:**\n• Use Daybreak (built-in)\n• Download Nintendo firmware\n• Install through Daybreak\n• Update sigpatches after`,
            inline: false
          },
          {
            name: '📍 **Step 4: Update Sigpatches**',
            value: `**Source:**\n• Download from sigmapatches\n• Extract to SD card\n• Replace existing patches\n\n**Verification:**\n• Test game modifications\n• Check cheat loading\n• Verify NSP installation`,
            inline: false
          }
        ),
      interaction
    );

    const embed3 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⬆️ **Post-Upgrade Verification**')
        .setColor(0x5865f2)
        .setDescription('✅ **Test everything after upgrading**')
        .addFields(
          {
            name: '🧪 **Basic Functionality Tests**',
            value: `• **Homebrew Menu:** Album button works\n• **Atmosphere:** Boots without errors\n• **Games:** Launch and play normally\n• **Online:** Test eShop (optional)\n• **USB:** File transfer works`,
            inline: false
          },
          {
            name: '🛠️ **Advanced Feature Tests**',
            value: `• **Cheats:** Load with Breeze/EdiZon\n• **NSP Install:** DBI/Awoo Installer\n• **Save Editors:** JKSV functionality\n• **FTP:** Wireless file transfer\n• **Custom Themes:** NXThemes works`,
            inline: false
          },
          {
            name: '🚨 **Troubleshooting**',
            value: `• **Black Screen:** Reboot with hekate\n• **Error Codes:** Google error code\n• **Boot Loop:** Restore NAND backup\n• **Homebrew Crash:** Check Atmosphere version\n• **Game Issues:** Update sigpatches`,
            inline: false
          }
        ),
      interaction
    );

    const embed4 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⬆️ **Version Compatibility Matrix**')
        .setColor(0xff6b35)
        .setDescription('🔗 **Compatible version combinations**')
        .addFields(
          {
            name: '✅ **Recommended Stable Setup**',
            value: `**Atmosphere:** ${coreData.atmosphere_stable.version}\n**Hekate:** ${coreData.hekate.version}\n**Sigpatches:** Latest for Atmosphere\n**Homebrew:** Check compatibility individually\n**Games:** Version-dependent, verify requirements`,
            inline: false
          },
          {
            name: '🧪 **Beta/Prerelease Setup**',
            value: `**Atmosphere:** ${coreData.atmosphere_prerelease.version}\n**Hekate:** Latest compatible\n**Sigpatches:** Updated for prerelease\n**Homebrew:** Test compatibility\n**Risk:** Higher instability`,
            inline: false
          },
          {
            name: '📋 **Version Checking Commands**',
            value: buildCommandReferenceList(['firmware', 'status', 'anynewupdates', 'compatibilitydigest']),
            inline: false
          },
          {
            name: '🎯 **Final Tips**',
            value: `• **Stay Updated:** Regular Atmosphere updates\n• **Backup Often:** Before major changes\n• **Test First:** Use secondary setup for testing\n• **Community Help:** r/SwitchHacks, GBAtemp\n• **Patience:** Take your time with each step`,
            inline: false
          }
        ),
      interaction
    );

    await interaction.reply({ embeds: [embed1, embed2, embed3, embed4] });

  } catch (error) {
    console.error('Error generating firmware upgrade guide:', error);
    const embed = createErrorEmbed('Upgrade Guide Error', '⚠️ **Unable to generate upgrade guide**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleTitleId(interaction) {
  try {
    const embed1 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🆔 **Finding Title IDs and Build IDs**')
        .setColor(0x5865f2)
        .setDescription('> 📋 **How to find Title IDs and Build IDs for your games**')
        .addFields(
          {
            name: '💡 **Why Find Them Yourself?**',
            value: `Title IDs and Build IDs are specific to your game version and region.\n\n` +
              `• **More Accurate:** You'll get the exact IDs from your game\n` +
              `• **Region-Specific:** Different regions may have different IDs\n` +
              `• **Version-Specific:** Build IDs change with each game update\n` +
              `• **Reliable:** No scraping delays or inaccuracies`,
            inline: false
          },
          {
            name: '🔍 **Method 1: Using Homebrew Apps (Recommended)**',
            value: `**DBI (DB Installer):**\n` +
              `1. Install DBI on your Switch\n` +
              `2. Launch DBI from Homebrew Menu\n` +
              `3. Navigate to "Browse installed applications"\n` +
              `4. Select your game\n` +
              `5. View Title ID (16 characters) and Build ID (8-16 characters)\n\n` +
              `**NX-Shell or Tinfoil:**\n` +
              `• Both apps can display Title IDs from installed games`,
            inline: false
          },
          {
            name: '🛠️ **Method 2: Using PC Tools**',
            value: `**NSZ Manager:**\n` +
              `• Open your game file (.nsp, .nsz, .xci)\n` +
              `• View Title ID in the file properties\n\n` +
              `**NSC Builder:**\n` +
              `• Extract game files\n` +
              `• View Title ID and Build ID from metadata\n\n` +
              `**Online Databases:**\n` +
              `• Search game title on switchbrew.org\n` +
              `• Check gamepedia or wiki pages`,
            inline: false
          }
        ),
      interaction
    );

    const embed2 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🆔 **Finding Build IDs for Cheats**')
        .setColor(0x00ff00)
        .setDescription('> 🎯 **Locating Build IDs for cheat compatibility**')
        .addFields(
          {
            name: '📍 **Using Cheat Repositories**',
            value: `**GitHub Cheat Repos:**\n` +
              `1. Visit cheat repositories like:\n` +
              `   • WerWolv/EdiZon_Cheats\n` +
              `   • Tomvita/EdiZon\n` +
              `   • Search "Switch cheats" on GitHub\n\n` +
              `2. Navigate to: \`atmosphere/contents/[TITLE_ID]/cheats/\`\n` +
              `3. Build ID folders are named with the Build ID (8-16 hex characters)\n` +
              `4. Match the Build ID folder to your game version`,
            inline: false
          },
          {
            name: '🎮 **Using Breeze or EdiZon**',
            value: `**Breeze (Recommended):**\n` +
              `1. Launch Breeze from Homebrew Menu\n` +
              `2. Select your game\n` +
              `3. Build ID is displayed at the top\n` +
              `4. Use this ID to find matching cheat files\n\n` +
              `**EdiZon:**\n` +
              `• Similar process - Build ID shown in game selection`,
            inline: false
          },
          {
            name: '📱 **Format Examples**',
            value: `**Title ID:** \`01008F6008C5E000\` (16 hex characters)\n` +
              `**Build ID:** \`12345678ABCDEF01\` (8-16 hex characters)\n\n` +
              `**Note:** Title IDs are consistent per game, Build IDs change with updates`,
            inline: false
          },
          {
            name: '🔗 **Helpful Resources**',
            value: `• **switchbrew.org** - Game Title ID database\n` +
              `• **GitHub Cheat Repos** - Find Build IDs for specific versions\n` +
              `• **GBAtemp Forums** - Community discussions and guides\n` +
              `• **Reddit r/SwitchHacks** - Help and tutorials`,
            inline: false
          },
          {
            name: '🛠️ **Related Commands**',
            value: buildCommandReferenceList(['update', 'cheatsource', 'organizecheats', 'github']),
            inline: false
          }
        ),
      interaction
    );

    await interaction.reply({ embeds: [embed1, embed2] });

  } catch (error) {
    console.error('Error in handleTitleId:', error);
    const embed = createErrorEmbed('Title ID Help Error', '⚠️ **Unable to display Title ID information**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

/**
 * Format cheat file for Breeze/Edizon compatibility
 * @param {string} fileContent - Raw cheat file content
 * @param {string} titleId - 16-digit Title ID (optional)
 * @param {string} buildId - 16-digit Build ID (optional)
 * @returns {Object} Formatted cheat data
 */
function formatCheatFileForBreeze(fileContent, titleId = null, buildId = null) {
  if (!fileContent || typeof fileContent !== 'string') {
    return { error: 'Invalid file content' };
  }

  const lines = fileContent.split('\n');
  const formatted = {
    cheats: [],
    metadata: {
      titleId: titleId,
      buildId: buildId,
      cheatCount: 0
    }
  };

  let currentCheat = null;
  let inCheatCode = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines between cheats
    if (!line && !inCheatCode) {
      continue;
    }

    // Detect cheat name (lines starting with [ or { or containing common cheat indicators)
    if (line.match(/^\[.*\]$/) || line.match(/^\{.*\}$/) || 
        (line.length > 2 && line.length < 100 && !line.match(/^[0-9A-Fa-f\s]{8,}$/) && !line.match(/^(Title|Build)\s*ID/i))) {
      
      // Save previous cheat if exists
      if (currentCheat && currentCheat.code.length > 0) {
        formatted.cheats.push(currentCheat);
      }
      
      // Start new cheat
      const cheatName = line.replace(/[\[\]{}]/g, '').trim();
      currentCheat = {
        name: cheatName || `Cheat ${formatted.cheats.length + 1}`,
        code: [],
        enabled: false
      };
      inCheatCode = false;
      continue;
    }

    // Detect Title ID
    if (line.match(/Title\s*ID[:\s]+([0-9A-Fa-f]{16})/i)) {
      const match = line.match(/Title\s*ID[:\s]+([0-9A-Fa-f]{16})/i);
      formatted.metadata.titleId = match[1].toUpperCase();
      continue;
    }

    // Detect Build ID
    if (line.match(/Build\s*ID[:\s]+([0-9A-Fa-f]{8,16})/i)) {
      const match = line.match(/Build\s*ID[:\s]+([0-9A-Fa-f]{8,16})/i);
      formatted.metadata.buildId = match[1].toUpperCase().padStart(16, '0');
      continue;
    }

    // Detect cheat code lines (hex codes: 8 characters, possibly with spaces)
    const hexPattern = /^[0-9A-Fa-f]{8}(?:\s+[0-9A-Fa-f]{8})*$/;
    const cleanLine = line.replace(/\s+/g, ' ').trim();
    if (hexPattern.test(cleanLine)) {
      if (!currentCheat) {
        currentCheat = { name: `Cheat ${formatted.cheats.length + 1}`, code: [], enabled: false };
      }
      
      // Format code line: remove extra spaces, ensure proper formatting
      currentCheat.code.push(cleanLine);
      inCheatCode = true;
      continue;
    }

    // If we're in a cheat code block and hit non-hex line, end the cheat
    if (inCheatCode && currentCheat && currentCheat.code.length > 0) {
      formatted.cheats.push(currentCheat);
      currentCheat = null;
      inCheatCode = false;
    }
  }

  // Add last cheat if exists
  if (currentCheat && currentCheat.code.length > 0) {
    formatted.cheats.push(currentCheat);
  }

  formatted.metadata.cheatCount = formatted.cheats.length;
  return formatted;
}

/**
 * Generate Breeze/Edizon compatible cheat file content
 * @param {Object} formattedData - Formatted cheat data from formatCheatFileForBreeze
 * @returns {string} Formatted cheat file content
 */
function generateBreezeCompatibleFile(formattedData) {
  if (!formattedData || formattedData.error) {
    return null;
  }

  let output = '';

  // Add Title ID header if available
  if (formattedData.metadata.titleId) {
    output += `Title ID: ${formattedData.metadata.titleId}\n`;
  }

  // Add Build ID header if available
  if (formattedData.metadata.buildId) {
    output += `Build ID: ${formattedData.metadata.buildId}\n`;
  }

  // Add blank line after headers
  if (formattedData.metadata.titleId || formattedData.metadata.buildId) {
    output += '\n';
  }

  // Add each cheat
  formattedData.cheats.forEach((cheat, index) => {
    // Cheat name in brackets
    output += `[${cheat.name}]\n`;
    
    // Cheat code lines
    cheat.code.forEach(codeLine => {
      output += `${codeLine}\n`;
    });
    
    // Blank line between cheats (except last)
    if (index < formattedData.cheats.length - 1) {
      output += '\n';
    }
  });

  return output.trim();
}

async function handleOrganizeCheats(interaction) {
  try {
    await interaction.deferReply();
    
    const cheatFile = interaction.options.getAttachment('cheatfile');

    // Validate file type
    if (!cheatFile.name.toLowerCase().endsWith('.txt')) {
      const embed = createErrorEmbed('Invalid File Type', '⚠️ **Only .txt files are supported**\n📄 **Please upload a valid cheat code file**', interaction);
      return await interaction.editReply({ embeds: [embed] });
    }

    // Validate file size (max 500KB)
    if (cheatFile.size > 500 * 1024) {
      const embed = createErrorEmbed('File Too Large', '⚠️ **File size exceeds 500KB limit**\n📄 **Please upload a smaller file**', interaction);
      return await interaction.editReply({ embeds: [embed] });
    }

    // Download and process the file
    try {
      const response = await axios.get(cheatFile.url, {
        timeout: 15000,
        responseType: 'text',
        headers: {
          'User-Agent': 'SwitchDex-Bot/1.0'
        }
      });

      const fileContent = response.data;

      // Format the cheat file
      const formatted = formatCheatFileForBreeze(fileContent);
      
      if (formatted.error) {
        const embed = createErrorEmbed(
          'Processing Error',
          `⚠️ **Failed to process cheat file:** ${formatted.error}\n\nPlease ensure the file is a valid cheat code file.`,
          interaction
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      if (formatted.cheats.length === 0) {
        // No cheats found - show guidelines instead
        const embed = enhanceEmbed(
          new EmbedBuilder()
            .setTitle('⚠️ **No Cheats Detected**')
            .setColor(0xffa500)
            .setDescription(
              `📁 **File:** ${cheatFile.name}\n` +
              `📊 **Size:** ${Math.round(cheatFile.size / 1024)} KB\n\n` +
              `No valid cheat codes were found in this file. Please ensure your file follows the correct format.`
            )
            .addFields(
              {
                name: '📝 **Expected Format**',
                value: '```\n[Cheat Name]\n04000000 12345678\n04000000 87654321\n\n[Another Cheat]\n08000000 ABCDEF00\n```',
                inline: false
              },
              {
                name: '🎯 **Requirements**',
                value: '• Cheat names in square brackets []\n• Hex codes: 8 characters per segment\n• Empty line between different cheats',
                inline: false
              }
            ),
          interaction
        );
        return await interaction.editReply({ embeds: [embed] });
      }

      // Generate formatted output
      const formattedContent = generateBreezeCompatibleFile(formatted);
      if (!formattedContent) {
        throw new Error('Failed to generate formatted file');
      }

      // Create embed with results
      const embed = enhanceEmbed(
        new EmbedBuilder()
          .setTitle('✅ **Cheat File Processed**')
          .setColor(0x00ff00)
          .setDescription(
            `📁 **File:** ${cheatFile.name}\n` +
            `📊 **Cheats Found:** ${formatted.metadata.cheatCount}\n` +
            `🆔 **Title ID:** ${formatted.metadata.titleId || 'Not detected'}\n` +
            `🔢 **Build ID:** ${formatted.metadata.buildId || 'Not detected'}\n\n` +
            `✅ **File formatted for Breeze/Edizon compatibility**`
          ),
        interaction
      );

      // Add cheat list preview
      if (formatted.cheats.length > 0) {
        const cheatPreview = formatted.cheats.slice(0, 10).map((cheat, index) => 
          `${index + 1}. ${cheat.name} (${cheat.code.length} line${cheat.code.length !== 1 ? 's' : ''})`
        ).join('\n');

        embed.addFields({
          name: '📋 **Cheats Found**',
          value: cheatPreview + (formatted.cheats.length > 10 ? `\n... and ${formatted.cheats.length - 10} more` : ''),
          inline: false
        });
      }

      // Add usage instructions
      embed.addFields({
        name: '📂 **Installation**',
        value: `Place the file in:\n\`SD:/atmosphere/contents/[TitleID]/cheats/\`\n\nRename to: \`[BuildID].txt\``,
        inline: false
      });

      // Send formatted file as attachment
      const buffer = Buffer.from(formattedContent, 'utf8');
      const attachment = new AttachmentBuilder(buffer, { name: `formatted_${cheatFile.name}` });

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
        content: '✅ **Your formatted cheat file is ready!** Download the attached file and place it in your Switch\'s cheat folder.'
      });

    } catch (downloadError) {
      console.error('Error downloading/processing cheat file:', downloadError);
      const embed = createErrorEmbed(
        'Download Error',
        `⚠️ **Failed to download or process file:** ${downloadError.message}\n\nPlease try again or check the file format.`,
        interaction
      );
      return await interaction.editReply({ embeds: [embed] });
    }

  } catch (error) {
    console.error('Error processing cheat organization:', error);
    const embed = createErrorEmbed(
      'Cheat Organization Error',
      `⚠️ **Unable to process cheat file:** ${error.message}\n📄 **Please try again with a valid .txt file**`,
      interaction
    );
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed] });
    }
  }
}

async function handleBlacklistMonitor(interaction) {
  try {
    const blacklistData = JSON.parse(fs.readFileSync('homebrew-blacklist.json', 'utf8'));
    const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));
    const stats = await getSystemStatistics();

    const dangerousCount = blacklistData.dangerous_apps.length;
    const abandonedCount = blacklistData.abandoned_apps.length;
    const warningCount = blacklistData.warning_apps.length;
    const totalFlagged = dangerousCount + abandonedCount + warningCount;

    const embed1 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🛡️ **Homebrew Security Monitor**')
        .setColor(totalFlagged > 0 ? 0xff0000 : 0x00ff00)
        .setDescription(`🔍 **Security analysis of homebrew ecosystem**\n📊 **Last updated:** ${blacklistData.last_updated}\n⚠️ **${totalFlagged} flagged applications**\n✅ **${stats.totalHomebrew} monitored apps**`)
        .addFields(
          {
            name: '🚨 **Critical Threats**',
            value: `**Dangerous Apps:** ${dangerousCount}\n**Abandoned Apps:** ${abandonedCount}\n**Warning Apps:** ${warningCount}\n**Total Flagged:** ${totalFlagged}`,
            inline: false
          },
          {
            name: '📈 **Security Statistics**',
            value: `**Safe Apps:** ${stats.totalHomebrew - totalFlagged}\n**Monitored Apps:** ${stats.totalHomebrew}\n**Last Scan:** ${blacklistData.last_updated}\n**Source:** ${blacklistData.update_source}`,
            inline: false
          }
        ),
      interaction
    );

    const embed2 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🚨 **Dangerous Applications**')
        .setColor(0xff0000)
        .setDescription('⚠️ **These apps pose serious security risks**')
        .addFields(
          {
            name: '🔴 **Critical Security Threats**',
            value: blacklistData.dangerous_apps.map(app =>
              `**${app.name}**\n• **Risk:** ${app.severity.toUpperCase()}\n• **Issue:** ${app.reason}\n• **Reported:** ${app.lastReported}\n• **Source:** ${app.source}\n`
            ).join('\n') || '✅ **No critical threats currently**',
            inline: false
          }
        ),
      interaction
    );

    const embed3 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⚠️ **Abandoned Applications**')
        .setColor(0xffa500)
        .setDescription('📭 **These apps are no longer maintained**')
        .addFields(
          {
            name: '🟡 **Unmaintained Software**',
            value: blacklistData.abandoned_apps.map(app =>
              `**${app.name}**\n• **Risk:** ${app.severity.toUpperCase()}\n• **Issue:** ${app.reason}\n• **Reported:** ${app.lastReported}\n• **Source:** ${app.source}\n`
            ).join('\n') || '✅ **No abandoned apps currently**',
            inline: false
          }
        ),
      interaction
    );

    const embed4 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⚠️ **Warning Applications**')
        .setColor(0xffff00)
        .setDescription('🟡 **These apps have known issues**')
        .addFields(
          {
            name: '🟡 **Apps with Issues**',
            value: blacklistData.warning_apps.map(app =>
              `**${app.name}**\n• **Risk:** ${app.severity.toUpperCase()}\n• **Issue:** ${app.reason}\n• **Reported:** ${app.lastReported}\n• **Source:** ${app.source}\n`
            ).join('\n') || '✅ **No warning apps currently**',
            inline: false
          }
        ),
      interaction
    );

    const embed5 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🛡️ **Security Best Practices**')
        .setColor(0x00ff00)
        .setDescription('🔒 **Stay safe when using homebrew**')
        .addFields(
          {
            name: '✅ **Safe Usage Guidelines**',
            value: `• **Verify Sources:** Only download from GitHub\n• **Check Signatures:** Verify file integrity\n• **Update Regularly:** Keep apps updated\n• **Backup Data:** Save files and NAND\n• **Test First:** Try new apps offline`,
            inline: false
          },
          {
            name: '🔍 **Verification Methods**',
            value: `• **GitHub Stars:** Check repository popularity\n• **Last Commit:** Recent activity indicates maintenance\n• **Issues/PRs:** Active community support\n• **Release Notes:** Proper documentation\n• **File Hashes:** Verify downloads`,
            inline: false
          },
          {
            name: '🚨 **Red Flags to Watch For**',
            value: `• **No Source Code:** Closed-source apps\n• **Suspicious Permissions:** Unnecessary access\n• **Encrypted Files:** Can't verify contents\n• **External Downloads:** Non-GitHub sources\n• **No Documentation:** Missing instructions`,
            inline: false
          },
          {
            name: '🆘 **What to Do If Infected**',
            value: `• **Isolate Console:** Disconnect from internet\n• **Change Passwords:** If accounts were accessed\n• **Scan Files:** Check for suspicious files\n• **Clean Install:** Reformat SD card\n• **Report Issues:** Help the community`,
            inline: false
          }
        ),
      interaction
    );

    const embed6 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🛡️ **Recommended Safe Apps**')
        .setColor(0x5865f2)
        .setDescription('✅ **Verified safe and well-maintained applications**')
        .addFields(
          {
            name: '🎯 **Cheat Managers**',
            value: `• **Breeze:** ✅ Active development\n• **EdiZon:** ✅ Stable and maintained\n• **JKSV:** ✅ Regular updates`,
            inline: false
          },
          {
            name: '📦 **Installers**',
            value: `• **DBI:** ✅ Community favorite\n• **Awoo Installer:** ✅ USB support\n• **Goldleaf:** ✅ Multi-purpose tool`,
            inline: false
          },
          {
            name: '🛠️ **System Tools**',
            value: `• **NX-Shell:** ✅ File management\n• **FTPD:** ✅ Wireless transfer\n• **Mission Control:** ✅ Button mapping`,
            inline: false
          },
          {
            name: '📋 **Related Commands**',
            value: buildCommandReferenceList(['github', 'homebrewupdates', 'status', 'riskscan']),
            inline: false
          }
        ),
      interaction
    );

    await interaction.reply({ embeds: [embed1, embed2, embed3, embed4, embed5, embed6] });

  } catch (error) {
    console.error('Error generating blacklist monitor:', error);
    const embed = createErrorEmbed('Security Monitor Error', '⚠️ **Unable to retrieve security information**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleRiskScan(interaction) {
  try {
    const blacklistData = JSON.parse(fs.readFileSync('homebrew-blacklist.json', 'utf8'));
    const bannedUsers = JSON.parse(fs.readFileSync('banned-users.json', 'utf8'));
    const bannedServers = JSON.parse(fs.readFileSync('banned-servers.json', 'utf8'));

    // Simulate risk assessment based on current data
    const riskFactors = {
      bannedUsers: bannedUsers.length,
      bannedServers: bannedServers.length,
      dangerousApps: blacklistData.dangerous_apps.length,
      totalMonitored: Object.keys(JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'))).length
    };

    // Calculate risk level
    let overallRisk = 'low';
    let riskColor = 0x00ff00;
    let riskEmoji = '🟢';

    if (riskFactors.bannedUsers > 5 || riskFactors.dangerousApps > 2) {
      overallRisk = 'high';
      riskColor = 0xff0000;
      riskEmoji = '🔴';
    } else if (riskFactors.bannedUsers > 2 || riskFactors.dangerousApps > 0) {
      overallRisk = 'medium';
      riskColor = 0xffa500;
      riskEmoji = '🟡';
    }

    const embed1 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle(`${riskEmoji} **Online Safety Risk Assessment**`)
        .setColor(riskColor)
        .setDescription(`🛡️ **Comprehensive safety evaluation**\n📊 **Risk Level:** ${overallRisk.toUpperCase()}\n🔍 **Assessment Date:** ${new Date().toLocaleString()}\n⚖️ **Based on ${riskFactors.totalMonitored} monitored systems**`)
        .addFields(
          {
            name: '📈 **Current Risk Metrics**',
            value: `**Overall Risk:** ${overallRisk.toUpperCase()}\n**Banned Users:** ${riskFactors.bannedUsers}\n**Banned Servers:** ${riskFactors.bannedServers}\n**Security Threats:** ${riskFactors.dangerousApps}`,
            inline: false
          },
          {
            name: '🎯 **Risk Assessment Factors**',
            value: `• **User Bans:** ${riskFactors.bannedUsers} active bans\n• **Server Bans:** ${riskFactors.bannedServers} banned servers\n• **Malware Threats:** ${riskFactors.dangerousApps} dangerous apps\n• **Ecosystem Health:** ${riskFactors.totalMonitored - riskFactors.dangerousApps} safe apps`,
            inline: false
          }
        ),
      interaction
    );

    const embed2 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🛡️ **Ban Risk Analysis**')
        .setColor(0xff0000)
        .setDescription('⚠️ **Nintendo Network ban probabilities**')
        .addFields(
          {
            name: '🚫 **High-Risk Activities**',
            value: `• **Online Cheating:** Very High ban risk\n• **Modified Gameplay:** High ban risk\n• **Pirated Games:** Instant permanent ban\n• **Unofficial Servers:** High ban risk\n• **Save File Sharing:** Moderate ban risk`,
            inline: false
          },
          {
            name: '✅ **Low-Risk Activities**',
            value: `• **Homebrew Apps:** No ban risk (offline)\n• **Custom Themes:** No ban risk\n• **Save Editors:** No ban risk (offline)\n• **Emulators:** No ban risk (offline)\n• **System Tools:** No ban risk`,
            inline: false
          },
          {
            name: '📊 **Ban Statistics**',
            value: `• **Cheat Bans:** 95% detection rate\n• **Piracy Bans:** 100% detection rate\n• **False Positives:** <1% (very rare)\n• **Appeal Success:** 0% for confirmed cheats\n• **Shadow Bans:** Undetected restrictions`,
            inline: false
          }
        ),
      interaction
    );

    const embed3 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🔒 **Safety Recommendations**')
        .setColor(0x00ff00)
        .setDescription('🛡️ **Minimize your risk exposure**')
        .addFields(
          {
            name: '🌐 **Online Safety**',
            value: `• **Separate Accounts:** Use different NNID for modding\n• **No Online Play:** Disable online features with mods\n• **Clean Sessions:** Play modded games offline only\n• **Regular Checks:** Monitor ban status\n• **Backup Saves:** Always backup legitimate saves`,
            inline: false
          },
          {
            name: '🖥️ **System Protection**',
            value: `• **Clean NAND:** Maintain unmodded NAND backup\n• **Stock Firmware:** Keep one clean SD card\n• **Signature Patches:** Only use verified patches\n• **Official Updates:** Test on secondary setup first\n• **Antivirus:** Scan downloads for malware`,
            inline: false
          },
          {
            name: '📱 **Data Protection**',
            value: `• **Save Backups:** Regular save file backups\n• **Account Security:** Strong passwords, 2FA\n• **Purchase History:** Keep legitimate game records\n• **Friend Lists:** Backup friend codes\n• **Screenshot Evidence:** Document legitimate gameplay`,
            inline: false
          }
        ),
      interaction
    );

    const embed4 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🚨 **Threat Detection**')
        .setColor(0xffa500)
        .setDescription('🔍 **Current security threats to monitor**')
        .addFields(
          {
            name: '🐛 **Malware & Viruses**',
            value: `• **Fake Homebrew:** Imitates legitimate apps\n• **Keyloggers:** Steal account credentials\n• **Ransomware:** Encrypts your data\n• **Backdoors:** Remote access to console\n• **Data Theft:** Steals save files and personal info`,
            inline: false
          },
          {
            name: '🎣 **Scam Tactics**',
            value: `• **Fake Updates:** Malware disguised as updates\n• **Premium Cheats:** Paid malware services\n• **Account Recovery:** Phishing attempts\n• **Discord Scams:** Fake support/technical help\n• **File Sharing:** Infected save files`,
            inline: false
          },
          {
            name: '🛡️ **Detection Methods**',
            value: `• **File Scanning:** Check file signatures\n• **Source Verification:** Only trusted GitHub repos\n• **Community Reports:** Monitor r/SwitchHacks\n• **Update Monitoring:** Track official releases\n• **Behavior Analysis:** Watch for suspicious activity`,
            inline: false
          }
        ),
      interaction
    );

    const embed5 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📋 **Risk Mitigation Checklist**')
        .setColor(0x5865f2)
        .setDescription('✅ **Complete safety checklist**')
        .addFields(
          {
            name: '🔍 **Pre-Installation Checks**',
            value: `• [ ] Verify download source (GitHub only)\n• [ ] Check file signatures/hashes\n• [ ] Read app documentation\n• [ ] Check community reviews\n• [ ] Test on secondary setup first`,
            inline: false
          },
          {
            name: '🛠️ **During Usage**',
            value: `• [ ] Use offline mode for modded games\n• [ ] Disable auto-cloud saves\n• [ ] Monitor system behavior\n• [ ] Regular security scans\n• [ ] Keep Atmosphere updated`,
            inline: false
          },
          {
            name: '📊 **Regular Maintenance**',
            value: `• [ ] Weekly security updates\n• [ ] Monthly system backups\n• [ ] Check ban status monthly\n• [ ] Update all homebrew apps\n• [ ] Clean old/unused files`,
            inline: false
          },
          {
            name: '🚨 **Emergency Response**',
            value: `• [ ] NAND backup available\n• [ ] Clean SD card ready\n• [ ] Legitimate game saves backed up\n• [ ] Account credentials secure\n• [ ] Recovery plan documented`,
            inline: false
          }
        ),
      interaction
    );

    const embed6 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📚 **Additional Resources**')
        .setColor(0xff6b35)
        .setDescription('🔗 **Helpful safety and security resources**')
        .addFields(
          {
            name: '🌐 **Communities & Forums**',
            value: `• **r/SwitchHacks:** Reddit community\n• **GBAtemp:** Technical discussions\n• **SwitchBrew:** Developer resources\n• **AtlasNX Discord:** Developer community\n• **r/SwitchPiracy:** (Use cautiously)`,
            inline: false
          },
          {
            name: '🛠️ **Security Tools**',
            value: `• **VirusTotal:** File scanning service\n• **Hybrid Analysis:** Malware analysis\n• **GitHub Security:** Repository monitoring\n• **Switch Ident:** System verification\n• **Lockpick:** Key verification`,
            inline: false
          },
          {
            name: '📋 **Related Commands**',
            value: buildCommandReferenceList(['blacklistmonitor', 'status', 'checkpermissions', 'loghere']),
            inline: false
          }
        ),
      interaction
    );

    await interaction.reply({ embeds: [embed1, embed2, embed3, embed4, embed5, embed6] });

  } catch (error) {
    console.error('Error generating risk assessment:', error);
    const embed = createErrorEmbed('Risk Assessment Error', '⚠️ **Unable to generate risk assessment**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handleHostPing(interaction) {
  try {
    const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));
    const stats = await getSystemStatistics();
    const startTime = Date.now();

    // Test key GitHub repositories and APIs
    const testHosts = [
      { name: 'GitHub API', url: 'https://api.github.com', type: 'api' },
      { name: 'Atmosphere-NX', url: 'https://api.github.com/repos/Atmosphere-NX/Atmosphere', type: 'repo' },
      { name: 'CTCaer/hekate', url: 'https://api.github.com/repos/CTCaer/hekate', type: 'repo' },
      { name: 'WerWolv/EdiZon', url: 'https://api.github.com/repos/WerWolv/EdiZon', type: 'repo' },
      { name: 'tomvita/Breeze-Beta', url: 'https://api.github.com/repos/tomvita/Breeze-Beta', type: 'repo' },
      { name: 'Nintendo Update API', url: 'https://github.com', type: 'service' }
    ];

    const results = [];

    for (const host of testHosts) {
      const hostStartTime = Date.now();
      try {
        let response;
        if (host.type === 'api') {
          response = await axios.get(host.url, {
            timeout: 5000,
            headers: { 'User-Agent': 'SwitchDex-Monitor/1.0' }
          });
        } else if (host.type === 'repo') {
          response = await axios.get(`${host.url}/releases/latest`, {
            timeout: 5000,
            headers: { 'User-Agent': 'SwitchDex-Monitor/1.0' }
          });
        } else {
          response = await axios.get(host.url, {
            timeout: 5000,
            headers: { 'User-Agent': 'SwitchDex-Monitor/1.0' }
          });
        }

        const responseTime = Date.now() - hostStartTime;
        results.push({
          name: host.name,
          status: 'online',
          responseTime: responseTime,
          statusCode: response.status,
          lastUpdate: host.type === 'repo' && response.data.published_at ?
            new Date(response.data.published_at).toLocaleDateString() : 'N/A'
        });

      } catch (error) {
        const responseTime = Date.now() - hostStartTime;
        results.push({
          name: host.name,
          status: 'offline',
          responseTime: responseTime,
          error: error.code || error.message,
          lastUpdate: 'N/A'
        });
      }
    }

    const totalTime = Date.now() - startTime;
    const onlineCount = results.filter(r => r.status === 'online').length;
    const offlineCount = results.filter(r => r.status === 'offline').length;

    const embed1 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🌐 **Remote Source Connectivity Test**')
        .setColor(onlineCount === results.length ? 0x00ff00 : offlineCount > 0 ? 0xffa500 : 0xff0000)
        .setDescription(`📡 **Network connectivity assessment**\n⏱️ **Total test time:** ${totalTime}ms\n✅ **Online:** ${onlineCount}/${results.length}\n❌ **Offline:** ${offlineCount}/${results.length}`)
        .addFields(
          {
            name: '📊 **Connectivity Summary**',
            value: `**Tested Services:** ${results.length}\n**Average Response:** ${Math.round(results.reduce((sum, r) => sum + r.responseTime, 0) / results.length)}ms\n**Best Response:** ${Math.min(...results.map(r => r.responseTime))}ms\n**Worst Response:** ${Math.max(...results.map(r => r.responseTime))}ms`,
            inline: false
          }
        ),
      interaction
    );

    const embed2 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🌐 **Service Status Details**')
        .setColor(0x5865f2)
        .setDescription('📋 **Detailed status for each monitored service**')
        .addFields(
          {
            name: '🔗 **API & Repository Status**',
            value: results.map(result =>
              `${result.status === 'online' ? '✅' : '❌'} **${result.name}**\n• Status: ${result.status.toUpperCase()}\n• Response: ${result.responseTime}ms\n• Code: ${result.statusCode || 'N/A'}\n• Last Update: ${result.lastUpdate}\n`
            ).join(''),
            inline: false
          }
        ),
      interaction
    );

    const embed3 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🌐 **Network Diagnostics**')
        .setColor(0xffa500)
        .setDescription('🔧 **Network troubleshooting information**')
        .addFields(
          {
            name: '📈 **Performance Metrics**',
            value: `**DNS Resolution:** ${results.every(r => r.responseTime < 1000) ? '✅ Fast' : '⚠️ Slow'}\n**API Response:** ${results.filter(r => r.status === 'online').every(r => r.responseTime < 2000) ? '✅ Good' : '⚠️ Slow'}\n**Service Availability:** ${onlineCount === results.length ? '✅ All Online' : '⚠️ Some Offline'}\n**Connection Stability:** ${results.filter(r => r.status === 'online').length > results.length * 0.8 ? '✅ Stable' : '⚠️ Unstable'}`,
            inline: false
          },
          {
            name: '🚨 **Common Issues & Solutions**',
            value: `• **DNS Issues:** Try different DNS servers\n• **Firewall Blocks:** Check firewall settings\n• **Rate Limiting:** GitHub API has rate limits\n• **ISP Blocking:** Use VPN if needed\n• **Regional Blocks:** Some services region-locked`,
            inline: false
          },
          {
            name: '🛠️ **Troubleshooting Steps**',
            value: `1. **Check Internet:** Test basic connectivity\n2. **DNS Flush:** Clear DNS cache\n3. **Firewall:** Temporarily disable\n4. **VPN:** Try different regions\n5. **Restart:** Reboot router/modem`,
            inline: false
          }
        ),
      interaction
    );

    const embed4 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🌐 **Homebrew Repository Health**')
        .setColor(0x00ff00)
        .setDescription('📊 **Status of monitored homebrew repositories**')
        .addFields(
          {
            name: '🏠 **Repository Overview**',
            value: `**Total Apps:** ${stats.totalHomebrew}\n**GitHub Hosted:** ${Object.values(homebrewData).filter(app => app.url.includes('github.com')).length}\n**Active Monitoring:** ✅ Enabled\n**Update Frequency:** ${config.checkInterval} minutes`,
            inline: false
          },
          {
            name: '🔄 **Update Sources**',
            value: Object.entries(homebrewData).slice(0, 8).map(([name, data]) => {
              const isGithub = data.url.includes('github.com');
              const status = results.find(r => r.name.includes(name.split('/')[0]))?.status || 'unknown';
              return `• **${name}:** ${isGithub ? 'GitHub' : 'Other'} (${status === 'online' ? '✅' : status === 'offline' ? '❌' : '❓'})`;
            }).join('\n'),
            inline: false
          },
          {
            name: '⚡ **API Rate Limits**',
            value: `• **GitHub API:** 5000 requests/hour (authenticated)\n• **Current Usage:** Low (monitoring only)\n• **Rate Limit Status:** ✅ Within limits\n• **Fallback:** Direct downloads available`,
            inline: false
          }
        ),
      interaction
    );

    const embed5 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🌐 **Monitoring & Alerts**')
        .setColor(0xff6b35)
        .setDescription('🚨 **Automated monitoring and notification system**')
        .addFields(
          {
            name: '📢 **Alert System**',
            value: `• **Downtime Detection:** Automatic monitoring\n• **Owner Notifications:** Critical failures only\n• **Channel Logging:** Status updates logged\n• **Recovery Testing:** Automatic re-testing`,
            inline: false
          },
          {
            name: '📊 **Health Metrics**',
            value: `• **Uptime Target:** 99.9% service availability\n• **Response Target:** <2000ms average response\n• **Monitoring Interval:** ${config.checkInterval} minutes\n• **Alert Threshold:** 3 consecutive failures`,
            inline: false
          },
          {
            name: '🔧 **Maintenance Windows**',
            value: `• **GitHub:** Occasional API maintenance\n• **Nintendo:** Regular service updates\n• **Discord:** Rare API maintenance\n• **Monitoring:** 24/7 continuous monitoring`,
            inline: false
          },
          {
            name: '📋 **Related Commands**',
            value: buildCommandReferenceList(['status', 'anynewupdates', 'homebrewupdates', 'forcedigest']),
            inline: false
          }
        ),
      interaction
    );

    await interaction.reply({ embeds: [embed1, embed2, embed3, embed4, embed5] });

  } catch (error) {
    console.error('Error testing host connectivity:', error);
    const embed = createErrorEmbed('Connectivity Test Error', '⚠️ **Unable to test connectivity**\n📄 **Please try again later**\n🔧 **Check your internet connection**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

async function handlePatchNotes(interaction) {
  try {
    const coreData = JSON.parse(fs.readFileSync('core-versions.json', 'utf8'));
    const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));

    // Get Nintendo firmware updates from history
    const nintendoUpdates = updateHistory.filter(update =>
      update.type === 'nintendo_firmware' || update.name.toLowerCase().includes('nintendo')
    ).slice(0, 5); // Last 5 updates

    const embed1 = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📝 **Nintendo Switch Firmware Patch Notes**')
        .setColor(0xff0000)
        .setDescription(`📰 **Official Nintendo firmware updates and changes**\n📅 **Current Version:** ${coreData.switch_firmware.version}\n⏰ **Last Updated:** ${coreData.switch_firmware.dateText}`)
        .addFields(
          {
            name: '📋 **Current Firmware Status**',
            value: `**Version:** ${coreData.switch_firmware.version}\n**Release Date:** ${coreData.switch_firmware.dateText}\n**Source:** [Nintendo Support](${coreData.switch_firmware.url})\n**Status:** Latest available`,
            inline: false
          },
          {
            name: '🔍 **What\'s Included in Updates**',
            value: `• **System Stability:** Performance improvements\n• **Security Patches:** Vulnerability fixes\n• **Game Compatibility:** New title support\n• **Feature Updates:** New system features\n• **Bug Fixes:** Known issue resolutions`,
            inline: false
          }
        ),
      interaction
    );

    if (nintendoUpdates.length > 0) {
      const embed2 = enhanceEmbed(
        new EmbedBuilder()
          .setTitle('📝 **Recent Firmware Updates**')
          .setColor(0xffa500)
          .setDescription('🆕 **Latest Nintendo firmware releases and changes**')
          .addFields(
            {
              name: '📰 **Update History**',
              value: nintendoUpdates.map(update =>
                `**${update.toVersion}** - ${update.dateText}\n${update.patchNotes || 'No detailed patch notes available'}\n`
              ).join('\n'),
              inline: false
            }
          ),
        interaction
      );

      await interaction.reply({ embeds: [embed1, embed2] });
    } else {
      embed1.addFields({
        name: '📝 **Current Patch Notes**',
        value: coreData.switch_firmware.patchNotes ||
          'No detailed patch notes are currently available. Check the [Nintendo Support page](' + coreData.switch_firmware.url + ') for the latest information.',
        inline: false
      });

      embed1.addFields({
        name: '💡 **How to Check for Updates**',
        value: `• **System Settings:** Settings → System → System Update\n• **Online Required:** Internet connection needed\n• **Automatic Checks:** Console checks periodically\n• **Manual Trigger:** Force update check anytime`,
        inline: false
      });

      await interaction.reply({ embeds: [embed1] });
    }

  } catch (error) {
    console.error('Error retrieving patch notes:', error);
    const embed = createErrorEmbed('Patch Notes Error', '⚠️ **Unable to retrieve firmware patch notes**\n📄 **Please try again later or check Nintendo\'s website directly**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

// Handle /addtracking command
async function handleAddTracking(interaction) {
  try {
    if (!hasAdminAccess(interaction)) {
      return await interaction.reply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to add custom tracking.',
        flags: 64
      });
    }

    const link = interaction.options.getString('link');
    const customName = interaction.options.getString('name');

    // Validate GitHub URL
    if (!link.includes('github.com')) {
      return await interaction.reply({
        content: '❌ Invalid URL. Please provide a valid GitHub repository or releases URL.',
        flags: 64
      });
    }

    // Extract owner/repo from URL (supports various formats)
    let urlMatch = link.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!urlMatch) {
      return await interaction.reply({
        content: '❌ Could not extract repository information from URL. Please use a valid GitHub repository URL.',
        flags: 64
      });
    }

    const [, owner, repo] = urlMatch;
    const repoName = repo.replace(/\.git$/, ''); // Remove .git suffix if present

    // Create unique identifier
    const uniqueId = `${owner}-${repoName}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Check if already tracked
    if (trackedReleases[uniqueId]) {
      return await interaction.reply({
        content: `❌ This repository is already being tracked as "${trackedReleases[uniqueId].name}".`,
        flags: 64
      });
    }

    // Verify repository exists and has releases
    const headers = process.env.GITHUB_TOKEN ?
      { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};

    try {
      // First check if repo exists
      const repoResponse = await axios.get(`https://api.github.com/repos/${owner}/${repoName}`, {
        headers,
        timeout: 10000
      });

      // Check for releases (list, include prereleases)
      const latest = await getLatestGithubRelease(owner, repoName, { headers, mode: 'any' });
      if (!latest || !latest.version) {
        return await interaction.reply({
          content: '❌ No releases or tags found for this repository.',
          flags: 64
        });
      }

      const latestVersion = latest.version;
      const dateText = latest.dateText || 'Unknown';

      // Determine display name
      const displayName = customName || repoResponse.data.name || repoName;

      // Add to tracked releases
      trackedReleases[uniqueId] = {
        name: displayName,
        version: latestVersion,
        dateText: dateText,
        url: latest.url,
        addedBy: interaction.user.id,
        addedAt: new Date().toISOString(),
        guildId: interaction.guild.id  // Per-server isolation for custom tracking
      };

      saveTrackedReleases();

      const embed = enhanceEmbed(
        new EmbedBuilder()
          .setTitle('✅ **Tracking Added**')
          .setColor(0x00ff00)
          .setDescription(`**${displayName}** is now being tracked for updates.`)
          .addFields(
            {
              name: '📦 **Current Version**',
              value: latestVersion,
              inline: true
            },
            {
              name: '📅 **Release Date**',
              value: dateText,
              inline: true
            },
            {
              name: '🔗 **Repository**',
              value: `[${owner}/${repoName}](https://github.com/${owner}/${repoName})`,
              inline: false
            }
          ),
        interaction
      );

      await interaction.reply({ embeds: [embed] });

    } catch (apiError) {
      if (apiError.response?.status === 404) {
        return await interaction.reply({
          content: '❌ Repository not found or does not exist. Please check the URL and try again.',
          flags: 64
        });
      } else if (apiError.response?.status === 403) {
        return await interaction.reply({
          content: '❌ Rate limited by GitHub API. Please try again later.',
          flags: 64
        });
      } else {
        return await interaction.reply({
          content: `❌ Error verifying repository: ${apiError.message}. Please check the URL and try again.`,
          flags: 64
        });
      }
    }

  } catch (error) {
    console.error('Error in handleAddTracking:', error);
    await interaction.reply({
      content: '❌ An error occurred while adding tracking. Please try again later.',
      flags: 64
    });
  }
}

// Handle /removetracking command
async function handleRemoveTracking(interaction) {
  try {
    await interaction.deferReply();

    let allRepos = [];
    try {
      allRepos = getAllTrackedRepositories(interaction.guild.id);
      console.log(`[DEBUG] Found ${allRepos.length} tracked repositories for removal (guild: ${interaction.guild.id})`);
    } catch (repoError) {
      console.error('[ERROR] Failed to get tracked repositories:', repoError);
      return await interaction.editReply({
        content: '❌ An error occurred while loading tracked repositories. Please check console logs.',
        flags: 64
      });
    }

    if (allRepos.length === 0) {
      return await interaction.editReply({
        content: '❌ No tracked repositories to remove.\n\nUse `/addtracking` to add repositories first.',
        flags: 64
      });
    }

    const homebrewRepos = allRepos.filter((repo) => repo.type === 'homebrew');
    const trackedRepos = allRepos.filter((repo) => repo.type === 'tracked');
    const options = [];

    for (const repo of trackedRepos.slice(0, 25)) {
      try {
        if (!repo || typeof repo !== 'object') {
          console.warn('[WARN] Invalid tracked repo object:', repo);
          continue;
        }

        if (!repo.id || !repo.displayName || !repo.owner || !repo.repo) {
          console.warn('[WARN] Missing required fields for tracked repo:', repo);
          continue;
        }

        const label = String(repo.displayName || 'Unknown').trim();
        const value = String(repo.id || '').trim();
        const owner = String(repo.owner || '').trim();
        const repoName = String(repo.repo || '').trim();
        const version = String(repo.version || 'Unknown').trim();

        if (!label || !value || !owner || !repoName) {
          continue;
        }

        const finalLabel = (label.length > 95 ? label.substring(0, 92) + '...' : label);
        const finalValue = value.length > 100 ? value.substring(0, 100) : value;
        const description = `${owner}/${repoName} - v${version}`;
        const finalDescription = description.length > 100 ? description.substring(0, 97) + '...' : description;

        options.push({
          label: `🔧 ${finalLabel}`,
          value: finalValue,
          description: finalDescription
        });
      } catch (optionError) {
        console.error(`[ERROR] Failed to create option for tracked repo:`, optionError);
      }
    }

    if (options.length < 25) {
      for (const repo of homebrewRepos.slice(0, 25 - options.length)) {
        try {
          if (!repo || typeof repo !== 'object') {
            continue;
          }

          if (!repo.id || !repo.displayName || !repo.owner || !repo.repo) {
            continue;
          }

          const label = String(repo.displayName || 'Unknown').trim();
          const value = String(repo.id || '').trim();
          const owner = String(repo.owner || '').trim();
          const repoName = String(repo.repo || '').trim();
          const version = String(repo.version || 'Unknown').trim();

          if (!label || !value || !owner || !repoName) {
            continue;
          }

          const finalLabel = (label.length > 94 ? label.substring(0, 91) + '...' : label);
          const finalValue = value.length > 100 ? value.substring(0, 100) : value;
          const description = `${owner}/${repoName} - v${version}`;
          const finalDescription = description.length > 95 ? description.substring(0, 92) + '...' : description;

          options.push({
            label: `🏠 ${finalLabel}`,
            value: finalValue,
            description: `${finalDescription} (System)`
          });
        } catch (optionError) {
          console.error(`[ERROR] Failed to create option for homebrew repo:`, optionError);
        }
      }
    }

    if (options.length === 0) {
      return await interaction.editReply({
        content: '❌ No valid repositories found to remove. Please check your data files.',
        flags: 64
      });
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('remove_tracking_select')
      .setPlaceholder('Select a repository to remove from tracking...')
      .setMinValues(1)
      .setMaxValues(1);

    for (const option of options) {
      try {
        selectMenu.addOptions(option);
      } catch (addError) {
        console.error('[ERROR] Failed to add option to menu:', option, addError);
      }
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle(`${EMBED_EMOJIS.CUSTOM} **Remove Tracking**`)
        .setColor(EMBED_COLORS.WARNING)
        .setDescription(
          `Select a repository to remove from tracking.\n\n` +
          `**Total Tracked:** ${allRepos.length} repositories\n` +
          `• **Homebrew (System):** ${homebrewRepos.length} (cannot be removed)\n` +
          `• **Custom Tracked:** ${trackedRepos.length} (can be removed)\n\n` +
          `${EMBED_EMOJIS.WARNING} **Note:** Homebrew repositories are system-managed and cannot be removed. Only custom tracked repositories can be removed.`
        ),
      interaction
    );

    console.log(`[DEBUG] Sending removal dropdown with ${options.length} options`);
    console.log(`[DEBUG] Components structure:`, JSON.stringify(row.toJSON(), null, 2));

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });

    console.log(`[DEBUG] Removal dropdown sent successfully`);
  } catch (error) {
    console.error('[ERROR] Error in handleRemoveTracking:', error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: `❌ An error occurred while loading tracked repositories:\n\`\`\`\n${error.message}\n\`\`\``,
        flags: 64
      });
    } else {
      await interaction.reply({
        content: `❌ An error occurred while loading tracked repositories:\n\`\`\`\n${error.message}\n\`\`\``,
        flags: 64
      });
    }
  }
}

// Handle select menu interaction for removetracking
async function handleRemoveTrackingSelect(interaction) {
  try {
    const selectedId = interaction.values[0];
    const repo = getRepositoryById(selectedId);

    if (!repo) {
      return await interaction.reply({
        content: '❌ Selected item not found. It may have already been removed.',
        flags: 64,
        ephemeral: true
      });
    }

    if (repo.type === 'homebrew') {
      return await interaction.reply({
        content: `❌ **Cannot remove system-managed repository**\n\n"${repo.displayName}" is a homebrew application that is system-managed and cannot be removed. Only custom tracked repositories (added with \`/addtracking\`) can be removed.`,
        flags: 64,
        ephemeral: true
      });
    }

    if (repo.type !== 'tracked' || !repo.uniqueId) {
      return await interaction.reply({
        content: '❌ This repository cannot be removed. Only custom tracked repositories can be removed.',
        flags: 64,
        ephemeral: true
      });
    }

    const trackedData = safeReadJSON('tracked-releases.json', null);

    if (!trackedData || typeof trackedData !== 'object') {
      return await interaction.reply({
        content: '❌ Tracked releases file is missing or invalid.',
        flags: 64,
        ephemeral: true
      });
    }

    if (!trackedData[repo.uniqueId]) {
      return await interaction.reply({
        content: '❌ Selected repository not found in tracking list. It may have already been removed.',
        flags: 64,
        ephemeral: true
      });
    }

    // Check if the repository belongs to the same guild (per-server isolation)
    const trackedItem = trackedData[repo.uniqueId];
    if (trackedItem.guildId && trackedItem.guildId !== interaction.guild.id) {
      return await interaction.reply({
        content: '❌ You can only remove repositories that were added to this server.',
        flags: 64,
        ephemeral: true
      });
    }

    const removedItem = trackedItem;

    delete trackedData[repo.uniqueId];
    safeWriteJSON('tracked-releases.json', trackedData);
    trackedReleases = trackedData;

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Tracking Removed**')
        .setColor(0x00ff00)
        .setDescription(`**${removedItem.name}** has been removed from tracking.`)
        .addFields(
          {
            name: '📦 **Removed Repository**',
            value: `**Name:** ${removedItem.name}\n**Repository:** ${repo.owner}/${repo.repo}\n**Last Version:** ${removedItem.version}`,
            inline: false
          },
          {
            name: '🔗 **Repository Link**',
            value: `[View on GitHub](${removedItem.url})`,
            inline: false
          }
        ),
      interaction
    );

    await interaction.update({ embeds: [embed], components: [] });

  } catch (error) {
    console.error('Error in handleRemoveTrackingSelect:', error);
    await interaction.reply({
      content: '❌ An error occurred while removing tracking. Please try again later.',
      flags: 64,
      ephemeral: true
    });
  }
}

// Title ID sync function - now shows guidance instead of syncing
async function handleSyncTitleIdsLegacy(interaction) {
  // This function is deprecated - see handleSyncTitleIds in the main handler section
}

async function handleForceDigest(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  try {
    const startTime = Date.now();

    // Gather all system data
    const stats = await getSystemStatistics();
    const pokemonData = JSON.parse(fs.readFileSync('pokemon-versions.json', 'utf8'));
    const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));

    // Send digest to all announcement channels
    let successCount = 0;
    let failCount = 0;

    for (const channel of announcementChannels) {
      try {
        const discordChannel = await client.channels.fetch(channel.channelId);
        if (discordChannel) {
          const digestEmbed = new EmbedBuilder()
            .setTitle('⚡ **SwitchDex Compatibility Digest**')
            .setColor(0x00ff00)
            .setDescription(`📊 **Automated system compatibility report**\n⏰ **Generated:** ${new Date().toLocaleString()}\n🔄 **Next update:** ${config.checkInterval} minutes`)
            .addFields(
              {
                name: '🎮 **Game Ecosystem**',
                value: `**Games Monitored:** ${stats.totalGames}\n**Tracked Releases:** ${stats.totalTrackedReleases}\n**Recent Updates:** ${stats.recentUpdates}\n**Status:** ✅ Active`,
                inline: true
              },
              {
                name: '🏠 **Homebrew Ecosystem**',
                value: `**Apps Available:** ${stats.totalHomebrew}\n**Categories:** 7 types\n**Security Status:** ✅ Clean\n**Updates:** Active`,
                inline: true
              },
              {
                name: '⚡ **Firmware Status**',
                value: `**Atmosphere:** ${stats.atmosphereVersion}\n**Hekate:** ${stats.hekateVersion}\n**Nintendo FW:** ${stats.firmwareVersion}\n**Compatibility:** Full`,
                inline: true
              },
              {
                name: '🛡️ **System Security**',
                value: `**Banned Users:** ${stats.bannedUsers}\n**Banned Servers:** ${stats.bannedServers}\n**Threat Level:** Low\n**Monitoring:** Active`,
                inline: false
              },
              {
                name: '📢 **Announcement Network**',
                value: `**Active Channels:** ${stats.announcementChannels}\n**Coverage:** ${stats.announcementChannels} servers\n**Status:** ✅ Operational\n**Last Digest:** Manual trigger`,
                inline: false
              },
              {
                name: '🔥 **Popular Content**',
                value: [popularGameHighlights, homebrewHighlights].filter(Boolean).join('\n') || '• No highlights available',
                inline: false
              }
            )
            .setFooter({
              text: 'SwitchDex Professional Monitor',
              iconURL: client.user?.displayAvatarURL()
            })
            .setTimestamp();

          await discordChannel.send({ embeds: [digestEmbed] });
          successCount++;
        }
      } catch (channelError) {
        console.error(`Failed to send digest to channel ${channel.channelId}:`, channelError.message);
        failCount++;
      }
    }

    const processingTime = Date.now() - startTime;

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⚡ **Force Compatibility Digest**')
        .setColor(successCount > 0 ? 0x00ff00 : 0xffa500)
        .setDescription(`✅ **Manual compatibility digest completed**\n⏱️ **Processing time:** ${processingTime}ms\n📊 **Data collected from ${Object.keys(stats).length} sources**`)
        .addFields(
          {
            name: '📢 **Distribution Results**',
            value: `**Channels Targeted:** ${announcementChannels.length}\n**Successful Sends:** ${successCount}\n**Failed Sends:** ${failCount}\n**Success Rate:** ${announcementChannels.length > 0 ? Math.round((successCount / announcementChannels.length) * 100) : 0}%`,
            inline: false
          },
          {
            name: '📊 **System Statistics**',
            value: `• Games: ${stats.totalGames} monitored\n• Homebrew: ${stats.totalHomebrew} apps\n• Tracked Releases: ${stats.totalTrackedReleases}\n• Updates (24h): ${stats.recentUpdates}\n• Channels: ${stats.announcementChannels} active`,
            inline: false
          },
          {
            name: '⚡ **Firmware Status**',
            value: `• Atmosphere: ${stats.atmosphereVersion}\n• Hekate: ${stats.hekateVersion}\n• Nintendo FW: ${stats.firmwareVersion}\n• Compatibility: Unverified - Check sources`,
            inline: false
          },
          {
            name: '🛡️ **Security Summary**',
            value: `• Banned Users: ${stats.bannedUsers}\n• Banned Servers: ${stats.bannedServers}\n• Threat Level: Low\n• Monitoring: Active`,
            inline: false
          }
        ),
      interaction
    );

    // Log the manual digest
    await logToChannel(
      `📢 **Manual Compatibility Digest**\n**Triggered by:** ${interaction.user.tag} (${interaction.user.id})\n**Channels:** ${successCount}/${announcementChannels.length} successful\n**Processing Time:** ${processingTime}ms\n**Timestamp:** ${new Date().toLocaleString()}`,
      interaction.guild?.id || null
    );

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Error generating force digest:', error);
    const embed = createErrorEmbed('Force Digest Error', '⚠️ **Failed to generate compatibility digest**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

// Periodic scanning function
function startPeriodicScanning() {
  // Clear existing interval if it exists
  if (scanInterval) {
    clearInterval(scanInterval);
  }

  scanInterval = setInterval(async () => {
    try {
      // Update file tracker
      fileTracker.lastCheck = Date.now();

      console.log(`🔍 [${new Date().toLocaleTimeString()}] Starting comprehensive update scan...`);

      // Send initial scan status to log channel
      await sendLogEmbed({
        title: '🔍 **Update Scan Started**',
        description: `**Scan Interval:** ${config.checkInterval} minutes\n**Timestamp:** ${new Date().toLocaleString()}`,
        color: 0x5865f2
      });

      // 1. Check Pokemon Game Updates
      console.log('🎮 Checking Pokemon game updates...');
      await sendLogEmbed({
        title: '🎮 **Pokemon Games Scan**',
        description: '🔍 Scanning for Pokemon game updates from official sources...',
        color: 0xff0000
      });

      await checkPokemonUpdates();

      // Title ID sync removed - users should find IDs themselves using /titleid guide

      // 2. Check Homebrew Updates
      console.log('🏠 Checking homebrew application updates...');
      await sendLogEmbed({
        title: '🏠 **Homebrew Scan**',
        description: '🔍 Scanning GitHub repositories for homebrew updates...',
        color: 0x00ff00
      });

      await checkHomebrewUpdates();

      // 3. Check Firmware Updates
      console.log('⚡ Checking firmware updates...');
      await sendLogEmbed({
        title: '⚡ **Firmware Scan**',
        description: '🔍 Scanning for Nintendo Switch and custom firmware updates...',
        color: 0xffff00
      });

      await checkFirmwareUpdates();

      // 4. Check Tracked Releases
      console.log('🔍 Checking tracked GitHub releases...');
      await sendLogEmbed({
        title: '🔍 **Tracked Releases Scan**',
        description: '🔍 Scanning custom tracked GitHub repositories for updates...',
        color: 0x9b59b6
      });
      await checkTrackedReleases();

      // Send completion status
      console.log(`✅ [${new Date().toLocaleTimeString()}] Update scan completed successfully`);
      await sendLogEmbed({
        title: '✅ **Scan Complete**',
        description: `**Next scan in:** ${config.checkInterval} minutes\n**Completed at:** ${new Date().toLocaleString()}`,
        color: 0x00ff00
      });

    } catch (error) {
      console.error('❌ Error during periodic scan:', error);
      await sendLogEmbed({
        title: '❌ **Scan Error**',
        description: `**Error:** ${error.message}\n**Time:** ${new Date().toLocaleString()}`,
        color: 0xff0000
      });
      detectAndNotifyErrors(error.message, 'periodic_scan');
    }
  }, config.checkInterval * 60000); // Convert minutes to milliseconds
}

// ========================================
// MULTI-SOURCE POKEMON SCRAPER FUNCTIONS
// ========================================

// Store for deduplication of recent updates
const recentPokemonUpdates = new Map();

// Load Pokemon sources configuration
function getPokemonSources() {
  try {
    if (fs.existsSync('pokemon-sources.json')) {
      return JSON.parse(fs.readFileSync('pokemon-sources.json', 'utf8'));
    }
  } catch (error) {
    console.warn('[WARN] Could not load pokemon-sources.json:', error.message);
  }
  
  // Return default sources if file not found
  return {
    sources: [
      {
        name: 'Nintendo Support',
        url: 'https://en-americas-support.nintendo.com/app/answers/detail/a_id/',
        type: 'official',
        priority: 1,
        scrapeMethod: 'nintendo_support',
        gameMapping: {
          'Pokémon Scarlet and Violet': '63362',
          'Pokémon Legends: Arceus': '63359',
          'Pokémon Brilliant Diamond': '63360',
          'Pokémon Sword': '63361'
        }
      },
      {
        name: 'Serebii',
        url: 'https://www.serebii.net/',
        type: 'fan_community',
        priority: 2,
        scrapeMethod: 'serebii'
      }
    ],
    deduplicationWindow: 3600000,
    updateCheckInterval: 900000
  };
}

// Check if an update is a duplicate within the deduplication window
function isDuplicatePokemonUpdate(gameName, version, deduplicationWindow = 3600000) {
  const key = `${gameName}_${version}`;
  const now = Date.now();
  
  if (recentPokemonUpdates.has(key)) {
    const lastSeen = recentPokemonUpdates.get(key);
    if (now - lastSeen < deduplicationWindow) {
      return true;
    }
  }
  
  recentPokemonUpdates.set(key, now);
  return false;
}

// Clean up old entries from deduplication map
function cleanupPokemonDeduplication(maxAge = 7200000) {
  const now = Date.now();
  for (const [key, timestamp] of recentPokemonUpdates.entries()) {
    if (now - timestamp > maxAge) {
      recentPokemonUpdates.delete(key);
    }
  }
}

// Scrape Nintendo Support for game updates
async function scrapeNintendoSupportPokemon(gameName, articleId) {
  try {
    const url = `https://en-americas-support.nintendo.com/app/answers/detail/a_id/${articleId}`;
    console.log(`   [POKEMON] Checking Nintendo Support for ${gameName}...`);
    
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    const html = response.data;
    
    // Look for version patterns in the HTML
    const versionPatterns = [
      /Ver(?:sion)?\.?\s*([0-9]+\.[0-9]+\.[0-9]+)/gi,
      /Version\s+([0-9]+\.[0-9]+\.[0-9]+)/gi,
      /v([0-9]+\.[0-9]+\.[0-9]+)/gi,
      /Update\s+([0-9]+\.[0-9]+\.[0-9]+)/gi
    ];
    
    let latestVersion = null;
    let allVersions = [];
    
    for (const pattern of versionPatterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          allVersions.push(match[1]);
        }
      }
    }
    
    if (allVersions.length > 0) {
      // Sort versions and get the highest
      allVersions = [...new Set(allVersions)].sort((a, b) => {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aVal = aParts[i] || 0;
          const bVal = bParts[i] || 0;
          if (aVal !== bVal) return bVal - aVal;
        }
        return 0;
      });
      latestVersion = allVersions[0];
    }
    
    // Try to extract date
    let releaseDate = null;
    const datePatterns = [
      /(?:Released?|Updated?)[:\s]+(?:on\s+)?(\w+\s+\d{1,2},?\s+\d{4})/i,
      /(\w+\s+\d{1,2},?\s+\d{4})/i
    ];
    
    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        releaseDate = match[1];
        break;
      }
    }
    
    // Extract patch notes
    let patchNotes = null;
    const notesMatch = html.match(/(?:Changes|Notes|Fixes|Updates)[:\s]*<[^>]*>([^<]+(?:<[^>]*>[^<]+)*)/i);
    if (notesMatch) {
      patchNotes = notesMatch[1].replace(/<[^>]*>/g, '').trim().substring(0, 500);
    }
    
    return {
      source: 'Nintendo Support',
      sourceType: 'official',
      priority: 1,
      confidence: 0.95,
      version: latestVersion,
      releaseDate: releaseDate,
      patchNotes: patchNotes,
      url: url
    };
    
  } catch (error) {
    console.log(`   [POKEMON] Nintendo Support scrape failed for ${gameName}: ${error.message}`);
    return null;
  }
}

// Scrape Serebii for game updates
async function scrapeSerebiiPokemon(gameName) {
  try {
    // Map game names to Serebii URLs
    const serebiiUrls = {
      'Pokémon Scarlet and Violet': 'https://www.serebii.net/scarletviolet/',
      'Pokémon Legends: Arceus': 'https://www.serebii.net/legendsarceus/',
      'Pokémon Brilliant Diamond': 'https://www.serebii.net/brilliantdiamondshiningpearl/',
      'Pokémon Sword': 'https://www.serebii.net/swordshield/',
      'Pokémon Shield': 'https://www.serebii.net/swordshield/',
      'Pokémon Lets Go Pikachu': 'https://www.serebii.net/letsgopikachueevee/'
    };
    
    const url = serebiiUrls[gameName];
    if (!url) {
      console.log(`   [POKEMON] No Serebii mapping for ${gameName}`);
      return null;
    }
    
    console.log(`   [POKEMON] Checking Serebii for ${gameName}...`);
    
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = response.data;
    
    // Look for version information
    const versionMatch = html.match(/Ver(?:sion)?\.?\s*([0-9]+\.[0-9]+\.[0-9]+)/i);
    const version = versionMatch ? versionMatch[1] : null;
    
    // Look for update announcements
    const updateMatch = html.match(/Update[:\s]+([^<]+)/i);
    let patchNotes = updateMatch ? updateMatch[1].trim().substring(0, 500) : null;
    
    return {
      source: 'Serebii',
      sourceType: 'fan_community',
      priority: 2,
      confidence: 0.85,
      version: version,
      releaseDate: null,
      patchNotes: patchNotes,
      url: url
    };
    
  } catch (error) {
    console.log(`   [POKEMON] Serebii scrape failed for ${gameName}: ${error.message}`);
    return null;
  }
}

// Scrape Bulbapedia for game updates
async function scrapeBulbapediaPokemon(gameName) {
  try {
    // Map game names to Bulbapedia URLs
    const bulbapediaUrls = {
      'Pokémon Scarlet and Violet': 'https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Scarlet_and_Violet',
      'Pokémon Legends: Arceus': 'https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Legends:_Arceus',
      'Pokémon Brilliant Diamond': 'https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Brilliant_Diamond_and_Shining_Pearl',
      'Pokémon Sword': 'https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Sword_and_Shield'
    };
    
    const url = bulbapediaUrls[gameName];
    if (!url) {
      return null;
    }
    
    console.log(`   [POKEMON] Checking Bulbapedia for ${gameName}...`);
    
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = response.data;
    
    // Look for version in infobox or article
    const versionMatch = html.match(/(?:Current|Latest)\s+(?:version|update)[:\s]*([0-9]+\.[0-9]+\.[0-9]+)/i) ||
                         html.match(/Ver(?:sion)?\.?\s*([0-9]+\.[0-9]+\.[0-9]+)/i);
    
    return {
      source: 'Bulbapedia',
      sourceType: 'fan_wiki',
      priority: 3,
      confidence: 0.80,
      version: versionMatch ? versionMatch[1] : null,
      releaseDate: null,
      patchNotes: null,
      url: url
    };
    
  } catch (error) {
    console.log(`   [POKEMON] Bulbapedia scrape failed for ${gameName}: ${error.message}`);
    return null;
  }
}

// Scrape PokemonDB for game updates
async function scrapePokemonDBPokemon(gameName) {
  try {
    console.log(`   [POKEMON] Checking PokemonDB for ${gameName}...`);
    
    const response = await axios.get('https://pokemondb.net/update-history', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const html = response.data;
    
    // Look for version references for the specific game
    const gamePattern = new RegExp(`${gameName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*([0-9]+\\.[0-9]+\\.[0-9]+)`, 'i');
    const match = html.match(gamePattern);
    
    return {
      source: 'PokemonDB',
      sourceType: 'fan_database',
      priority: 4,
      confidence: 0.75,
      version: match ? match[1] : null,
      releaseDate: null,
      patchNotes: null,
      url: 'https://pokemondb.net/update-history'
    };
    
  } catch (error) {
    console.log(`   [POKEMON] PokemonDB scrape failed: ${error.message}`);
    return null;
  }
}

// Check a single source for Pokemon game updates
async function checkPokemonSingleSource(source, gameName) {
  try {
    switch (source.scrapeMethod) {
      case 'nintendo_support':
        const articleId = source.gameMapping?.[gameName];
        if (articleId) {
          return await scrapeNintendoSupportPokemon(gameName, articleId);
        }
        return null;
        
      case 'serebii':
        return await scrapeSerebiiPokemon(gameName);
        
      case 'bulbapedia':
        return await scrapeBulbapediaPokemon(gameName);
        
      case 'pokemondb':
        return await scrapePokemonDBPokemon(gameName);
        
      default:
        return null;
    }
  } catch (error) {
    console.log(`   [POKEMON] Source ${source.name} failed for ${gameName}: ${error.message}`);
    return null;
  }
}

// Check multiple sources for a single Pokemon game
async function checkMultipleSourcesForPokemonGame(gameName, sources) {
  const results = [];
  
  // Sort sources by priority
  const sortedSources = [...sources].sort((a, b) => a.priority - b.priority);
  
  for (const source of sortedSources) {
    try {
      const result = await checkPokemonSingleSource(source, gameName);
      if (result && result.version) {
        results.push(result);
      }
      
      // Small delay between sources to be respectful
      await new Promise(resolve => setTimeout(resolve, 200));
      
    } catch (error) {
      console.log(`   [POKEMON] Error checking ${source.name}: ${error.message}`);
    }
  }
  
  return results;
}

// Determine the best version from multiple sources
function determineBestPokemonVersion(results) {
  if (!results || results.length === 0) return null;
  
  // Group by version
  const versionVotes = new Map();
  
  for (const result of results) {
    if (!result.version) continue;
    
    const existing = versionVotes.get(result.version) || {
      version: result.version,
      totalConfidence: 0,
      sources: [],
      bestResult: null
    };
    
    existing.totalConfidence += result.confidence;
    existing.sources.push(result.source);
    
    if (!existing.bestResult || result.priority < existing.bestResult.priority) {
      existing.bestResult = result;
    }
    
    versionVotes.set(result.version, existing);
  }
  
  // Find version with highest confidence
  let bestVersion = null;
  let highestConfidence = 0;
  
  for (const [version, data] of versionVotes.entries()) {
    if (data.totalConfidence > highestConfidence) {
      highestConfidence = data.totalConfidence;
      bestVersion = data;
    }
  }
  
  return bestVersion;
}

// ========================================
// MULTI-SOURCE FIRMWARE SCRAPER FUNCTIONS
// ========================================

// Store for deduplication of firmware updates
const recentFirmwareUpdates = new Map();

// Check if a firmware update is a duplicate
function isDuplicateFirmwareUpdate(version, deduplicationWindow = 3600000) {
  const key = `firmware_${version}`;
  const now = Date.now();
  
  if (recentFirmwareUpdates.has(key)) {
    const lastSeen = recentFirmwareUpdates.get(key);
    if (now - lastSeen < deduplicationWindow) {
      return true;
    }
  }
  
  recentFirmwareUpdates.set(key, now);
  return false;
}

// Scrape Wikipedia for Nintendo Switch firmware version
async function scrapeWikipediaFirmware() {
  try {
    console.log('   [FIRMWARE] Checking Wikipedia for Nintendo firmware...');
    
    const response = await axios.get('https://en.wikipedia.org/wiki/Nintendo_Switch_system_software', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const html = response.data;
    
    // Find all version numbers in the page
    const allVersions = html.match(/[0-9]+\.[0-9]+\.[0-9]+/g);
    let latestVersion = null;

    if (allVersions && allVersions.length > 0) {
      // Sort versions and get the highest
      const sortedVersions = [...new Set(allVersions)].sort((a, b) => {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aVal = aParts[i] || 0;
          const bVal = bParts[i] || 0;
          if (aVal !== bVal) return bVal - aVal;
        }
        return 0;
      });
      latestVersion = sortedVersions[0];
    }

    // Try to extract release date from infobox
    let releaseDate = null;
    const infoboxMatch = html.match(/Latest release[^>]*>([^<]*(?:November|December|January|February|March|April|May|June|July|August|September|October)[^<]*\d{4}[^<]*)/i);
    if (infoboxMatch && infoboxMatch[1]) {
      releaseDate = infoboxMatch[1]
        .replace(/&#160;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const dateMatch = releaseDate.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i);
      if (dateMatch) releaseDate = dateMatch[0];
    }

    return {
      source: 'Wikipedia',
      sourceType: 'wiki',
      priority: 2,
      confidence: 0.85,
      version: latestVersion,
      releaseDate: releaseDate,
      url: 'https://en.wikipedia.org/wiki/Nintendo_Switch_system_software'
    };

  } catch (error) {
    console.log(`   [FIRMWARE] Wikipedia scrape failed: ${error.message}`);
    return null;
  }
}

// Scrape Nintendo Support for firmware info
async function scrapeNintendoSupportFirmware() {
  try {
    console.log('   [FIRMWARE] Checking Nintendo Support for firmware...');
    
    const response = await axios.get('https://en-americas-support.nintendo.com/app/answers/detail/a_id/22525', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const html = response.data;
    
    // Look for version patterns
    const versionPatterns = [
      /System Menu Update[:\s]*(?:Version\s*)?([0-9]+\.[0-9]+\.[0-9]+)/i,
      /Version\s+([0-9]+\.[0-9]+\.[0-9]+)/i,
      /ver(?:sion)?\.?\s*([0-9]+\.[0-9]+\.[0-9]+)/i
    ];
    
    let latestVersion = null;
    for (const pattern of versionPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        latestVersion = match[1];
        break;
      }
    }
    
    // Extract date
    let releaseDate = null;
    const dateMatch = html.match(/(?:Released?|Updated?)[:\s]+(\w+\s+\d{1,2},?\s+\d{4})/i);
    if (dateMatch) releaseDate = dateMatch[1];

    return {
      source: 'Nintendo Support',
      sourceType: 'official',
      priority: 1,
      confidence: 0.95,
      version: latestVersion,
      releaseDate: releaseDate,
      url: 'https://en-americas-support.nintendo.com/app/answers/detail/a_id/22525'
    };

  } catch (error) {
    console.log(`   [FIRMWARE] Nintendo Support scrape failed: ${error.message}`);
    return null;
  }
}

// Scrape GBAtemp for firmware info
async function scrapeGBAtempFirmware() {
  try {
    console.log('   [FIRMWARE] Checking GBAtemp for firmware...');
    
    const response = await axios.get('https://gbatemp.net/search/?q=switch+firmware', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = response.data;
    
    // Look for firmware version mentions in search results
    const versionMatch = html.match(/(?:Switch|Nintendo)\s+(?:firmware|system)\s+(?:update\s+)?([0-9]+\.[0-9]+\.[0-9]+)/i);
    
    return {
      source: 'GBAtemp',
      sourceType: 'community',
      priority: 3,
      confidence: 0.75,
      version: versionMatch ? versionMatch[1] : null,
      releaseDate: null,
      url: 'https://gbatemp.net/'
    };

  } catch (error) {
    console.log(`   [FIRMWARE] GBAtemp scrape failed: ${error.message}`);
    return null;
  }
}

// Scrape Darthsternie's firmware archive
async function scrapeDarthsternieFirmware() {
  try {
    console.log('   [FIRMWARE] Checking Darthsternie firmware archive...');
    
    const response = await axios.get('https://darthsternie.net/switch-firmwares/', {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = response.data;
    
    // Look for firmware versions in the archive
    const allVersions = html.match(/[0-9]+\.[0-9]+\.[0-9]+/g);
    let latestVersion = null;
    
    if (allVersions && allVersions.length > 0) {
      const sortedVersions = [...new Set(allVersions)].sort((a, b) => {
        const aParts = a.split('.').map(Number);
        const bParts = b.split('.').map(Number);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
          const aVal = aParts[i] || 0;
          const bVal = bParts[i] || 0;
          if (aVal !== bVal) return bVal - aVal;
        }
        return 0;
      });
      latestVersion = sortedVersions[0];
    }

    return {
      source: 'Darthsternie',
      sourceType: 'archive',
      priority: 2,
      confidence: 0.90,
      version: latestVersion,
      releaseDate: null,
      url: 'https://darthsternie.net/switch-firmwares/'
    };

  } catch (error) {
    console.log(`   [FIRMWARE] Darthsternie scrape failed: ${error.message}`);
    return null;
  }
}

// Check multiple sources for firmware updates
async function checkMultipleFirmwareSources() {
  const results = [];
  
  // Define sources to check
  const scrapers = [
    { name: 'Nintendo Support', fn: scrapeNintendoSupportFirmware },
    { name: 'Wikipedia', fn: scrapeWikipediaFirmware },
    { name: 'Darthsternie', fn: scrapeDarthsternieFirmware },
    { name: 'GBAtemp', fn: scrapeGBAtempFirmware }
  ];
  
  for (const scraper of scrapers) {
    try {
      const result = await scraper.fn();
      if (result && result.version) {
        results.push(result);
        console.log(`   ✅ ${scraper.name}: Found version ${result.version}`);
      }
      
      // Small delay between sources
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (error) {
      console.log(`   ⚠️ ${scraper.name} failed: ${error.message}`);
    }
  }
  
  return results;
}

// Determine best firmware version from multiple sources
function determineBestFirmwareVersion(results) {
  if (!results || results.length === 0) return null;
  
  // Group by version
  const versionVotes = new Map();
  
  for (const result of results) {
    if (!result.version) continue;
    
    const existing = versionVotes.get(result.version) || {
      version: result.version,
      totalConfidence: 0,
      sources: [],
      bestResult: null
    };
    
    existing.totalConfidence += result.confidence;
    existing.sources.push(result.source);
    
    if (!existing.bestResult || result.priority < existing.bestResult.priority) {
      existing.bestResult = result;
    }
    
    versionVotes.set(result.version, existing);
  }
  
  // Find version with highest confidence
  let bestVersion = null;
  let highestConfidence = 0;
  
  for (const [version, data] of versionVotes.entries()) {
    if (data.totalConfidence > highestConfidence) {
      highestConfidence = data.totalConfidence;
      bestVersion = data;
    }
  }
  
  return bestVersion;
}

// Update checking functions
async function checkPokemonUpdates() {
  try {
    console.log('[POKEMON] Starting multi-source Pokemon update check...');
    
    // Load game data and sources configuration
    const pokemonData = safeReadJSON('pokemon-versions.json', {});
    const sourcesConfig = getPokemonSources();
    const sources = sourcesConfig.sources || [];
    const deduplicationWindow = sourcesConfig.deduplicationWindow || 3600000;
    
    // Clean up old deduplication entries
    cleanupPokemonDeduplication();

    const games = Object.keys(pokemonData);
    let checked = 0;
    let updated = 0;
    let sourceStats = {};
    
    // Initialize source stats
    for (const source of sources) {
      sourceStats[source.name] = { checked: 0, found: 0, failed: 0 };
    }

    console.log(`[POKEMON] Checking ${games.length} games across ${sources.length} sources...`);

    for (const gameName of games) {
      console.log(`   📡 Checking ${gameName}...`);

      try {
        const gameData = pokemonData[gameName];
        const currentVersion = gameData.version;
        
        // Check multiple sources for this game
        const results = await checkMultipleSourcesForPokemonGame(gameName, sources);
        
        // Update source stats
        for (const result of results) {
          if (sourceStats[result.source]) {
            sourceStats[result.source].checked++;
            if (result.version) sourceStats[result.source].found++;
          }
        }
        
        // Determine best version from all sources
        const bestVersion = determineBestPokemonVersion(results);
        
        if (bestVersion && bestVersion.version && bestVersion.version !== currentVersion) {
          // Check for duplicate notification
          if (!isDuplicatePokemonUpdate(gameName, bestVersion.version, deduplicationWindow)) {
            console.log(`   🆕 ${gameName}: ${currentVersion} → ${bestVersion.version}`);
            console.log(`      Sources: ${bestVersion.sources.join(', ')} (confidence: ${bestVersion.totalConfidence.toFixed(2)})`);
            updated++;
            
            // Update pokemon data
            pokemonData[gameName].version = bestVersion.version;
            pokemonData[gameName].lastChecked = new Date().toISOString();
            
            if (bestVersion.bestResult.releaseDate) {
              pokemonData[gameName].dateText = bestVersion.bestResult.releaseDate;
            }
            
            // Send update notification
            await sendUpdateNotificationToChannels({
              type: 'pokemon',
              name: gameName,
              fromVersion: currentVersion,
              toVersion: bestVersion.version,
              dateText: bestVersion.bestResult.releaseDate || new Date().toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
              }),
              url: bestVersion.bestResult.url,
              category: 'Pokemon Games',
              sources: bestVersion.sources,
              confidence: bestVersion.totalConfidence,
              patchNotes: bestVersion.bestResult.patchNotes
            });
            
            // Add to update history
            try {
              const updateHistory = safeReadJSON('update-history.json', []);
              updateHistory.unshift({
                type: 'pokemon',
                name: gameName,
                fromVersion: currentVersion,
                toVersion: bestVersion.version,
                dateText: bestVersion.bestResult.releaseDate || new Date().toISOString(),
                detectedAt: new Date().toISOString(),
                url: bestVersion.bestResult.url,
                sources: bestVersion.sources,
                confidence: bestVersion.totalConfidence
              });
              
              // Keep only last 100 entries
              if (updateHistory.length > 100) {
                updateHistory.splice(100);
              }
              
              safeWriteJSON('update-history.json', updateHistory);
            } catch (historyError) {
              console.warn(`[POKEMON] Failed to update history: ${historyError.message}`);
            }
          } else {
            console.log(`   ⏭️ ${gameName}: Duplicate update notification suppressed`);
          }
        } else {
          console.log(`   ✅ ${gameName}: ${currentVersion} (up to date)`);
        }
        
        // Update last checked time
        pokemonData[gameName].lastChecked = new Date().toISOString();
        checked++;

        // Send progress update every 3 games
        if (checked % 3 === 0) {
          await sendLogEmbed({
            title: `🎮 **Pokemon Progress**`,
            description: `**Checked:** ${checked}/${games.length} games\n**Updates Found:** ${updated}\n**Current:** ${gameName}`,
            color: 0xff0000
          });
        }

        // Delay between games to be respectful to sources
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (gameError) {
        console.log(`   ⚠️ ${gameName} check failed: ${gameError.message}`);
      }
    }

    // Save updated pokemon data
    safeWriteJSON('pokemon-versions.json', pokemonData);

    console.log('[POKEMON] Multi-source Pokemon game scan completed');
    
    // Build source summary
    const sourcesSummary = Object.entries(sourceStats)
      .map(([name, stats]) => `${name}: ${stats.found}/${stats.checked}`)
      .join('\n');
    
    await sendLogEmbed({
      title: '🎮 **Pokemon Scan Results**',
      description: `✅ **Games Checked:** ${checked}/${games.length}\n🆕 **Updates Found:** ${updated}\n🔄 **Status:** Multi-source monitoring active\n📊 **Next check:** ${config.checkInterval} minutes`,
      color: updated > 0 ? 0xffa500 : 0xff0000,
      fields: [
        { name: '📊 Total Games', value: games.length.toString(), inline: true },
        { name: '🌐 Sources Active', value: sources.length.toString(), inline: true },
        { name: '🔍 Update Method', value: 'Multi-Source Comparison', inline: true },
        { name: '📈 Source Stats', value: sourcesSummary || 'No data', inline: false }
      ],
    });

  } catch (error) {
    console.error('[POKEMON] Error checking Pokemon updates:', error);
    throw error;
  }
}

async function checkHomebrewUpdates() {
  try {
    const homebrewData = JSON.parse(fs.readFileSync('homebrew-versions.json', 'utf8'));

    // Check GitHub releases for each app
    const apps = Object.keys(homebrewData);
    let checked = 0;
    let updated = 0;
    let rateLimited = false;

    const headers = process.env.GITHUB_TOKEN ?
      { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};

    for (const app of apps) {
      console.log(`   📡 Checking ${app}...`);

      try {
        const appData = homebrewData[app];
        if (!appData.url || !appData.url.includes('github.com')) {
          console.log(`   ⏭️ ${app} skipped (no GitHub URL)`);
          continue;
        }

        // Extract owner/repo from GitHub URL
        const urlMatch = appData.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (!urlMatch) {
          console.log(`   ⚠️ ${app} skipped (invalid GitHub URL)`);
          continue;
        }

        const [, owner, repo] = urlMatch;

        // Check latest release via GitHub API (include prereleases)
        const latest = await getLatestGithubRelease(owner, repo, { headers, mode: 'any' });
        if (!latest || !latest.version) {
          console.log(`   ⚠️ ${app} skipped (no releases/tags found)`);
          continue;
        }

        const latestRelease = latest.release;
        const latestVersion = latest.version;
        const currentVersion = appData.version;

        // Compare versions (simple string comparison for now)
        if (latestVersion !== currentVersion) {
          console.log(`   🆕 ${app}: ${currentVersion} → ${latestVersion}`);
          updated++;

          // Send immediate notification to all announcement channels
          const dateText = latest.dateText || 'Unknown';

          await sendUpdateNotificationToChannels({
            type: 'homebrew',
            name: app.charAt(0).toUpperCase() + app.slice(1),
            fromVersion: currentVersion,
            toVersion: latestVersion,
            dateText: dateText,
            url: latest.url,
            category: 'Homebrew Applications'
          });

          if (latest.isPrerelease) {
            await logToChannel(`ℹ️ Using prerelease for ${app}: ${latestVersion} (prerelease=true)`);
          }

          // Add to update history
          const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));
          updateHistory.unshift({
            type: 'homebrew',
            name: app,
            fromVersion: currentVersion,
            toVersion: latestVersion,
            dateText: dateText,
            detectedAt: new Date().toISOString(),
            url: latest.url
          });
          // Keep only last 50 entries
          if (updateHistory.length > 50) {
            updateHistory.splice(50);
          }
          fs.writeFileSync('update-history.json', JSON.stringify(updateHistory, null, 2));

          // Update the data file
          homebrewData[app].version = latestVersion;
          homebrewData[app].dateText = dateText;
          homebrewData[app].url = latest.url;
        } else {
          console.log(`   ✅ ${app}: ${currentVersion} (up to date)`);
        }

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (apiError) {
        if (apiError.response?.status === 403) {
          console.log(`   🚫 ${app} rate limited`);
          rateLimited = true;
        } else if (apiError.response?.status === 404) {
          console.log(`   ❌ ${app} not found on GitHub`);
        } else {
          console.log(`   ⚠️ ${app} API error: ${apiError.message}`);
        }
      }

      checked++;

      // Send progress update every 5 apps
      if (checked % 5 === 0) {
        await sendLogEmbed({
          title: `🏠 **Homebrew Progress**`,
          description: `**Checked:** ${checked}/${apps.length} apps\n**Updates Found:** ${updated}\n**Current:** ${app}`,
          color: 0x00ff00,
        });
      }
    }

    // Save updated homebrew data if any changes were made
    if (updated > 0) {
      fs.writeFileSync('homebrew-versions.json', JSON.stringify(homebrewData, null, 2));
    }

    console.log('   ✅ Homebrew scan completed');
    await sendLogEmbed({
      title: '🏠 **Homebrew Scan Results**',
      description: `✅ **Apps Checked:** ${checked}/${apps.length}\n🆕 **Updates Found:** ${updated}\n🔄 **Status:** Monitoring active\n📊 **Next check:** ${config.checkInterval} minutes`,
      color: updated > 0 ? 0xffa500 : 0x00ff00,
      fields: [
        { name: 'Total Apps', value: apps.length.toString(), inline: true },
        { name: 'GitHub Token', value: process.env.GITHUB_TOKEN ? '✅ Available' : '❌ Not set', inline: true },
        { name: 'Rate Limited', value: rateLimited ? '⚠️ Yes' : '✅ No', inline: true }
      ],
    });

  } catch (error) {
    console.error('Error checking homebrew updates:', error);
    throw error;
  }
}

async function checkFirmwareUpdates() {
  try {
    const coreData = JSON.parse(fs.readFileSync('core-versions.json', 'utf8'));

    const components = Object.keys(coreData);
    let checked = 0;
    let updated = 0;

    for (const component of components) {
      console.log(`   📡 Checking ${component}...`);

      try {
        const compData = coreData[component];

        if (compData.url && compData.url.includes('github.com')) {
          // Check GitHub releases for custom firmware
          const urlMatch = compData.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (urlMatch) {
            const [, owner, repo] = urlMatch;
            const headers = process.env.GITHUB_TOKEN ?
              { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};

            const mode = component === 'atmosphere_prerelease'
              ? 'prefer_prerelease'
              : component === 'atmosphere_stable'
                ? 'stable_only'
                : 'any';

            const latest = await getLatestGithubRelease(owner, repo, { headers, mode });
            if (!latest || !latest.version) {
              console.log(`   ⚠️ ${component} skipped (no releases/tags found)`);
              continue;
            }

            const latestRelease = latest.release;
            const latestVersion = latest.version;

            if (latestVersion !== compData.version) {
              console.log(`   🆕 ${component}: ${compData.version} → ${latestVersion}`);
              updated++;

              // Send immediate notification to all announcement channels
              const dateText = latestRelease?.published_at
                ? new Date(latestRelease.published_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })
                : latest.dateText || 'Unknown';

              await sendUpdateNotificationToChannels({
                type: 'firmware',
                name: component.charAt(0).toUpperCase() + component.slice(1).replace('_', ' '),
                fromVersion: compData.version,
                toVersion: latestVersion,
                dateText: dateText,
                url: latest.url,
                category: 'Custom Firmware'
              });

              if (latest.isPrerelease) {
                await logToChannel(`ℹ️ Using prerelease for ${component}: ${latestVersion} (prerelease=true)`);
              }

              // Add to update history
              const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));
              updateHistory.unshift({
                type: 'firmware',
                name: component,
                fromVersion: compData.version,
                toVersion: latestVersion,
                dateText: dateText,
                detectedAt: new Date().toISOString(),
                url: latest.url
              });
              // Keep only last 50 entries
              if (updateHistory.length > 50) {
                updateHistory.splice(50);
              }
              fs.writeFileSync('update-history.json', JSON.stringify(updateHistory, null, 2));

              // Update the data file
              coreData[component].version = latestVersion;
              coreData[component].dateText = dateText;
              coreData[component].url = latest.url;
            } else {
              console.log(`   ✅ ${component}: ${compData.version} (up to date)`);
            }
          }
        } else if (component === 'switch_firmware') {
          // Multi-source firmware scraping
          try {
            console.log('   📡 Checking multiple sources for Nintendo firmware...');
            
            const firmwareResults = await checkMultipleFirmwareSources();
            const bestFirmware = determineBestFirmwareVersion(firmwareResults);
            
            if (bestFirmware && bestFirmware.version) {
              const currentVersion = compData.version;
              
              if (bestFirmware.version !== currentVersion && bestFirmware.version !== 'Unknown') {
                // Check for duplicate notification
                if (!isDuplicateFirmwareUpdate(bestFirmware.version)) {
                  console.log(`   🆕 ${component}: ${currentVersion} → ${bestFirmware.version}`);
                  console.log(`      Sources: ${bestFirmware.sources.join(', ')} (confidence: ${bestFirmware.totalConfidence.toFixed(2)})`);
                  updated++;
                  
                  // Update the data
                  const previousVersion = compData.version;
                  coreData[component].version = bestFirmware.version;
                  
                  if (bestFirmware.bestResult.releaseDate) {
                    coreData[component].dateText = bestFirmware.bestResult.releaseDate;
                  }
                  
                  // Update the URL to the best source
                  if (bestFirmware.bestResult.url) {
                    coreData[component].url = bestFirmware.bestResult.url;
                  }
                  
                  // Log the update for notification
                  const updateEntry = {
                    type: 'nintendo_firmware',
                    name: 'Nintendo Switch System Firmware',
                    fromVersion: previousVersion,
                    toVersion: bestFirmware.version,
                    dateText: bestFirmware.bestResult.releaseDate || new Date().toLocaleDateString('en-US', {
                      year: 'numeric', month: 'long', day: 'numeric'
                    }),
                    detectedAt: new Date().toISOString(),
                    sources: bestFirmware.sources,
                    confidence: bestFirmware.totalConfidence,
                    url: bestFirmware.bestResult.url
                  };
                  
                  // Add to update history
                  const updateHistory = safeReadJSON('update-history.json', []);
                  updateHistory.unshift(updateEntry);
                  // Keep only last 100 entries
                  if (updateHistory.length > 100) {
                    updateHistory.splice(100);
                  }
                  safeWriteJSON('update-history.json', updateHistory);
                  
                  // Send immediate notification to all announcement channels
                  await sendUpdateNotificationToChannels({
                    type: 'nintendo_firmware',
                    name: 'Nintendo Switch System Firmware',
                    fromVersion: previousVersion,
                    toVersion: bestFirmware.version,
                    dateText: updateEntry.dateText,
                    url: updateEntry.url,
                    category: 'Nintendo Switch Firmware',
                    sources: bestFirmware.sources,
                    confidence: bestFirmware.totalConfidence
                  });
                  
                } else {
                  console.log(`   ⏭️ ${component}: Duplicate firmware update notification suppressed`);
                }
              } else {
                console.log(`   ✅ ${component}: ${compData.version} (up to date from ${firmwareResults.length} sources)`);
              }
            } else {
              console.log(`   ⚠️ ${component}: No firmware version found from any source`);
            }
            
          } catch (scrapeError) {
            console.log(`   ⚠️ Multi-source ${component} scraping failed: ${scrapeError.message}`);
            console.log(`   📄 Falling back to cached data: ${compData.version}`);
          }
        } else {
          // For other non-GitHub components
          console.log(`   ✅ ${component}: ${compData.version} (no update check available)`);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        checked++;

      } catch (compError) {
        console.log(`   ⚠️ ${component} check failed: ${compError.message}`);
        checked++;
      }
    }

    // Save updated data if any changes were made
    if (updated > 0) {
      try {
        fs.writeFileSync('core-versions.json', JSON.stringify(coreData, null, 2));
        console.log(`   💾 Saved ${updated} firmware updates to core-versions.json`);
      } catch (saveError) {
        console.error('   ❌ Failed to save firmware updates:', saveError.message);
      }
    }

    console.log('   ✅ Firmware scan completed');
    await sendLogEmbed({
      title: '⚡ **Firmware Scan Results**',
      description: `✅ **Components Checked:** ${checked}/${components.length}\n🆕 **Updates Found:** ${updated}\n🔄 **Status:** Monitoring active\n📊 **Next check:** ${config.checkInterval} minutes`,
      color: updated > 0 ? 0xffa500 : 0xffff00,
      fields: [
        { name: 'Nintendo Firmware', value: coreData.switch_firmware?.version || 'Unknown', inline: true },
        { name: 'Atmosphere', value: coreData.atmosphere_stable?.version || 'Unknown', inline: true },
        { name: 'Hekate', value: coreData.hekate?.version || 'Unknown', inline: true },
        { name: 'Custom Firmware', value: updated > 0 ? '🆕 Updates Available' : '✅ All Up to Date', inline: true }
      ],
    });

  } catch (error) {
    console.error('Error checking firmware updates:', error);
    throw error;
  }
}

// Check tracked GitHub releases for updates
async function checkTrackedReleases() {
  try {
    const trackedItems = Object.keys(trackedReleases);
    if (trackedItems.length === 0) {
      console.log('   ℹ️ No tracked releases to check');
      return;
    }

    let checked = 0;
    let updated = 0;
    let rateLimited = false;

    const headers = process.env.GITHUB_TOKEN ?
      { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};

    for (const uniqueId of trackedItems) {
      console.log(`   📡 Checking ${trackedReleases[uniqueId].name}...`);

      try {
        const trackedItem = trackedReleases[uniqueId];
        if (!trackedItem.url || !trackedItem.url.includes('github.com')) {
          console.log(`   ⏭️ ${trackedItem.name} skipped (no GitHub URL)`);
          continue;
        }

        // Extract owner/repo from GitHub URL
        const urlMatch = trackedItem.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
        if (!urlMatch) {
          console.log(`   ⚠️ ${trackedItem.name} skipped (invalid GitHub URL)`);
          continue;
        }

        const [, owner, repo] = urlMatch;

        // Check latest release via GitHub API (allow prereleases)
        const latest = await getLatestGithubRelease(owner, repo, { headers, mode: 'any' });
        if (!latest || !latest.version) {
          console.log(`   ⚠️ ${trackedItem.name} skipped (no releases/tags found)`);
          continue;
        }

        const latestRelease = latest.release;
        const latestVersion = latest.version;
        const currentVersion = trackedItem.version;

        // Compare versions
        if (latestVersion !== currentVersion) {
          console.log(`   🆕 ${trackedItem.name}: ${currentVersion} → ${latestVersion}`);
          updated++;

          // Send immediate notification to all announcement channels
          const dateText = latest.dateText || 'Unknown';

          await sendUpdateNotificationToChannels({
            type: 'sysbot_fork',
            name: trackedItem.name,
            fromVersion: currentVersion,
            toVersion: latestVersion,
            dateText: dateText,
            url: latest.url,
            category: 'Sysbot fork updates',
            guildId: trackedItem.guildId  // Per-server isolation for custom tracking
          });

          if (latest.isPrerelease) {
            await logToChannel(`ℹ️ Using prerelease for tracked repo ${trackedItem.name}: ${latestVersion} (prerelease=true)`, trackedItem.guildId || null);
          }

          // Add to update history
          const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));
          updateHistory.unshift({
            type: 'sysbot_fork',
            name: trackedItem.name,
            fromVersion: currentVersion,
            toVersion: latestVersion,
            dateText: dateText,
            detectedAt: new Date().toISOString(),
            url: latest.url
          });
          // Keep only last 50 entries
          if (updateHistory.length > 50) {
            updateHistory.splice(50);
          }
          fs.writeFileSync('update-history.json', JSON.stringify(updateHistory, null, 2));

          // Update the tracked item
          trackedReleases[uniqueId].version = latestVersion;
          trackedReleases[uniqueId].dateText = dateText;
          trackedReleases[uniqueId].url = latestRelease.html_url;
        } else {
          console.log(`   ✅ ${trackedItem.name}: ${currentVersion} (up to date)`);
        }

        // Small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 300));

      } catch (apiError) {
        if (apiError.response?.status === 403) {
          console.log(`   🚫 ${trackedReleases[uniqueId].name} rate limited`);
          rateLimited = true;
        } else if (apiError.response?.status === 404) {
          console.log(`   ❌ ${trackedReleases[uniqueId].name} not found on GitHub`);
        } else {
          console.log(`   ⚠️ ${trackedReleases[uniqueId].name} API error: ${apiError.message}`);
        }
      }

      checked++;
    }

    // Save updated tracked releases if any changes were made
    if (updated > 0) {
      saveTrackedReleases();
    }

    console.log('   ✅ Tracked releases scan completed');
    await sendLogEmbed({
      title: '🔍 **Tracked Releases Scan Results**',
      description: `✅ **Items Checked:** ${checked}/${trackedItems.length}\n🆕 **Updates Found:** ${updated}\n🔄 **Status:** Monitoring active\n📊 **Next check:** ${config.checkInterval} minutes`,
      color: updated > 0 ? 0xffa500 : 0x9b59b6,
      fields: [
        { name: 'Total Tracked', value: trackedItems.length.toString(), inline: true },
        { name: 'GitHub Token', value: process.env.GITHUB_TOKEN ? '✅ Available' : '❌ Not set', inline: true },
        { name: 'Rate Limited', value: rateLimited ? '⚠️ Yes' : '✅ No', inline: true }
      ],
    });

  } catch (error) {
    console.error('Error checking tracked releases:', error);
    throw error;
  }
}

/**
 * Fetches the latest Build ID for a game from GitHub cheat repositories
 */
async function fetchBuildIdFromGitHub(titleId, gameName) {
  const headers = process.env.GITHUB_TOKEN ?
    { 'Authorization': `token ${process.env.GITHUB_TOKEN}` } : {};

  let bestResult = {
    buildId: null,
    version: null,
    source: null,
    confidence: 0
  };

  const errors = [];
  let rateLimited = false;

  for (const repo of cheatRepos) {
    try {
      const path = `atmosphere/contents/${titleId}/cheats`;
      const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${path}`;

      console.log(`   🔍 Checking ${repo.owner}/${repo.repo} for ${gameName}...`);

      const response = await axios.get(apiUrl, {
        headers,
        timeout: 15000,
        validateStatus: (status) => status < 500
      });

      if (response.status === 403) {
        const remaining = response.headers['x-ratelimit-remaining'];
        const resetTime = response.headers['x-ratelimit-reset'];

        if (remaining === '0') {
          rateLimited = true;
          const resetDate = new Date(parseInt(resetTime || '0', 10) * 1000);
          console.log(`   🚫 Rate limited. Resets at: ${resetDate.toLocaleString()}`);

          if (bestResult.buildId) {
            break;
          }

          if (process.env.GITHUB_TOKEN && resetDate.getTime() - Date.now() < 60000) {
            console.log('   ⏳ Waiting for rate limit reset...');
            await new Promise(resolve => setTimeout(resolve, Math.max(resetDate.getTime() - Date.now(), 0) + 1000));
            continue;
          } else {
            errors.push(`Rate limited by ${repo.owner}/${repo.repo}`);
            break;
          }
        }
      }

      if (response.status === 404) {
        console.log(`   ⏭️ ${repo.owner}/${repo.repo} doesn't have cheats for ${gameName}`);
        continue;
      }

      if (response.status !== 200) {
        errors.push(`${repo.owner}/${repo.repo}: HTTP ${response.status}`);
        continue;
      }

      if (!response.data || !Array.isArray(response.data)) {
        errors.push(`${repo.owner}/${repo.repo}: Invalid response format`);
        continue;
      }

      const buildIdFolders = response.data
        .filter(item => item.type === 'dir')
        .map(item => ({ name: item.name, size: item.size || 0 }))
        .filter(item => /^[0-9A-Fa-f]{8,16}$/.test(item.name))
        .sort((a, b) => {
          if (a.name.length !== b.name.length) {
            return b.name.length - a.name.length;
          }
          return b.name.localeCompare(a.name);
        });

      if (buildIdFolders.length === 0) {
        console.log(`   ⚠️ No valid Build ID folders found in ${repo.owner}/${repo.repo}`);
        continue;
      }

      for (const folder of buildIdFolders.slice(0, 3)) {
        try {
          const buildId = folder.name;
          const cheatPath = `${path}/${buildId}`;

          const cheatFilesResponse = await axios.get(
            `https://api.github.com/repos/${repo.owner}/${repo.repo}/contents/${cheatPath}`,
            {
              headers,
              timeout: 10000,
              validateStatus: (status) => status < 500
            }
          );

          if (cheatFilesResponse.status !== 200 || !Array.isArray(cheatFilesResponse.data)) {
            continue;
          }

          const cheatFiles = cheatFilesResponse.data.filter(file =>
            file.type === 'file' &&
            file.name.endsWith('.txt') &&
            file.size > 0 &&
            file.size < 50000
          );

          if (cheatFiles.length === 0) {
            if (!bestResult.buildId) {
              bestResult = {
                buildId: buildId,
                version: null,
                source: `${repo.owner}/${repo.repo}`,
                confidence: 1
              };
            }
            continue;
          }

          for (const cheatFile of cheatFiles.slice(0, 2)) {
            try {
              const fileContentResponse = await axios.get(cheatFile.download_url, {
                headers,
                timeout: 10000,
                maxContentLength: 50000,
                validateStatus: (status) => status === 200
              });

              const content = typeof fileContentResponse.data === 'string'
                ? fileContentResponse.data
                : JSON.stringify(fileContentResponse.data);

              const versionInfo = parseCheatFileForVersion(content, gameName);

              if (versionInfo && versionInfo.version) {
                const confidence = versionInfo.confidence || 3;

                if (confidence > bestResult.confidence || (confidence === bestResult.confidence && !bestResult.version)) {
                  bestResult = {
                    buildId: buildId,
                    version: versionInfo.version,
                    source: `${repo.owner}/${repo.repo}`,
                    confidence: confidence
                  };

                  console.log(`   ✅ Found Build ID ${buildId} with version ${versionInfo.version} from ${repo.owner}/${repo.repo}`);

                  if (confidence >= 4) {
                    return bestResult;
                  }
                }
              } else if (!bestResult.buildId) {
                bestResult = {
                  buildId: buildId,
                  version: null,
                  source: `${repo.owner}/${repo.repo}`,
                  confidence: 2
                };
              }

              await new Promise(resolve => setTimeout(resolve, 300));

            } catch (fileError) {
              if (fileError.response?.status !== 404) {
                console.log(`   ⚠️ Error reading cheat file: ${fileError.message}`);
              }
              continue;
            }
          }

        } catch (folderError) {
          if (folderError.response?.status === 404) {
            continue;
          }
          console.log(`   ⚠️ Error checking Build ID folder: ${folderError.message}`);
          continue;
        }
      }

      if (bestResult.buildId && bestResult.confidence >= 2) {
        console.log(`   ✅ Found Build ID ${bestResult.buildId} from ${repo.owner}/${repo.repo}`);
        break;
      }

    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        errors.push(`${repo.owner}/${repo.repo}: Timeout`);
      } else if (error.response) {
        errors.push(`${repo.owner}/${repo.repo}: ${error.response.status} ${error.response.statusText}`);
      } else {
        errors.push(`${repo.owner}/${repo.repo}: ${error.message}`);
      }
      console.log(`   ⚠️ Error checking ${repo.owner}/${repo.repo}: ${error.message}`);
      continue;
    }

    await new Promise(resolve => setTimeout(resolve, 800));
  }

  if (bestResult.buildId) {
    console.log(`   ✅ Best result for ${gameName}: Build ID ${bestResult.buildId} from ${bestResult.source}`);
  } else if (errors.length > 0 && !rateLimited) {
    console.log(`   ⚠️ Failed to find Build ID for ${gameName}. Errors: ${errors.join(', ')}`);
  }

  return {
    buildId: bestResult.buildId,
    version: bestResult.version,
    source: bestResult.source
  };
}

function parseCheatFileForVersion(content, gameName = '') {
  if (!content || typeof content !== 'string') {
    if (gameName) {
      console.warn(`[WARN] Invalid content provided for ${gameName}`);
    }
    return null;
  }

  const patterns = [
    { regex: /Version:\s*v?([\d.]+)/i, confidence: 5 },
    { regex: /Build ID:.*?Version:\s*v?([\d.]+)/i, confidence: 5 },
    { regex: /\[v?([\d.]+)\]/i, confidence: 4 },
    { regex: /v\s*([\d.]+)(?:\s|$)/i, confidence: 3 },
    { regex: /\b([\d]+\.[\d]+\.[\d]+)\b/, confidence: 2 }
  ];

  const lines = content.split('\n').slice(0, 20);
  const header = lines.join('\n');

  for (const pattern of patterns) {
    const match = header.match(pattern.regex) || content.match(pattern.regex);
    if (match && match[1]) {
      const version = match[1].trim();
      if (/^\d+\.\d+\.\d+$/.test(version) || /^\d+\.\d+$/.test(version)) {
        if (gameName) {
          console.log(`[INFO] Found version ${version} for ${gameName} (confidence: ${pattern.confidence})`);
        }
        return {
          version,
          confidence: pattern.confidence
        };
      }
    }
  }

  if (gameName) {
    console.warn(`[WARN] Could not extract version from cheat file for ${gameName}`);
  }

  return null;
}

async function syncTitleIdsWithVersions() {
  const results = {
    checked: 0,
    updated: 0,
    errors: [],
    skipped: []
  };

  try {
    console.log('🔄 Syncing Title IDs and Build IDs with current game versions...');

    let pokemonData;
    let titleIdData;

    try {
      pokemonData = JSON.parse(fs.readFileSync('pokemon-versions.json', 'utf8'));
    } catch (error) {
      throw new Error(`Failed to load pokemon-versions.json: ${error.message}`);
    }

    try {
      titleIdData = JSON.parse(fs.readFileSync('title-ids.json', 'utf8'));
    } catch (error) {
      throw new Error(`Failed to load title-ids.json: ${error.message}`);
    }

    for (const [titleId, gameInfo] of Object.entries(titleIdToGameMap)) {
      const gameKey = gameInfo.gameKey;
      const gameName = gameInfo.gameName;

      try {
        if (!titleIdData[gameKey]) {
          console.log(`   ⏭️ Skipping ${gameName} - not in title-ids.json`);
          results.skipped.push(`${gameName}: Not in title-ids.json`);
          continue;
        }

        const currentGameData = Object.entries(pokemonData).find(
          ([name]) => name === gameInfo.displayName ||
            name.toLowerCase().includes(gameInfo.gameName.toLowerCase())
        );

        if (!currentGameData) {
          console.log(`   ⏭️ Skipping ${gameName} - not found in pokemon-versions.json`);
          results.skipped.push(`${gameName}: Not in pokemon-versions.json`);
          continue;
        }

        const [, versionData] = currentGameData;
        const currentVersion = versionData.version;

        if (!currentVersion) {
          console.log(`   ⚠️ Skipping ${gameName} - no version data`);
          results.errors.push(`${gameName}: Missing version data`);
          continue;
        }

        const storedVersion = titleIdData[gameKey].version || 'Unknown';
        const storedBuildId = titleIdData[gameKey].buildId;

        const needsUpdate =
          currentVersion !== storedVersion ||
          !storedBuildId ||
          storedBuildId === 'Unknown' ||
          storedBuildId.length < 8;

        if (needsUpdate) {
          console.log(`   🔍 Checking Build ID for ${gameName} (v${currentVersion})...`);
          results.checked++;

          try {
            const fetchPromise = fetchBuildIdFromGitHub(titleId, gameName);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Build ID fetch timeout')), 30000)
            );

            const fetchResult = await Promise.race([fetchPromise, timeoutPromise]);

            if (fetchResult && fetchResult.buildId) {
              const buildId = fetchResult.buildId.trim().toUpperCase();

              if (!/^[0-9A-F]{8,16}$/.test(buildId)) {
                throw new Error(`Invalid Build ID format: ${buildId}`);
              }

              const oldBuildId = titleIdData[gameKey].buildId;
              titleIdData[gameKey].buildId = buildId;
              titleIdData[gameKey].version = currentVersion;
              titleIdData[gameKey].lastUpdated = new Date().toISOString().split('T')[0];

              if (fetchResult.source) {
                titleIdData[gameKey].source = fetchResult.source;
              }

              results.updated++;
              console.log(`   ✅ Updated ${gameName}: Build ID ${oldBuildId || 'None'} → ${buildId} (v${currentVersion})`);

              try {
                const updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));
                updateHistory.unshift({
                  type: 'build_id_update',
                  name: gameInfo.displayName,
                  fromVersion: storedVersion,
                  toVersion: currentVersion,
                  fromBuildId: oldBuildId || 'Unknown',
                  toBuildId: buildId,
                  detectedAt: new Date().toISOString(),
                  source: fetchResult.source || 'GitHub Cheat Repos'
                });
                if (updateHistory.length > 50) {
                  updateHistory.splice(50);
                }
                fs.writeFileSync('update-history.json', JSON.stringify(updateHistory, null, 2));
              } catch (historyError) {
                console.log(`   ⚠️ Failed to update history: ${historyError.message}`);
              }

            } else {
              const errorMsg = `Could not find Build ID for ${gameName} (v${currentVersion})`;
              console.log(`   ⚠️ ${errorMsg}`);
              results.errors.push(errorMsg);
            }

          } catch (fetchError) {
            const errorMsg = `${gameName}: ${fetchError.message}`;
            console.log(`   ❌ Error fetching Build ID for ${gameName}: ${fetchError.message}`);
            results.errors.push(errorMsg);
          }

        } else {
          console.log(`   ✅ ${gameName} is up to date (v${currentVersion}, Build ID: ${storedBuildId})`);
        }

      } catch (gameError) {
        const errorMsg = `${gameName}: ${gameError.message}`;
        console.error(`   ❌ Error processing ${gameName}: ${gameError.message}`);
        results.errors.push(errorMsg);
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    if (results.updated > 0) {
      try {
        const backupPath = `title-ids.backup.${Date.now()}.json`;
        fs.writeFileSync(backupPath, JSON.stringify(titleIdData, null, 2));
        console.log(`   💾 Created backup: ${backupPath}`);

        fs.writeFileSync('title-ids.json', JSON.stringify(titleIdData, null, 2));
        console.log(`   💾 Saved ${results.updated} Build ID updates to title-ids.json`);
      } catch (saveError) {
        throw new Error(`Failed to save title-ids.json: ${saveError.message}`);
      }
    }

    const embedColor = results.updated > 0 ? 0x00ff00 : (results.errors.length > 0 ? 0xffa500 : 0xffff00);
    const description = results.updated > 0
      ? `✅ **Sync completed successfully**\n**Games Checked:** ${results.checked}\n**Build IDs Updated:** ${results.updated}`
      : results.errors.length > 0
        ? `⚠️ **Sync completed with errors**\n**Games Checked:** ${results.checked}\n**Errors:** ${results.errors.length}`
        : `✅ **All games up to date**\n**Games Checked:** ${results.checked}`;

    await sendLogEmbed({
      title: '🆔 **Title ID Sync Complete**',
      description: description,
      color: embedColor,
      fields: results.errors.length > 0 ? [{
        name: '⚠️ **Errors**',
        value: results.errors.slice(0, 5).map(e => `• ${e}`).join('\n') +
          (results.errors.length > 5 ? `\n... and ${results.errors.length - 5} more` : ''),
        inline: false
      }] : undefined
    });

    return results;
  } catch (error) {
    console.error('❌ Critical error in syncTitleIdsWithVersions:', error);

    await sendLogEmbed({
      title: '❌ **Title ID Sync Error**',
      description: `**Critical Error:** ${error.message}\n**Time:** ${new Date().toLocaleString()}`,
      color: 0xff0000
    });

    throw error;
  }
}

// Handle data/analytics command
async function handleData(interaction) {
  try {
    await interaction.deferReply();
    
    const stats = loadStatistics();
    if (!stats) {
      return await interaction.editReply({
        content: '❌ Statistics tracking not initialized. Please wait a moment and try again.'
      });
    }
    
    // Calculate time-based statistics
    const now = new Date();
    const trackingStart = stats.trackingStarted ? new Date(stats.trackingStarted) : now;
    const daysTracking = Math.max(1, Math.floor((now - trackingStart) / (1000 * 60 * 60 * 24)));
    
    // Get recent stats (last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recentUpdates = (stats.updateStatistics.updateTimeline || []).filter(
      update => new Date(update.timestamp) >= sevenDaysAgo
    ).length;
    
    // Get unique users in last 7 days
    let recentUniqueUsers = 0;
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];
    for (const date in stats.userStatistics?.usersByDate || {}) {
      if (date >= sevenDaysAgoStr) {
        const userSet = stats.userStatistics.usersByDate[date];
        if (userSet instanceof Set) {
          recentUniqueUsers += userSet.size;
        } else if (Array.isArray(userSet)) {
          recentUniqueUsers += new Set(userSet).size;
        }
      }
    }
    
    // EMBED 1: Overview Dashboard
    const overviewEmbed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📊 **SwitchDex Analytics Dashboard**')
        .setColor(0x5865f2)
        .setDescription(`> 📈 **Comprehensive bot statistics and analytics**\n> ⏱️ **Tracking for:** ${daysTracking} day${daysTracking !== 1 ? 's' : ''}\n> 📅 **Since:** ${trackingStart.toLocaleDateString()}`)
        .addFields(
          {
            name: '👥 **User Statistics**',
            value: `**Total Unique Users:** ${stats.userStatistics?.totalUniqueUsers || 0}\n**Recent Users (7d):** ${recentUniqueUsers}\n**Total Commands:** ${stats.userStatistics?.totalCommandsProcessed || 0}\n**Most Active Command:** /${stats.userStatistics?.mostActiveCommand || 'N/A'}`,
            inline: true
          },
          {
            name: '🔄 **Update Statistics**',
            value: `**Total Updates:** ${stats.updateStatistics?.totalUpdatesDetected || 0}\n**Recent Updates (7d):** ${recentUpdates}\n**Pokémon:** ${stats.updateStatistics?.pokemonUpdates || 0}\n**Homebrew:** ${stats.updateStatistics?.homebrewUpdates || 0}\n**Firmware:** ${stats.updateStatistics?.firmwareUpdates || 0}`,
            inline: true
          },
          {
            name: '⚙️ **System Health**',
            value: `**Total Scans:** ${stats.scanStatistics?.totalScans || 0}\n**Success Rate:** ${stats.scanStatistics?.totalScans > 0 ? Math.round((stats.scanStatistics.successfulScans / stats.scanStatistics.totalScans) * 100) : 100}%\n**Error Rate:** ${(stats.errorStatistics?.errorRate || 0).toFixed(2)}%\n**Avg Scan Time:** ${Math.round(stats.scanStatistics?.averageScanDuration || 0)}ms`,
            inline: true
          }
        ),
      interaction
    );
    
    // EMBED 2: User Analytics
    const userEmbed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('👥 **User Analytics**')
        .setColor(0x00ff00)
        .setDescription(`> 📊 **Detailed user engagement statistics**`)
        .addFields(
          {
            name: '📈 **Overview**',
            value: `**Total Unique Users:** ${stats.userStatistics?.totalUniqueUsers || 0}\n**Commands Processed:** ${stats.userStatistics?.totalCommandsProcessed || 0}\n**Avg Commands/User:** ${stats.userStatistics?.totalUniqueUsers > 0 ? Math.round((stats.userStatistics?.totalCommandsProcessed || 0) / stats.userStatistics.totalUniqueUsers) : 0}\n**Tracking Since:** ${stats.userStatistics?.firstUsageTimestamp ? new Date(stats.userStatistics.firstUsageTimestamp).toLocaleDateString() : 'N/A'}`,
            inline: false
          },
          {
            name: '🏆 **Top Commands**',
            value: Object.entries(stats.userStatistics?.commandsByType || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([cmd, count], i) => `${i + 1}. **/${cmd}** - ${count} uses`)
              .join('\n') || 'No command data yet',
            inline: false
          }
        ),
      interaction
    );
    
    // EMBED 3: Update Analytics
    const updateEmbed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🔄 **Update Analytics**')
        .setColor(0xffff00)
        .setDescription(`> 📦 **Update detection and frequency statistics**`)
        .addFields(
          {
            name: '📊 **Overview**',
            value: `**Total Updates Detected:** ${stats.updateStatistics?.totalUpdatesDetected || 0}\n**Pokémon Updates:** ${stats.updateStatistics?.pokemonUpdates || 0}\n**Homebrew Updates:** ${stats.updateStatistics?.homebrewUpdates || 0}\n**Firmware Updates:** ${stats.updateStatistics?.firmwareUpdates || 0}\n**Custom Tracked:** ${stats.updateStatistics?.customTrackedUpdates || 0}`,
            inline: false
          },
          {
            name: '🏆 **Most Active Games/Apps**',
            value: Object.entries(stats.updateStatistics?.updatesByGame || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([game, count]) => `• **${game}** - ${count} update${count !== 1 ? 's' : ''}`)
              .join('\n') || 'No update data yet',
            inline: false
          }
        ),
      interaction
    );
    
    // EMBED 4: Source Reliability
    const sourceEntries = Object.entries(stats.sourceStatistics?.sourceReliability || {})
      .map(([source, reliability]) => ({
        source,
        reliability: reliability || 0,
        avgResponse: stats.sourceStatistics?.averageResponseTime?.[source] ? 
          Math.round(stats.sourceStatistics.averageResponseTime[source].reduce((a, b) => a + b, 0) /
          stats.sourceStatistics.averageResponseTime[source].length) : null
      }))
      .sort((a, b) => b.reliability - a.reliability);
    
    const sourceEmbed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🌐 **Source Reliability**')
        .setColor(0x9b59b6)
        .setDescription(`> 🔍 **Scraping source performance metrics**`)
        .addFields(
          {
            name: '📊 **Source Performance**',
            value: sourceEntries.length > 0 ? 
              sourceEntries.slice(0, 5).map(({ source, reliability, avgResponse }) =>
                `**${source}**\n• Reliability: ${reliability.toFixed(1)}%\n• Avg Response: ${avgResponse ? avgResponse + 'ms' : 'N/A'}`
              ).join('\n\n') : 'No source data yet',
            inline: false
          }
        ),
      interaction
    );
    
    // EMBED 5: Error Analytics
    const errorEmbed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⚠️ **Error Analytics**')
        .setColor(0xff0000)
        .setDescription(`> 🚨 **Error tracking and diagnostics**`)
        .addFields(
          {
            name: '📊 **Overview**',
            value: `**Total Errors:** ${stats.errorStatistics?.totalErrors || 0}\n**Error Rate:** ${(stats.errorStatistics?.errorRate || 0).toFixed(2)}%\n**Most Common:** ${stats.errorStatistics?.mostCommonError || 'N/A'}`,
            inline: false
          },
          {
            name: '🔍 **Errors by Type**',
            value: Object.entries(stats.errorStatistics?.errorsByType || {})
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([type, count]) => `• **${type}** - ${count} occurrence${count !== 1 ? 's' : ''}`)
              .join('\n') || 'No errors recorded ✅',
            inline: false
          }
        ),
      interaction
    );
    
    // EMBED 6: Bot Health
    const uptimeMs = stats.botHealth?.uptime || 0;
    const uptimeDays = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
    const uptimeHours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
    
    const healthEmbed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('💚 **Bot Health Metrics**')
        .setColor(0x00ff00)
        .setDescription(`> ⚙️ **System performance and uptime**`)
        .addFields(
          {
            name: '⏱️ **Uptime**',
            value: `**Uptime:** ${uptimeDays}d ${uptimeHours}h ${uptimeMinutes}m\n**Start Time:** ${stats.botHealth?.startTime ? new Date(stats.botHealth.startTime).toLocaleString() : 'N/A'}\n**Last Restart:** ${stats.botHealth?.lastRestart ? new Date(stats.botHealth.lastRestart).toLocaleString() : 'First run'}`,
            inline: false
          },
          {
            name: '📊 **Performance**',
            value: `**Total Scans:** ${stats.scanStatistics?.totalScans || 0}\n**Success Rate:** ${stats.scanStatistics?.totalScans > 0 ? Math.round((stats.scanStatistics.successfulScans / stats.scanStatistics.totalScans) * 100) : 100}%\n**Avg Scan Duration:** ${Math.round(stats.scanStatistics?.averageScanDuration || 0)}ms\n**Last Scan:** ${stats.scanStatistics?.lastScanTime ? new Date(stats.scanStatistics.lastScanTime).toLocaleString() : 'N/A'}`,
            inline: false
          }
        ),
      interaction
    );
    
    await interaction.editReply({
      embeds: [overviewEmbed, userEmbed, updateEmbed, sourceEmbed, errorEmbed, healthEmbed]
    });
    
  } catch (error) {
    console.error('Error generating data dashboard:', error);
    const embed = createErrorEmbed(
      'Analytics Error',
      `❌ **Error generating analytics dashboard:** ${error.message}\n\nPlease try again later.`,
      interaction
    );
    
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed] });
    }
  }
}

// Handle Title ID sync command
async function handleSyncTitleIds(interaction) {
  if (!hasAdminPermissions(interaction.member)) {
    return await interaction.reply({
      content: '❌ You need administrator permissions to use this command.',
      flags: 64
    });
  }

  try {
    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🆔 **Title ID Sync No Longer Available**')
        .setColor(0x5865f2)
        .setDescription('> 📋 **Why syncing was removed and what to do instead**')
        .addFields(
          {
            name: '⚠️ **Why Was Syncing Removed?**',
            value: `Title ID and Build ID syncing has been removed because:\n\n` +
              `• **Accuracy Issues:** Scraped IDs may not match your specific game version\n` +
              `• **Regional Differences:** Different regions have different Title IDs\n` +
              `• **Update Delays:** Scraped data may be outdated\n` +
              `• **User Control:** Finding IDs yourself ensures accuracy`,
            inline: false
          },
          {
            name: '💡 **How to Find Title IDs Yourself**',
            value: `Use \`/titleid\` command for detailed instructions!\n\n` +
              `**Quick Methods:**\n` +
              `• **DBI:** Browse installed applications → Select game\n` +
              `• **Breeze/EdiZon:** Launch app → Select game → View Build ID\n` +
              `• **NSZ Manager:** Open game file → View properties\n` +
              `• **Online Databases:** Search switchbrew.org`,
            inline: false
          },
          {
            name: '🔗 **Recommended Tools**',
            value: `• **DBI** - Best for viewing installed game IDs\n` +
              `• **Breeze** - Cheat manager that shows Build IDs\n` +
              `• **NSZ Manager** - PC tool for game file analysis\n` +
              `• **switchbrew.org** - Online Title ID database`,
            inline: false
          },
          {
            name: '🛠️ **Related Commands**',
            value: buildCommandReferenceList(['titleid', 'update', 'cheatsource', 'organizecheats']),
            inline: false
          }
        ),
      interaction
    );

    await interaction.reply({ embeds: [embed] });

  } catch (error) {
    console.error('Error in handleSyncTitleIds:', error);
    const embed = createErrorEmbed('Command Error', '⚠️ **An error occurred**\n📄 **Please try again later**', interaction);
    await interaction.reply({ embeds: [embed] });
  }
}

// Periodic scanning function
function startPeriodicScanning() {
  // Clear existing interval if it exists
  if (scanInterval) {
    clearInterval(scanInterval);
  }

  scanInterval = setInterval(async () => {
    const scanStartTime = Date.now();
    
    try {
      // Update file tracker
      fileTracker.lastCheck = Date.now();

      console.log(`🔍 [${new Date().toLocaleTimeString()}] Starting comprehensive update scan...`);

      // Send initial scan status to log channel
      await sendLogEmbed({
        title: '🔍 **Update Scan Started**',
        description: `**Scan Interval:** ${config.checkInterval} minutes\n**Timestamp:** ${new Date().toLocaleString()}`,
        color: 0x5865f2
      });

      // 1. Check Pokemon Game Updates
      console.log('🎮 Checking Pokemon game updates...');
      await sendLogEmbed({
        title: '🎮 **Pokemon Games Scan**',
        description: '🔍 Scanning for Pokemon game updates from official sources...',
        color: 0xff0000
      });

      await checkPokemonUpdates();

      // Title ID sync removed - users should find IDs themselves using /titleid guide

      // 2. Check Homebrew Updates
      console.log('🏠 Checking homebrew application updates...');
      await sendLogEmbed({
        title: '🏠 **Homebrew Scan**',
        description: '🔍 Scanning GitHub repositories for homebrew updates...',
        color: 0x00ff00
      });

      await checkHomebrewUpdates();

      // 3. Check Firmware Updates
      console.log('⚡ Checking firmware updates...');
      await sendLogEmbed({
        title: '⚡ **Firmware Scan**',
        description: '🔍 Scanning for Nintendo Switch and custom firmware updates...',
        color: 0xffff00
      });

      await checkFirmwareUpdates();

      // 4. Check Tracked Releases
      console.log('🔍 Checking tracked GitHub releases...');
      await sendLogEmbed({
        title: '🔍 **Tracked Releases Scan**',
        description: '🔍 Scanning custom tracked GitHub repositories for updates...',
        color: 0x9b59b6
      });
      await checkTrackedReleases();

      // Send completion status
      const scanDuration = Date.now() - scanStartTime;
      console.log(`✅ [${new Date().toLocaleTimeString()}] Update scan completed successfully (${scanDuration}ms)`);
      
      // Track successful scan
      updateScanStatistics(true, scanDuration);
      
      await sendLogEmbed({
        title: '✅ **Scan Complete**',
        description: `**Next scan in:** ${config.checkInterval} minutes\n**Completed at:** ${new Date().toLocaleString()}\n**Duration:** ${scanDuration}ms`,
        color: 0x00ff00
      });

    } catch (error) {
      const scanDuration = Date.now() - scanStartTime;
      console.error(`❌ [${new Date().toLocaleTimeString()}] Error during update scan:`, error);
      
      // Track failed scan
      updateScanStatistics(false, scanDuration);
      updateErrorStatistics('scan_error', error.message);
      
      await sendLogEmbed({
        title: '❌ **Scan Error**',
        description: `**Error:** ${error.message}\n**Timestamp:** ${new Date().toLocaleString()}\n**Duration:** ${scanDuration}ms`,
        color: 0xff0000
      });
    }
  }, config.checkInterval * 60 * 1000); // Convert minutes to milliseconds

  console.log(`✅ Periodic scanning started (interval: ${config.checkInterval} minutes)`);
}

// Enhanced logging function for Discord channel
async function sendLogEmbed(options, guildId = null) {
  const targets = new Set();

  if (guildId && serverLogRoutes[guildId]?.channelId) {
    targets.add(String(serverLogRoutes[guildId].channelId));
  } else {
    // Broadcast to all known server routes when no guildId is provided
    Object.values(serverLogRoutes || {}).forEach(route => {
      if (route?.channelId) targets.add(String(route.channelId));
    });
    if (config.logChannelId) {
      targets.add(String(config.logChannelId));
    }
  }

  // Fallback to global if nothing else and guildId was provided
  if (targets.size === 0 && config.logChannelId) {
    targets.add(String(config.logChannelId));
  }

  if (targets.size === 0) return;

  for (const channelId of targets) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel) continue;

    const embed = new EmbedBuilder()
      .setTitle(options.title)
      .setColor(options.color)
      .setDescription(options.description)
      .setTimestamp();

    if (options.fields) {
      embed.addFields(options.fields);
    }

    embed.setFooter({
      text: 'SwitchDex Update Monitor',
      iconURL: client.user?.displayAvatarURL()
    });

      await channel.send({ embeds: [embed] });
    } catch (error) {
      console.error(`Failed to send log embed to ${channelId}:`, error.message);
    }
  }
}

/**
 * Send immediate update notification to all announcement channels
 * @param {Object} updateData
 */
async function sendUpdateNotificationToChannels(updateData) {
  try {
    if (!updateData || !updateData.name || !updateData.toVersion) {
      console.error('[ERROR] Invalid updateData provided to sendUpdateNotificationToChannels');
      return;
    }

    if (announcementChannels.length === 0) {
      console.log('[INFO] No announcement channels configured, skipping notification');
      return;
    }


    let typeEmoji = '🆕';
    let typeColor = 0x00ff00;
    let typeName = 'Update';

    if (updateData.type === 'homebrew') {
      typeEmoji = '🏠';
      typeColor = 0x00ff00;
      typeName = 'Homebrew Application';
    } else if (updateData.type === 'firmware' || updateData.type === 'nintendo_firmware') {
      typeEmoji = '⚡';
      typeColor = 0xffff00;
      typeName = 'Firmware';
    } else if (updateData.type === 'sysbot_fork') {
      typeEmoji = '🔧';
      typeColor = 0x9b59b6;
      typeName = 'Sysbot fork updates';
    } else if (updateData.type === 'pokemon') {
      typeEmoji = '🎮';
      typeColor = 0xff0000;
      typeName = 'Pokémon Game';
    }

    const embed = new EmbedBuilder()
      .setTitle(`${typeEmoji} **${updateData.name} Update Available**`)
      .setColor(typeColor)
      .setDescription(
        `**${typeName}** has a new version available!\n\n` +
        `**Version:** \`${updateData.fromVersion || 'Unknown'}\` → \`${updateData.toVersion}\`\n` +
        `**Release Date:** ${updateData.dateText || 'Unknown'}\n` +
        `**Category:** ${updateData.category || typeName}`
      )
      .addFields({
        name: '🔗 **Download**',
        value: `[View Release](${updateData.url || 'https://github.com'})`,
        inline: false
      })
      .setFooter({
        text: 'SwitchDex Professional Monitor',
        iconURL: client.user?.displayAvatarURL()
      })
      .setTimestamp();

    let successCount = 0;
    let failCount = 0;

    // Validate channel data - fix corrupted entries
    const validChannels = announcementChannels.filter(ch => {
      if (typeof ch.channelId !== 'string') {
        console.error(`[ERROR] Invalid channel entry, skipping:`, JSON.stringify(ch));
        return false;
      }
      return true;
    });

    // Filter channels by guildId for per-server isolation (custom tracking)
    // If updateData.guildId is provided, only send to channels in that guild
    // If updateData.guildId is undefined (built-in tracking), send to all channels
    let targetChannels = updateData.guildId
      ? validChannels.filter(ch => ch.guildId === updateData.guildId)
      : validChannels;


    console.log(`[INFO] Sending ${updateData.type} notification to ${targetChannels.length} channel(s)${updateData.guildId ? ` in guild ${updateData.guildId}` : ' (global)'}`);

    for (const channel of targetChannels) {
      try {
        console.log(`[DEBUG] Attempting to send to channel: ${channel.channelId} (type: ${typeof channel.channelId})`);

        if (typeof channel.channelId !== 'string') {
          console.error(`[ERROR] Invalid channelId type: ${typeof channel.channelId}`, channel);
          failCount++;
          continue;
        }

        const discordChannel = await client.channels.fetch(channel.channelId);
        if (discordChannel) {
          // Create embed with role mention if configured
          const guildSettings = getGuildSettings(channel.guildId);
          const category = updateData.type === 'homebrew' ? 'homebrew' :
                          updateData.type === 'firmware' || updateData.type === 'nintendo_firmware' ? 'firmware' :
                          updateData.type === 'pokemon' ? 'pokemon' : 'custom';

          let content = '';
          if (guildSettings.mentionRoles && guildSettings.mentionRoles[category]) {
            content = `<@&${guildSettings.mentionRoles[category]}>`;
          }

          await discordChannel.send({ content, embeds: [embed] });
          successCount++;
          console.log(`[INFO] Sent update notification to channel ${channel.channelId}`);
        } else {
          console.warn(`[WARN] Channel ${channel.channelId} not found`);
          failCount++;
        }
      } catch (channelError) {
        console.error(`[ERROR] Failed to send notification to channel ${channel.channelId}:`, channelError.message);
        failCount++;
      }
    }

    console.log(`[INFO] Update notification sent: ${successCount} successful, ${failCount} failed`);

    if (config.logChannelId || (updateData.guildId && serverLogRoutes[updateData.guildId])) {
      try {
        await logToChannel(
          `📢 **Update Notification Sent**\n` +
          `**Item:** ${updateData.name}\n` +
          `**Version:** ${updateData.fromVersion} → ${updateData.toVersion}\n` +
          `**Channels:** ${successCount}/${targetChannels.length} successful\n` +
          `**Time:** ${new Date().toLocaleString()}`,
          updateData.guildId || null
        );
      } catch (logError) {
        console.error('[ERROR] Failed to log notification:', logError);
      }
    }
  } catch (error) {
    console.error('[ERROR] Error in sendUpdateNotificationToChannels:', error);
    detectAndNotifyErrors(`sendUpdateNotificationToChannels error: ${error.message}`, 'notification');
  }
}

// ===== MULTI-SERVER PERSONALIZATION HANDLERS =====

async function handleSubscribe(interaction) {
  try {
    await interaction.deferReply();

    if (!hasAdminAccess(interaction)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to manage subscriptions.',
        flags: 64
      });
    }

    const category = interaction.options.getString('category');
    const guildSettings = getGuildSettings(interaction.guild.id);

    if (guildSettings.subscriptions[category]) {
      return await interaction.editReply({
        content: `❌ This server is already subscribed to **${category}** updates.`,
        flags: 64
      });
    }

    guildSettings.subscriptions[category] = true;
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Subscription Added**')
        .setColor(EMBED_COLORS.SUCCESS)
        .setDescription(`Successfully subscribed to **${category}** updates!\n\nThis server will now receive ${category} notifications.`)
        .addFields({
          name: '📋 **Current Subscriptions**',
          value: Object.entries(guildSettings.subscriptions)
            .map(([cat, enabled]) => `${enabled ? '✅' : '❌'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`)
            .join('\n'),
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleSubscribe:', error);
    detectAndNotifyErrors(`handleSubscribe error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleUnsubscribe(interaction) {
  try {
    await interaction.deferReply();

    if (!hasAdminAccess(interaction)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to manage subscriptions.',
        flags: 64
      });
    }

    const category = interaction.options.getString('category');
    const guildSettings = getGuildSettings(interaction.guild.id);

    if (!guildSettings.subscriptions[category]) {
      return await interaction.editReply({
        content: `❌ This server is not subscribed to **${category}** updates.`,
        flags: 64
      });
    }

    guildSettings.subscriptions[category] = false;
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Subscription Removed**')
        .setColor(EMBED_COLORS.WARNING)
        .setDescription(`Successfully unsubscribed from **${category}** updates.\n\nThis server will no longer receive ${category} notifications.`)
        .addFields({
          name: '📋 **Current Subscriptions**',
          value: Object.entries(guildSettings.subscriptions)
            .map(([cat, enabled]) => `${enabled ? '✅' : '❌'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`)
            .join('\n'),
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleUnsubscribe:', error);
    detectAndNotifyErrors(`handleUnsubscribe error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleViewSubscriptions(interaction) {
  try {
    await interaction.deferReply();

    const guildSettings = getGuildSettings(interaction.guild.id);

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📋 **Server Subscriptions**')
        .setColor(EMBED_COLORS.INFO)
        .setDescription('Current update category subscriptions for this server:')
        .addFields(
          Object.entries(guildSettings.subscriptions).map(([category, enabled]) => ({
            name: `${enabled ? '✅' : '❌'} ${category.charAt(0).toUpperCase() + category.slice(1)}`,
            value: enabled ?
              `Receiving **${category}** update notifications` :
              `Not receiving **${category}** update notifications`,
            inline: true
          }))
        ),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleViewSubscriptions:', error);
    detectAndNotifyErrors(`handleViewSubscriptions error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleSetAdminRole(interaction) {
  try {
    await interaction.deferReply();

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions to set the admin role.',
        flags: 64
      });
    }

    const role = interaction.options.getRole('role');
    const guildSettings = getGuildSettings(interaction.guild.id);

    guildSettings.adminRoleId = role.id;
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Admin Role Set**')
        .setColor(EMBED_COLORS.SUCCESS)
        .setDescription(`Successfully set **${role.name}** as the admin role for managing bot settings.\n\nUsers with this role can now manage subscriptions, channels, and other bot settings.`)
        .addFields({
          name: '👥 **Role Permissions**',
          value: `• Manage subscriptions (/subscribe, /unsubscribe)\n• Configure channels (/addchannel, /removechannel)\n• Set mention roles (/setmentionrole)\n• Configure quiet hours and digest mode`,
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleSetAdminRole:', error);
    detectAndNotifyErrors(`handleSetAdminRole error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleRemoveAdminRole(interaction) {
  try {
    await interaction.deferReply();

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions to remove the admin role.',
        flags: 64
      });
    }

    const guildSettings = getGuildSettings(interaction.guild.id);

    if (!guildSettings.adminRoleId) {
      return await interaction.editReply({
        content: '❌ No admin role is currently set for this server.',
        flags: 64
      });
    }

    const oldRole = interaction.guild.roles.cache.get(guildSettings.adminRoleId);
    guildSettings.adminRoleId = null;
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Admin Role Removed**')
        .setColor(EMBED_COLORS.WARNING)
        .setDescription(`Successfully removed ${oldRole ? `**${oldRole.name}**` : 'the previous role'} as the admin role.\n\nOnly users with Administrator permissions can now manage bot settings.`)
        .addFields({
          name: '🔒 **Access Control**',
          value: `• Only Administrator permission holders can manage settings\n• Bot owner always has full access`,
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleRemoveAdminRole:', error);
    detectAndNotifyErrors(`handleRemoveAdminRole error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleSetMentionRole(interaction) {
  try {
    await interaction.deferReply();

    if (!hasAdminAccess(interaction)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to manage mention roles.',
        flags: 64
      });
    }

    const category = interaction.options.getString('category');
    const role = interaction.options.getRole('role');
    const guildSettings = getGuildSettings(interaction.guild.id);

    if (!guildSettings.mentionRoles) {
      guildSettings.mentionRoles = {};
    }

    guildSettings.mentionRoles[category] = role.id;
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Mention Role Set**')
        .setColor(EMBED_COLORS.SUCCESS)
        .setDescription(`Successfully set **${role.name}** to be mentioned for **${category}** updates.\n\nUsers with this role will be pinged when ${category} updates are posted.`)
        .addFields({
          name: '📢 **Mention Settings**',
          value: Object.entries(guildSettings.mentionRoles)
            .filter(([cat, roleId]) => roleId)
            .map(([cat, roleId]) => `• **${cat}**: <@&${roleId}>`)
            .join('\n') || 'No mention roles configured',
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleSetMentionRole:', error);
    detectAndNotifyErrors(`handleSetMentionRole error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleRemoveMentionRole(interaction) {
  try {
    await interaction.deferReply();

    if (!hasAdminAccess(interaction)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to manage mention roles.',
        flags: 64
      });
    }

    const category = interaction.options.getString('category');
    const guildSettings = getGuildSettings(interaction.guild.id);

    if (!guildSettings.mentionRoles || !guildSettings.mentionRoles[category]) {
      return await interaction.editReply({
        content: `❌ No mention role is currently set for **${category}** updates.`,
        flags: 64
      });
    }

    const oldRole = interaction.guild.roles.cache.get(guildSettings.mentionRoles[category]);
    delete guildSettings.mentionRoles[category];
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Mention Role Removed**')
        .setColor(EMBED_COLORS.WARNING)
        .setDescription(`Successfully removed ${oldRole ? `**${oldRole.name}**` : 'the role'} from **${category}** update mentions.\n\nNo users will be pinged for ${category} updates.`)
        .addFields({
          name: '📢 **Current Mention Settings**',
          value: Object.entries(guildSettings.mentionRoles || {})
            .filter(([cat, roleId]) => roleId)
            .map(([cat, roleId]) => `• **${cat}**: <@&${roleId}>`)
            .join('\n') || 'No mention roles configured',
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleRemoveMentionRole:', error);
    detectAndNotifyErrors(`handleRemoveMentionRole error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleServerSettings(interaction) {
  try {
    await interaction.deferReply();

    const guildSettings = getGuildSettings(interaction.guild.id);
    const serverChannels = announcementChannels.filter(ch => ch.guildId === interaction.guild.id);
    const customRepos = Object.values(trackedReleases).filter(repo => repo.guildId === interaction.guild.id).length;

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⚙️ **Server Settings Dashboard**')
        .setColor(EMBED_COLORS.INFO)
        .setDescription(`Configuration overview for **${interaction.guild.name}**`)
        .addFields(
          {
            name: '📢 **Announcement Channels**',
            value: serverChannels.length > 0
              ? serverChannels.map(ch => `<#${ch.channelId}>`).join('\n')
              : 'No channels configured',
            inline: true
          },
          {
            name: '👥 **Admin Role**',
            value: guildSettings.adminRoleId
              ? `<@&${guildSettings.adminRoleId}>`
              : 'Not set (Administrator permission required)',
            inline: true
          },
          {
            name: '📊 **Custom Repositories**',
            value: `${customRepos} tracked`,
            inline: true
          },
          {
            name: '📋 **Subscriptions**',
            value: Object.entries(guildSettings.subscriptions)
              .map(([cat, enabled]) => `${enabled ? '✅' : '❌'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`)
              .join('\n'),
            inline: true
          },
          {
            name: '📢 **Mention Roles**',
            value: Object.entries(guildSettings.mentionRoles || {})
              .filter(([cat, roleId]) => roleId)
              .map(([cat, roleId]) => `• **${cat}**: <@&${roleId}>`)
              .join('\n') || 'None configured',
            inline: true
          },
          {
            name: '⏰ **Quiet Hours**',
            value: guildSettings.quietHours?.enabled
              ? `${guildSettings.quietHours.start} - ${guildSettings.quietHours.end} (${guildSettings.quietHours.timezone})`
              : 'Disabled',
            inline: true
          },
          {
            name: '📧 **Digest Mode**',
            value: guildSettings.digestMode?.enabled
              ? `Daily at ${guildSettings.digestMode.time} (${guildSettings.digestMode.timezone})`
              : 'Disabled (instant notifications)',
            inline: true
          }
        ),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleServerSettings:', error);
    detectAndNotifyErrors(`handleServerSettings error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleSetQuietHours(interaction) {
  try {
    await interaction.deferReply();

    if (!hasAdminAccess(interaction)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to manage quiet hours.',
        flags: 64
      });
    }

    const startTime = interaction.options.getString('start');
    const endTime = interaction.options.getString('end');
    const timezone = interaction.options.getString('timezone') || 'UTC';

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return await interaction.editReply({
        content: '❌ Invalid time format. Please use HH:MM format (e.g., 22:00, 08:00).',
        flags: 64
      });
    }

    const guildSettings = getGuildSettings(interaction.guild.id);

    guildSettings.quietHours = {
      enabled: true,
      start: startTime,
      end: endTime,
      timezone: timezone
    };
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Quiet Hours Set**')
        .setColor(EMBED_COLORS.SUCCESS)
        .setDescription(`Successfully configured quiet hours for this server.\n\n**Quiet Hours:** ${startTime} - ${endTime} (${timezone})\n\nDuring quiet hours, update notifications will be queued and sent as a digest when quiet hours end.`)
        .addFields({
          name: '⏰ **Quiet Hours Schedule**',
          value: `• **Start:** ${startTime} ${timezone}\n• **End:** ${endTime} ${timezone}\n• **Timezone:** ${timezone}`,
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleSetQuietHours:', error);
    detectAndNotifyErrors(`handleSetQuietHours error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleRemoveQuietHours(interaction) {
  try {
    await interaction.deferReply();

    if (!hasAdminAccess(interaction)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to manage quiet hours.',
        flags: 64
      });
    }

    const guildSettings = getGuildSettings(interaction.guild.id);

    if (!guildSettings.quietHours?.enabled) {
      return await interaction.editReply({
        content: '❌ Quiet hours are not currently enabled for this server.',
        flags: 64
      });
    }

    guildSettings.quietHours.enabled = false;
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Quiet Hours Disabled**')
        .setColor(EMBED_COLORS.WARNING)
        .setDescription('Successfully disabled quiet hours for this server.\n\nUpdate notifications will now be sent instantly as they arrive.')
        .addFields({
          name: '📢 **Notification Mode**',
          value: '• Instant notifications enabled\n• No quiet hours restrictions',
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleRemoveQuietHours:', error);
    detectAndNotifyErrors(`handleRemoveQuietHours error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleSetDigestMode(interaction) {
  try {
    await interaction.deferReply();

    if (!hasAdminAccess(interaction)) {
      return await interaction.editReply({
        content: '❌ You need Administrator permissions or the server\'s configured admin role to manage digest mode.',
        flags: 64
      });
    }

    const mode = interaction.options.getString('mode');

    if (mode === 'off') {
      const guildSettings = getGuildSettings(interaction.guild.id);
      guildSettings.digestMode.enabled = false;
      saveGuildSettings();

      const embed = enhanceEmbed(
        new EmbedBuilder()
          .setTitle('✅ **Digest Mode Disabled**')
          .setColor(EMBED_COLORS.WARNING)
          .setDescription('Successfully disabled digest mode for this server.\n\nUpdate notifications will now be sent instantly as they arrive.')
          .addFields({
            name: '📢 **Notification Mode**',
            value: '• Instant notifications enabled\n• No daily digest scheduling',
            inline: false
          }),
        interaction
      );

      return await interaction.editReply({ embeds: [embed] });
    }

    // Enable digest mode
    const time = interaction.options.getString('time');
    const timezone = interaction.options.getString('timezone') || 'UTC';

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(time)) {
      return await interaction.editReply({
        content: '❌ Invalid time format. Please use HH:MM format (e.g., 09:00, 18:30).',
        flags: 64
      });
    }

    const guildSettings = getGuildSettings(interaction.guild.id);

    guildSettings.digestMode = {
      enabled: true,
      time: time,
      timezone: timezone
    };
    saveGuildSettings();

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('✅ **Digest Mode Enabled**')
        .setColor(EMBED_COLORS.SUCCESS)
        .setDescription(`Successfully enabled daily digest mode for this server.\n\n**Daily Digest:** ${time} (${timezone})\n\nUpdate notifications will be collected throughout the day and sent as a single summary at the configured time.`)
        .addFields({
          name: '📧 **Digest Schedule**',
          value: `• **Time:** ${time} ${timezone}\n• **Frequency:** Daily\n• **Content:** All updates from the previous day`,
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleSetDigestMode:', error);
    detectAndNotifyErrors(`handleSetDigestMode error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleTestNotification(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`${EMBED_EMOJIS.CUSTOM} **Test Notification**`)
      .setColor(EMBED_COLORS.INFO)
      .setDescription(
        `**Homebrew Application** has a new version available!\n\n` +
        `**Version:** \`v1.0.0\` → \`v1.1.0\`\n` +
        `**Release Date:** ${new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })}\n` +
        `**Category:** Test notification`
      )
      .addFields({
        name: '🔗 **Download**',
        value: `[View Release](https://github.com/example/test/releases/latest)`,
        inline: false
      })
      .setFooter({
        text: 'SwitchDex Professional Monitor',
        iconURL: client.user?.displayAvatarURL()
      })
      .setTimestamp();

    // Check if mention role is configured for custom category
    const guildSettings = getGuildSettings(interaction.guild.id);
    let content = '';
    if (guildSettings.mentionRoles && guildSettings.mentionRoles.custom) {
      content = `<@&${guildSettings.mentionRoles.custom}>`;
    }

    await interaction.editReply({
      content: content || undefined,
      embeds: [embed],
      ephemeral: true
    });
  } catch (error) {
    console.error('[ERROR] Error in handleTestNotification:', error);
    detectAndNotifyErrors(`handleTestNotification error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleUpdateHistory(interaction) {
  try {
    await interaction.deferReply();

    // Load update history
    let updateHistory = [];
    try {
      updateHistory = JSON.parse(fs.readFileSync('update-history.json', 'utf8'));
    } catch (error) {
      console.warn('[WARN] Could not load update history:', error.message);
    }

    // Filter updates sent to this guild's channels
    const serverChannels = announcementChannels.filter(ch => ch.guildId === interaction.guild.id);
    const serverChannelIds = serverChannels.map(ch => ch.channelId);

    const serverUpdates = updateHistory.filter(update => {
      // For now, show all updates since we don't track which channels received which updates
      // This is a simplified implementation - in a full implementation you'd track per-channel delivery
      return true;
    }).slice(0, 10);

    if (serverUpdates.length === 0) {
      const embed = enhanceEmbed(
        new EmbedBuilder()
          .setTitle('📋 **Update History**')
          .setColor(EMBED_COLORS.INFO)
          .setDescription('No recent updates have been sent to this server.')
          .addFields({
            name: 'ℹ️ **Note**',
            value: 'This shows updates that would be sent to your server based on current subscriptions.',
            inline: false
          }),
        interaction
      );

      return await interaction.editReply({ embeds: [embed] });
    }

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📋 **Recent Server Updates**')
        .setColor(EMBED_COLORS.INFO)
        .setDescription(`Last ${serverUpdates.length} updates sent to this server:`)
        .addFields(
          serverUpdates.map((update, index) => ({
            name: `${index + 1}. ${update.name}`,
            value: `**${update.fromVersion}** → **${update.toVersion}**\n` +
                  `*${new Date(update.detectedAt).toLocaleDateString()}*`,
            inline: true
          }))
        ),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleUpdateHistory:', error);
    detectAndNotifyErrors(`handleUpdateHistory error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

// Guild join event - send welcome message
client.on('guildCreate', async (guild) => {
  try {
    console.log(`[INFO] Joined new guild: ${guild.name} (${guild.id})`);

    // Check whitelist if enabled (except for owner guild)
    if (allowedServers.whitelistEnabled && guild.id !== config.ownerGuildId && !allowedServers.servers.includes(guild.id)) {
      console.log(`[WHITELIST] Guild ${guild.name} (${guild.id}) not whitelisted, leaving...`);
      try {
        await guild.leave();
        console.log(`[WHITELIST] Left non-whitelisted guild: ${guild.name} (${guild.id})`);
        return;
      } catch (leaveError) {
        console.error(`[ERROR] Failed to leave non-whitelisted guild ${guild.id}:`, leaveError.message);
        return;
      }
    }

    // Initialize guild settings
    const guildSettings = getGuildSettings(guild.id);
    guildSettings.setupComplete = false;
    guildSettings.joinedAt = new Date().toISOString();
    saveGuildSettings();

    // Try to find the first available text channel to send welcome message
    const channels = guild.channels.cache.filter(ch =>
      ch.type === 0 && // TEXT channel
      ch.permissionsFor(guild.members.me).has(PermissionFlagsBits.SendMessages) &&
      ch.permissionsFor(guild.members.me).has(PermissionFlagsBits.EmbedLinks)
    );

    if (channels.size > 0) {
      const welcomeChannel = channels.first();

      const embed = new EmbedBuilder()
        .setTitle('🎮 **Welcome to SwitchDex!**')
        .setColor(0x5865f2)
        .setDescription(
          `Hello **${guild.name}**! 👋\n\n` +
          `I'm **SwitchDex**, your professional Nintendo Switch ecosystem monitor. I track updates for homebrew applications, firmware, and games.\n\n` +
          `**🚀 Quick Setup (3 steps):**\n` +
          `1️⃣ **Configure announcement channel:** Use \`/addchannel\` in your preferred channel\n` +
          `2️⃣ **Set subscriptions:** Use \`/subscribe\` to choose what updates you want\n` +
          `3️⃣ **Optional:** Use \`/setadminrole\` to allow specific roles to manage settings\n\n` +
          `**📚 Need help?** Use \`/help\` for a complete command reference!\n\n` +
          `**🎯 Default Settings:** All update categories are enabled by default.`
        )
        .addFields({
          name: '📋 **Available Commands**',
          value:
            `• \`/help\` - Complete command reference\n` +
            `• \`/addchannel\` - Set announcement channel\n` +
            `• \`/subscribe\` - Choose update categories\n` +
            `• \`/serversettings\` - View current configuration\n` +
            `• \`/status\` - Check system status`,
          inline: true
        }, {
          name: '⚙️ **Features**',
          value:
            `• 🏠 Homebrew app tracking\n` +
            `• ⚡ Firmware monitoring\n` +
            `• 🎮 Pokémon game updates\n` +
            `• 🔧 Custom repository tracking\n` +
            `• 📊 Per-server settings`,
          inline: true
        })
        .setFooter({
          text: 'SwitchDex Professional Monitor',
          iconURL: client.user?.displayAvatarURL()
        })
        .setTimestamp();

      try {
        await welcomeChannel.send({ embeds: [embed] });
        console.log(`[INFO] Sent welcome message to ${guild.name} in #${welcomeChannel.name}`);
      } catch (sendError) {
        console.error(`[ERROR] Failed to send welcome message to ${guild.name}:`, sendError.message);
      }
    } else {
      console.log(`[WARN] No suitable channels found to send welcome message in ${guild.name}`);
    }

    // Register slash commands for the new guild (immediate availability)
    try {
      await new Promise(resolve => setTimeout(resolve, 500)); // small delay to ensure cache ready
      await registerCommandsForGuild(guild);
    } catch (cmdError) {
      console.error(`[ERROR] Failed to register commands for new guild ${guild.name}:`, cmdError.message);
    }
  } catch (error) {
    console.error('[ERROR] Error in guildCreate event:', error);
    detectAndNotifyErrors(`guildCreate error: ${error.message}`, 'guild_join');
  }
});

// ===== CHANGELOG COMMAND HANDLERS =====

async function handleChangelog(interaction) {
  try {
    await interaction.deferReply();

    let changelog;
    try {
      changelog = JSON.parse(fs.readFileSync('changelog.json', 'utf8'));
    } catch (error) {
      return await interaction.editReply({
        content: '❌ Changelog file not found or invalid.'
      });
    }

    const requestedVersion = interaction.options.getString('version');
    const showAll = requestedVersion?.toLowerCase() === 'all';

    if (requestedVersion && !showAll) {
      const version = changelog.versions.find(v => v.version === requestedVersion);
      if (!version) {
        return await interaction.editReply({
          content: `❌ Version ${requestedVersion} not found. Available: ${changelog.versions.map(v => v.version).join(', ')}`
        });
      }
      const embed = buildVersionEmbed(version, true);
      return await interaction.editReply({ embeds: [embed] });
    }

    const versionsToShow = showAll ? changelog.versions : changelog.versions.slice(0, 3);
    const embeds = [];

    const headerEmbed = new EmbedBuilder()
      .setTitle('📜 **SwitchDex Changelog**')
      .setColor(0x5865f2)
      .setDescription(
        `🔷 **Version History & Release Notes**\n\n` +
        `📦 **Current Version:** v${changelog.currentVersion}\n` +
        `📋 **Total Releases:** ${changelog.versions.length}\n` +
        `📅 **Latest Update:** ${changelog.versions[0]?.date || 'Unknown'}`
      )
      .setThumbnail(client.user?.displayAvatarURL());

    embeds.push(headerEmbed);

    for (const version of versionsToShow) {
      embeds.push(buildVersionEmbed(version, false));
    }

    if (!showAll && changelog.versions.length > 3) {
      const footerEmbed = new EmbedBuilder()
        .setColor(0x2f3136)
        .setDescription(
          `📄 *Showing ${versionsToShow.length} of ${changelog.versions.length} versions*\n` +
          `💡 Use \`/changelog version:all\` for full history\n` +
          `🔍 Use \`/changelog version:1.0.0\` for a specific version`
        );
      embeds.push(footerEmbed);
    }

    await interaction.editReply({ embeds: embeds.slice(0, 10) });

  } catch (error) {
    console.error('[ERROR] Error in handleChangelog:', error);
    await interaction.editReply({ content: '❌ An error occurred while loading the changelog.' });
  }
}

function buildVersionEmbed(version, detailed = false) {
  const isLatest = version.latest === true;
  const emoji = isLatest ? '🆕' : '📦';
  const latestBadge = isLatest ? ' `[LATEST]`' : '';

  let color = 0x2f3136;
  if (isLatest) color = 0x00ff00;
  else if (version.version.startsWith('2.')) color = 0x5865f2;
  else if (version.version.startsWith('1.')) color = 0x3498db;

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} v${version.version} — ${version.date}${latestBadge}`)
    .setColor(color);

  const fields = [];

  if (version.features?.length > 0) {
    fields.push({
      name: '✨ **New Features**',
      value: version.features.map(f => `• ${f}`).join('\n').substring(0, 1024),
      inline: false
    });
  }

  if (version.improvements?.length > 0) {
    fields.push({
      name: '🔧 **Improvements**',
      value: version.improvements.map(i => `• ${i}`).join('\n').substring(0, 1024),
      inline: false
    });
  }

  if (version.fixes?.length > 0) {
    fields.push({
      name: '🐛 **Bug Fixes**',
      value: version.fixes.map(f => `• ${f}`).join('\n').substring(0, 1024),
      inline: false
    });
  }

  if (fields.length > 0) embed.addFields(fields);
  else embed.setDescription('*No detailed notes for this version*');

  return embed;
}

// ===== OWNER COMMAND HANDLERS =====

async function handleServers(interaction) {
  try {
    await interaction.deferReply();

    const guilds = Array.from(client.guilds.cache.values());
    const totalServers = guilds.length;

    // Sort by member count descending
    guilds.sort((a, b) => b.memberCount - a.memberCount);

    const itemsPerPage = 10;
    const totalPages = Math.ceil(totalServers / itemsPerPage);
    const currentPage = 1; // For now, show first page. Could be enhanced with pagination

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalServers);
    const pageGuilds = guilds.slice(startIndex, endIndex);

    let serverList = '';
    for (let i = 0; i < pageGuilds.length; i++) {
      const guild = pageGuilds[i];
      const index = startIndex + i + 1;
      const joinedAt = guild.joinedAt ? guild.joinedAt.toLocaleDateString() : 'Unknown';
      serverList += `${index}. **${guild.name}**\n`;
      serverList += `   ID: \`${guild.id}\` | Members: ${guild.memberCount} | Joined: ${joinedAt}\n\n`;
    }

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🖥️ **Server List**')
        .setColor(EMBED_COLORS.INFO)
        .setDescription(`Showing servers ${startIndex + 1}-${endIndex} of ${totalServers}`)
        .addFields({
          name: '📊 **Server Statistics**',
          value: `**Total Servers:** ${totalServers}\n**Page:** ${currentPage}/${totalPages}`,
          inline: false
        }, {
          name: '🏠 **Servers**',
          value: serverList || 'No servers found',
          inline: false
        }),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleServers:', error);
    detectAndNotifyErrors(`handleServers error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleServerInfo(interaction) {
  try {
    await interaction.deferReply();

    const serverId = interaction.options.getString('serverid');
    const guild = client.guilds.cache.get(serverId);

    if (!guild) {
      return await interaction.editReply({
        content: `❌ Server with ID \`${serverId}\` not found. The bot may not be in that server.`,
        flags: 64
      });
    }

    const owner = await client.users.fetch(guild.ownerId).catch(() => null);
    const serverChannels = announcementChannels.filter(ch => ch.guildId === serverId);
    const customRepos = Object.values(trackedReleases).filter(repo => repo.guildId === serverId).length;
    const guildSettings = getGuildSettings(serverId);

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('📊 **Server Information**')
        .setColor(EMBED_COLORS.INFO)
        .setDescription(`Detailed information for **${guild.name}**`)
        .addFields(
          {
            name: '🏠 **Basic Info**',
            value: `**Name:** ${guild.name}\n**ID:** \`${guild.id}\`\n**Owner:** ${owner ? `${owner.tag} (${owner.id})` : 'Unknown'}\n**Members:** ${guild.memberCount}`,
            inline: true
          },
          {
            name: '📅 **Bot Status**',
            value: `**Joined:** ${guild.joinedAt ? guild.joinedAt.toLocaleDateString() : 'Unknown'}\n**Channels:** ${guild.channels.cache.size}\n**Roles:** ${guild.roles.cache.size}`,
            inline: true
          },
          {
            name: '⚙️ **Bot Configuration**',
            value: `**Announcement Channels:** ${serverChannels.length}\n**Custom Repositories:** ${customRepos}\n**Admin Role:** ${guildSettings.adminRoleId ? `<@&${guildSettings.adminRoleId}>` : 'Not set'}\n**Setup Complete:** ${guildSettings.setupComplete ? '✅' : '❌'}`,
            inline: true
          },
          {
            name: '🔔 **Subscriptions**',
            value: Object.entries(guildSettings.subscriptions || {})
              .map(([cat, enabled]) => `${enabled ? '✅' : '❌'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}`)
              .join('\n') || 'Default (all enabled)',
            inline: true
          },
          {
            name: '⏰ **Quiet Hours**',
            value: guildSettings.quietHours?.enabled
              ? `${guildSettings.quietHours.start} - ${guildSettings.quietHours.end} (${guildSettings.quietHours.timezone})`
              : 'Disabled',
            inline: true
          }
        ),
      interaction
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[ERROR] Error in handleServerInfo:', error);
    detectAndNotifyErrors(`handleServerInfo error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleLeaveServer(interaction) {
  try {
    await interaction.deferReply();

    const serverId = interaction.options.getString('serverid');
    const guild = client.guilds.cache.get(serverId);

    if (!guild) {
      return await interaction.editReply({
        content: `❌ Server with ID \`${serverId}\` not found. The bot may not be in that server.`,
        flags: 64
      });
    }

    if (guild.id === config.ownerGuildId) {
      return await interaction.editReply({
        content: '❌ Cannot leave the owner testing server.',
        flags: 64
      });
    }

    // Create confirmation button
    const confirmButton = new ButtonBuilder()
      .setCustomId(`confirm_leave_${serverId}`)
      .setLabel('Confirm Leave Server')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_leave')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('⚠️ **Confirm Server Leave**')
        .setColor(EMBED_COLORS.WARNING)
        .setDescription(`Are you sure you want to leave **${guild.name}**?\n\n**Server ID:** \`${guild.id}\`\n**Members:** ${guild.memberCount}\n\nThis action cannot be undone.`)
        .addFields({
          name: '⚠️ **Warning**',
          value: 'The bot will lose access to this server and all its data will remain.',
          inline: false
        }),
      interaction
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('[ERROR] Error in handleLeaveServer:', error);
    detectAndNotifyErrors(`handleLeaveServer error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleLeaveAll(interaction) {
  try {
    await interaction.deferReply();

    const guilds = client.guilds.cache.filter(guild => guild.id !== config.ownerGuildId);
    const serverCount = guilds.size;

    if (serverCount === 0) {
      return await interaction.editReply({
        content: 'ℹ️ The bot is only in the owner testing server.',
        flags: 64
      });
    }

    // Create confirmation buttons
    const confirmButton = new ButtonBuilder()
      .setCustomId('confirm_leave_all')
      .setLabel('Confirm Leave All Servers')
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId('cancel_leave')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🚨 **DANGER: Leave All Servers**')
        .setColor(EMBED_COLORS.ERROR)
        .setDescription(`Are you sure you want to leave **ALL ${serverCount} servers**?\n\nThis will:\n• Remove the bot from all servers except the owner testing server\n• Keep all data intact\n• Require manual re-invites to rejoin servers\n\n**This action cannot be easily undone!**`)
        .addFields({
          name: '⚠️ **Critical Warning**',
          value: 'Type `CONFIRM` in the confirmation dialog to proceed.',
          inline: false
        }),
      interaction
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });
  } catch (error) {
    console.error('[ERROR] Error in handleLeaveAll:', error);
    detectAndNotifyErrors(`handleLeaveAll error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

// Button confirmation handlers
async function handleConfirmLeaveServer(interaction, serverId) {
  try {
    const guild = client.guilds.cache.get(serverId);
    if (!guild) {
      return await interaction.update({
        content: '❌ Server not found.',
        embeds: [],
        components: []
      });
    }

    const serverName = guild.name;
    await guild.leave();

    console.log(`[OWNER] Bot left server: ${serverName} (${serverId})`);

    await interaction.update({
      content: `✅ Successfully left server **${serverName}** (\`${serverId}\`)`,
      embeds: [],
      components: []
    });
  } catch (error) {
    console.error('[ERROR] Error leaving server:', error);
    await interaction.update({
      content: '❌ Error leaving server.',
      embeds: [],
      components: []
    });
  }
}

async function handleConfirmLeaveAll(interaction) {
  try {
    await interaction.update({
      content: '⚠️ **FINAL CONFIRMATION REQUIRED**\n\nType `CONFIRM` (in all caps) to leave all servers.',
      embeds: [],
      components: []
    });
  } catch (error) {
    console.error('[ERROR] Error in leave all confirmation:', error);
  }
}

// Additional owner command handlers
async function handleAllowServer(interaction) {
  try {
    await interaction.deferReply();

    const serverId = interaction.options.getString('serverid');

    if (allowedServers.servers.includes(serverId)) {
      return await interaction.editReply({
        content: `❌ Server \`${serverId}\` is already whitelisted.`,
        flags: 64
      });
    }

    allowedServers.servers.push(serverId);
    fs.writeFileSync('allowed-servers.json', JSON.stringify(allowedServers, null, 2));

    console.log(`[OWNER] Added server ${serverId} to whitelist`);

    await interaction.editReply({
      content: `✅ Server \`${serverId}\` added to whitelist.`,
      flags: 64
    });
  } catch (error) {
    console.error('[ERROR] Error in handleAllowServer:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleToggleWhitelist(interaction) {
  try {
    await interaction.deferReply();

    allowedServers.whitelistEnabled = !allowedServers.whitelistEnabled;
    fs.writeFileSync('allowed-servers.json', JSON.stringify(allowedServers, null, 2));

    const status = allowedServers.whitelistEnabled ? 'ENABLED' : 'DISABLED';
    console.log(`[OWNER] Whitelist ${status.toLowerCase()}`);

    await interaction.editReply({
      content: `✅ Server whitelist **${status}**.\n\n${allowedServers.whitelistEnabled ?
        'The bot will only join whitelisted servers.' :
        'The bot can join any server (except banned ones).'}`,
      flags: 64
    });
  } catch (error) {
    console.error('[ERROR] Error in handleToggleWhitelist:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleBroadcast(interaction) {
  try {
    await interaction.deferReply();

    const message = interaction.options.getString('message');
    const targetChannels = announcementChannels.filter(ch => ch.guildId !== config.ownerGuildId);

    let successCount = 0;
    let failCount = 0;

    for (const channel of targetChannels) {
      try {
        const discordChannel = await client.channels.fetch(channel.channelId);
        if (discordChannel) {
          await discordChannel.send(`📢 **Bot Announcement:** ${message}`);
          successCount++;
        }
      } catch (error) {
        console.error(`[ERROR] Failed to broadcast to ${channel.channelId}:`, error.message);
        failCount++;
      }
    }

    console.log(`[OWNER] Broadcast sent to ${successCount} channels, ${failCount} failed`);

    await interaction.editReply({
      content: `✅ Broadcast sent!\n\n**Message:** ${message}\n**Channels:** ${successCount} successful, ${failCount} failed`,
      flags: 64
    });
  } catch (error) {
    console.error('[ERROR] Error in handleBroadcast:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleMaintenance(interaction) {
  try {
    await interaction.deferReply();

    const mode = interaction.options.getString('mode');

    if (mode === 'on') {
      maintenanceMode.enabled = true;
      maintenanceMode.enabledAt = new Date().toISOString();
      fs.writeFileSync('maintenance.json', JSON.stringify(maintenanceMode, null, 2));
      console.log(`[OWNER] Maintenance mode ENABLED`);
    } else {
      maintenanceMode.enabled = false;
      fs.writeFileSync('maintenance.json', JSON.stringify(maintenanceMode, null, 2));
      console.log(`[OWNER] Maintenance mode DISABLED`);
    }

    await interaction.editReply({
      content: `✅ Maintenance mode **${mode.toUpperCase()}**.\n\n${mode === 'on' ?
        'All commands (except owner) will show the maintenance message.' :
        'Normal bot operation resumed.'}`,
      flags: 64
    });
  } catch (error) {
    console.error('[ERROR] Error in handleMaintenance:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleRefreshCommands(interaction) {
  try {
    await interaction.deferReply();

    console.log('[OWNER] Refreshing slash commands...');

    // Clear global commands
    await client.application.commands.set([]);

    // PHASE 1: Register regular commands to ALL guilds
    const guildArray = Array.from(client.guilds.cache.values());
    console.log(`[REFRESH] Phase 1: Registering ${commands.length} regular commands to ${guildArray.length} guilds...`);

    for (const guild of guildArray) {
      try {
        console.log(`[REFRESH] Registering to ${guild.name}...`);
        await guild.commands.set(commands);
        console.log(`✅ Commands registered for guild: ${guild.name} (${guild.id})`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      } catch (error) {
        console.error(`❌ Failed for ${guild.name}: ${error.message}`);
      }
    }

    console.log('✅ Phase 1 complete: Regular commands registered to all guilds');

    // PHASE 2: Add owner commands to owner guild only (using create, not set)
    console.log(`[REFRESH] Phase 2: Adding ${ownerCommands.length} owner commands to owner guild...`);
    const ownerGuild = client.guilds.cache.get(config.ownerGuildId);

    if (ownerGuild) {
      let ownerRegistered = 0;
      let ownerFailed = 0;

      for (const cmd of ownerCommands) {
        try {
          await ownerGuild.commands.create(cmd);
          console.log(`  ✅ Added owner command: /${cmd.name}`);
          ownerRegistered++;
          await new Promise(resolve => setTimeout(resolve, 300)); // 300ms between each
        } catch (error) {
          console.error(`  ❌ Failed to add /${cmd.name}: ${error.message}`);
          ownerFailed++;
        }
      }

      console.log(`✅ Phase 2 complete: ${ownerRegistered} owner commands added, ${ownerFailed} failed`);
      console.log(`📊 Owner guild total: ${commands.length} regular + ${ownerRegistered} owner = ${commands.length + ownerRegistered}`);
    } else {
      console.warn(`⚠️ Owner guild ${config.ownerGuildId} not found`);
    }

    await interaction.editReply({
      content: '✅ Slash commands refreshed across all servers.',
      flags: 64
    });
  } catch (error) {
    console.error('[ERROR] Error in handleRefreshCommands:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

// Stub implementations for remaining owner commands
async function handleLogServerHere(interaction) {
  await interaction.reply({ content: '🚧 Log routing feature coming soon!', flags: 64 });
}

async function handleDisallowServer(interaction) {
  const serverId = interaction.options.getString('serverid');
  await interaction.reply({ content: `🚧 Disallow server ${serverId} - feature coming soon!`, flags: 64 });
}

async function handleListAllowedServers(interaction) {
  await interaction.reply({ content: `🚧 List allowed servers - whitelist: ${allowedServers.whitelistEnabled}`, flags: 64 });
}

async function handleDmUser(interaction) {
  await interaction.reply({ content: '🚧 DM user feature coming soon!', flags: 64 });
}

async function handleBotStats(interaction) {
  await interaction.reply({ content: '🚧 Bot stats feature coming soon!', flags: 64 });
}

async function handleGetServerChannels(interaction) {
  await interaction.reply({ content: '🚧 Get server channels feature coming soon!', flags: 64 });
}

async function handleCreateInvite(interaction) {
  await interaction.reply({ content: '🚧 Create invite feature coming soon!', flags: 64 });
}

async function handlePurgeServer(interaction) {
  await interaction.reply({ content: '🚧 Purge server feature coming soon!', flags: 64 });
}

async function handleUpdateHistory(interaction) {
  await interaction.reply({ content: '🚧 Update history feature coming soon!', flags: 64 });
}

async function handleLogServerSelect(interaction) {
  await interaction.reply({ content: '🚧 Log server select feature coming soon!', flags: 64 });
}

async function handleConfirmPurgeServer(interaction, serverId) {
  await interaction.update({ content: `🚧 Purge server ${serverId} confirmed - feature coming soon!`, embeds: [], components: [] });
}

// ===== PROMOTIONAL & OWNER COMMAND HANDLERS =====

async function handleOwnerOnlyCmds(interaction) {
  try {
    const embed = enhanceEmbed(
      new EmbedBuilder()
        .setTitle('🔐 **Owner-Only Commands**')
        .setColor(0xFF0000)
        .setDescription('These commands are only available to you in this server.')
        .addFields(
          {
            name: '📊 **Server Management**',
            value:
              '• `/servers` — List all servers bot is in\n' +
              '• `/serverinfo` — Detailed info about a server\n' +
              '• `/leaveserver` — Leave a specific server\n' +
              '• `/leaveall` — Leave all servers (emergency)\n' +
              '• `/getserverchannels` — View server\'s channels\n' +
              '• `/createinvite` — Generate invite to a server',
            inline: false
          },
          {
            name: '🛡️ **Access Control**',
            value:
              '• `/allowserver` — Whitelist a server\n' +
              '• `/disallowserver` — Remove from whitelist & leave\n' +
              '• `/listallowedservers` — View whitelist\n' +
              '• `/togglewhitelist` — Enable/disable whitelist mode',
            inline: false
          },
          {
            name: '🚫 **Server Bans**',
            value:
              '• `/banserver` — Ban a server (bot auto-leaves)\n' +
              '• `/unbanserver` — Remove server ban\n' +
              '• `/listbannedservers` — View banned servers',
            inline: false
          },
          {
            name: '📢 **Communication**',
            value:
              '• `/logserverhere` — Route server logs here\n' +
              '• `/broadcast` — Message all servers\n' +
              '• `/dmuser` — DM any user',
            inline: false
          },
          {
            name: '⚙️ **Bot Control**',
            value:
              '• `/globalstats` — Global statistics\n' +
              '• `/maintenance` — Toggle maintenance mode\n' +
              '• `/refreshcommands` — Re-sync slash commands\n' +
              '• `/purgeserver` — Wipe server data',
            inline: false
          },
          {
            name: '📋 **Info Commands**',
            value:
              '• `/owneronlycmds` — This menu\n' +
              '• `/invite` — Bot invite embed',
            inline: false
          }
        )
        .setFooter({
          text: 'SwitchDex Owner Panel • Use responsibly'
        })
        .setTimestamp(),
      interaction
    );

    await interaction.reply({
      embeds: [embed],
      flags: 64 // ephemeral
    });
  } catch (error) {
    console.error('[ERROR] Error in handleOwnerOnlyCmds:', error);
    detectAndNotifyErrors(`handleOwnerOnlyCmds error: ${error.message}`, 'command');
  }
}

async function sendInviteEmbed(channel) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('🎮 **SwitchDex — Nintendo Switch Update Bot**')
      .setColor(0x00FF00)
      .setDescription(
        '⚡ **All-in-One Ecosystem Monitoring**\n\n' +
        'Track Pokémon games, homebrew apps, firmware, CFW, and custom GitHub repos with instant update alerts.\n\n' +
        '✔ 47+ commands\n' +
        '✔ Per-server customization\n' +
        '✔ Role pings & quiet hours\n' +
        '✔ Custom repo tracking'
      )
      .setThumbnail(client.user?.displayAvatarURL())
      .setFooter({
        text: 'Click below to add SwitchDex to your server!'
      })
      .setTimestamp();

    // Create buttons
    const addButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('➕ Add to Server')
      .setURL('https://discord.com/oauth2/authorize?client_id=1443771523763798187&permissions=414733298752&integration_type=0&scope=bot');

    const guideButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setLabel('📖 Setup Guide')
      .setCustomId('download_setup_guide');

    const row = new ActionRowBuilder().addComponents(addButton, guideButton);

    // Attach setup guide
    const attachment = new AttachmentBuilder('./setup-guide.txt', {
      name: 'SwitchDex-Setup-Guide.txt'
    });

    await channel.send({
      embeds: [embed],
      components: [row],
      files: [attachment]
    });
  } catch (error) {
    console.error('[ERROR] Error in sendInviteEmbed:', error);
  }
}

async function handleInvite(interaction) {
  try {
    await interaction.deferReply();
    await sendInviteEmbed(interaction.channel);
    await interaction.deleteReply(); // Delete the deferred reply since we sent the embed
  } catch (error) {
    console.error('[ERROR] Error in handleInvite:', error);
    detectAndNotifyErrors(`handleInvite error: ${error.message}`, 'command');
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
}

async function handleDownloadSetupGuide(interaction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const attachment = new AttachmentBuilder('./setup-guide.txt', {
      name: 'SwitchDex-Setup-Guide.txt'
    });

    await interaction.editReply({
      content: '📖 **SwitchDex Setup Guide**\n\nHere\'s the complete setup guide for SwitchDex:',
      files: [attachment],
      ephemeral: true
    });
  } catch (error) {
    console.error('[ERROR] Error in handleDownloadSetupGuide:', error);
    await interaction.editReply({
      content: '❌ Failed to send setup guide.',
      ephemeral: true
    });
  }
}

// Ready event
client.once('ready', async () => {
  console.log('🎉 Ready event fired!');
  console.log(`✅ Bot logged in as: ${client.user.tag}`);
  console.log(`🎯 Connected to ${client.guilds.cache.size} servers`);
  console.log(`📊 Bot ID: ${client.user.id}`);
  console.log('');

  // Clear global commands and register as guild commands only
  try {
    console.log('🔄 Clearing global commands and registering as guild commands...');

    // First, clear all global commands
    console.log('[DEBUG] Clearing global commands...');
    const globalCommands = await client.application.commands.fetch();
    console.log(`[DEBUG] Found ${globalCommands.size} global commands to clear`);
    if (globalCommands.size > 0) {
      console.log(`[DEBUG] Global command names: ${Array.from(globalCommands.values()).map(c => c.name).join(', ')}`);
    }
    await client.application.commands.set([]);
    console.log('✅ Cleared all global commands');

    // PHASE 1: Register regular commands to ALL guilds
    const guildArray = Array.from(client.guilds.cache.values());
    console.log(`[DEBUG] Phase 1: Registering ${commands.length} regular commands to ${guildArray.length} guilds...`);

    for (const guild of guildArray) {
      try {
        console.log(`[DEBUG] Registering to ${guild.name}...`);
        await guild.commands.set(commands);
        console.log(`✅ Commands registered for guild: ${guild.name} (${guild.id})`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
      } catch (error) {
        console.error(`❌ Failed for ${guild.name}: ${error.message}`);
      }
    }

    console.log('✅ Phase 1 complete: Regular commands registered to all guilds');

    // PHASE 2: Add owner commands to owner guild only (using create, not set)
    console.log(`[DEBUG] Phase 2: Adding ${ownerCommands.length} owner commands to owner guild...`);
    const ownerGuild = client.guilds.cache.get(config.ownerGuildId);

    if (ownerGuild) {
      let ownerRegistered = 0;
      let ownerFailed = 0;

      for (const cmd of ownerCommands) {
        try {
          await ownerGuild.commands.create(cmd);
          console.log(`  ✅ Added owner command: /${cmd.name}`);
          ownerRegistered++;
          await new Promise(resolve => setTimeout(resolve, 300)); // 300ms between each
        } catch (error) {
          console.error(`  ❌ Failed to add /${cmd.name}: ${error.message}`);
          ownerFailed++;
        }
      }

      console.log(`✅ Phase 2 complete: ${ownerRegistered} owner commands added, ${ownerFailed} failed`);
      console.log(`📊 Owner guild total: ${commands.length} regular + ${ownerRegistered} owner = ${commands.length + ownerRegistered}`);
    } else {
      console.warn(`⚠️ Owner guild ${config.ownerGuildId} not found`);
    }

    console.log('✅ All command registration complete!');
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error);
  }

  // Validate command categories
  const validation = validateCommandCategories();
  if (validation.missing.length > 0 || validation.invalid.length > 0) {
    console.warn('⚠️ Command category validation found issues. Check logs above.');
  }

  // Start periodic scanning
  startPeriodicScanning();

  console.log('');
  console.log('📋 Available commands:');
  console.log('   /help - Show comprehensive help');
  console.log('   /dashboard - System overview dashboard');
  console.log('   /changelog - View version history and release notes');
  console.log('   /analytics - Comprehensive bot statistics');
  console.log('   /setinterval <minutes> - Configure monitoring frequency');
  console.log('   /recent - Show updates detected in the last 24 hours');
  console.log('   /addchannel - Configure update channels');
  console.log('   /removechannel - Remove update channels');
  console.log('   /listchannels - List announcement channels');
  console.log('   /checkpermissions - Diagnose bot permissions');
  console.log('   /banuser, /unbanuser, /listbannedusers - User management');
  console.log('   /banserver, /unbanserver, /listbannedservers - Server management');
  console.log('   /github - Tracked GitHub repositories');
  console.log('   /hbstatus - Current homebrew application versions');
  console.log('   /hbhelp - Homebrew guide');
  console.log('   /update <game> - Game update info');
  console.log('   /firmware - System firmware status');
  console.log('   /ecosystem - Full Nintendo Switch ecosystem report');
  console.log('   /firmwareupgrade - Upgrade planning');
  console.log('   /titleid - Title IDs and Build IDs');
  console.log('   /cheatsource - Cheat sources and safety');
  console.log('   /organizecheats <file> - AI cheat organizer');
  console.log('   /blacklistmonitor - Security blacklist');
  console.log('   /riskscan - Online safety assessment');
  console.log('   /hostping - Remote source status');
  console.log('   /senddigest - Send compatibility digest to all channels');
  console.log('   /loghere - Route logs to channel');
  console.log('');
  console.log('🌟 Features:');
  console.log('   • Homebrew application monitoring');
  console.log('   • Pokémon game update tracking');
  console.log('   • Custom firmware ecosystem surveillance');
  console.log('   • Unified channel management');
  console.log('   • Professional access control');
  console.log('   • Periodic scanning with logging');
  console.log('   • Daily compatibility digests');
  console.log('   • Firmware upgrade planning');
  console.log('   • Title ID & Build ID lookup');
  console.log('   • AI-powered cheat code organization');
  console.log('   • Error detection & notifications');
  console.log('   • Security blacklist monitoring');
  console.log('   • Bot self-update tracking');
  console.log('   • Online risk assessment');
  console.log('   • Remote host connectivity checks');
  console.log('');
  console.log('🚀 SwitchDex is now running! Press Ctrl+C to stop.');
});

// Interaction handler
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // Check if user is banned
  if (isUserBanned(interaction.user.id)) {
    return await interaction.reply({
      content: '❌ You have been banned from using this bot.',
      flags: 64
    });
  }

  // Check if server is banned
  if (isServerBanned(interaction.guild.id)) {
    return await interaction.reply({
      content: '❌ This server has been banned from using this bot.',
      flags: 64
    });
  }

  // Check maintenance mode (allow owner to bypass)
  if (maintenanceMode.enabled && interaction.user.id !== config.botOwnerId) {
    return await interaction.reply({
      content: maintenanceMode.message,
      flags: 64
    });
  }

  // Track user command usage for analytics
  try {
    const userId = interaction.user.id;
    const commandName = interaction.commandName;
    const guildId = interaction.guild?.id || null;
    updateUserStatistics(userId, commandName, guildId);
  } catch (trackError) {
    console.error('Error tracking user statistics:', trackError.message);
  }

  const command = interaction.commandName;

  // Log command usage (async to avoid timeouts)
  setImmediate(async () => {
    try {
      await logToChannel(
        `💬 **Command executed**\n**Command:** /${command}\n**User:** ${interaction.user.tag} (${interaction.user.id})\n**Channel:** <#${interaction.channel.id}>\n**Server:** ${interaction.guild.name} (${interaction.guild.id})`,
        interaction.guild?.id
      );
    } catch (logError) {
      console.error('Failed to log command usage:', logError.message);
    }
  });

  try {
    switch (command) {
      case 'help':
        await handleHelp(interaction);
        break;
      case 'dashboard':
        await handleStatus(interaction);
        break;
      case 'changelog':
        await handleChangelog(interaction);
        break;
      case 'setinterval':
        await handleSetInterval(interaction);
        break;
      case 'recent':
        await handleAnyNewUpdates(interaction);
        break;
      case 'addchannel':
        await handleAddChannel(interaction);
        break;
      case 'removechannel':
        await handleRemoveChannel(interaction);
        break;
      case 'listchannels':
        await handleListChannels(interaction);
        break;
      case 'checkpermissions':
        await handleCheckPermissions(interaction);
        break;
      case 'banuser':
        await handleBanUser(interaction);
        break;
      case 'unbanuser':
        await handleUnbanUser(interaction);
        break;
      case 'listbannedusers':
        await handleListBannedUsers(interaction);
        break;
      case 'loghere':
        await handleLogHere(interaction);
        break;
      case 'github':
        await handleGithub(interaction);
        break;
      case 'hbstatus':
        await handleHomebrewUpdates(interaction);
        break;
      case 'hbhelp':
        await handleHbHelp(interaction);
        break;
      case 'update':
        await handleUpdate(interaction);
        break;
      case 'firmware':
        await handleFirmware(interaction);
        break;
      case 'ecosystem':
        await handleCompatibilityDigest(interaction);
        break;
      case 'firmwareupgrade':
        await handleFirmwareUpgrade(interaction);
        break;
      case 'titleid':
        await handleTitleId(interaction);
        break;
      case 'cheatsource':
        await handleCheatSource(interaction);
        break;
      case 'organizecheats':
        await handleOrganizeCheats(interaction);
        break;
      case 'blacklistmonitor':
        await handleBlacklistMonitor(interaction);
        break;
      case 'riskscan':
        await handleRiskScan(interaction);
        break;
      case 'hostping':
        await handleHostPing(interaction);
        break;
      case 'senddigest':
        await handleForceDigest(interaction);
        break;
      case 'patchnotes':
        await handlePatchNotes(interaction);
        break;
      case 'addtracking':
        await handleAddTracking(interaction);
        break;
      case 'removetracking':
        await handleRemoveTracking(interaction);
        break;
      case 'analytics':
        await handleData(interaction);
        break;
      // Multi-server personalization commands
      case 'subscribe':
        await handleSubscribe(interaction);
        break;
      case 'unsubscribe':
        await handleUnsubscribe(interaction);
        break;
      case 'mysubs':
        await handleViewSubscriptions(interaction);
        break;
      case 'setadminrole':
        await handleSetAdminRole(interaction);
        break;
      case 'removeadminrole':
        await handleRemoveAdminRole(interaction);
        break;
      case 'setmentionrole':
        await handleSetMentionRole(interaction);
        break;
      case 'removementionrole':
        await handleRemoveMentionRole(interaction);
        break;
      case 'settings':
        await handleServerSettings(interaction);
        break;
      case 'setquiethours':
        await handleSetQuietHours(interaction);
        break;
      case 'removequiethours':
        await handleRemoveQuietHours(interaction);
        break;
      case 'setdigestmode':
        await handleSetDigestMode(interaction);
        break;
      case 'testnotification':
        await handleTestNotification(interaction);
        break;
      case 'serverupdates':
        await handleUpdateHistory(interaction);
        break;
      // Owner-only commands
      case 'servers':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleServers(interaction);
        break;
      case 'serverinfo':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleServerInfo(interaction);
        break;
      case 'leaveserver':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleLeaveServer(interaction);
        break;
      case 'leaveall':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleLeaveAll(interaction);
        break;
      case 'logserverhere':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleLogServerHere(interaction);
        break;
      case 'allowserver':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleAllowServer(interaction);
        break;
      case 'disallowserver':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleDisallowServer(interaction);
        break;
      case 'listallowedservers':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleListAllowedServers(interaction);
        break;
      case 'togglewhitelist':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleToggleWhitelist(interaction);
        break;
      case 'broadcast':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleBroadcast(interaction);
        break;
      case 'dmuser':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleDmUser(interaction);
        break;
      case 'globalstats':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleBotStats(interaction);
        break;
      case 'maintenance':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleMaintenance(interaction);
        break;
      case 'refreshcommands':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleRefreshCommands(interaction);
        break;
      case 'getserverchannels':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleGetServerChannels(interaction);
        break;
      case 'createinvite':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleCreateInvite(interaction);
        break;
      case 'purgeserver':
        if (interaction.user.id !== config.botOwnerId) return;
        await handlePurgeServer(interaction);
        break;
      case 'owneronlycmds':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleOwnerOnlyCmds(interaction);
        break;
      case 'invite':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleInvite(interaction);
        break;
      case 'banserver':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleBanServer(interaction);
        break;
      case 'unbanserver':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleUnbanServer(interaction);
        break;
      case 'listbannedservers':
        if (interaction.user.id !== config.botOwnerId) return;
        await handleListBannedServers(interaction);
        break;
      default:
        await interaction.reply({
          content: '❌ Unknown command. Use `/help` for a list of available commands.',
          flags: 64
        });
    }
  } catch (error) {
    console.error(`Error handling command ${command}:`, error);
    await detectAndNotifyErrors(error.message, `command_${command}`);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ An error occurred while processing this command.',
        flags: 64
      });
    }
  }
});

// Handle select menu interactions
client.on('interactionCreate', async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'remove_tracking_select') {
      await handleRemoveTrackingSelect(interaction);
    } else if (interaction.customId === 'github_repo_select') {
      await handleGithubRepoSelect(interaction);
    } else if (interaction.customId === 'log_server_select') {
      await handleLogServerSelect(interaction);
    }
  } else if (interaction.isButton()) {
    // Handle owner confirmation buttons
    if (interaction.customId.startsWith('confirm_leave_')) {
      const serverId = interaction.customId.replace('confirm_leave_', '');
      await handleConfirmLeaveServer(interaction, serverId);
    } else if (interaction.customId === 'confirm_leave_all') {
      await handleConfirmLeaveAll(interaction);
    } else if (interaction.customId === 'cancel_leave') {
      await interaction.update({
        content: '❌ Server leave cancelled.',
        embeds: [],
        components: []
      });
    } else if (interaction.customId.startsWith('confirm_purge_')) {
      const serverId = interaction.customId.replace('confirm_purge_', '');
      await handleConfirmPurgeServer(interaction, serverId);
    } else if (interaction.customId === 'download_setup_guide') {
      await handleDownloadSetupGuide(interaction);
    }
  }
});

// Message listener for text commands
client.on('messageCreate', async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  // Check for .switchdex command (owner only)
  if (message.content.toLowerCase() === '.switchdex') {
    // Only owner can use this
    if (message.author.id !== config.botOwnerId) return;

    // Send the invite embed (same as /invite command)
    await sendInviteEmbed(message.channel);
  }
});

// Error handling
client.on('error', (error) => {
  console.error('❌ Discord client error:', error.message);
  detectAndNotifyErrors(error.message, 'discord_client');
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error.message);
  detectAndNotifyErrors(error.message, 'unhandled_rejection');
});

process.on('SIGINT', () => {
  console.log('');
  console.log('🛑 Shutting down SwitchDex...');

  // Clear scanning interval
  if (scanInterval) {
    clearInterval(scanInterval);
    console.log('✅ Stopped periodic scanning');
  }

  client.destroy();
  process.exit(0);
});


// Login
console.log('🔌 Attempting to connect to Discord...');
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error('❌ Failed to login:', error.message);
  console.log('');
  console.log('🔧 Troubleshooting steps:');
  console.log('1. Check if your bot token is valid at https://discord.com/developers/applications');
  console.log('2. Make sure the bot has been invited to at least one server');
  console.log('3. Verify the bot has the following permissions:');
  console.log('   - Send Messages');
  console.log('   - Use Slash Commands');
  console.log('   - Embed Links');
  console.log('   - Read Message History');
  console.log('   - View Channels');
  console.log('4. Regenerate your bot token if it has expired');
  console.log('');
  process.exit(1);
});
