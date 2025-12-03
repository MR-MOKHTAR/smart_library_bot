const logger = require("./logger");

/**
 * Global error handler middleware for bot
 * @param {Error} error - Error object
 * @param {object} ctx - Telegraf context
 */
async function handleError(error, ctx) {
  logger.logError("Unhandled error in bot", error, {
    userId: ctx?.from?.id,
    chatId: ctx?.chat?.id,
    messageText: ctx?.message?.text,
  });

  // Send user-friendly error message
  if (ctx && ctx.reply) {
    try {
      await ctx.reply(
        "❌ عذراً، حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى لاحقاً.",
        { parse_mode: "HTML" }
      );
    } catch (replyError) {
      logger.logError("Failed to send error message to user", replyError);
    }
  }
}

/**
 * Handle database errors
 * @param {Error} error - Database error
 * @param {string} operation - Operation that failed
 * @param {object} context - Additional context
 */
function handleDatabaseError(error, operation, context = {}) {
  logger.logError(`Database error during ${operation}`, error, context);
}

/**
 * Handle file send errors
 * @param {Error} error - File send error
 * @param {string} filePath - File path that failed
 * @param {object} ctx - Telegraf context
 */
async function handleFileSendError(error, filePath, ctx) {
  logger.logError("Failed to send file", error, {
    filePath,
    userId: ctx?.from?.id,
  });

  if (ctx && ctx.reply) {
    try {
      await ctx.reply("❌ عذراً، فشل إرسال الملف. يرجى المحاولة مرة أخرى.");
    } catch (replyError) {
      logger.logError("Failed to send file error message", replyError);
    }
  }
}

/**
 * Handle search errors
 * @param {Error} error - Search error
 * @param {string} query - Search query
 * @param {object} ctx - Telegraf context
 */
async function handleSearchError(error, query, ctx) {
  logger.logError("Search error", error, {
    query,
    userId: ctx?.from?.id,
  });

  if (ctx && ctx.reply) {
    try {
      await ctx.reply("❌ حدث خطأ أثناء البحث. يرجى المحاولة مرة أخرى.");
    } catch (replyError) {
      logger.logError("Failed to send search error message", replyError);
    }
  }
}

/**
 * Wrap async function with error handling
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
function asyncErrorWrapper(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const ctx = args.find((arg) => arg && arg.reply);
      await handleError(error, ctx);
    }
  };
}

module.exports = {
  handleError,
  handleDatabaseError,
  handleFileSendError,
  handleSearchError,
  asyncErrorWrapper,
};
