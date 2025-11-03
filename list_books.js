const { Markup } = require("telegraf");
const { openDb } = require("./db_manager");

// Helper function to truncate text
function truncateText(text, maxLength = 35) {
  if (text.length > maxLength) {
    return text.substring(0, maxLength - 2) + "..";
  }
  return text;
}

async function showCategories(ctx) {
  const db = await openDb();
  try {
    const categories = await db.all(
      "SELECT DISTINCT category FROM usol_books WHERE category NOT IN ('111', '222') ORDER BY category"
    );

    if (!categories || categories.length === 0) {
      await ctx.reply("لاتوجد معلومات متاحة.");
      return;
    }

    const categoryNames = categories.map((c) => c.category);

    // Create inline keyboard buttons
    const keyboard = [];
    const fighButton = categoryNames.find((name) => name === "الفقه");
    if (fighButton) {
      keyboard.push([Markup.button.callback("⚖️ الفقه", "category_الفقه")]);
    }

    const otherCategories = categoryNames.filter((name) => name !== "الفقه");
    for (let i = 0; i < otherCategories.length; i += 2) {
      const row = [];
      row.push(
        Markup.button.callback(
          `📚 ${truncateText(otherCategories[i])}`,
          `category_${otherCategories[i]}`
        )
      );
      if (otherCategories[i + 1]) {
        row.push(
          Markup.button.callback(
            `📚 ${truncateText(otherCategories[i + 1])}`,
            `category_${otherCategories[i + 1]}`
          )
        );
      }
      keyboard.push(row);
    }
    keyboard.push([
      Markup.button.callback("❌ إخفاء الفئات", "hide_categories"),
    ]);

    const text = `<b>📚 قائمة الأقسام :</b>
🔷 یرجی اختیار قسم بالضغظ علی اسم الأقسام التاليّة حتی یعرض  الکتب.
🔷 و للحصول علی ملف PDF اضغط علی الأمر الشبیه بـ :/book_10`;

    await ctx.reply(text, {
      reply_to_message_id: ctx.message.message_id,
      reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
      parse_mode: "HTML",
    });
  } catch (error) {
    console.error("Error in showCategories:", error);
    await ctx.reply("An error occurred while fetching categories.");
  } finally {
    await db.close();
  }
}

async function handleListBooks(ctx, { page = 1, filter_category = null } = {}) {
  const db = await openDb();
  try {
    // Get user's selected language
    const user = await db.get(
      "SELECT selected_language FROM users WHERE user_id = ?",
      [ctx.from.id]
    );
    const userLanguage = user ? user.selected_language : "All";

    let query = `
            SELECT id, book_name, author_name, 
                   (LENGTH(file_path) - LENGTH(REPLACE(file_path, '|', '')) + 1) AS parts_count,
                   zip_file_path
            FROM usol_books
        `;
    const params = [];
    const whereClauses = [];

    if (filter_category) {
      whereClauses.push("category = ?");
      params.push(filter_category);
    }
    if (userLanguage && userLanguage !== "All") {
      whereClauses.push("language = ?");
      params.push(userLanguage);
    }

    if (whereClauses.length > 0) {
      query += " WHERE " + whereClauses.join(" AND ");
    }

    const books_list = await db.all(query, params);
    const sorted_books = books_list.sort((a, b) =>
      a.book_name.localeCompare(b.book_name)
    );

    const items_per_page = 20;
    const start_index = (page - 1) * items_per_page;
    const end_index = start_index + items_per_page;
    const current_page_items = sorted_books.slice(start_index, end_index);

    const category_name = filter_category ? filter_category : "جميع الأقسام";
    let books_text = `📊 مجموع الكتب لقسم <b>${category_name}</b> : ${books_list.length}\n\n`;

    current_page_items.forEach((book) => {
      books_text += `📘 <b>اسم الكتاب : ${book.book_name}</b>\n`;
      books_text += `✍️ <b>الكاتب :</b> ${book.author_name}\n`;
      books_text += `📑 <b>الاجزا :</b> ${book.parts_count}\n`;
      books_text += `🔗 <b>للتحميل : /book_${book.id}</b>\n`;
      if (book.parts_count >= 10) {
        const zip_status_emoji = book.zip_file_path ? "✅" : "❌";
        books_text += `🗜️ <b>الملف المضغوط : /zip_${book.id} ${zip_status_emoji}</b>\n`;
      }
      books_text += "\n";
    });

    const total_pages = Math.ceil(sorted_books.length / items_per_page);
    const keyboard = [];
    if (total_pages > 1) {
      const row = [];
      for (let i = 1; i <= total_pages; i++) {
        row.push(
          Markup.button.callback(
            i === page ? `✔️ ${i}` : `${i}`,
            `page_${filter_category}_${i}`
          )
        );
      }
      keyboard.push(row);
    }

    if (ctx.callbackQuery) {
      await ctx.editMessageText(books_text, {
        reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
        parse_mode: "HTML",
      });
      await ctx.answerCbQuery();
    } else {
      await ctx.reply(books_text, {
        reply_markup: Markup.inlineKeyboard(keyboard).reply_markup,
        parse_mode: "HTML",
      });
    }
  } catch (error) {
    console.error("Error in handleListBooks:", error);
    await ctx.reply("An error occurred while fetching the book list.");
  } finally {
    await db.close();
  }
}

