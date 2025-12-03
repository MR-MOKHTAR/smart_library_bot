const FuzzySearch = require("fuzzy-search");
const { openDb } = require("./db_manager");
const config = require("./config");
const logger = require("./logger");
const searchCache = require("./search_cache");

/**
 * Convert Arabic/Persian numbers to English
 */
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

/**
 * Normalize Persian/Arabic characters for better matching
 */
function normalizePersianArabicChars(text) {
  return text
    .replace(/ک/g, "ك")
    .replace(/ی/g, "ي")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/إ|أ|آ/g, "ا")
    .replace(/ة/g, "ه")
    .trim();
}

/**
 * Calculate similarity score between two strings
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0-1)
 */
function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  // Exact match
  if (s1 === s2) return 1.0;

  // Starts with
  if (s1.startsWith(s2) || s2.startsWith(s1)) return 0.9;

  // Contains
  if (s1.includes(s2) || s2.includes(s1)) return 0.7;

  // Levenshtein distance for fuzzy matching
  const distance = levenshteinDistance(s1, s2);
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - distance / maxLen;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  const dp = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
      }
    }
  }

  return dp[m][n];
}

/**
 * Score a book against search query with weighted fields
 * @param {object} book - Book object
 * @param {string} query - Search query
 * @returns {number} Total score
 */
function scoreBook(book, query) {
  const normalizedQuery = normalizePersianArabicChars(query.toLowerCase());
  const normalizedBookName = normalizePersianArabicChars(
    book.book_name.toLowerCase()
  );
  const normalizedAuthorName = normalizePersianArabicChars(
    book.author_name.toLowerCase()
  );

  // Calculate similarity scores
  const bookNameScore = calculateSimilarity(
    normalizedBookName,
    normalizedQuery
  );
  const authorNameScore = calculateSimilarity(
    normalizedAuthorName,
    normalizedQuery
  );

  // Apply weights from config
  const totalScore =
    bookNameScore * config.search.weights.bookName +
    authorNameScore * config.search.weights.authorName;

  // Boost score if book is popular
  const popularityBoost = Math.min(book.request_count / 100, 0.1); // Max 10% boost

  return totalScore + popularityBoost;
}

/**
 * Advanced search with multiple strategies
 * @param {string} query - Search query
 * @param {object} options - Search options
 * @returns {Promise<Array>} Search results
 */
