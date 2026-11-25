"""AO Community Closet — a tiny lending marketplace for a friend group.

Run locally:
    pip install -r requirements.txt
    flask --app app run --debug
"""
import os
import secrets
import sqlite3
import uuid
from functools import wraps
from pathlib import Path

from flask import (Flask, abort, flash, g, redirect, render_template, request,
                   send_from_directory, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent

CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Dresses", "Shoes",
              "Accessories", "Gear", "Games", "Other"]
CONDITIONS = ["Like new", "Great", "Good", "Well loved"]
SORTS = {
    "new": "i.created_at DESC, i.id DESC",
    "az": "i.name COLLATE NOCASE ASC",
    "owner": "u.display_name COLLATE NOCASE ASC, i.name COLLATE NOCASE ASC",
    "avail": "(i.status = 'borrowed') ASC, i.created_at DESC, i.id DESC",
}
ALLOWED_EXT = {"jpg", "jpeg", "png", "gif", "webp", "heic", "heif"}
MAX_PHOTOS = 4

def _secret_key():
    """Use $SECRET_KEY, else a random key saved next to the app so logins survive restarts."""
    if os.environ.get("SECRET_KEY"):
        return os.environ["SECRET_KEY"]
    key_file = BASE_DIR / ".secret_key"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
        key_file.chmod(0o600)
    return key_file.read_text().strip()


app = Flask(__name__)
app.config.update(
    SECRET_KEY=_secret_key(),
    DATABASE=os.environ.get("DATABASE", str(BASE_DIR / "closet.db")),
    UPLOAD_FOLDER=os.environ.get("UPLOAD_FOLDER", str(BASE_DIR / "uploads")),
    INVITE_CODE=os.environ.get("INVITE_CODE", ""),  # empty = anyone with the link can sign up
    MAX_CONTENT_LENGTH=45 * 1024 * 1024,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
)


# ---------------------------------------------------------------- database

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    with sqlite3.connect(app.config["DATABASE"]) as db:
        db.executescript((BASE_DIR / "schema.sql").read_text())


@app.cli.command("init-db")
def init_db_command():
    """Create the tables (safe to run more than once)."""
    init_db()
    print("Database ready at", app.config["DATABASE"])


Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
init_db()


# ---------------------------------------------------------------- auth + csrf

def current_user():
    uid = session.get("user_id")
    if uid is None:
        return None
    if "user" not in g:
        g.user = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return g.user


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


@app.before_request
def check_csrf():
    if request.method == "POST":
        sent = request.form.get("csrf")
        if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
            abort(400, "Form expired. Go back, refresh and try again.")


@app.context_processor
def inject_globals():
    user = current_user()
    counts = {"unread": 0, "cart": 0}
    if user:
        db = get_db()
        counts["unread"] = db.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0",
            (user["id"],)).fetchone()[0]
        counts["cart"] = db.execute(
            "SELECT COUNT(*) FROM cart_items WHERE user_id = ?", (user["id"],)).fetchone()[0]
    return {"me": user, "counts": counts, "csrf_token": csrf_token,
            "CATEGORIES": CATEGORIES, "CONDITIONS": CONDITIONS}


def safe_back(default):
    back = request.form.get("back", "")
    return back if back.startswith("/") and not back.startswith("//") else default


@app.template_global()
def browse_url(**over):
    """Browse URL keeping the current filters, with some of them replaced."""
    keep = ("q", "category", "size", "available", "sort")
    args = {k: v for k, v in request.args.items() if k in keep}
    args.update(over)
    return url_for("browse", **{k: v for k, v in args.items() if v})


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        display = request.form.get("display_name", "").strip() or username
        pw = request.form.get("password", "")
        pw2 = request.form.get("password2", "")
        code = request.form.get("invite_code", "").strip()
        error = None
        if not (3 <= len(username) <= 30) or not username.replace("_", "").replace(".", "").isalnum():
            error = "Usernames are 3–30 letters, numbers, dots or underscores."
        elif len(pw) < 8:
            error = "Passwords need at least 8 characters."
        elif pw != pw2:
            error = "Those passwords don't match."
        elif app.config["INVITE_CODE"] and not secrets.compare_digest(code, app.config["INVITE_CODE"]):
            error = "That invite code isn't right. Ask in the group chat."
        if error is None:
            try:
                db = get_db()
                cur = db.execute(
                    "INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)",
                    (username, display[:40], generate_password_hash(pw)))
                db.commit()
            except sqlite3.IntegrityError:
                error = "Someone already has that username."
            else:
                session.clear()
                session["user_id"] = cur.lastrowid
                flash(f"Welcome to the closet, {display}!")
                return redirect(url_for("browse"))
        flash(error, "error")
    return render_template("auth.html", mode="signup",
                           need_code=bool(app.config["INVITE_CODE"]))


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        user = get_db().execute("SELECT * FROM users WHERE username = ?",
                                (request.form.get("username", "").strip(),)).fetchone()
        if user and check_password_hash(user["password_hash"], request.form.get("password", "")):
            session.clear()
            session["user_id"] = user["id"]
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("browse"))
        flash("Wrong username or password.", "error")
    return render_template("auth.html", mode="login", need_code=False)


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# ---------------------------------------------------------------- browsing

