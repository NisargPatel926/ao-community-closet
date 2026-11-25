// Page templates. Same look and markup as the original Flask/Jinja version.
import type { Flash } from "./auth.js";
import type { Row } from "./db.js";
import { ago, fmtDate, html, raw, type Safe } from "./html.js";

export const CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Dresses", "Shoes", "Accessories", "Gear", "Games", "Other"];
export const CONDITIONS = ["Like new", "Great", "Good", "Well loved"];

export interface Ctx {
  me: Row | null;
  counts: { unread: number; cart: number };
  flashes: Flash[];
  url: URL;
}

const photoUrl = (key: string) => `/photos/${encodeURIComponent(key)}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const sizeLabel = (size: string) => (size ? `size ${size}` : "one size");

const HANGER = html`<svg width="52" height="40" viewBox="0 0 58 44" aria-hidden="true"><path d="M29 6 a5 5 0 1 1 5 5 q-5 1 -5 6 L3 34 Q1 38 6 38 L52 38 Q57 38 55 34 L29 17" fill="none" stroke="#1f1f1f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BELL = html`<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z M10 21h4" fill="none" stroke="#1f1f1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BAG = html`<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6z M9 8V6a3 3 0 0 1 6 0v2" fill="none" stroke="#1f1f1f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SEARCH = html`<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 4a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13z M15.5 15.5L21 21" fill="none" stroke="#1f1f1f" stroke-width="2" stroke-linecap="round"/></svg>`;
const STICK = html`<svg width="90" height="90" viewBox="0 0 120 120" aria-hidden="true"><path d="M60 20 a14 14 0 1 1 0 28 a14 14 0 1 1 0-28 M60 48 L60 85 M60 60 L38 50 M60 60 L82 50 M60 85 L44 108 M60 85 L76 108 M54 32 L56 32 M64 32 L66 32 M54 41 Q60 37 66 41" fill="none" stroke="#1f1f1f" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const CAMERA = html`<svg width="64" height="54" viewBox="0 0 64 54" aria-hidden="true"><path d="M6 14 L20 14 L25 6 L39 6 L44 14 L58 14 L58 48 L6 48 Z M32 20 a11 11 0 1 1 -0.1 0" fill="none" stroke="#1f1f1f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A POST form with a single button. */
const postButton = (action: string, label: string, cls: string, extra: Safe | string = "") =>
  html`<form method="post" action="${action}">${extra}<button class="${cls}" type="submit">${label}</button></form>`;
const back = (to: string) => html`<input type="hidden" name="back" value="${to}">`;

export function layout(ctx: Ctx, title: string, body: Safe): string {
  const { me, counts, url } = ctx;
  const on = (p: string) => (url.pathname === p ? "on" : "");
  const header = me
    ? html`
<header class="wrap topbar">
  <a href="/" class="brand">${HANGER}<span class="brand-label wobbly">AO Community Closet</span></a>
  <nav class="nav" aria-label="Main">
    <a href="/" class="${on("/")}">Browse</a>
    <a href="/items/new" class="${on("/items/new")}">+ List an item</a>
    <a href="/inbox" class="${on("/inbox")}">${BELL} Inbox ${counts.unread ? html`<span class="badge red">${counts.unread}<span class="sr-only"> unread</span></span>` : ""}</a>
    <a href="/cart" class="${on("/cart")}">${BAG} Cart <span class="badge">${counts.cart}</span></a>
    <span class="me">@${me.username}</span>
    ${postButton("/logout", "log out", "linklike")}
  </nav>
</header>`
    : "";
  const flashes = ctx.flashes.length
    ? html`<ul class="flashes" role="status">${ctx.flashes.map(([k, m]) => html`<li class="flash wobbly ${k === "error" ? "error" : ""}">${m}</li>`)}</ul>`
    : "";
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Permanent+Marker&display=swap">
  <link rel="stylesheet" href="/style.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
${header}
<div class="wrap">
  ${flashes}
  ${body}
</div>
</body>
</html>`.value;
}

// ------------------------------------------------------------------ auth