async function pdfCallback(ctx) {
  const match = ctx.message.text.match(/\/book_(\d+)/);
  if (!match) return;

  const bookId = match[1];
  const db = await openDb();
  try {
    const book = await db.get("SELECT file_path FROM usol_books WHERE id = ?", [
      bookId,
    ]);
    if (book && book.file_path) {
      const filePaths = book.file_path.split("|");
      let filesSent = 0;
      for (const filePath of filePaths) {
        try {
          await ctx.replyWithDocument(filePath);
          filesSent++;
        } catch (error) {
          console.error(`Failed to send file: ${filePath}`, error);
        }
      }
      if (filesSent > 0) {
        await updateRequestCount(bookId);
        await ctx.reply(`📥 تم إرسال ${filesSent} ملف.`);
      } else {
        await ctx.reply("❌ حدثت مشكلة في إرسال الملفات.");
      }
    } else {
      await ctx.reply("❌ لم يتم العثور على الكتاب.");
    }
  } catch (error) {
    console.error("Error in pdfCallback:", error);
    await ctx.reply("An error occurred while fetching the book.");
  } finally {
    await db.close();
  }
}

async function zipCallback(ctx) {
  const match = ctx.message.text.match(/\/zip_(\d+)/);
  if (!match) return;

  const bookId = match[1];
  const db = await openDb();
  try {
    const book = await db.get(
      "SELECT zip_file_path FROM usol_books WHERE id = ?",
      [bookId]
    );
    if (book && book.zip_file_path) {
      try {
        await ctx.replyWithDocument(book.zip_file_path);
      } catch (error) {
        console.error(`Failed to send zip file for book ${bookId}`, error);
        await ctx.reply("❌ حدثت مشکله في ارسال الملف المضغوط.");
      }
    } else {
      await ctx.reply("عذرًا، لم نتمكن من العثور على الملف المضغوط 📁❌.");
    }
  } catch (error) {
    console.error("Error in zipCallback:", error);
    await ctx.reply("An error occurred while fetching the zip file.");
  } finally {
    await db.close();
  }
}

async function updateRequestCount(bookId) {
  const db = await openDb();
  try {
    await db.run(
      "UPDATE usol_books SET request_count = request_count + 1, total_requests = total_requests + 1 WHERE id = ?",
      [bookId]
    );
  } catch (error) {
    console.error(`Failed to update request count for book ${bookId}`, error);
  } finally {
    await db.close();
  }
}

module.exports = {
  showCategories,
  handleListBooks,
  pdfCallback,
  zipCallback,
};
