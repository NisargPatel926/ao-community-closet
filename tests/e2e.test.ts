// End-to-end test of the whole borrowing flow, run against a throwaway local database.
// npm test
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "closet-"));
process.env.CLOSET_DEV = "1";
process.env.TURSO_DATABASE_URL = `file:${dir}/test.db`;
process.env.PHOTO_DIR = `${dir}/photos`;
process.env.INVITE_CODE = "closet";
const { handle } = await import("../src/app.js");

const BASE = "https://closet.test";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAJGwPXa8Y7pQAAAABJRU5ErkJggg==", "base64");

class Browser {
  jar = new Map<string, string>();
  async req(method: string, p: string, body?: FormData | Record<string, string>, extra: Record<string, string> = {}) {
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body) payload = new URLSearchParams(body);
    const headers = new Headers(extra);
    if (method === "POST" && !headers.has("origin")) headers.set("origin", BASE);
    headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    const res = await handle(new Request(BASE + p, { method, body: payload, headers }));
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const [k, v] = kv.split("=");
      if (attrs.some((a) => a.trim() === "Max-Age=0")) this.jar.delete(k);
      else this.jar.set(k, v);
    }
    return res;
  }
  /** Like a browser: follow redirects, return final status and HTML. */
  async go(method: string, p: string, body?: FormData | Record<string, string>, extra?: Record<string, string>) {
    let res = await this.req(method, p, body, extra);
    while (res.status === 303) res = await this.req("GET", res.headers.get("location")!);
    return { status: res.status, html: await res.text(), res };
  }
  get(p: string) { return this.go("GET", p); }
  post(p: string, body: FormData | Record<string, string> = {}, extra?: Record<string, string>) { return this.go("POST", p, body, extra); }
}

const signup = (b: Browser, u: string, name: string, code = "closet") =>
  b.post("/signup", { username: u, display_name: name, password: "password1", password2: "password1", invite_code: code });