async function advancedSearch(query, options = {}) {
  const {
    category = null,
    author = null,
    sortBy = "relevance", // relevance, popularity, name
    limit = config.search.maxSimilarResults,
  } = options;

  // Normalize query
  const normalizedQuery = convertToEnglishDigits(
    normalizePersianArabicChars(query)
  );

  // Check cache first
  const cacheKey = searchCache.generateSearchKey(normalizedQuery, options);
  const cachedResult = searchCache.get(cacheKey);
  if (cachedResult) {
    logger.logDebug("Returning cached search results", {
      query: normalizedQuery,
    });
    return cachedResult;
  }

  const db = await openDb();
  try {
    // Build query
    let sqlQuery = `
      SELECT id, file_path, emergency_file_path, book_name, author_name, 
             category, request_count, total_requests
      FROM usol_books
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      sqlQuery += " AND category = ?";
      params.push(category);
    }

    if (author) {
      sqlQuery += " AND author_name LIKE ?";
      params.push(`%${author}%`);
    }

    const allBooks = await db.all(sqlQuery, params);

    if (!allBooks || allBooks.length === 0) {
      return [];
    }

    // If query is purely numeric, try exact ID match first
    if (/^\d+$/.test(normalizedQuery)) {
      const exactMatch = allBooks.find(
        (book) => book.id === parseInt(normalizedQuery)
      );
      if (exactMatch) {
        const result = [exactMatch];
        searchCache.set(cacheKey, result);
        return result;
      }
    }

    // Score all books
    const scoredBooks = allBooks.map((book) => ({
      ...book,
      score: scoreBook(book, normalizedQuery),
    }));

    // Filter by minimum threshold
    const threshold = config.search.fuzzyThreshold;
    let filteredBooks = scoredBooks.filter((book) => book.score >= threshold);

    // Sort results
    if (sortBy === "popularity") {
      filteredBooks.sort((a, b) => b.request_count - a.request_count);
    } else if (sortBy === "name") {
      filteredBooks.sort((a, b) => a.book_name.localeCompare(b.book_name));
    } else {
      // Sort by relevance (score)
      filteredBooks.sort((a, b) => b.score - a.score);
    }

    // Limit results
    const results = filteredBooks.slice(0, limit);

    // Cache results
    searchCache.set(cacheKey, results);

    logger.logInfo("Search completed", {
      query: normalizedQuery,
      resultsCount: results.length,
      totalBooks: allBooks.length,
    });

    return results;
  } catch (error) {
    logger.logError("Error in advanced search", error, {
      query: normalizedQuery,
    });
    throw error;
  } finally {
    await db.close();
  }
}

/**
 * Get similar books based on a book
 * @param {number} bookId - Book ID
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>} Similar books
 */
async function getSimilarBooks(bookId, limit = 5) {
  const db = await openDb();
  try {
    // Get the source book
    const sourceBook = await db.get("SELECT * FROM usol_books WHERE id = ?", [
      bookId,
    ]);

    if (!sourceBook) {
      return [];
    }

    // Find books by same author or same category
    const similarBooks = await db.all(
      `SELECT id, book_name, author_name, category, request_count
       FROM usol_books
       WHERE id != ? AND (author_name = ? OR category = ?)
       ORDER BY request_count DESC
       LIMIT ?`,
      [bookId, sourceBook.author_name, sourceBook.category, limit]
    );

    return similarBooks;
  } catch (error) {
    logger.logError("Error getting similar books", error, { bookId });
    return [];
  } finally {
    await db.close();
  }
}

/**
 * Get popular books
 * @param {number} limit - Maximum results
 * @param {string} category - Optional category filter
 * @returns {Promise<Array>} Popular books
 */
async function getPopularBooks(limit = 10, category = null) {
  const db = await openDb();
  try {
    let query = `
      SELECT id, book_name, author_name, category, request_count, total_requests
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
    logger.logError("Error getting popular books", error);
    return [];
  } finally {
    await db.close();
  }
}

/**
 * Search books by multiple criteria
 * @param {object} criteria - Search criteria
 * @returns {Promise<Array>} Matching books
 */
async function multiFieldSearch(criteria) {
  const { bookName, authorName, category, minParts, maxParts } = criteria;

  const db = await openDb();
  try {
    let query = "SELECT * FROM usol_books WHERE 1=1";
    const params = [];

    if (bookName) {
      query += " AND book_name LIKE ?";
      params.push(`%${normalizePersianArabicChars(bookName)}%`);
    }

    if (authorName) {
      query += " AND author_name LIKE ?";
      params.push(`%${normalizePersianArabicChars(authorName)}%`);
    }

    if (category) {
      query += " AND category = ?";
      params.push(category);
    }

    const books = await db.all(query, params);

    // Filter by parts count if specified
    let filteredBooks = books;
    if (minParts || maxParts) {
      filteredBooks = books.filter((book) => {
        const partsCount = book.file_path
          ? book.file_path.split("|").length
          : 0;
        if (minParts && partsCount < minParts) return false;
        if (maxParts && partsCount > maxParts) return false;
        return true;
      });
    }

    return filteredBooks;
  } catch (error) {
    logger.logError("Error in multi-field search", error, { criteria });
    return [];
  } finally {
    await db.close();
  }
}

module.exports = {
  advancedSearch,
  getSimilarBooks,
  getPopularBooks,
  multiFieldSearch,
  convertToEnglishDigits,
  normalizePersianArabicChars,
  scoreBook,
};
