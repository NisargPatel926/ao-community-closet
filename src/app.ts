// AO Community Closet — request router. One Netlify Function runs this for every page.
import { randomUUID } from "node:crypto";
import {
  checkPassword, clearFlashCookie, clearSessionCookie, ConfigError, flashCookie, hashPassword,
  readFlashes, safeEqual, sessionCookie, sessionUserId, type Flash,
} from "./auth.js";
import { all, one, run, tx, type Row } from "./db.js";
import { type Safe } from "./html.js";
import { photos } from "./storage.js";
import {
  authPage, browsePage, cartPage, CATEGORIES, CONDITIONS, inboxPage, itemPage, layout,
  messagePage, newItemPage, setupPage, type BrowseState, type Ctx,
} from "./views.js";

const SORTS: Record<string, string> = {
  new: "i.created_at DESC, i.id DESC",
  az: "i.name COLLATE NOCASE ASC",
  owner: "u.display_name COLLATE NOCASE ASC, i.name COLLATE NOCASE ASC",
  avail: "(i.status = 'borrowed') ASC, i.created_at DESC, i.id DESC",
};
const PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
};
const MAX_PHOTOS = 4;
const MAX_UPLOAD = 5.5 * 1024 * 1024; // Netlify's request limit is ~6 MB

const ITEM_SELECT = `
  SELECT i.*, u.display_name AS owner_name, u.username AS owner_username,
         (SELECT filename FROM item_photos p WHERE p.item_id = i.id ORDER BY position LIMIT 1) AS cover,
         (SELECT b.display_name FROM loans l JOIN users b ON b.id = l.borrower_id
           WHERE l.item_id = i.id AND l.status IN ('requested', 'approved') ORDER BY l.id DESC LIMIT 1) AS borrower_name,
         (SELECT l.end_date FROM loans l
           WHERE l.item_id = i.id AND l.status IN ('requested', 'approved') ORDER BY l.id DESC LIMIT 1) AS due_date
  FROM items i JOIN users u ON u.id = i.owner_id`;

// ------------------------------------------------------------------ responses

class HttpError extends Error {
  constructor(readonly status: number, readonly title: string, readonly detail: string) {
    super(title);
  }
}

function redirect(req: Request, to: string, flashes: Flash[] = [], cookies: string[] = []): Response {
  const headers = new Headers({ Location: to });
  if (flashes.length) headers.append("Set-Cookie", flashCookie(req, flashes));
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

async function page(req: Request, me: Row | null, title: string, body: Safe, status = 200, extra: Flash[] = []): Promise<Response> {
  const url = new URL(req.url);
  const pending = readFlashes(req);
  const counts = { unread: 0, cart: 0 };
  if (me) {
    const c = await one(
      `SELECT (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = 0) AS unread,
              (SELECT COUNT(*) FROM cart_items WHERE user_id = ?) AS cart`, [me.id, me.id]);
    counts.unread = Number(c?.unread || 0);
    counts.cart = Number(c?.cart || 0);
  }
  const ctx: Ctx = { me, counts, flashes: [...pending, ...extra], url };
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  if (pending.length) headers.append("Set-Cookie", clearFlashCookie(req));
  return new Response(layout(ctx, title ? `${title} · AO Community Closet` : "AO Community Closet", body), { status, headers });
}

const safeBack = (v: FormDataEntryValue | null, fallback: string) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : fallback;
};

const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? "").trim().slice(0, max);

// ------------------------------------------------------------------ entry point