function itemForm(fields: Record<string, string>, nPhotos = 2) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ description: "", size: "M", condition: "Good", rules: "", ...fields })) f.set(k, v);
  for (let i = 0; i < nPhotos; i++) f.append("photos", new File([PNG], `p${i}.png`, { type: "image/png" }));
  return f;
}
const cardCount = (h: string) => (h.match(/<article class="card/g) || []).length;
const names = (h: string) => [...h.matchAll(/<h2><a href="\/items\/\d+">([^<]+)<\/a>/g)].map((m) => m[1]);

test("the whole borrowing flow", async () => {
  const priya = new Browser(), marcus = new Browser(), jess = new Browser();

  // accounts
  assert.match((await signup(priya, "priya", "Priya", "wrong")).html, /invite code isn/);
  assert.match((await signup(priya, "priya", "Priya")).html, /Welcome to the closet, Priya/);
  await signup(marcus, "marcus", "Marcus");
  await signup(jess, "jess", "Jess");
  assert.match((await signup(new Browser(), "PRIYA", "dup")).html, /already has that username/);
  assert.match((await new Browser().post("/login", { username: "priya", password: "nope" })).html, /Wrong username or password/);
  const relog = new Browser();
  await relog.post("/login?next=/cart", { username: "priya", password: "password1" });
  assert.equal((await relog.req("GET", "/cart")).status, 200);
  assert.equal((await new Browser().req("GET", "/")).headers.get("location"), "/login?next=%2F");

  // cross-site form posts are rejected
  assert.equal((await priya.req("POST", "/cart/add/1", {}, { origin: "https://evil.example" })).status, 403);

  // listing
  assert.match((await priya.post("/items/new", itemForm({ name: "Cozy grey hoodie", category: "Tops", description: "soft" }))).html, /It&#39;s in the closet/);
  await priya.post("/items/new", itemForm({ name: "Party board game", category: "Games", size: "" }));
  await marcus.post("/items/new", itemForm({ name: "Vintage denim jacket", category: "Outerwear", size: "L" }));
  assert.match((await priya.post("/items/new", itemForm({ name: "no photo", category: "Tops" }, 0))).html, /at least one photo/);
  assert.match((await priya.post("/items/new", itemForm({ name: "<script>x</script>", category: "Nope" }))).html, /Pick a category/);

  // browse, search, filter, sort
  let h = (await jess.get("/")).html;
  assert.equal(cardCount(h), 3);
  assert.ok(!h.includes("<script>x</script>"));
  h = (await jess.get("/?q=hoodie")).html; assert.deepEqual(names(h), ["Cozy grey hoodie"]);
  h = (await jess.get("/?q=marcus")).html; assert.deepEqual(names(h), ["Vintage denim jacket"]);
  h = (await jess.get("/?category=Games")).html; assert.deepEqual(names(h), ["Party board game"]);
  h = (await jess.get("/?size=l")).html; assert.deepEqual(names(h), ["Vintage denim jacket"]);
  h = (await jess.get("/?sort=az")).html; assert.deepEqual(names(h), ["Cozy grey hoodie", "Party board game", "Vintage denim jacket"]);
  h = (await jess.get("/?sort=owner")).html; assert.deepEqual(names(h), ["Vintage denim jacket", "Cozy grey hoodie", "Party board game"]);
  h = (await jess.get("/?sort=';drop")).html; assert.equal(cardCount(h), 3);

  // photos need a login
  const photo = h.match(/\/photos\/([\w.]+)/)![0];
  assert.equal((await new Browser().req("GET", photo)).status, 303);
  const pr = await jess.req("GET", photo);
  assert.equal(pr.status, 200); assert.equal(pr.headers.get("content-type"), "image/png");

  // cart + checkout: jess wants the hoodie (1) and the jacket (3); marcus also wants the hoodie
  await jess.post("/cart/add/1", { back: "/" });
  await jess.post("/cart/add/3", { back: "/" });
  await marcus.post("/cart/add/1", { back: "/" });
  assert.match((await priya.post("/cart/add/1", { back: "/" })).html, /That&#39;s yours already/);
  h = (await jess.get("/cart")).html;
  assert.match(h, /2 things from 2 friends: Marcus, Priya/);
  h = (await jess.post("/cart/checkout", { start_date: "2026-12-02", end_date: "2026-12-09", message: "ski trip!" })).html;
  assert.match(h, /Requests sent/);
  assert.match(h, /Waiting on Priya/);

  // borrowed items are visible but can't be checked out
  h = (await marcus.get("/")).html;
  assert.match(h, /BORROWED/);
  assert.match(h, /With Jess until Dec 9/);
  assert.match((await marcus.post("/cart/add/1", { back: "/" })).html, /already borrowing/);
  assert.ok(!(await marcus.get("/cart")).html.includes("Cozy grey hoodie"), "dropped from Marcus's cart");
  assert.deepEqual(names((await marcus.get("/?available=1")).html), ["Party board game"]);

  // owner gets a notification
  assert.match((await priya.get("/")).html, /badge red">1/);
  h = (await priya.get("/inbox")).html;
  assert.match(h, /<b>Jess<\/b> wants to borrow your <b>Cozy grey hoodie<\/b>/);
  assert.match(h, /ski trip!/);
  assert.match(h, /Pick up Dec 2 · back by Dec 9/);
  assert.ok(!(await priya.get("/")).html.includes("badge red"), "marked read");

  // only the owner can act on a request
  assert.equal((await marcus.go("POST", "/loans/1/approve")).status, 403);
  await priya.post("/loans/1/approve");
  assert.match((await jess.get("/inbox")).html, /said yes to lending you the/);
  assert.match((await priya.post("/items/1/delete")).html, /can&#39;t remove something while it&#39;s borrowed/);
  assert.match((await priya.post("/loans/1/returned")).html, /Back in the closet/);
  assert.equal(((await marcus.get("/")).html.match(/class="stamp"/g) || []).length, 1, "only the jacket is still out");

  // decline puts it back
  await marcus.post("/loans/2/decline");
  assert.ok(!(await jess.get("/")).html.includes('class="stamp"'));
  assert.match((await jess.get("/inbox")).html, /can't lend you the/);

  // deleting your own item, and open-redirect guard
  assert.match((await priya.post("/items/2/delete")).html, /Removed from the closet/);
  assert.equal((await jess.req("POST", "/cart/add/1", { back: "//evil.example" })).headers.get("location"), "/");
  assert.equal((await jess.get("/nope")).status, 404);
});

test("missing configuration shows a setup page", async () => {
  const saved = process.env.CLOSET_DEV;
  process.env.CLOSET_DEV = "0";
  delete process.env.SECRET_KEY;
  const res = await handle(new Request(BASE + "/", { headers: { cookie: "closet_session=1.9999999999.x" } }));
  assert.equal(res.status, 500);
  assert.match(await res.text(), /SECRET_KEY/);
  process.env.CLOSET_DEV = saved;
});