export function authPage(mode: "login" | "signup", needCode: boolean, form: Record<string, string> = {}): Safe {
  const signup = mode === "signup";
  const field = (id: string, label: string, attrs: Safe | string = "") =>
    html`<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${id}" class="wobbly" ${attrs}></div>`;
  return html`
<div class="auth">
  <section class="pitch">
    <span class="brand-label wobbly" style="align-self:flex-start;font-size:clamp(32px,6vw,46px);padding:8px 22px;transform:rotate(-2deg)">AO Community Closet</span>
    <p>A notebook of clothes and stuff our friend group is happy to lend out.</p>
    <ol>
      <li>Snap a photo of something you don't mind lending.</li>
      <li>Browse what everyone else has listed.</li>
      <li>Add stuff to your cart, check out, and the owner gets a heads-up.</li>
      <li>Give it back. (Seriously.)</li>
    </ol>
  </section>
  <section class="box wobbly2">
    <div class="tape" style="width:110px;margin-left:-55px;transform:rotate(2deg)"></div>
    <nav class="tabs" aria-label="Account">
      <a href="/login" class="${signup ? "" : "on"}" ${signup ? "" : raw('aria-current="page"')}>Log in</a>
      <a href="/signup" class="${signup ? "on" : ""}" ${signup ? raw('aria-current="page"') : ""}>Sign up</a>
    </nav>
    <form method="post">
      ${signup ? field("display_name", "Your name (what friends call you)", html`maxlength="40" value="${form.display_name || ""}"`) : ""}
      ${field("username", "Username", html`autocomplete="username" required value="${form.username || ""}"`)}
      ${field("password", "Password", raw(signup ? 'type="password" required minlength="8" autocomplete="new-password"' : 'type="password" required autocomplete="current-password"'))}
      ${signup ? field("password2", "Password again", raw('type="password" required minlength="8" autocomplete="new-password"')) : ""}
      ${signup && needCode ? field("invite_code", "Invite code (ask in the group chat)", raw("required")) : ""}
      <button class="btn wobbly" type="submit" style="margin-top:8px">${signup ? "Make my account" : "Open the closet"}</button>
      <p class="muted" style="margin:0;text-align:center;font-size:18px">
        ${signup ? html`Already in? <a href="/login">Log in</a>` : html`New here? <a href="/signup">Make an account</a>`}
      </p>
    </form>
  </section>
</div>`;
}

// ------------------------------------------------------------------ browse

export interface BrowseState {
  q: string;
  category: string;
  size: string;
  available: boolean;
  sort: string;
}

