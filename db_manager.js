const sqlite3 = require("sqlite3").verbose();
const { open } = require("sqlite");
const config = require("./config");
const logger = require("./logger");

// Database connection pool (simple implementation)
let dbPool = [];
const poolSize = config.database.pool.max;

/**
 * Get database connection from pool or create new one
 */
async function openDb() {
  // Simple pool: reuse if available, otherwise create new
  if (dbPool.length > 0) {
    return dbPool.pop();
  }

  try {
    const db = await open({
      filename: config.database.filename,
      driver: sqlite3.Database,
    });

    // Enable foreign keys
    await db.exec("PRAGMA foreign_keys = ON");

    // Enable WAL mode for better concurrency
    await db.exec("PRAGMA journal_mode = WAL");

    return db;
  } catch (error) {
    logger.logError("Failed to open database connection", error);
    throw error;
  }
}

/**
 * Return database connection to pool
 */
async function closeDb(db) {
  if (dbPool.length < poolSize) {
    dbPool.push(db);
  } else {
    await db.close();
  }
}

/**
 * Create database tables and indexes
 */
async function createDatabase() {
  const db = await openDb();
  try {
    // Users table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        name TEXT,
        points INTEGER DEFAULT 0,
        coins INTEGER DEFAULT 0,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        selected_language TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Books table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS usol_books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_name TEXT NOT NULL,
        author_name TEXT NOT NULL,
        file_path TEXT,
        emergency_file_path TEXT,
        word_file_path TEXT,
        zip_file_path TEXT,
        category TEXT,
        request_count INTEGER DEFAULT 0,
        total_requests INTEGER DEFAULT 0,
        language TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Favorites table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES usol_books (id) ON DELETE CASCADE,
        UNIQUE(user_id, book_id)
      );
    `);

    // Search history table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS search_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        search_query TEXT NOT NULL,
        results_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
      );
    `);

    // Book ratings table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS book_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        review TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES usol_books (id) ON DELETE CASCADE,
        UNIQUE(user_id, book_id)
      );
    `);

    // Recent access table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS recent_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        book_id INTEGER NOT NULL,
        accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
        FOREIGN KEY (book_id) REFERENCES usol_books (id) ON DELETE CASCADE
      );
    `);

    // Legacy tables (keeping for compatibility)
    await db.exec(`
      CREATE TABLE IF NOT EXISTS data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        question_id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT,
        correct_answer TEXT,
        wrong_answers TEXT,
        author_name TEXT,
        status TEXT DEFAULT 'pending'
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS asked_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_id INTEGER,
        user_id INTEGER,
        FOREIGN KEY (question_id) REFERENCES questions (question_id),
        FOREIGN KEY (user_id) REFERENCES users (user_id)
      );
    `);

    logger.logInfo("Database tables created successfully");

    // Create indexes for better performance
    await createIndexes(db);

    logger.logInfo("Database initialization completed");
  } catch (error) {
    logger.logError("Failed to create database", error);
    throw error;
  } finally {
    await closeDb(db);
  }
}

/**
 * Create database indexes
 */
async function createIndexes(db) {
  try {
    // Books indexes
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_book_name ON usol_books(book_name)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_author_name ON usol_books(author_name)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_category ON usol_books(category)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_request_count ON usol_books(request_count DESC)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_language ON usol_books(language)"
    );

    // Favorites indexes
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_favorites_book ON user_favorites(book_id)"
    );

    // Search history indexes
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_search_user ON search_history(user_id)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_search_time ON search_history(created_at DESC)"
    );

    // Ratings indexes
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_ratings_book ON book_ratings(book_id)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_ratings_user ON book_ratings(user_id)"
    );

    // Recent access indexes
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_access(user_id)"
    );
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_recent_time ON recent_access(accessed_at DESC)"
    );

    logger.logInfo("Database indexes created successfully");
  } catch (error) {
    logger.logError("Failed to create indexes", error);
    throw error;
  }
}

/**
 * Add or update a user
 */
async function addUser(userId, name, languageCode) {
  const selectedLanguage = languageCode === "fa" ? "All" : "arabic";
  const db = await openDb();
  try {
    await db.run(
      `INSERT INTO users (user_id, name, selected_language, points, coins, last_activity) 
       VALUES (?, ?, ?, 0, 0, CURRENT_TIMESTAMP) 
       ON CONFLICT(user_id) DO UPDATE SET 
         name = excluded.name,
         selected_language = excluded.selected_language,
         last_activity = CURRENT_TIMESTAMP`,
      [userId, name, selectedLanguage]
    );
    logger.logInfo(`User ${userId} (${name}) added/updated`);
  } catch (error) {
    logger.logError("Failed to add user", error, { userId, name });
    throw error;
  } finally {
    await closeDb(db);
  }
}

/**
 * Update book request count
 */
async function incrementBookRequestCount(bookId) {
  const db = await openDb();
  try {
    await db.run(
      `UPDATE usol_books 
       SET request_count = request_count + 1, 
           total_requests = total_requests + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [bookId]
    );
  } catch (error) {
    logger.logError("Failed to increment book request count", error, {
      bookId,
    });
  } finally {
    await closeDb(db);
  }
}

/**
 * Record user book access
 */
async function recordBookAccess(userId, bookId) {
  const db = await openDb();
  try {
    await db.run(
      `INSERT INTO recent_access (user_id, book_id, accessed_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [userId, bookId]
    );

    // Keep only last 50 records per user
    await db.run(
      `DELETE FROM recent_access 
       WHERE user_id = ? AND id NOT IN (
         SELECT id FROM recent_access 
         WHERE user_id = ? 
         ORDER BY accessed_at DESC 
         LIMIT 50
       )`,
      [userId, userId]
    );
  } catch (error) {
    logger.logError("Failed to record book access", error, { userId, bookId });
  } finally {
    await closeDb(db);
  }
}

/**
 * Save search query to history
 */
async function saveSearchHistory(userId, searchQuery, resultsCount) {
  const db = await openDb();
  try {
    await db.run(
      `INSERT INTO search_history (user_id, search_query, results_count) 
       VALUES (?, ?, ?)`,
      [userId, searchQuery, resultsCount]
    );

    // Keep only last 100 searches per user
    await db.run(
      `DELETE FROM search_history 
       WHERE user_id = ? AND id NOT IN (
         SELECT id FROM search_history 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 100
       )`,
      [userId, userId]
    );
  } catch (error) {
    logger.logError("Failed to save search history", error, {
      userId,
      searchQuery,
    });
  } finally {
    await closeDb(db);
  }
}

module.exports = {
  openDb,
  closeDb,
  createDatabase,
  createIndexes,
  addUser,
  incrementBookRequestCount,
  recordBookAccess,
  saveSearchHistory,
};