export async function handle(req: Request): Promise<Response> {
  try {
    return await route(req);
  } catch (e) {
    if (e instanceof ConfigError) {
      return page(req, null, "Setup needed", setupPage(e.missing), 500).catch(
        () => new Response(`Setup needed: add the ${e.missing} environment variable in Netlify.`, { status: 500 }));
    }
    if (e instanceof HttpError) {
      const me = await currentUser(req).catch(() => null);
      return page(req, me, e.title, messagePage(e.title, e.detail), e.status);
    }
    console.error(e);
    return new Response("Something broke. Try again in a minute.", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}

async function currentUser(req: Request): Promise<Row | null> {
  const uid = sessionUserId(req);
  return uid === null ? null : (await one("SELECT id, username, display_name FROM users WHERE id = ?", [uid])) ?? null;
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (process.env.CLOSET_DEV !== "1") {
    for (const name of ["TURSO_DATABASE_URL", "SECRET_KEY"]) if (!process.env[name]) throw new ConfigError(name);
  }

  // CSRF: session cookies are SameSite=Lax, and we also reject cross-site form posts.
  if (method === "POST") {
    const origin = req.headers.get("origin");
    if (origin && origin !== "null" && new URL(origin).host !== url.host) {
      throw new HttpError(403, "Hmm, no", "That form came from another website.");
    }
  }

  if (path === "/login") return method === "POST" ? login(req) : page(req, null, "Log in", authPage("login", false));
  if (path === "/signup") return method === "POST" ? signup(req) : page(req, null, "Sign up", authPage("signup", !!process.env.INVITE_CODE));
  if (path === "/logout" && method === "POST") return redirect(req, "/login", [], [clearSessionCookie(req)]);

  const me = await currentUser(req);
  if (!me) {
    if (method === "GET") return redirect(req, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
    return redirect(req, "/login");
  }

  let m: RegExpMatchArray | null;
  if (path === "/" && method === "GET") return browse(req, me, url);
  if (path === "/items/new") return method === "POST" ? createItem(req, me) : page(req, me, "List an item", newItemPage());
  if ((m = path.match(/^\/items\/(\d+)$/)) && method === "GET") return itemDetail(req, me, Number(m[1]));
  if ((m = path.match(/^\/items\/(\d+)\/delete$/)) && method === "POST") return deleteItem(req, me, Number(m[1]));
  if ((m = path.match(/^\/photos\/([\w.-]+)$/)) && method === "GET") return servePhoto(m[1]);
  if ((m = path.match(/^\/cart\/add\/(\d+)$/)) && method === "POST") return cartAdd(req, me, Number(m[1]));
  if ((m = path.match(/^\/cart\/remove\/(\d+)$/)) && method === "POST") return cartRemove(req, me, Number(m[1]));
  if (path === "/cart" && method === "GET") return cart(req, me);
  if (path === "/cart/checkout" && method === "POST") return checkout(req, me);
  if (path === "/inbox" && method === "GET") return inbox(req, me);
  if ((m = path.match(/^\/loans\/(\d+)\/(approve|decline|returned)$/)) && method === "POST") return loanAction(req, me, Number(m[1]), m[2]);

  throw new HttpError(404, "Not in the closet", "That page doesn't exist.");
}

// ------------------------------------------------------------------ accounts

async function signup(req: Request): Promise<Response> {
  const f = await req.formData();
  const form = { username: str(f, "username", 60), display_name: str(f, "display_name", 40) };
  const pw = String(f.get("password") ?? ""), pw2 = String(f.get("password2") ?? "");
  const invite = process.env.INVITE_CODE || "";
  let error = "";
  if (!/^[A-Za-z0-9._]{3,30}$/.test(form.username)) error = "Usernames are 3–30 letters, numbers, dots or underscores.";
  else if (pw.length < 8) error = "Passwords need at least 8 characters.";
  else if (pw !== pw2) error = "Those passwords don't match.";
  else if (invite && !safeEqual(str(f, "invite_code", 200), invite)) error = "That invite code isn't right. Ask in the group chat.";
  else if (await one("SELECT 1 FROM users WHERE username = ?", [form.username])) error = "Someone already has that username.";
  if (error) return page(req, null, "Sign up", authPage("signup", !!invite, form), 400, [["error", error]]);

  const display = form.display_name || form.username;
  const res = await run("INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)",
    [form.username, display, await hashPassword(pw)]);
  return redirect(req, "/", [["ok", `Welcome to the closet, ${display}!`]], [sessionCookie(req, Number(res.lastInsertRowid))]);
}

async function login(req: Request): Promise<Response> {
  const f = await req.formData();
  const username = str(f, "username", 60);
  const user = await one("SELECT id, password_hash FROM users WHERE username = ?", [username]);
  if (user && (await checkPassword(String(f.get("password") ?? ""), user.password_hash))) {
    const next = new URL(req.url).searchParams.get("next") || "";
    return redirect(req, safeBack(next, "/"), [], [sessionCookie(req, user.id)]);
  }
  return page(req, null, "Log in", authPage("login", false, { username }), 401, [["error", "Wrong username or password."]]);
}

// ------------------------------------------------------------------ browsing

async function browse(req: Request, me: Row, url: URL): Promise<Response> {
  const p = url.searchParams;
  const s: BrowseState = {
    q: (p.get("q") || "").trim().slice(0, 100),
    category: CATEGORIES.includes(p.get("category") || "") ? p.get("category")! : "",
    size: (p.get("size") || "").trim().slice(0, 20),
    available: p.get("available") === "1",
    sort: SORTS[p.get("sort") || ""] ? p.get("sort")! : "new",
  };
  const where: string[] = [];
  const args: unknown[] = [];
  if (s.q) {
    where.push("(i.name LIKE ? OR i.description LIKE ? OR u.display_name LIKE ? OR u.username LIKE ? OR i.category LIKE ?)");
    const like = `%${s.q}%`;
    args.push(like, like, like, like, like);
  }
  if (s.category) { where.push("i.category = ?"); args.push(s.category); }
  if (s.size) { where.push("i.size = ? COLLATE NOCASE"); args.push(s.size); }
  if (s.available) where.push("i.status = 'available'");

  const [items, totals, cats, sizes, cartRows] = await Promise.all([
    all(`${ITEM_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY ${SORTS[s.sort]}`, args),
    one("SELECT COUNT(*) AS n FROM items"),
    all("SELECT category, COUNT(*) AS n FROM items GROUP BY category"),
    all("SELECT DISTINCT size FROM items WHERE size != '' ORDER BY size COLLATE NOCASE"),
    all("SELECT item_id FROM cart_items WHERE user_id = ?", [me.id]),
  ]);
  return page(req, me, "Browse", browsePage({ me, counts: { unread: 0, cart: 0 }, flashes: [], url }, s, {
    items,
    total: Number(totals?.n || 0),
    catCounts: Object.fromEntries(cats.map((r) => [r.category, Number(r.n)])),
    sizes: sizes.map((r) => String(r.size)),
    inCart: new Set(cartRows.map((r) => Number(r.item_id))),
  }));
}

async function getItem(id: number): Promise<Row> {
  const item = await one(`${ITEM_SELECT} WHERE i.id = ?`, [id]);
  if (!item) throw new HttpError(404, "Not in the closet", "That item doesn't exist (anymore).");
  return item;
}

async function itemDetail(req: Request, me: Row, id: number): Promise<Response> {
  const item = await getItem(id);
  const [pics, inCart] = await Promise.all([
    all("SELECT filename FROM item_photos WHERE item_id = ? ORDER BY position", [id]),
    one("SELECT 1 AS x FROM cart_items WHERE user_id = ? AND item_id = ?", [me.id, id]),
  ]);
  return page(req, me, item.name, itemPage({ me, counts: { unread: 0, cart: 0 }, flashes: [], url: new URL(req.url) }, item, pics, !!inCart));
}

async function servePhoto(key: string): Promise<Response> {
  const photo = await photos().get(key);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(photo.data, {
    headers: { "Content-Type": photo.type, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}

// ------------------------------------------------------------------ listing items

async function createItem(req: Request, me: Row): Promise<Response> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD) {
    return page(req, me, "List an item", newItemPage(), 413, [["error", "Those photos are too big. Try fewer or smaller ones."]]);
  }
  const f = await req.formData();
  const form = {
    name: str(f, "name", 80), description: str(f, "description", 2000), category: str(f, "category", 40),
    size: str(f, "size", 20), condition: str(f, "condition", 40), rules: str(f, "rules", 200),
  };
  const files = f.getAll("photos").filter((x): x is File => typeof x !== "string" && x.size > 0);
  let error = "";
  if (!form.name) error = "Give it a name.";
  else if (!CATEGORIES.includes(form.category)) error = "Pick a category.";
  else if (!files.length) error = "Add at least one photo.";
  else if (files.length > MAX_PHOTOS) error = `Up to ${MAX_PHOTOS} photos, please.`;
  else if (files.some((x) => !PHOTO_TYPES[x.type])) error = "Photos need to be JPG, PNG, GIF, WEBP or HEIC.";
  else if (files.reduce((n, x) => n + x.size, 0) > MAX_UPLOAD) error = "Those photos are too big. Try fewer or smaller ones.";
  if (error) return page(req, me, "List an item", newItemPage(form), 400, [["error", error]]);

  const keys: string[] = [];
  for (const file of files) {
    const key = `${randomUUID().replace(/-/g, "")}.${PHOTO_TYPES[file.type]}`;
    await photos().put(key, await file.arrayBuffer(), file.type);
    keys.push(key);
  }
  const res = await tx([
    {
      sql: "INSERT INTO items (owner_id, name, description, category, size, condition, rules) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [me.id, form.name, form.description, form.category, form.size,
        CONDITIONS.includes(form.condition) ? form.condition : "Good", form.rules],
    },
    ...keys.map((key, pos) => ({
      sql: "INSERT INTO item_photos (item_id, filename, position) VALUES ((SELECT MAX(id) FROM items WHERE owner_id = ?), ?, ?)",
      args: [me.id, key, pos],
    })),
  ]);
  return redirect(req, `/items/${Number(res[0].lastInsertRowid)}`, [["ok", "It's in the closet!"]]);
}

async function deleteItem(req: Request, me: Row, id: number): Promise<Response> {
  const item = await getItem(id);
  if (item.owner_id !== me.id) throw new HttpError(403, "Not yours", "You can only remove your own stuff.");
  if (item.status === "borrowed") return redirect(req, `/items/${id}`, [["error", "You can't remove something while it's borrowed."]]);
  const keys = (await all("SELECT filename FROM item_photos WHERE item_id = ?", [id])).map((r) => String(r.filename));
  await tx([
    { sql: "DELETE FROM notifications WHERE loan_id IN (SELECT id FROM loans WHERE item_id = ?)", args: [id] },
    { sql: "DELETE FROM loans WHERE item_id = ?", args: [id] },
    { sql: "DELETE FROM cart_items WHERE item_id = ?", args: [id] },
    { sql: "DELETE FROM item_photos WHERE item_id = ?", args: [id] },
    { sql: "DELETE FROM items WHERE id = ?", args: [id] },
  ]);
  await Promise.all(keys.map((k) => photos().del(k).catch(() => {})));
  return redirect(req, "/", [["ok", "Removed from the closet."]]);
}

// ------------------------------------------------------------------ cart + checkout

async function cartAdd(req: Request, me: Row, id: number): Promise<Response> {
  const f = await req.formData();
  const to = safeBack(f.get("back"), "/");
  const item = await getItem(id);
  if (item.owner_id === me.id) return redirect(req, to, [["error", "That's yours already!"]]);
  if (item.status !== "available") return redirect(req, to, [["error", "Someone's already borrowing that."]]);
  await run("INSERT OR IGNORE INTO cart_items (user_id, item_id) VALUES (?, ?)", [me.id, id]);
  return redirect(req, to, [["ok", `Added ${item.name} to your cart.`]]);
}

async function cartRemove(req: Request, me: Row, id: number): Promise<Response> {
  const f = await req.formData();
  await run("DELETE FROM cart_items WHERE user_id = ? AND item_id = ?", [me.id, id]);
  return redirect(req, safeBack(f.get("back"), "/cart"));
}

async function cart(req: Request, me: Row): Promise<Response> {
  const items = await all(`${ITEM_SELECT} JOIN cart_items c ON c.item_id = i.id WHERE c.user_id = ? ORDER BY c.added_at`, [me.id]);
  return page(req, me, "Cart", cartPage(items));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function checkout(req: Request, me: Row): Promise<Response> {
  const f = await req.formData();
  const start = DATE.test(str(f, "start_date")) ? str(f, "start_date") : null;
  const end = DATE.test(str(f, "end_date")) ? str(f, "end_date") : null;
  const message = str(f, "message", 500);
  const rows = await all("SELECT i.id, i.name FROM cart_items c JOIN items i ON i.id = c.item_id WHERE c.user_id = ?", [me.id]);
  if (!rows.length) return redirect(req, "/cart", [["error", "Your cart is empty."]]);

  const before = Number((await one("SELECT COALESCE(MAX(id), 0) AS n FROM loans"))?.n || 0);
  // One atomic transaction. For each item: claim it only if it's still available, create the loan
  // only if nobody else has an open loan on it, then notify the owner.
  await tx([
    ...rows.flatMap((r) => [
      {
        sql: "UPDATE items SET status = 'borrowed' WHERE id = ? AND status = 'available' AND owner_id != ?",
        args: [r.id, me.id],
      },
      {
        sql: `INSERT INTO loans (item_id, borrower_id, lender_id, start_date, end_date, message)
              SELECT id, ?, owner_id, ?, ?, ? FROM items
              WHERE id = ? AND status = 'borrowed'
                AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.item_id = items.id AND l.status IN ('requested', 'approved'))`,
        args: [me.id, start, end, message, r.id],
      },
    ]),
    {
      sql: `INSERT INTO notifications (user_id, actor_id, loan_id, kind)
            SELECT lender_id, borrower_id, id, 'borrow_request' FROM loans WHERE id > ? AND borrower_id = ?`,
      args: [before, me.id],
    },
    { sql: "DELETE FROM cart_items WHERE user_id = ?", args: [me.id] },
    { sql: "DELETE FROM cart_items WHERE item_id IN (SELECT id FROM items WHERE status = 'borrowed')", args: [] },
  ]);
  const got = new Set((await all("SELECT item_id FROM loans WHERE id > ? AND borrower_id = ?", [before, me.id])).map((r) => Number(r.item_id)));
  const missed = rows.filter((r) => !got.has(Number(r.id))).map((r) => r.name);

  const flashes: Flash[] = [];
  if (missed.length) flashes.push(["error", `Someone beat you to: ${missed.join(", ")}`]);
  if (got.size) flashes.push(["ok", "Requests sent! The owners just got a note."]);
  return redirect(req, "/inbox", flashes);
}

// ------------------------------------------------------------------ inbox + loans

async function inbox(req: Request, me: Row): Promise<Response> {
  const [notes, lentOut, borrowing] = await Promise.all([
    all(`SELECT n.*, a.display_name AS actor_name, l.status AS loan_status, l.start_date, l.end_date,
                l.message, l.id AS loan_id, i.name AS item_name
         FROM notifications n
         LEFT JOIN users a ON a.id = n.actor_id
         LEFT JOIN loans l ON l.id = n.loan_id
         LEFT JOIN items i ON i.id = l.item_id
         WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`, [me.id]),
    all(`SELECT l.*, i.name AS item_name, b.display_name AS borrower_name
         FROM loans l JOIN items i ON i.id = l.item_id JOIN users b ON b.id = l.borrower_id
         WHERE l.lender_id = ? AND l.status IN ('requested', 'approved') ORDER BY l.end_date`, [me.id]),
    all(`SELECT l.*, i.name AS item_name, o.display_name AS lender_name
         FROM loans l JOIN items i ON i.id = l.item_id JOIN users o ON o.id = l.lender_id
         WHERE l.borrower_id = ? AND l.status IN ('requested', 'approved') ORDER BY l.end_date`, [me.id]),
  ]);
  await run("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [me.id]);
  const res = await page(req, me, "Inbox", inboxPage(notes, lentOut, borrowing));
  return res;
}

async function loanAction(req: Request, me: Row, id: number, action: string): Promise<Response> {
  const loan = await one("SELECT * FROM loans WHERE id = ?", [id]);
  if (!loan) throw new HttpError(404, "Not found", "That request doesn't exist.");
  if (loan.lender_id !== me.id) throw new HttpError(403, "Not yours", "Only the owner can do that.");
  const notify = (kind: string) => ({
    sql: "INSERT INTO notifications (user_id, actor_id, loan_id, kind) VALUES (?, ?, ?, ?)",
    args: [loan.borrower_id, loan.lender_id, id, kind],
  });
  const open = loan.status === "requested" || loan.status === "approved";
  if (action === "approve" && loan.status === "requested") {
    await tx([{ sql: "UPDATE loans SET status = 'approved' WHERE id = ?", args: [id] }, notify("request_approved")]);
  } else if (action === "decline" && loan.status === "requested") {
    await tx([
      { sql: "UPDATE loans SET status = 'declined', closed_at = datetime('now') WHERE id = ?", args: [id] },
      { sql: "UPDATE items SET status = 'available' WHERE id = ?", args: [loan.item_id] },
      notify("request_declined"),
    ]);
  } else if (action === "returned" && open) {
    await tx([
      { sql: "UPDATE loans SET status = 'returned', closed_at = datetime('now') WHERE id = ?", args: [id] },
      { sql: "UPDATE items SET status = 'available' WHERE id = ?", args: [loan.item_id] },
      notify("item_returned"),
    ]);
    return redirect(req, "/inbox", [["ok", "Back in the closet. Anyone can borrow it again."]]);
  }
  return redirect(req, "/inbox");
}
