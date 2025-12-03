const { openDb, closeDb } = require("./db_manager");
const logger = require("./logger");
const { getTopRatedBooks } = require("./rating");

/**
 * Get recently accessed books by user
 * @param {number} userId - User ID
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Recently accessed books
 */
async function getRecentBooks(userId, limit = 10) {
  const db = await openDb();
  try {
    const books = await db.all(
      `SELECT DISTINCT b.id, b.book_name, b.author_name, b.category,
              ra.accessed_at
       FROM recent_access ra
       JOIN usol_books b ON ra.book_id = b.id
       WHERE ra.user_id = ?
       ORDER BY ra.accessed_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    return books;
  } catch (error) {
    logger.logError("Failed to get recent books", error, { userId });
    return [];
  } finally {
    await closeDb(db);
  }
}

/**
 * Get popular books (most requested)
 * @param {number} limit - Maximum results
 * @param {string} category - Optional category filter
 * @returns {Promise<Array>} Popular books
 */
async function getPopularBooks(limit = 10, category = null) {
  const db = await openDb();
  try {
    let query = `
      SELECT id, book_name, author_name, category, request_count
      FROM usol_books
      WHERE request_count > 0
    `;
    const params = [];

    if (category) {
      query += " AND category = ?";
      params.push(category);
    }

    query += " ORDER BY request_count DESC LIMIT ?";
    params.push(limit);

    const books = await db.all(query, params);
    return books;
  } catch (error) {
    logger.logError("Failed to get popular books", error);
    return [];
  } finally {
    await closeDb(db);
  }
}

/**
 * Get personalized recommendations for user
 * Based on: favorites, recent reads, and search history
 * @param {number} userId - User ID
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Recommended books
 */
async function getPersonalizedRecommendations(userId, limit = 10) {
  const db = await openDb();
  try {
    // Get user's favorite categories and authors
    const userPreferences = await db.all(
      `SELECT DISTINCT b.category, b.author_name
       FROM user_favorites f
       JOIN usol_books b ON f.book_id = b.id
       WHERE f.user_id = ?
       LIMIT 10`,
      [userId]
    );

    if (userPreferences.length === 0) {
      // If no favorites, return popular books
      return await getPopularBooks(limit);
    }

    const categories = [...new Set(userPreferences.map((p) => p.category))];
    const authors = [...new Set(userPreferences.map((p) => p.author_name))];

    // Get user's already accessed/favorited books to exclude
    const accessedBooks = await db.all(
      `SELECT book_id FROM user_favorites WHERE user_id = ?
       UNION
       SELECT DISTINCT book_id FROM recent_access WHERE user_id = ?`,
      [userId, userId]
    );
    const accessedIds = accessedBooks.map((b) => b.book_id);

    // Build recommendations query
    let query = `
      SELECT b.id, b.book_name, b.author_name, b.category, b.request_count,
             CASE 
               WHEN b.author_name IN (${authors
                 .map(() => "?")
                 .join(",")}) THEN 2
               WHEN b.category IN (${categories
                 .map(() => "?")
                 .join(",")}) THEN 1
               ELSE 0
             END as relevance_score
      FROM usol_books b
      WHERE 1=1
    `;

    const params = [...authors, ...categories];

    if (accessedIds.length > 0) {
      query += ` AND b.id NOT IN (${accessedIds.map(() => "?").join(",")})`;
      params.push(...accessedIds);
    }

    query += " ORDER BY relevance_score DESC, request_count DESC LIMIT ?";
    params.push(limit);

    const recommendations = await db.all(query, params);
    return recommendations;
  } catch (error) {
    logger.logError("Failed to get personalized recommendations", error, {
      userId,
    });
    return [];
  } finally {
    await closeDb(db);
  }
}

/**
 * Get books by same author
 * @param {string} authorName - Author name
 * @param {number} excludeBookId - Book ID to exclude
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Books by same author
 */
async function getBooksByAuthor(authorName, excludeBookId = null, limit = 10) {
  const db = await openDb();
  try {
    let query = `
      SELECT id, book_name, author_name, category, request_count
      FROM usol_books
      WHERE author_name = ?
    `;
    const params = [authorName];

    if (excludeBookId) {
      query += " AND id != ?";
      params.push(excludeBookId);
    }

    query += " ORDER BY request_count DESC LIMIT ?";
    params.push(limit);

    const books = await db.all(query, params);
    return books;
  } catch (error) {
    logger.logError("Failed to get books by author", error, { authorName });
    return [];
  } finally {
    await closeDb(db);
  }
}

/**
 * Get similar books based on category
 * @param {string} category - Category name
 * @param {number} excludeBookId - Book ID to exclude
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Similar books
 */
async function getSimilarBooksByCategory(
  category,
  excludeBookId = null,
  limit = 10
) {
  const db = await openDb();
  try {
    let query = `
      SELECT id, book_name, author_name, category, request_count
      FROM usol_books
      WHERE category = ?
    `;
    const params = [category];

    if (excludeBookId) {
      query += " AND id != ?";
      params.push(excludeBookId);
    }

    query += " ORDER BY request_count DESC LIMIT ?";
    params.push(limit);

    const books = await db.all(query, params);
    return books;
  } catch (error) {
    logger.logError("Failed to get similar books by category", error, {
      category,
    });
    return [];
  } finally {
    await closeDb(db);
  }
}

/**
 * Show recommendations to user
 * @param {object} ctx - Telegraf context
 */
async function showRecommendations(ctx) {
  const userId = ctx.from.id;
  const recommendations = await getPersonalizedRecommendations(userId, 10);

  if (recommendations.length === 0) {
    await ctx.reply("لا توجد توصيات متاحة حالياً.");
    return;
  }

  let message = "<b>📚 كتب موصى بها لك:</b>\n\n";
  recommendations.forEach((book, index) => {
    message += `${index + 1}. 📖 <b>${book.book_name}</b>\n`;
    message += `   ✍️ ${book.author_name}\n`;
    message += `   📂 ${book.category}\n`;
    message += `   🔗 /book_${book.id}\n\n`;
  });

  await ctx.reply(message, { parse_mode: "HTML" });
}

/**
 * Show popular books to user
 * @param {object} ctx - Telegraf context
 * @param {string} category - Optional category filter
 */
async function showPopularBooks(ctx, category = null) {
  const books = await getPopularBooks(10, category);

  if (books.length === 0) {
    await ctx.reply("لا توجد كتب شائعة حالياً.");
    return;
  }

  const categoryText = category ? ` في قسم ${category}` : "";
  let message = `<b>🔥 الكتب الأكثر طلباً${categoryText}:</b>\n\n`;

  books.forEach((book, index) => {
    message += `${index + 1}. 📖 <b>${book.book_name}</b>\n`;
    message += `   ✍️ ${book.author_name}\n`;
    message += `   📊 ${book.request_count} طلب\n`;
    message += `   🔗 /book_${book.id}\n\n`;
  });

  await ctx.reply(message, { parse_mode: "HTML" });
}

/**
 * Show top-rated books to user
 * @param {object} ctx - Telegraf context
 */
async function showTopRated(ctx) {
  const books = await getTopRatedBooks(10, 3);

  if (books.length === 0) {
    await ctx.reply("لا توجد كتب مقيّمة بشكل كافٍ حالياً.");
    return;
  }

  let message = "<b>⭐ أفضل الكتب تقييماً:</b>\n\n";

  books.forEach((book, index) => {
    message += `${index + 1}. 📖 <b>${book.book_name}</b>\n`;
    message += `   ✍️ ${book.author_name}\n`;
    message += `   ⭐ ${book.avg_rating.toFixed(1)}/5 (${
      book.rating_count
    } تقييم)\n`;
    message += `   🔗 /book_${book.id}\n\n`;
  });

  await ctx.reply(message, { parse_mode: "HTML" });
}

module.exports = {
  getRecentBooks,
  getPopularBooks,
  getPersonalizedRecommendations,
  getBooksByAuthor,
  getSimilarBooksByCategory,
  showRecommendations,
  showPopularBooks,
  showTopRated,
};
