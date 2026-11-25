-- AO Community Closet — SQLite schema
PRAGMA foreign_keys = ON;

-- People in the friend group.
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,              -- werkzeug scrypt hash, never the raw password
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Things people are willing to lend.
CREATE TABLE IF NOT EXISTS items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    category    TEXT    NOT NULL,                -- Tops, Outerwear, Shoes, Gear, ...
    size        TEXT    NOT NULL DEFAULT '',     -- free text: M, US 10, one size
    condition   TEXT    NOT NULL DEFAULT 'Good',
    rules       TEXT    NOT NULL DEFAULT '',     -- "dry clean only", "back in 2 weeks"
    status      TEXT    NOT NULL DEFAULT 'available'
                CHECK (status IN ('available', 'borrowed')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_owner    ON items(owner_id);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_status   ON items(status);

-- One item can have several photos; position 0 is the cover photo.
CREATE TABLE IF NOT EXISTS item_photos (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    filename TEXT    NOT NULL,                   -- random name inside the uploads folder
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_photos_item ON item_photos(item_id);

-- What someone has put in their cart but not checked out yet.
CREATE TABLE IF NOT EXISTS cart_items (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    added_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, item_id)
);

-- A checkout creates one loan per item. The item is marked 'borrowed' at the same moment.
CREATE TABLE IF NOT EXISTS loans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    borrower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date  TEXT,                            -- planned pick-up (YYYY-MM-DD)
    end_date    TEXT,                            -- planned return
    message     TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested', 'approved', 'declined', 'returned')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    closed_at   TEXT                             -- when declined or returned
);
CREATE INDEX IF NOT EXISTS idx_loans_item     ON loans(item_id);
CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_id);
CREATE INDEX IF NOT EXISTS idx_loans_lender   ON loans(lender_id);

-- In-app notifications ("Marcus wants to borrow your hoodie").
CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who sees it
    actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,          -- who caused it
    loan_id    INTEGER REFERENCES loans(id) ON DELETE CASCADE,
    kind       TEXT    NOT NULL
               CHECK (kind IN ('borrow_request', 'request_approved', 'request_declined', 'item_returned')),
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
