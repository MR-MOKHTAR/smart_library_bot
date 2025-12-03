const { Telegraf, Markup, session } = require("telegraf");
const dbManager = require("./db_manager");
const listBooks = require("./list_books");
const searchEngine = require("./search_engine");
const favorites = require("./favorites");
const rating = require("./rating");
const recommendations = require("./recommendations");
const { handleError } = require("./error_handler");
const logger = require("./logger");
const config = require("./config");
require("dotenv").config();

// Basic bot configuration
const bot = new Telegraf(config.bot.token);

// Helper function to escape HTML entities
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Use session middleware
bot.use(session());

// Global error handler
bot.catch((error, ctx) => {
  handleError(error, ctx);
});

// Start command handler
bot.start(async (ctx) => {
  try {
    const user = ctx.from;
    const rawName = user.first_name || user.username;
    const name = escapeHtml(rawName);
    const userLanguage = user.language_code;

    // Clear any previous session data
    ctx.session = {};

    // Define the keyboard
    const keyboard = Markup.keyboard([
      ["📖 المکتبة الحوزويّة الذکيّة"],
      ["💖 المفضلة", "🔍 سجل البحث"],
      ["📚 الكتب الأخيرة", "🔥 الأكثر طلباً"],
      ["⭐ الأعلى تقييماً", "✨ موصى بها"],
    ]).resize();

    // Welcome message based on user language
    let welcomeMessage;
    if (userLanguage === "fa") {
      welcomeMessage = `‏<b>${name} عزیز!</b> به ربات <b>المکتبة الذکیّة</b> خوش آمدید!`;
    } else {
      welcomeMessage = `مرحبا <b>${name}</b> في بوت <b>المکتبة الذکيّة</b>!`;
    }

    await ctx.reply(welcomeMessage, {
      reply_to_message_id: ctx.message.message_id,
      reply_markup: keyboard.reply_markup,
      parse_mode: "HTML",
    });

    // Add user to the database
    await dbManager.addUser(user.id, name, userLanguage);
    logger.logInfo("User started bot", { userId: user.id, name });
  } catch (error) {
    logger.logError("Error in start command", error);
    await ctx.reply("❌ حدث خطأ. يرجى المحاولة مرة أخرى.");
  }
});

// Message handlers for main menu buttons
bot.hears("📖 المکتبة الحوزويّة الذکيّة", (ctx) =>
  listBooks.showCategories(ctx)
);

bot.hears("💖 المفضلة", (ctx) => favorites.showFavoritesList(ctx));

bot.hears("🔍 سجل البحث", (ctx) => searchEngine.showSearchHistory(ctx));

bot.hears("📚 الكتب الأخيرة", (ctx) => searchEngine.showRecentBooks(ctx));

bot.hears("🔥 الأكثر طلباً", (ctx) => recommendations.showPopularBooks(ctx));

bot.hears("⭐ الأعلى تقييماً", (ctx) => recommendations.showTopRated(ctx));

bot.hears("✨ موصى بها", (ctx) => recommendations.showRecommendations(ctx));

// General message handler for text messages
bot.on("text", async (ctx) => {
  try {
    // Handle book and zip commands
    if (ctx.message.text.startsWith("/book_")) {
      await listBooks.pdfCallback(ctx);
      return;
    }
    if (ctx.message.text.startsWith("/zip_")) {
      await listBooks.zipCallback(ctx);
      return;
    }

    // In the Python code, this is where different states are checked.
    // For now, we'll default to the search engine.
    // We'll add more sophisticated state handling later.
    if (ctx.session.searching_author) {
      // await listBooks.handleAuthorsSearch(ctx);
      return;
    }
    if (ctx.session.addition_step === "book") {
      // await dbManager.handleBooksStep(ctx);
      return;
    }

    // Default action is to search
    await searchEngine.handleSearchEngine(ctx);
  } catch (error) {
    logger.logError("Error handling text message", error, {
      userId: ctx.from.id,
      text: ctx.message.text,
    });
    await ctx.reply("❌ حدث خطأ. يرجى المحاولة مرة أخرى.");
  }
});

// Callback query handlers

// Category selection
bot.action(/category_(.+)/, (ctx) => {
  const category = ctx.match[1];
  listBooks.handleListBooks(ctx, { filter_category: category });
});

// Pagination
bot.action(/page_(.+)_(\d+)/, (ctx) => {
  const category = ctx.match[1];
  const page = parseInt(ctx.match[2], 10);
  listBooks.handleListBooks(ctx, { filter_category: category, page: page });
});

// Hide categories button
bot.action("hide_categories", (ctx) => {
  ctx.editMessageText("📭 حله بکارت برس", { parse_mode: "HTML" });
  ctx.answerCbQuery();
});

// Similar result selection
bot.action(/similar_result_(\d+)/, (ctx) => {
  const bookId = ctx.match[1];
  searchEngine.handleSearchEngine(ctx, { book_id: bookId });
});

// Favorites toggle
bot.action(/fav_toggle_(\d+)/, async (ctx) => {
  try {
    const bookId = parseInt(ctx.match[1]);
    await favorites.handleToggleFavorite(ctx, bookId);
  } catch (error) {
    logger.logError("Error toggling favorite", error);
    await ctx.answerCbQuery("❌ حدث خطأ");
  }
});

// Show rating interface
bot.action(/show_rate_(\d+)/, async (ctx) => {
  try {
    const bookId = parseInt(ctx.match[1]);
    await rating.showRatingInterface(ctx, bookId);
    await ctx.answerCbQuery();
  } catch (error) {
    logger.logError("Error showing rating interface", error);
    await ctx.answerCbQuery("❌ حدث خطأ");
  }
});

// Handle rating callback
bot.action(/rate_(\d+)_(\d)/, async (ctx) => {
  try {
    const bookId = parseInt(ctx.match[1]);
    const ratingValue = parseInt(ctx.match[2]);
    await rating.handleRatingCallback(ctx, bookId, ratingValue);
  } catch (error) {
    logger.logError("Error handling rating", error);
    await ctx.answerCbQuery("❌ حدث خطأ");
  }
});

// Initialize the database and start the bot
dbManager
  .createDatabase()
  .then(() => {
    bot.launch();
    logger.logInfo("Bot started successfully");
    console.log("✅ Bot started successfully.");
  })
  .catch((err) => {
    logger.logError("Failed to initialize database", err);
    console.error("❌ Failed to initialize database:", err);
    process.exit(1);
  });

// Graceful stop
process.once("SIGINT", () => {
  logger.logInfo("Bot stopping (SIGINT)");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  logger.logInfo("Bot stopping (SIGTERM)");
  bot.stop("SIGTERM");
});
