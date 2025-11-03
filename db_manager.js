const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

// Function to open the database connection
async function openDb() {
    return open({
        filename: './light_effects.db',
        driver: sqlite3.Database
    });
}

// Function to create database tables if they don't exist
async function createDatabase() {
    const db = await openDb();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            name TEXT,
            points INTEGER DEFAULT 0,
            coins INTEGER DEFAULT 0,
            last_activity TIMESTAMP,
            selected_language TEXT
        );
    `);
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
    await db.exec(`
        CREATE TABLE IF NOT EXISTS usol_books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_name TEXT,
            author_name TEXT,
            file_path TEXT,
            emergency_file_path TEXT,
            word_file_path TEXT,
            zip_file_path TEXT,
            category TEXT,
            request_count INTEGER DEFAULT 0,
            total_requests INTEGER DEFAULT 0,
            language TEXT
        );
    `);
    console.log('Database and tables checked/created successfully.');
    await db.close();
}

// Function to add or update a user
async function addUser(userId, name, languageCode) {
    const selectedLanguage = languageCode === 'fa' ? 'All' : 'arabic';
    const db = await openDb();
    await db.run(
        `
        INSERT INTO users (user_id, name, selected_language, points, coins) 
        VALUES (?, ?, ?, 0, 0) 
        ON CONFLICT(user_id) DO UPDATE SET 
            name = excluded.name,
            selected_language = excluded.selected_language
        `,
        [userId, name, selectedLanguage]
    );
    console.log(`User ${userId} (${name}) was added or updated in the database.`);
    await db.close();
}

module.exports = {
    openDb,
    createDatabase,
    addUser
};
