const Joi = require("joi");
const logger = require("./logger");

/**
 * Validate user input for search
 * @param {object} ctx - Telegraf context
 * @param {string} userInput - User input text
 * @returns {boolean} Is valid
 */
async function validateUserInput(ctx, userInput) {
  // Check for English letters
  if (/[A-Za-z]/.test(userInput)) {
    await ctx.reply(
      "❌ <b>خطأ</b>: يُرجى استخدام الأحرف الفارسية أو العربية فقط.",
      { parse_mode: "HTML" }
    );
    logger.logWarning("User input contains English letters", {
      userId: ctx.from.id,
      input: userInput,
    });
    return false;
  }

  // Check length
  if (userInput.length > 37) {
    await ctx.reply(
      "❌ <b>خطأ</b>: النص المُدخل أطول من الحدّ المسموح به<b>(الحد الأقصى 40 حرفًا)</b>.",
      { parse_mode: "HTML" }
    );
    logger.logWarning("User input too long", {
      userId: ctx.from.id,
      length: userInput.length,
    });
    return false;
  }

  // Check for emojis
  if (/\p{Emoji}/u.test(userInput)) {
    await ctx.reply(
      "❌ <b>خطأ</b>: النص المُدخل يحتوي على ايموجي، يُرجى إدخال نصوص فقط.",
      { parse_mode: "HTML" }
    );
    logger.logWarning("User input contains emoji", { userId: ctx.from.id });
    return false;
  }

  // Check for media
  if (ctx.message.photo || ctx.message.video || ctx.message.document) {
    await ctx.reply(
      "❌ <b>خطأ</b>: لا يُسمح بإرسال الصور أو الفيديو أو الملفات في هذا البحث.",
      { parse_mode: "HTML" }
    );
    logger.logWarning("User sent media instead of text", {
      userId: ctx.from.id,
    });
    return false;
  }

  return true;
}

/**
 * Validate book ID
 * @param {string|number} bookId - Book ID to validate
 * @returns {boolean} Is valid
 */
function validateBookId(bookId) {
  const schema = Joi.number().integer().positive();
  const { error } = schema.validate(bookId);
  if (error) {
    logger.logWarning("Invalid book ID", { bookId, error: error.message });
    return false;
  }
  return true;
}

/**
 * Validate user ID
 * @param {number} userId - User ID to validate
 * @returns {boolean} Is valid
 */
function validateUserId(userId) {
  const schema = Joi.number().integer().positive();
  const { error } = schema.validate(userId);
  if (error) {
    logger.logWarning("Invalid user ID", { userId, error: error.message });
    return false;
  }
  return true;
}

/**
 * Validate category name
 * @param {string} category - Category name to validate
 * @returns {boolean} Is valid
 */
function validateCategory(category) {
  const schema = Joi.string().min(1).max(100);
  const { error } = schema.validate(category);
  if (error) {
    logger.logWarning("Invalid category", { category, error: error.message });
    return false;
  }
  return true;
}

/**
 * Sanitize text for HTML output
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
function sanitizeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validate rating value
 * @param {number} rating - Rating value (1-5)
 * @returns {boolean} Is valid
 */
function validateRating(rating) {
  const schema = Joi.number().integer().min(1).max(5);
  const { error } = schema.validate(rating);
  if (error) {
    logger.logWarning("Invalid rating", { rating, error: error.message });
    return false;
  }
  return true;
}

module.exports = {
  validateUserInput,
  validateBookId,
  validateUserId,
  validateCategory,
  validateRating,
  sanitizeHtml,
};