ITEM_SELECT = """
    SELECT i.*, u.display_name AS owner_name, u.username AS owner_username,
           (SELECT filename FROM item_photos p WHERE p.item_id = i.id
             ORDER BY position LIMIT 1) AS cover,
           (SELECT b.display_name FROM loans l JOIN users b ON b.id = l.borrower_id
             WHERE l.item_id = i.id AND l.status IN ('requested', 'approved')
             ORDER BY l.id DESC LIMIT 1) AS borrower_name,
           (SELECT l.end_date FROM loans l
             WHERE l.item_id = i.id AND l.status IN ('requested', 'approved')
             ORDER BY l.id DESC LIMIT 1) AS due_date
    FROM items i JOIN users u ON u.id = i.owner_id
"""


@app.route("/")
@login_required
def browse():
    q = request.args.get("q", "").strip()
    category = request.args.get("category", "")
    size = request.args.get("size", "").strip()
    available = request.args.get("available") == "1"
    sort = request.args.get("sort", "new")
    if sort not in SORTS:
        sort = "new"

    where, params = [], []
    if q:
        like = f"%{q}%"
        where.append("(i.name LIKE ? OR i.description LIKE ? OR u.display_name LIKE ? "
                     "OR u.username LIKE ? OR i.category LIKE ?)")
        params += [like] * 5
    if category in CATEGORIES:
        where.append("i.category = ?")
        params.append(category)
    if size:
        where.append("i.size = ? COLLATE NOCASE")
        params.append(size)
    if available:
        where.append("i.status = 'available'")

    sql = ITEM_SELECT + (" WHERE " + " AND ".join(where) if where else "") + f" ORDER BY {SORTS[sort]}"
    db = get_db()
    items = db.execute(sql, params).fetchall()
    total = db.execute("SELECT COUNT(*) FROM items").fetchone()[0]
    cat_counts = dict(db.execute("SELECT category, COUNT(*) FROM items GROUP BY category").fetchall())
    sizes = [r[0] for r in db.execute(
        "SELECT DISTINCT size FROM items WHERE size != '' ORDER BY size COLLATE NOCASE")]
    in_cart = {r[0] for r in db.execute(
        "SELECT item_id FROM cart_items WHERE user_id = ?", (current_user()["id"],))}
    return render_template("browse.html", items=items, total=total, cat_counts=cat_counts,
                           sizes=sizes, in_cart=in_cart, q=q, category=category, size=size,
                           available=available, sort=sort)


def get_item(item_id):
    item = get_db().execute(ITEM_SELECT + " WHERE i.id = ?", (item_id,)).fetchone()
    if item is None:
        abort(404)
    return item


@app.route("/items/<int:item_id>")
@login_required
def item_detail(item_id):
    item = get_item(item_id)
    photos = get_db().execute(
        "SELECT filename FROM item_photos WHERE item_id = ? ORDER BY position", (item_id,)).fetchall()
    in_cart = get_db().execute(
        "SELECT 1 FROM cart_items WHERE user_id = ? AND item_id = ?",
        (current_user()["id"], item_id)).fetchone() is not None
    return render_template("item.html", item=item, photos=photos, in_cart=in_cart)


@app.route("/uploads/<path:filename>")
@login_required
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


# ---------------------------------------------------------------- listing items