function browseUrl(s: BrowseState, over: Partial<BrowseState>): string {
  const m = { ...s, ...over };
  const p = new URLSearchParams();
  if (m.q) p.set("q", m.q);
  if (m.category) p.set("category", m.category);
  if (m.size) p.set("size", m.size);
  if (m.available) p.set("available", "1");
  if (m.sort && m.sort !== "new") p.set("sort", m.sort);
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

function card(it: Row, me: Row, inCart: Set<number>, here: string): Safe {
  const borrowed = it.status === "borrowed";
  let action: Safe;
  if (borrowed) {
    action = html`<p class="out">With ${it.borrower_name || "someone"}${it.due_date ? ` until ${fmtDate(it.due_date)}` : ""}</p>
      <button class="btn wobbly" disabled>Can't borrow right now</button>`;
  } else if (it.owner_id === me.id) {
    action = html`<a class="btn light wobbly" href="/items/${it.id}">Yours · view</a>`;
  } else if (inCart.has(it.id)) {
    action = postButton(`/cart/remove/${it.id}`, "In your cart (remove)", "btn incart wobbly", back(here));
  } else {
    action = postButton(`/cart/add/${it.id}`, "Add to cart", "btn wobbly", back(here));
  }
  return html`
<article class="card ${borrowed ? "is-borrowed" : ""}">
  <div class="tape"></div>
  <a class="photo" href="/items/${it.id}" tabindex="-1" aria-hidden="true">
    ${it.cover ? html`<img src="${photoUrl(it.cover)}" alt="" loading="lazy">` : ""}
    ${borrowed ? html`<span class="stamp">BORROWED</span>` : ""}
  </a>
  <h2><a href="/items/${it.id}">${it.name}</a></h2>
  <p class="meta">${it.category} · ${sizeLabel(it.size)} · ${it.condition}</p>
  <div class="owner">
    <span class="avatar" aria-hidden="true">${String(it.owner_name).slice(0, 1).toUpperCase()}</span>
    <span>from <b>${it.owner_id === me.id ? "you" : it.owner_name}</b> · ${ago(it.created_at)}</span>
  </div>
  ${action}
</article>`;
}

export function browsePage(ctx: Ctx, s: BrowseState, d: {
  items: Row[]; total: number; catCounts: Record<string, number>; sizes: string[]; inCart: Set<number>;
}): Safe {
  const here = ctx.url.pathname + ctx.url.search;
  const opt = (v: string, label: string) => html`<option value="${v}" ${s.sort === v ? "selected" : ""}>${label}</option>`;
  return html`
<section class="intro">
  <div>
    <h1>Stuff you can borrow</h1>
    <p>Everything your friends are willing to lend. Please bring it back.</p>
  </div>
  ${d.total ? html`<p class="aside-note">&larr; ${plural(d.total, "thing")} in the closet</p>` : ""}
</section>

<div class="browse">
  <form class="filters panel wobbly2" method="get" action="/" aria-label="Filters">
    <div class="field">
      <label for="q">Search</label>
      <div class="search wobbly">${SEARCH}<input id="q" name="q" type="search" placeholder="hoodie, tent, a friend's name…" value="${s.q}"></div>
    </div>
    <div class="field">
      <span class="label" id="cat-label">Category</span>
      <div class="chips" role="group" aria-labelledby="cat-label">
        <a class="chip wobbly ${s.category ? "" : "on"}" href="${browseUrl(s, { category: "" })}">All <span>${d.total}</span></a>
        ${CATEGORIES.filter((c) => d.catCounts[c]).map((c) =>
          html`<a class="chip wobbly ${s.category === c ? "on" : ""}" href="${browseUrl(s, { category: c })}" ${s.category === c ? raw('aria-current="true"') : ""}>${c} <span>${d.catCounts[c]}</span></a>`)}
      </div>
      <input type="hidden" name="category" value="${s.category}">
    </div>
    <div class="field">
      <label for="size">Size</label>
      <select id="size" name="size" class="wobbly">
        <option value="">Any size</option>
        ${d.sizes.map((z) => html`<option value="${z}" ${z.toLowerCase() === s.size.toLowerCase() ? "selected" : ""}>${z}</option>`)}
      </select>
    </div>
    <label class="check"><input type="checkbox" name="available" value="1" ${s.available ? "checked" : ""}> Only show stuff I can borrow now</label>
    <input type="hidden" name="sort" value="${s.sort}">
    <button class="btn wobbly" type="submit">Apply</button>
    <a href="/" style="font-size:19px">clear everything</a>
  </form>

  <main class="results">
    <div class="results-bar">
      <p>Showing <b>${d.items.length}</b> of ${d.total} things</p>
      <form class="sort" method="get" action="/">
        ${s.q ? html`<input type="hidden" name="q" value="${s.q}">` : ""}
        ${s.category ? html`<input type="hidden" name="category" value="${s.category}">` : ""}
        ${s.size ? html`<input type="hidden" name="size" value="${s.size}">` : ""}
        ${s.available ? html`<input type="hidden" name="available" value="1">` : ""}
        <label for="sort">Sort by</label>
        <select id="sort" name="sort" class="wobbly" onchange="this.form.submit()">
          ${opt("new", "Newest first")}${opt("az", "Name A–Z")}${opt("owner", "Owner A–Z")}${opt("avail", "Available first")}
        </select>
        <noscript><button class="btn light wobbly" type="submit">Sort</button></noscript>
      </form>
    </div>
    ${d.items.length ? "" : html`
    <div class="empty wobbly">${STICK}
      ${d.total
        ? html`<p style="margin:8px 0 0">Nothing matches that. Try a different search, or ask the group chat.</p>`
        : html`<p style="margin:8px 0 0">The closet is empty! <a href="/items/new">Be the first to list something.</a></p>`}
    </div>`}
    <div class="cards">${d.items.map((it) => card(it, ctx.me!, d.inCart, here))}</div>
  </main>
</div>`;
}

// ------------------------------------------------------------------ item detail

export function itemPage(ctx: Ctx, item: Row, photos: Row[], inCart: boolean): Safe {
  const me = ctx.me!;
  const borrowed = item.status === "borrowed";
  const mine = item.owner_id === me.id;
  const here = `/items/${item.id}`;
  let action: Safe;
  if (borrowed) {
    action = html`<p class="out" style="font-size:21px">With ${item.borrower_name || "someone"}${item.due_date ? ` until ${fmtDate(item.due_date)}` : ""}. You can look, but you can't check it out right now.</p>
      <button class="btn wobbly" disabled style="align-self:flex-start">Can't borrow right now</button>`;
  } else if (mine) {
    action = html`<p class="muted">This is yours. Friends can add it to their cart.</p>
      <form method="post" action="/items/${item.id}/delete" onsubmit="return confirm('Take this out of the closet for good?')">
        <button class="btn light wobbly" type="submit">Remove from the closet</button>
      </form>`;
  } else if (inCart) {
    action = html`${postButton(`/cart/remove/${item.id}`, "In your cart (remove)", "btn incart wobbly", back(here))}<a href="/cart">go to cart &rarr;</a>`;
  } else {
    action = postButton(`/cart/add/${item.id}`, "Add to cart", "btn wobbly", back(here));
  }
  return html`
<p style="margin:18px 0 0"><a href="/">&larr; back to the closet</a></p>
<div class="detail">
  <div class="gallery">
    <div class="card ${borrowed ? "is-borrowed" : ""}">
      <div class="tape"></div>
      <div class="photo">
        ${photos.length ? html`<img id="main-photo" src="${photoUrl(photos[0].filename)}" alt="Photo of ${item.name}">` : ""}
        ${borrowed ? html`<span class="stamp">BORROWED</span>` : ""}
      </div>
    </div>
    ${photos.length > 1 ? html`
    <div class="thumbs">
      ${photos.map((p, i) => html`<a href="${photoUrl(p.filename)}" onclick="document.getElementById('main-photo').src=this.href;return false;" aria-label="Show photo ${i + 1}"><img src="${photoUrl(p.filename)}" alt=""></a>`)}
    </div>` : ""}
  </div>
  <section class="info">
    <h1>${item.name}</h1>
    <p class="meta" style="font-size:22px">${item.category} · ${sizeLabel(item.size)} · ${item.condition}</p>
    <div class="owner" style="font-size:21px">
      <span class="avatar" aria-hidden="true">${String(item.owner_name).slice(0, 1).toUpperCase()}</span>
      <span>from <b>${mine ? "you" : item.owner_name}</b> (@${item.owner_username}) · listed ${ago(item.created_at)}</span>
    </div>
    ${item.description ? html`<p style="font-size:22px;white-space:pre-line">${item.description}</p>` : ""}
    ${item.rules ? html`<p class="rule">House rules: ${item.rules}</p>` : ""}
    ${action}
  </section>
</div>`;
}

// ------------------------------------------------------------------ list an item

export function newItemPage(form: Record<string, string> = {}): Safe {
  return html`
<section class="intro">
  <div>
    <h1>Put something in the closet</h1>
    <p>A clear photo and an honest description go a long way.</p>
  </div>
</section>
<div class="two">
  <form id="new-item" class="main panel wobbly2" method="post" enctype="multipart/form-data">
    <label class="drop wobbly" for="photos">
      ${CAMERA}
      <span style="font-size:22px">Drop photos here or tap to choose</span>
      <span class="muted" style="font-size:17px">Up to 4 photos · the first one is the cover</span>
      <input id="photos" name="photos" type="file" accept="image/*" multiple required>
    </label>
    <div class="previews" id="previews" aria-live="polite"></div>
    <div class="field">
      <label for="name">What is it?</label>
      <input id="name" name="name" class="wobbly" maxlength="80" required value="${form.name || ""}" placeholder="Cozy grey hoodie">
    </div>
    <div class="field">
      <label for="description">Describe it</label>
      <textarea id="description" name="description" class="wobbly" rows="4" maxlength="2000" placeholder="Color, fit, anything people should know">${form.description || ""}</textarea>
    </div>
    <div class="grid-3">
      <div class="field">
        <label for="category">Category</label>
        <select id="category" name="category" class="wobbly" required>
          ${CATEGORIES.map((c) => html`<option ${form.category === c ? "selected" : ""}>${c}</option>`)}
        </select>
      </div>
      <div class="field">
        <label for="size">Size</label>
        <input id="size" name="size" class="wobbly" maxlength="20" value="${form.size || ""}" placeholder="M, US 9, one size…">
      </div>
      <div class="field">
        <label for="condition">Condition</label>
        <select id="condition" name="condition" class="wobbly">
          ${CONDITIONS.map((c) => html`<option ${(form.condition || "Good") === c ? "selected" : ""}>${c}</option>`)}
        </select>
      </div>
    </div>
    <div class="field">
      <label for="rules">House rules for borrowers (optional)</label>
      <input id="rules" name="rules" class="wobbly" maxlength="200" value="${form.rules || ""}" placeholder="e.g. dry clean only, back within 2 weeks">
    </div>
    <div class="actions">
      <button class="btn wobbly" type="submit" id="submit-btn">Add it to the closet</button>
      <a href="/" style="min-height:44px;display:inline-flex;align-items:center">never mind</a>
    </div>
  </form>
  <aside class="side">
    <p class="aside-note">Tips &darr;</p>
    <div class="panel wobbly" style="transform:rotate(1deg)">
      <ul style="margin:0;padding-left:22px;line-height:1.6">
        <li>Good light, plain background.</li>
        <li>Put the real size. Nobody likes surprises.</li>
        <li>Mention stains, missing pieces, quirks.</li>
        <li>Once someone checks it out, it's marked BORROWED until you say you got it back.</li>
      </ul>
    </div>
  </aside>
</div>
<script src="/new-item.js" defer></script>`;
}

// ------------------------------------------------------------------ cart

export function cartPage(items: Row[]): Safe {
  const ready = items.filter((i) => i.status === "available");
  const owners = [...new Set(ready.map((i) => i.owner_name as string))].sort();
  return html`
<section class="intro">
  <div>
    <h1>Your borrow list</h1>
    <p>Each owner gets a note when you check out.</p>
  </div>
</section>
<div class="two">
  <section class="main">
    ${items.length ? "" : html`<div class="empty wobbly">Your cart is empty. <a href="/">Go find something good.</a></div>`}
    ${items.map((it) => html`
    <article class="row-card wobbly2">
      <div class="thumb">${it.cover ? html`<img src="${photoUrl(it.cover)}" alt="">` : ""}</div>
      <div class="grow">
        <h2><a href="/items/${it.id}" style="color:inherit">${it.name}</a></h2>
        <p class="muted">from <b>${it.owner_name}</b> · ${it.category}${it.size ? ` · size ${it.size}` : ""}</p>
        ${it.rules ? html`<p class="muted">${it.rules}</p>` : ""}
        ${it.status !== "available" ? html`<p class="late">Someone grabbed this first. It won't be included.</p>` : ""}
      </div>
      ${postButton(`/cart/remove/${it.id}`, "remove", "linklike")}
    </article>`)}
  </section>
  ${items.length ? html`
  <aside class="side">
    <form class="panel wobbly" method="post" action="/cart/checkout" style="display:flex;flex-direction:column;gap:14px;transform:rotate(-.6deg)">
      <h2 class="marker" style="margin:0;font-size:28px">Check out</h2>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
        <div class="field"><label for="start_date">Pick up</label><input id="start_date" name="start_date" type="date" class="wobbly"></div>
        <div class="field"><label for="end_date">Give back by</label><input id="end_date" name="end_date" type="date" class="wobbly"></div>
      </div>
      <div class="field">
        <label for="message">Note to the owners</label>
        <textarea id="message" name="message" rows="3" class="wobbly" maxlength="500" placeholder="What's it for? When can you grab it?"></textarea>
      </div>
      <p class="muted" style="margin:0">${plural(ready.length, "thing")} from ${plural(owners.length, "friend")}${owners.length ? `: ${owners.join(", ")}` : ""}.</p>
      <button class="btn wobbly" type="submit" ${ready.length ? "" : "disabled"}>Send borrow requests</button>
      <p class="muted" style="margin:0;font-size:17px">Items show as BORROWED right away so nobody double-books them.</p>
    </form>
  </aside>
  <script>
  (function () {
    var s = document.getElementById('start_date'), e = document.getElementById('end_date');
    var iso = function (x) { return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
    var d = new Date(); s.value = iso(d); s.min = iso(d);
    var w = new Date(d); w.setDate(w.getDate() + 7); e.value = iso(w); e.min = iso(d);
  })();
  </script>` : ""}
</div>`;
}

// ------------------------------------------------------------------ inbox

function noteText(n: Row): Safe {
  switch (n.kind) {
    case "borrow_request": return html`<b>${n.actor_name}</b> wants to borrow your <b>${n.item_name}</b>`;
    case "request_approved": return html`<b>${n.actor_name}</b> said yes to lending you the <b>${n.item_name}</b>`;
    case "request_declined": return html`<b>${n.actor_name}</b> can't lend you the <b>${n.item_name}</b> right now`;
    default: return html`<b>${n.actor_name}</b> marked the <b>${n.item_name}</b> as returned. Thanks!`;
  }
}

export function inboxPage(notes: Row[], lentOut: Row[], borrowing: Row[]): Safe {
  const today = new Date().toISOString().slice(0, 10);
  return html`
<div class="two">
  <section class="main">
    <h1 style="padding-top:4px">Inbox</h1>
    <p class="muted" style="margin:-8px 0 6px;font-size:22px">Who wants your stuff, and what's still out.</p>
    ${notes.length ? "" : html`<div class="empty wobbly">Nothing yet. When a friend wants to borrow something of yours, it shows up here.</div>`}
    ${notes.map((n) => {
      const pending = n.kind === "borrow_request" && n.loan_status === "requested";
      let status: Safe | string = "";
      if (n.kind === "borrow_request") {
        if (pending) {
          status = html`<div class="actions">
            ${postButton(`/loans/${n.loan_id}/approve`, "Sounds good", "btn wobbly")}
            ${postButton(`/loans/${n.loan_id}/decline`, "Sorry, can't right now", "btn light wobbly")}
          </div>`;
        } else if (n.loan_status === "approved") status = html`<p class="ok">You said yes.</p>`;
        else if (n.loan_status === "declined") status = html`<p class="ok">You passed. It's back in the closet.</p>`;
        else if (n.loan_status === "returned") status = html`<p class="ok">Returned.</p>`;
      }
      return html`
    <article class="note wobbly2 ${n.is_read && !pending ? "read" : ""}">
      <div class="top"><p>${noteText(n)}</p><span class="muted" style="font-size:17px">${ago(n.created_at)}</span></div>
      ${n.kind === "borrow_request" && (n.start_date || n.end_date)
        ? html`<p class="muted" style="margin:0">Pick up ${fmtDate(n.start_date) || "?"} · back by ${fmtDate(n.end_date) || "?"}</p>` : ""}
      ${n.kind === "borrow_request" && n.message ? html`<p class="quote">&ldquo;${n.message}&rdquo;</p>` : ""}
      ${status}
    </article>`;
    })}
  </section>

  <aside class="side" style="padding-top:8px">
    <div class="panel wobbly" style="transform:rotate(.6deg)">
      <h2 class="marker" style="margin:0 0 12px;font-size:26px">Your stuff that's out</h2>
      ${lentOut.length ? html`
      <ul class="list-plain">
        ${lentOut.map((l) => {
          const late = l.end_date && l.end_date < today;
          return html`<li>
          <b style="font-size:21px">${l.item_name}</b>
          <span class="${late ? "late" : "muted"}">with ${l.borrower_name}${l.end_date ? ` · due ${fmtDate(l.end_date)}` : ""}${late ? " (late!)" : ""}</span>
          ${postButton(`/loans/${l.id}/returned`, "Got it back", "btn light wobbly")}
        </li>`;
        })}
      </ul>
      <p class="muted" style="margin:12px 0 0;font-size:17px">"Got it back" removes the BORROWED stamp.</p>`
      : html`<p class="muted" style="margin:0">Nothing of yours is out right now.</p>`}
    </div>
    <div class="panel wobbly2" style="transform:rotate(-.6deg)">
      <h2 class="marker" style="margin:0 0 12px;font-size:26px">Stuff you're borrowing</h2>
      ${borrowing.length ? html`
      <ul class="list-plain">
        ${borrowing.map((l) => html`<li>
          <b style="font-size:21px">${l.item_name}</b>
          <span class="muted">from ${l.lender_name}${l.end_date ? ` · give back by ${fmtDate(l.end_date)}` : ""}</span>
          <span class="muted" style="font-size:17px">${l.status === "requested" ? `Waiting on ${l.lender_name}` : `${l.lender_name} said yes`}</span>
        </li>`)}
      </ul>` : html`<p class="muted" style="margin:0">You're not borrowing anything.</p>`}
    </div>
  </aside>
</div>`;
}

// ------------------------------------------------------------------ misc

export const messagePage = (title: string, body: string) =>
  html`<div class="empty wobbly" style="margin-top:40px">${STICK}<h1 style="margin:8px 0">${title}</h1><p>${body}</p><p><a href="/">Back to the closet</a></p></div>`;

export const setupPage = (missing: string) => html`
<div class="panel wobbly" style="margin-top:40px">
  <h1>Almost there!</h1>
  <p>The site needs the <b>${missing}</b> setting before it can open.</p>
  <p>In Netlify, go to <b>Site configuration → Environment variables</b> and add
  <code>TURSO_DATABASE_URL</code>, <code>TURSO_AUTH_TOKEN</code> and <code>SECRET_KEY</code>
  (and optionally <code>INVITE_CODE</code>), then redeploy. The README has the details.</p>
</div>`;
