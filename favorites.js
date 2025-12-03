const { Markup } = require("telegraf");
const { openDb, closeDb } = require("./db_manager");
const logger = require("./logger");
const { validateBookId, validateUserId } = require("./validators");

/**
 * Add book to user's favorites
 * @param {number} userId - User ID
 * @param {number} bookId - Book ID
 * @returns {Promise<boolean>} Success status
 */
async function addToFavorites(userId, bookId) {
  if (!validateUserId(userId) || !validateBookId(bookId)) {
    return false;
  }

  const db = await openDb();
  try {
    await db.run(
      "INSERT INTO user_favorites (user_id, book_id) VALUES (?, ?)",
      [userId, bookId]
    );
    logger.logInfo("Book added to favorites", { userId, bookId });
    return true;
  } catch (error) {
    if (error.message.includes("UNIQUE")) {
      logger.logDebug("Book already in favorites", { userId, bookId });
      return false;
    }
    logger.logError("Failed to add to favorites", error, { userId, bookId });
    return false;
  } finally {
    await closeDb(db);
  }
}

/**
 * Remove book from user's favorites
 * @param {number} userId - User ID
 * @param {number} bookId - Book ID
 * @returns {Promise<boolean>} Success status
 */
async function removeFromFavorites(userId, bookId) {
  if (!validateUserId(userId) || !validateBookId(bookId)) {
    return false;
  }

  const db = await openDb();
  try {
    const result = await db.run(
      "DELETE FROM user_favorites WHERE user_id = ? AND book_id = ?",
      [userId, bookId]
    );
    logger.logInfo("Book removed from favorites", { userId, bookId });
    return result.changes > 0;
  } catch (error) {
    logger.logError("Failed to remove from favorites", error, {
      userId,
      bookId,
    });
    return false;
  } finally {
    await closeDb(db);
  }
}

/**
 * Check if book is in user's favorites
 * @param {number} userId - User ID
 * @param {number} bookId - Book ID
 * @returns {Promise<boolean>} Is favorite
 */
async function isFavorite(userId, bookId) {
  const db = await openDb();
  try {
    const result = await db.get(
      "SELECT 1 FROM user_favorites WHERE user_id = ? AND book_id = ?",
      [userId, bookId]
    );
    return !!result;
  } catch (error) {
    logger.logError("Failed to check favorite status", error, {
      userId,
      bookId,
    });
    return false;
  } finally {
    await closeDb(db);
  }
}

/**
 * Get user's favorite books
 * @param {number} userId - User ID
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} List of favorite books
 */
async function getUserFavorites(userId, limit = 50) {
  if (!validateUserId(userId)) {
    return [];
  }

  const db = await openDb();
  try {
    const favorites = await db.all(
      `SELECT b.id, b.book_name, b.author_name, b.category, 
              b.request_count, f.created_at as favorited_at
       FROM user_favorites f
       JOIN usol_books b ON f.book_id = b.id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    return favorites;
  } catch (error) {
    logger.logError("Failed to get user favorites", error, { userId });
    return [];
  } finally {
    await closeDb(db);
  }
}

/**
 * Handle toggle favorite action
 * @param {object} ctx - Telegraf context
 * @param {number} bookId - Book ID
 */
async function handleToggleFavorite(ctx, bookId) {
  const userId = ctx.from.id;

  const alreadyFavorite = await isFavorite(userId, bookId);

  if (alreadyFavorite) {
    const success = await removeFromFavorites(userId, bookId);
    if (success) {
      await ctx.answerCbQuery("💔 تم إزالة الكتاب من المفضلة");
    } else {
      await ctx.answerCbQuery("❌ حدث خطأ");
    }
  } else {
    const success = await addToFavorites(userId, bookId);
    if (success) {
      await ctx.answerCbQuery("💖 تم إضافة الكتاب إلى المفضلة");
    } else {
      await ctx.answerCbQuery("⚠️ الكتاب موجود بالفعل في المفضلة");
    }
  }
}

/**
 * Show user's favorites list
 * @param {object} ctx - Telegraf context
 */
async function showFavoritesList(ctx) {
  const userId = ctx.from.id;
  const favorites = await getUserFavorites(userId);

  if (favorites.length === 0) {
    await ctx.reply("📭 لا توجد كتب في قائمة المفضلة الخاصة بك.");
    return;
  }

  let message = "<b>💖 كتبك المفضلة:</b>\n\n";
  favorites.forEach((book, index) => {
    message += `${index + 1}. 📚 <b>${book.book_name}</b>\n`;
    message += `   ✍️ ${book.author_name}\n`;
    message += `   📂 ${book.category}\n`;
    message += `   🔗 /book_${book.id}\n\n`;
  });

  await ctx.reply(message, { parse_mode: "HTML" });
}

/**
 * Get number of users who favorited a book
 * @param {number} bookId - Book ID
 * @returns {Promise<number>} Count of favorites
 */
async function getFavoriteCount(bookId) {
  const db = await openDb();
  try {
    const result = await db.get(
      "SELECT COUNT(*) as count FROM user_favorites WHERE book_id = ?",
      [bookId]
    );
    return result.count || 0;
  } catch (error) {
    logger.logError("Failed to get favorite count", error, { bookId });
    return 0;
  } finally {
    await closeDb(db);
  }
}

module.exports = {
  addToFavorites,
  removeFromFavorites,
  isFavorite,
  getUserFavorites,
  handleToggleFavorite,
  showFavoritesList,
  getFavoriteCount,
};