@app.route("/items/new", methods=["GET", "POST"])
@login_required
def new_item():
    form = request.form
    if request.method == "POST":
        name = form.get("name", "").strip()
        category = form.get("category", "")
        condition = form.get("condition", "Good")
        photos = [f for f in request.files.getlist("photos") if f and f.filename]
        error = None
        if not name:
            error = "Give it a name."
        elif category not in CATEGORIES:
            error = "Pick a category."
        elif not photos:
            error = "Add at least one photo."
        elif len(photos) > MAX_PHOTOS:
            error = f"Up to {MAX_PHOTOS} photos, please."
        elif any(f.filename.rsplit(".", 1)[-1].lower() not in ALLOWED_EXT for f in photos):
            error = "Photos need to be JPG, PNG, GIF, WEBP or HEIC."
        if error:
            flash(error, "error")
        else:
            db = get_db()
            cur = db.execute(
                "INSERT INTO items (owner_id, name, description, category, size, condition, rules) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (current_user()["id"], name[:80], form.get("description", "").strip()[:2000], category,
                 form.get("size", "").strip()[:20],
                 condition if condition in CONDITIONS else "Good",
                 form.get("rules", "").strip()[:200]))
            item_id = cur.lastrowid
            for pos, f in enumerate(photos):
                ext = f.filename.rsplit(".", 1)[-1].lower()
                fname = f"{uuid.uuid4().hex}.{ext}"
                f.save(Path(app.config["UPLOAD_FOLDER"]) / fname)
                db.execute("INSERT INTO item_photos (item_id, filename, position) VALUES (?, ?, ?)",
                           (item_id, fname, pos))
            db.commit()
            flash("It's in the closet!")
            return redirect(url_for("item_detail", item_id=item_id))
    return render_template("new_item.html", form=form)


@app.post("/items/<int:item_id>/delete")
@login_required
def delete_item(item_id):
    item = get_item(item_id)
    if item["owner_id"] != current_user()["id"]:
        abort(403)
    if item["status"] == "borrowed":
        flash("You can't remove something while it's borrowed.", "error")
        return redirect(url_for("item_detail", item_id=item_id))
    db = get_db()
    files = [r[0] for r in db.execute("SELECT filename FROM item_photos WHERE item_id = ?", (item_id,))]
    db.execute("DELETE FROM items WHERE id = ?", (item_id,))
    db.commit()
    for fname in files:
        (Path(app.config["UPLOAD_FOLDER"]) / fname).unlink(missing_ok=True)
    flash("Removed from the closet.")
    return redirect(url_for("browse"))


# ---------------------------------------------------------------- cart + checkout

@app.post("/cart/add/<int:item_id>")
@login_required
def cart_add(item_id):
    item = get_item(item_id)
    me = current_user()
    if item["owner_id"] == me["id"]:
        flash("That's yours already!", "error")
    elif item["status"] != "available":
        flash("Someone's already borrowing that.", "error")
    else:
        get_db().execute("INSERT OR IGNORE INTO cart_items (user_id, item_id) VALUES (?, ?)",
                         (me["id"], item_id))
        get_db().commit()
        flash(f"Added {item['name']} to your cart.")
    return redirect(safe_back(url_for("browse")))


@app.post("/cart/remove/<int:item_id>")
@login_required
def cart_remove(item_id):
    get_db().execute("DELETE FROM cart_items WHERE user_id = ? AND item_id = ?",
                     (current_user()["id"], item_id))
    get_db().commit()
    return redirect(safe_back(url_for("cart")))


@app.route("/cart")
@login_required
def cart():
    items = get_db().execute(
        ITEM_SELECT + " JOIN cart_items c ON c.item_id = i.id WHERE c.user_id = ? ORDER BY c.added_at",
        (current_user()["id"],)).fetchall()
    owners = sorted({i["owner_name"] for i in items if i["status"] == "available"})
    return render_template("cart.html", items=items, owners=owners)


