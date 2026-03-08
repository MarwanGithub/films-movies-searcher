"""
Lightweight SQLite database for watchlist persistence.
Works locally, on PythonAnywhere, and any host with a persistent filesystem.

Each user is identified by a UUID stored in their browser's localStorage and
sent as the X-User-ID request header. No login required.
"""
import os
import json
import sqlite3
import uuid
from datetime import datetime
from werkzeug.security import generate_password_hash, check_password_hash

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
DB_PATH = os.environ.get('DATABASE_PATH', os.path.join(DB_DIR, 'streamfinder.db'))

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# Sentinel used for migrating legacy rows that had no user_id
LEGACY_USER_ID = 'legacy'


def get_db():
    """Get a database connection (creates/migrates tables on first use)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    _init_tables(conn)
    return conn


def _init_tables(conn):
    conn.executescript(f'''
        CREATE TABLE IF NOT EXISTS watchlist (
            id           INTEGER NOT NULL,
            media_type   TEXT    NOT NULL,
            user_id      TEXT    NOT NULL DEFAULT '{LEGACY_USER_ID}',
            title        TEXT,
            poster_path  TEXT,
            vote_average REAL DEFAULT 0,
            release_date TEXT,
            added_at     TEXT,
            PRIMARY KEY (id, media_type, user_id)
        );
        CREATE TABLE IF NOT EXISTS users (
            id            TEXT PRIMARY KEY,
            email         TEXT UNIQUE NOT NULL,
            username      TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TEXT
        );
    ''')



# ---------------------------------------------------------------------------
# Watchlist helpers
# ---------------------------------------------------------------------------

def load_watchlist(user_id: str):
    """Return the full watchlist for a given user as a list of dicts."""
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC',
            (user_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def add_to_watchlist(item, user_id: str):
    """Insert a title for a user if it doesn't already exist. Return the full watchlist."""
    conn = get_db()
    try:
        conn.execute('''
            INSERT OR IGNORE INTO watchlist
                (id, media_type, user_id, title, poster_path, vote_average, release_date, added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            item['id'],
            item['media_type'],
            user_id,
            item.get('title', ''),
            item.get('poster_path', ''),
            item.get('vote_average', 0),
            item.get('release_date', ''),
            datetime.now().isoformat(),
        ))
        conn.commit()
        return load_watchlist_from(conn, user_id)
    finally:
        conn.close()


def remove_from_watchlist(media_type, title_id, user_id: str):
    """Delete a title for a user. Return the updated watchlist."""
    conn = get_db()
    try:
        conn.execute(
            'DELETE FROM watchlist WHERE id = ? AND media_type = ? AND user_id = ?',
            (title_id, media_type, user_id),
        )
        conn.commit()
        return load_watchlist_from(conn, user_id)
    finally:
        conn.close()


def load_watchlist_from(conn, user_id: str):
    """Load watchlist using an existing connection (avoids re-opening)."""
    rows = conn.execute(
        'SELECT * FROM watchlist WHERE user_id = ? ORDER BY added_at DESC',
        (user_id,)
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Migration: import existing JSON watchlist into SQLite (run once)
# ---------------------------------------------------------------------------

def migrate_json_watchlist():
    """If a watchlist.json exists, import it into SQLite under LEGACY_USER_ID and rename the file."""
    json_path = os.path.join(DB_DIR, 'watchlist.json')
    if not os.path.exists(json_path):
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        items = json.load(f)

    if not items:
        return

    conn = get_db()
    try:
        for item in items:
            conn.execute('''
                INSERT OR IGNORE INTO watchlist
                    (id, media_type, user_id, title, poster_path, vote_average, release_date, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                item.get('id'),
                item.get('media_type', ''),
                LEGACY_USER_ID,
                item.get('title', ''),
                item.get('poster_path', ''),
                item.get('vote_average', 0),
                item.get('release_date', ''),
                item.get('added_at', datetime.now().isoformat()),
            ))
        conn.commit()
    finally:
        conn.close()

    # Rename so we don't re-import
    os.rename(json_path, json_path + '.migrated')
    print(f'Migrated {len(items)} watchlist items from JSON to SQLite.')


# ---------------------------------------------------------------------------
# User helpers
# ---------------------------------------------------------------------------

def create_user(username: str, email: str, password: str):
    conn = get_db()
    try:
        user_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        conn.execute(
            'INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
            (user_id, email, username, generate_password_hash(password), now),
        )
        conn.commit()
        return {'id': user_id, 'email': email, 'username': username}
    finally:
        conn.close()


def get_user_by_email(email: str):
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: str):
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def verify_user(email: str, password: str):
    """Check credentials and return user dict or None."""
    user = get_user_by_email(email)
    if not user or not check_password_hash(user['password_hash'], password):
        return None
    return user


def merge_watchlist(from_user_id: str, to_user_id: str):
    """Copy watchlist items from an anonymous browser session into an account,
    then delete the anonymous copies."""
    if not from_user_id or from_user_id == to_user_id:
        return
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM watchlist WHERE user_id = ?', (from_user_id,)
        ).fetchall()
        for row in rows:
            conn.execute('''
                INSERT OR IGNORE INTO watchlist
                    (id, media_type, user_id, title, poster_path, vote_average, release_date, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (row['id'], row['media_type'], to_user_id, row['title'],
                  row['poster_path'], row['vote_average'], row['release_date'], row['added_at']))
        conn.execute('DELETE FROM watchlist WHERE user_id = ?', (from_user_id,))
        conn.commit()
    finally:
        conn.close()
