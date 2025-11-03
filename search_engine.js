const { Markup } = require("telegraf");
const { openDb } = require("./db_manager");
const FuzzySearch = require("fuzzy-search");

// Helper function to convert Arabic/Persian numbers to English
function convertToEnglishDigits(inputStr) {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  const englishDigits = "0123456789";

  let outputStr = "";
  for (let i = 0; i < inputStr.length; i++) {
    let char = inputStr[i];
    let index = arabicDigits.indexOf(char);
    if (index !== -1) {
      outputStr += englishDigits[index];
    } else {
      index = persianDigits.indexOf(char);
      if (index !== -1) {
        outputStr += englishDigits[index];
      } else {
        outputStr += char;
      }
    }
  }
  return outputStr;
}

// Helper function to normalize Persian/Arabic characters
function normalizePersianArabicChars(text) {
  return text.replace(/ک/g, "ك").replace(/ی/g, "ي");
}

// Helper function to validate user input
async function validateUserInput(ctx, userInput) {
  if (/[A-Za-z]/.test(userInput)) {
    await ctx.reply(
      "❌ <b>خطأ</b>: يُرجى استخدام الأحرف الفارسية أو العربية فقط.",
      { parse_mode: "HTML" }
    );
    return false;
  }
  if (userInput.length > 37) {
    await ctx.reply(
      "❌ <b>خطأ</b>: النص المُدخل أطول من الحدّ المسموح به<b>(الحد الأقصى 40 حرفًا)</b>.",
      { parse_mode: "HTML" }
    );
    return false;
  }
  // Simple emoji check
  if (/\p{Emoji}/u.test(userInput)) {
    await ctx.reply(
      "❌ <b>خطأ</b>: النص المُدخل يحتوي على ايموجي، يُرجى إدخال نصوص فقط.",
      { parse_mode: "HTML" }
    );
    return false;
  }
  if (ctx.message.photo || ctx.message.video || ctx.message.document) {
    await ctx.reply(
      "❌ <b>خطأ</b>: لا يُسمح بإرسال الصور أو الفيديو أو الملفات في هذا البحث.",
      { parse_mode: "HTML" }
    );
    return false;
  }
  return true;
}

async function handleSearchEngine(ctx, { book_id = null } = {}) {
  const db = await openDb();
  try {
    let searchQuery;
    let source = "message";

    if (book_id) {
      searchQuery = book_id;
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

    let results;
    if (/^\d+$/.test(searchQuery)) {
      results = await db.all(
        "SELECT id, file_path, emergency_file_path, book_name, author_name, request_count FROM usol_books WHERE id = ? OR book_name LIKE ?",
        [searchQuery, `%${searchQuery}%`]
      );
    } else {
      results = await db.all(
        "SELECT id, file_path, emergency_file_path, book_name, author_name, request_count FROM usol_books WHERE book_name LIKE ?",
        [`%${searchQuery}%`]
      );
    }

    if (results && results.length > 0) {
      const searcher = new FuzzySearch(results, ["book_name"], {
        caseSensitive: false,
      });
      const bestResult = searcher.search(searchQuery)[0];

      const searchResultText = ` 
          🔍 <b>نتیجة البحث لـ : ${searchQuery}</b>
          📚 <b>اسم الكتاب : </b> ${bestResult.book_name}
          ✍️ <b>اسم المؤلف : </b> ${bestResult.author_name}
          📄 <b>عدد الأجزاء : </b> ${bestResult.file_path.split("|").length}
          📊 <b>عدد مرات الطلب : </b> ${bestResult.request_count}
          🆔 <i>${bestResult.id}</i>
            `;

      if (source === "message") {
        await ctx.reply(searchResultText, { parse_mode: "HTML" });
      } else {
        await ctx.reply(searchResultText, { parse_mode: "HTML" });
      }

      // Send files
      if (bestResult.file_path) {
        const filePaths = bestResult.file_path.split("|");
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
          await db.run(
            "UPDATE usol_books SET request_count = request_count + 1, total_requests = total_requests + 1 WHERE id = ?",
            [bestResult.id]
          );
          await ctx.reply(`📥 تم إرسال ${filesSent} ملف.`);
        } else {
          await ctx.reply("❌ حدثت مشكلة في إرسال الملفات.");
        }
      } else {
        await ctx.reply("❌ لم يتم العثور على ملف للكتاب.");
      }
    } else {
      const all_books = await db.all(
        "SELECT id, book_name, author_name FROM usol_books"
      );
      const searcher = new FuzzySearch(
        all_books,
        ["book_name", "author_name"],
        {
          caseSensitive: false,
        }
      );
      const similar_books = searcher.search(searchQuery).slice(0, 10);

      if (similar_books.length > 0) {
        const keyboard = Markup.inlineKeyboard(
          similar_books.map((book) => [
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
      } else {
        await ctx.reply(`❌ لم یتم العثور علی نتیجة ل (${searchQuery}) .`);
      }
    }
  } catch (error) {
    console.error("Error in handleSearchEngine:", error);
    await ctx.reply("An error occurred during the search.");
  } finally {
    await db.close();
  }
}

module.exports = {
  handleSearchEngine,
};
