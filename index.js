const { Telegraf, Markup, session } = require("telegraf");
const dbManager = require("./db_manager");
const listBooks = require("./list_books");
const searchEngine = require("./search_engine");
require("dotenv").config();

// Basic bot configuration
const TOKEN = process.env.BOT_TOKEN;
const bot = new Telegraf(TOKEN);

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

// Start command handler
bot.start(async (ctx) => {
  const user = ctx.from;
  const rawName = user.first_name || user.username;
  const name = escapeHtml(rawName); // Escape HTML in the name
  const userLanguage = user.language_code;

  // Clear any previous session data
  ctx.session = {};

  // Define the keyboard
  const keyboard = Markup.keyboard([
    ["📖 المکتبة الحوزويّة الذکيّة"],
    ["📺 قنوات الدروس", "💬 الاسئلة و الأجوبة"],
  ]).resize();

  // Welcome message based on user language
  let welcomeMessage;
  if (userLanguage === "fa") {
    welcomeMessage = `\u200F<b>${name} عزیز!</b> به ربات <b>المکتبة الذکیّة</b> خوش آمدید!`;
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
});

// Message handlers for main menu buttons
bot.hears("📖 المکتبة الحوزويّة الذکيّة", (ctx) =>
  listBooks.showCategories(ctx)
);

// General message handler for text messages
bot.on("text", async (ctx) => {
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
});

// Callback query handlers
bot.action(/category_(.+)/, (ctx) => {
  const category = ctx.match[1];
  listBooks.handleListBooks(ctx, { filter_category: category });
});

bot.action(/page_(.+)_(\d+)/, (ctx) => {
  const category = ctx.match[1];
  const page = parseInt(ctx.match[2], 10);
  listBooks.handleListBooks(ctx, { filter_category: category, page: page });
});

bot.action("hide_categories", (ctx) => {
  ctx.editMessageText("📭 حله بکارت برس", { parse_mode: "HTML" });
  ctx.answerCbQuery();
});

bot.action(/similar_result_(\d+)/, (ctx) => {
  const bookId = ctx.match[1];
  searchEngine.handleSearchEngine(ctx, { book_id: bookId });
});

// Initialize the database and start the bot
dbManager
  .createDatabase()
  .then(() => {
    bot.launch();
    console.log("Bot started successfully.");
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
  });

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
