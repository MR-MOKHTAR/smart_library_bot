const NodeCache = require("node-cache");
const config = require("./config");
const logger = require("./logger");

// Create cache instance
const searchCache = new NodeCache({
  stdTTL: config.cache.stdTTL,
  checkperiod: config.cache.checkperiod,
  maxKeys: config.cache.maxKeys,
  useClones: false, // Better performance, but be careful with mutable objects
});

// Cache statistics
let hits = 0;
let misses = 0;

/**
 * Get value from cache
 * @param {string} key - Cache key
 * @returns {any|undefined} Cached value or undefined
 */
function get(key) {
  if (!config.cache.enabled) return undefined;

  const value = searchCache.get(key);
  if (value !== undefined) {
    hits++;
    logger.logDebug(`Cache hit for key: ${key}`);
    return value;
  }
  misses++;
  logger.logDebug(`Cache miss for key: ${key}`);
  return undefined;
}

/**
 * Set value in cache
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Optional TTL in seconds
 * @returns {boolean} Success status
 */
function set(key, value, ttl = undefined) {
  if (!config.cache.enabled) return false;

  const success = ttl
    ? searchCache.set(key, value, ttl)
    : searchCache.set(key, value);
  if (success) {
    logger.logDebug(`Cached value for key: ${key}`);
  }
  return success;
}

/**
 * Delete value from cache
 * @param {string} key - Cache key
 * @returns {number} Number of deleted entries
 */
function del(key) {
  return searchCache.del(key);
}

/**
 * Clear all cache
 */
function flush() {
  searchCache.flushAll();
  hits = 0;
  misses = 0;
  logger.logInfo("Cache flushed");
}

/**
 * Get cache statistics
 * @returns {object} Cache statistics
 */
function getStats() {
  return {
    hits,
    misses,
    hitRate:
      hits + misses > 0
        ? ((hits / (hits + misses)) * 100).toFixed(2) + "%"
        : "0%",
    keys: searchCache.keys().length,
    size: searchCache.getStats(),
  };
}

/**
 * Generate cache key for search queries
 * @param {string} query - Search query
 * @param {object} options - Search options
 * @returns {string} Cache key
 */
function generateSearchKey(query, options = {}) {
  const optionsStr = JSON.stringify(options);
  return `search:${query}:${optionsStr}`;
}

module.exports = {
  get,
  set,
  del,
  flush,
  getStats,
  generateSearchKey,
};
