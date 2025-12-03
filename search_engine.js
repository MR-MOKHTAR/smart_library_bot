const { Markup } = require("telegraf");
const {
  openDb,
  closeDb,
  recordBookAccess,
  saveSearchHistory,
} = require("./db_manager");
const {
  advancedSearch,
  getSimilarBooks,
  convertToEnglishDigits,
  normalizePersianArabicChars,
} = require("./advanced_search");
const { validateUserInput } = require("./validators");
const { isFavorite } = require("./favorites");
const { getBookRating } = require("./rating");
const logger = require("./logger");
const config = require("./config");

/**
 * Handle search engine with advanced features
 * @param {object} ctx - Telegraf context
 * @param {object} options - Search options
 */
async function handleSearchEngine(ctx, { book_id = null } = {}) {
  const userId = ctx.from.id;

  try {
    let searchQuery;
    let source = "message";

    if (book_id) {
      searchQuery = book_id.toString();
      source = "callback";
    } else {
      const userInput = ctx.message.text.trim();
      if (!(await validateUserInput(ctx, userInput))) {
        return;
      }
      searchQuery = convertToEnglishDigits(
        normalizePersianArabicChars(userInput)
      );
    }

    // Perform advanced search
    const results = await advancedSearch(searchQuery, {
      sortBy: "relevance",
      limit: config.search.maxSimilarResults,
    });

    // Save search to history
    await saveSearchHistory(userId, searchQuery, results.length);

    if (results.length > 0) {
      // Show best result
      const bestResult = results[0];

      // Get additional info
      const [favoriteStatus, ratingInfo] = await Promise.all([
        isFavorite(userId, bestResult.id),
        getBookRating(bestResult.id),
      ]);

      const favoriteIcon = favoriteStatus ? "💖" : "🤍";
      const ratingText =
        ratingInfo.count > 0
          ? `⭐ ${ratingInfo.average}/5 (${ratingInfo.count} تقييم)`
          : "لم يتم التقييم بعد";

      const searchResultText = `
🔍 <b>نتیجة البحث لـ : ${searchQuery}</b>

📚 <b>اسم الكتاب : </b> ${bestResult.book_name}
✍️ <b>اسم المؤلف : </b> ${bestResult.author_name}
📂 <b>القسم : </b> ${bestResult.category || "غير محدد"}
📄 <b>عدد الأجزاء : </b> ${
        bestResult.file_path ? bestResult.file_path.split("|").length : 0
      }
📊 <b>عدد مرات الطلب : </b> ${bestResult.request_count}
${ratingText}
${favoriteIcon} <b>في المفضلة</b>
🆔 <i>${bestResult.id}</i>
      `.trim();

      // Action buttons
      const keyboard = [
        [
          Markup.button.callback(
            favoriteStatus ? "💔 إزالة من المفضلة" : "💖 إضافة للمفضلة",
            `fav_toggle_${bestResult.id}`
          ),
        ],
        [
          Markup.button.callback(
            "⭐ قيّم الكتاب",
            `show_rate_${bestResult.id}`
          ),
        ],
      ];

      await ctx.reply(searchResultText, {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
      });

      // Send files
      if (bestResult.file_path) {
        const filePaths = bestResult.file_path.split("|");
        let filesSent = 0;

        for (const filePath of filePaths) {
          try {
            await ctx.replyWithDocument(filePath);
            filesSent++;
          } catch (error) {
            logger.logError("Failed to send file", error, {
              filePath,
              bookId: bestResult.id,
            });
          }
        }

        if (filesSent > 0) {
          // Record access and increment count
          await recordBookAccess(userId, bestResult.id);
          const db = await openDb();
          await db.run(
            `UPDATE usol_books 
             SET request_count = request_count + 1, 
                 total_requests = total_requests + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [bestResult.id]
          );
          await closeDb(db);

          await ctx.reply(`📥 تم إرسال ${filesSent} ملف.`);

          // Show similar books
          await showSimilarBooks(
            ctx,
            bestResult.id,
            bestResult.author_name,
            bestResult.category
          );
        } else {
          await ctx.reply("❌ حدثت مشكلة في إرسال الملفات.");
        }
      } else {
        await ctx.reply("❌ لم يتم العثور على ملف للكتاب.");
      }
    } else {
      // No exact match, show alternatives
      await ctx.reply(`❌ لم یتم العثور علی نتیجة دقيقة ل (${searchQuery}).`);

      // Try broader search
      const db = await openDb();
      const allBooks = await db.all(
        "SELECT id, book_name, author_name FROM usol_books"
      );
      await closeDb(db);

      const alternativeResults = await advancedSearch(searchQuery, {
        sortBy: "relevance",
        limit: 10,
      });

      if (alternativeResults.length > 0) {
        const keyboard = Markup.inlineKeyboard(
          alternativeResults.map((book) => [
            Markup.button.callback(
              `${book.book_name} - ${book.author_name}`,
              `similar_result_${book.id}`
            ),
          ])
        );

        const messageText =
          '📚 <b dir="rtl">تم العثور على بعض الكتب المشابهة:</b>\n\n👇 يرجى اختيار أحد النتائج أدناه:';
        await ctx.reply(messageText, {
          reply_markup: keyboard.reply_markup,
          parse_mode: "HTML",
        });
      }
    }
  } catch (error) {
    logger.logError("Error in handleSearchEngine", error, { userId });
    await ctx.reply("❌ حدث خطأ أثناء البحث. يرجى المحاولة مرة أخرى.");
  }
}

/**
 * Show similar books after sending a book
 * @param {object} ctx - Telegraf context
 * @param {number} bookId - Current book ID
 * @param {string} authorName - Author name
 * @param {string} category - Category name
 */
async function showSimilarBooks(ctx, bookId, authorName, category) {
  try {
    const similarBooks = await getSimilarBooks(bookId, 5);

    if (similarBooks.length > 0) {
      let message = "\n📖 <b>كتب مشابهة قد تهمك:</b>\n\n";

      similarBooks.forEach((book, index) => {
        message += `${index + 1}. ${book.book_name} - ${book.author_name}\n`;
        message += `   🔗 /book_${book.id}\n`;
      });

      await ctx.reply(message, { parse_mode: "HTML" });
    }
  } catch (error) {
    logger.logError("Failed to show similar books", error, { bookId });
  }
}

/**
 * Show search history for user
 * @param {object} ctx - Telegraf context
 */
async function showSearchHistory(ctx) {
  const userId = ctx.from.id;
  const db = await openDb();

  try {
    const history = await db.all(
      `SELECT DISTINCT search_query, created_at 
       FROM search_history 
       WHERE user_id = ? 
       ORDER BY created_at DESC 
       LIMIT 20`,
      [userId]
    );

    if (history.length === 0) {
      await ctx.reply("📭 لا توجد سجل للبحث.");
      return;
    }

    let message = "<b>🔍 سجل البحث الأخير:</b>\n\n";
    history.forEach((item, index) => {
      message += `${index + 1}. ${item.search_query}\n`;
    });

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    logger.logError("Failed to show search history", error, { userId });
    await ctx.reply("❌ حدث خطأ أثناء عرض السجل.");
  } finally {
    await closeDb(db);
  }
}

/**
 * Show recent books accessed by user
 * @param {object} ctx - Telegraf context
 */
async function showRecentBooks(ctx) {
  const userId = ctx.from.id;
  const db = await openDb();

  try {
    const recentBooks = await db.all(
      `SELECT DISTINCT b.id, b.book_name, b.author_name, ra.accessed_at
       FROM recent_access ra
       JOIN usol_books b ON ra.book_id = b.id
       WHERE ra.user_id = ?
       ORDER BY ra.accessed_at DESC
       LIMIT 10`,
      [userId]
    );

    if (recentBooks.length === 0) {
      await ctx.reply("📭 لا توجد كتب تم الوصول إليها مؤخراً.");
      return;
    }

    let message = "<b>📚 الكتب التي تم الوصول إليها مؤخراً:</b>\n\n";
    recentBooks.forEach((book, index) => {
      message += `${index + 1}. ${book.book_name}\n`;
      message += `   ✍️ ${book.author_name}\n`;
      message += `   🔗 /book_${book.id}\n\n`;
    });

    await ctx.reply(message, { parse_mode: "HTML" });
  } catch (error) {
    logger.logError("Failed to show recent books", error, { userId });
    await ctx.reply("❌ حدث خطأ أثناء عرض الكتب الأخيرة.");
  } finally {
    await closeDb(db);
  }
}

module.exports = {
  handleSearchEngine,
  showSimilarBooks,
  showSearchHistory,
  showRecentBooks,
};
