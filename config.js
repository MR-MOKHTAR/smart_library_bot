require("dotenv").config();

const config = {
  // Bot configuration
  bot: {
    token: process.env.BOT_TOKEN,
    channelId: process.env.CHANNEL_ID || "",
  },

  // Database configuration
  database: {
    filename: process.env.DB_FILENAME || "./light_effects.db",
    // Connection pool settings
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000,
    },
  },

  // Search configuration
  search: {
    // Maximum length of search query
    maxQueryLength: 37,
    // Maximum number of similar results to show
    maxSimilarResults: 10,
    // Search scoring weights
    weights: {
      bookName: 0.7,
      authorName: 0.3,
    },
    // Fuzzy search threshold (0-1, higher is more strict)
    fuzzyThreshold: 0.3,
  },

  // Cache configuration
  cache: {
    enabled: true,
    stdTTL: 600, // 10 minutes in seconds
    checkperiod: 120, // Clean expired keys every 2 minutes
    maxKeys: 1000,
  },

  // Pagination settings
  pagination: {
    itemsPerPage: 20,
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },

  // Rate limiting (optional for future use)
  rateLimit: {
    enabled: false,
    windowMs: 60000, // 1 minute
    maxRequests: 30,
  },

  // Features flags
  features: {
    favorites: true,
    ratings: true,
    searchHistory: true,
    recommendations: true,
    analytics: true,
  },
};

module.exports = config;