@app.post("/cart/checkout")
@login_required
def checkout():
    me = current_user()
    db = get_db()
    start = request.form.get("start_date") or None
    end = request.form.get("end_date") or None
    message = request.form.get("message", "").strip()[:500]
    cart_rows = db.execute(
        "SELECT i.id, i.owner_id, i.name FROM cart_items c JOIN items i ON i.id = c.item_id "
        "WHERE c.user_id = ?", (me["id"],)).fetchall()
    if not cart_rows:
        flash("Your cart is empty.", "error")
        return redirect(url_for("cart"))

    got, missed = [], []
    db.execute("BEGIN IMMEDIATE")  # lock so two friends can't grab the same thing at once
    for row in cart_rows:
        claimed = db.execute(
            "UPDATE items SET status = 'borrowed' WHERE id = ? AND status = 'available' AND owner_id != ?",
            (row["id"], me["id"])).rowcount
        if not claimed:
            missed.append(row["name"])
            continue
        loan = db.execute(
            "INSERT INTO loans (item_id, borrower_id, lender_id, start_date, end_date, message) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (row["id"], me["id"], row["owner_id"], start, end, message)).lastrowid
        db.execute("INSERT INTO notifications (user_id, actor_id, loan_id, kind) VALUES (?, ?, ?, 'borrow_request')",
                   (row["owner_id"], me["id"], loan))
        got.append(row["name"])
    db.execute("DELETE FROM cart_items WHERE user_id = ?", (me["id"],))
    # The borrowed items can't be checked out by anyone else, so drop them from other carts too.
    db.execute("DELETE FROM cart_items WHERE item_id IN (SELECT id FROM items WHERE status = 'borrowed')")
    db.commit()

    if missed:
        flash("Someone beat you to: " + ", ".join(missed), "error")
    if got:
        flash("Requests sent! The owners just got a note.")
    return redirect(url_for("inbox"))


# ---------------------------------------------------------------- inbox + loan actions

@app.route("/inbox")
@login_required
def inbox():
    me = current_user()
    db = get_db()
    notes = db.execute("""
        SELECT n.*, a.display_name AS actor_name, l.status AS loan_status, l.start_date, l.end_date,
               l.message, l.id AS loan_id, i.name AS item_name, i.id AS item_id
        FROM notifications n
        LEFT JOIN users a ON a.id = n.actor_id
        LEFT JOIN loans l ON l.id = n.loan_id
        LEFT JOIN items i ON i.id = l.item_id
        WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100""", (me["id"],)).fetchall()
    lent_out = db.execute("""
        SELECT l.*, i.name AS item_name, b.display_name AS borrower_name,
               (l.end_date IS NOT NULL AND l.end_date < date('now')) AS late
        FROM loans l JOIN items i ON i.id = l.item_id JOIN users b ON b.id = l.borrower_id
        WHERE l.lender_id = ? AND l.status IN ('requested', 'approved') ORDER BY l.end_date""",
                          (me["id"],)).fetchall()
    borrowing = db.execute("""
        SELECT l.*, i.name AS item_name, o.display_name AS lender_name
        FROM loans l JOIN items i ON i.id = l.item_id JOIN users o ON o.id = l.lender_id
        WHERE l.borrower_id = ? AND l.status IN ('requested', 'approved') ORDER BY l.end_date""",
                           (me["id"],)).fetchall()
    db.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", (me["id"],))
    db.commit()
    return render_template("inbox.html", notes=notes, lent_out=lent_out, borrowing=borrowing)


def lender_loan(loan_id):
    loan = get_db().execute("SELECT * FROM loans WHERE id = ?", (loan_id,)).fetchone()
    if loan is None:
        abort(404)
    if loan["lender_id"] != current_user()["id"]:
        abort(403)
    return loan


@app.post("/loans/<int:loan_id>/approve")
@login_required
def approve_loan(loan_id):
    loan = lender_loan(loan_id)
    if loan["status"] == "requested":
        db = get_db()
        db.execute("UPDATE loans SET status = 'approved' WHERE id = ?", (loan_id,))
        db.execute("INSERT INTO notifications (user_id, actor_id, loan_id, kind) VALUES (?, ?, ?, 'request_approved')",
                   (loan["borrower_id"], loan["lender_id"], loan_id))
        db.commit()
    return redirect(url_for("inbox"))


@app.post("/loans/<int:loan_id>/decline")
@login_required
def decline_loan(loan_id):
    loan = lender_loan(loan_id)
    if loan["status"] == "requested":
        db = get_db()
        db.execute("UPDATE loans SET status = 'declined', closed_at = datetime('now') WHERE id = ?", (loan_id,))
        db.execute("UPDATE items SET status = 'available' WHERE id = ?", (loan["item_id"],))
        db.execute("INSERT INTO notifications (user_id, actor_id, loan_id, kind) VALUES (?, ?, ?, 'request_declined')",
                   (loan["borrower_id"], loan["lender_id"], loan_id))
        db.commit()
    return redirect(url_for("inbox"))


@app.post("/loans/<int:loan_id>/returned")
@login_required
def return_loan(loan_id):
    loan = lender_loan(loan_id)
    if loan["status"] in ("requested", "approved"):
        db = get_db()
        db.execute("UPDATE loans SET status = 'returned', closed_at = datetime('now') WHERE id = ?", (loan_id,))
        db.execute("UPDATE items SET status = 'available' WHERE id = ?", (loan["item_id"],))
        db.execute("INSERT INTO notifications (user_id, actor_id, loan_id, kind) VALUES (?, ?, ?, 'item_returned')",
                   (loan["borrower_id"], loan["lender_id"], loan_id))
        db.commit()
        flash("Back in the closet. Anyone can borrow it again.")
    return redirect(url_for("inbox"))


@app.errorhandler(413)
def too_big(_e):
    flash("Those photos are too big. Try smaller ones (under 10 MB each).", "error")
    return redirect(request.url)


if __name__ == "__main__":
    app.run(debug=True)
