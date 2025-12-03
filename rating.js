const { Markup } = require("telegraf");
const { openDb, closeDb } = require("./db_manager");
const logger = require("./logger");
const {
  validateBookId,
  validateUserId,
  validateRating,
} = require("./validators");

/**
 * Add or update book rating
 * @param {number} userId - User ID
 * @param {number} bookId - Book ID
 * @param {number} rating - Rating (1-5)
 * @param {string} review - Optional review text
 * @returns {Promise<boolean>} Success status
 */
async function rateBook(userId, bookId, rating, review = null) {
  if (
    !validateUserId(userId) ||
    !validateBookId(bookId) ||
    !validateRating(rating)
  ) {
    return false;
  }

  const db = await openDb();
  try {
    await db.run(
      `INSERT INTO book_ratings (user_id, book_id, rating, review) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, book_id) DO UPDATE SET 
         rating = excluded.rating,
         review = excluded.review,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, bookId, rating, review]
    );
    logger.logInfo("Book rated", { userId, bookId, rating });
    return true;
  } catch (error) {
    logger.logError("Failed to rate book", error, { userId, bookId, rating });
    return false;
  } finally {
    await closeDb(db);
  }
}

/**
 * Get average rating for a book
 * @param {number} bookId - Book ID
 * @returns {Promise<object>} Rating info (average, count)
 */
async function getBookRating(bookId) {
  const db = await openDb();
  try {
    const result = await db.get(
      `SELECT AVG(rating) as average, COUNT(*) as count 
       FROM book_ratings 
       WHERE book_id = ?`,
      [bookId]
    );
    return {
      average: result.average ? parseFloat(result.average.toFixed(1)) : 0,
      count: result.count || 0,
    };
  } catch (error) {
    logger.logError("Failed to get book rating", error, { bookId });
    return { average: 0, count: 0 };
  } finally {
    await closeDb(db);
  }
}

/**
 * Get user's rating for a book
 * @param {number} userId - User ID
 * @param {number} bookId - Book ID
 * @returns {Promise<object|null>} User rating
 */
async function getUserRating(userId, bookId) {
  const db = await openDb();
  try {
    const rating = await db.get(
      "SELECT rating, review FROM book_ratings WHERE user_id = ? AND book_id = ?",
      [userId, bookId]
    );
    return rating;
  } catch (error) {
    logger.logError("Failed to get user rating", error, { userId, bookId });
    return null;
  } finally {
    await closeDb(db);
  }
}

/**
 * Get top-rated books
 * @param {number} limit - Maximum results
 * @param {number} minRatings - Minimum number of ratings required
 * @returns {Promise<Array>} Top-rated books
 */
async function getTopRatedBooks(limit = 10, minRatings = 3) {
  const db = await openDb();
  try {
    const books = await db.all(
      `SELECT b.id, b.book_name, b.author_name, b.category,
              AVG(r.rating) as avg_rating,
              COUNT(r.rating) as rating_count
       FROM usol_books b
       JOIN book_ratings r ON b.id = r.book_id
       GROUP BY b.id
       HAVING COUNT(r.rating) >= ?
       ORDER BY avg_rating DESC, rating_count DESC
       LIMIT ?`,
      [minRatings, limit]
    );
    return books;
  } catch (error) {
    logger.logError("Failed to get top-rated books", error);
    return [];
  } finally {
    await closeDb(db);
  }
}

/**
 * Show rating interface
 * @param {object} ctx - Telegraf context
 * @param {number} bookId - Book ID
 */
async function showRatingInterface(ctx, bookId) {
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback("⭐", `rate_${bookId}_1`),
      Markup.button.callback("⭐⭐", `rate_${bookId}_2`),
      Markup.button.callback("⭐⭐⭐", `rate_${bookId}_3`),
    ],
    [
      Markup.button.callback("⭐⭐⭐⭐", `rate_${bookId}_4`),
      Markup.button.callback("⭐⭐⭐⭐⭐", `rate_${bookId}_5`),
    ],
  ]);

  await ctx.reply("⭐ قيّم هذا الكتاب:", keyboard);
}

/**
 * Handle rating callback
 * @param {object} ctx - Telegraf context
 * @param {number} bookId - Book ID
 * @param {number} rating - Rating value
 */
async function handleRatingCallback(ctx, bookId, rating) {
  const userId = ctx.from.id;

  const success = await rateBook(userId, bookId, rating);

  if (success) {
    const ratingInfo = await getBookRating(bookId);
    await ctx.answerCbQuery(`✅ شكراً! تقييمك: ${"⭐".repeat(rating)}`);
    await ctx.editMessageText(
      `تم تقييم الكتاب بنجاح!\n\n📊 متوسط التقييم: ${ratingInfo.average} ⭐\n👥 عدد التقييمات: ${ratingInfo.count}`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.answerCbQuery("❌ حدث خطأ أثناء التقييم");
  }
}

/**
 * Show book reviews
 * @param {object} ctx - Telegraf context
 * @param {number} bookId - Book ID
 */
async function showBookReviews(ctx, bookId) {
  const db = await openDb();
  try {
    const reviews = await db.all(
      `SELECT r.rating, r.review, r.created_at, u.name as user_name
       FROM book_ratings r
       JOIN users u ON r.user_id = u.user_id
       WHERE r.book_id = ? AND r.review IS NOT NULL
       ORDER BY r.created_at DESC
       LIMIT 10`,
      [bookId]
    );

    if (reviews.length === 0) {
      await ctx.reply("لا توجد مراجعات لهذا الكتاب بعد.");
      return;
    }

    let message = "<b>📝 مراجعات الكتاب:</b>\n\n";
    reviews.forEach((review, index) => {
      message += `${index + 1}. ${"⭐".repeat(review.rating)}\n`;
      message += `   👤 ${review.user_name}\n`;
      if (review.review) {
        message += `   💬 ${review.review}\n`;
      }
      message += "\n";
    });

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    logger.logError("Failed to show book reviews", error, { bookId });
    await ctx.reply("❌ حدث خطأ أثناء عرض المراجعات");
  } finally {
    await closeDb(db);
  }
}

/**
 * Format rating display
 * @param {number} average - Average rating
 * @param {number} count - Number of ratings
 * @returns {string} Formatted rating string
 */
function formatRating(average, count) {
  if (count === 0) return "لم يتم التقييم بعد";

  const stars = "⭐".repeat(Math.round(average));
  return `${stars} ${average}/5 (${count} تقييم)`;
}

module.exports = {
  rateBook,
  getBookRating,
  getUserRating,
  getTopRatedBooks,
  showRatingInterface,
  handleRatingCallback,
  showBookReviews,
  formatRating,
};
