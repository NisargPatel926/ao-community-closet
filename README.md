# AO Community Closet

A small lending marketplace for a friend group. People list clothes and other stuff with photos, and friends borrow it by adding it to a cart and checking out.

**Runs on Netlify:**

| Piece | Where it lives |
|---|---|
| Pages and logic | One Netlify Function (`netlify/functions/app.mts` → `src/`) that renders HTML |
| Database | [Turso](https://turso.tech), which is hosted SQLite |
| Photos | Netlify Blobs (built in, no setup) |
| CSS, favicon, upload script | `public/`, served as static files |

## Deploy to Netlify

### 1. Make a Turso database (free)

Sign up at [turso.tech](https://turso.tech) and create a database, for example `ao-closet`. You need two values:

- **Database URL**, which looks like `libsql://ao-closet-yourname.turso.io`
- **Auth token**, made with "Create token" on the database page

With the Turso CLI instead:

```bash
turso db create ao-closet
turso db show ao-closet --url
turso db tokens create ao-closet
```

The tables are created automatically the first time the site runs.

### 2. Connect the repo in Netlify

1. In Netlify, choose **Add new site → Import an existing project → GitHub**, then pick `ao-community-closet`.
2. Leave the build command empty. The publish directory (`public`) comes from `netlify.toml`.
3. Under **Site configuration → Environment variables**, add:

| Variable | Value |
|---|---|
| `TURSO_DATABASE_URL` | the database URL from step 1 |
| `TURSO_AUTH_TOKEN` | the token from step 1 |
| `SECRET_KEY` | a long random string, e.g. the output of `openssl rand -hex 32` |
| `INVITE_CODE` | optional; if set, people need it to sign up |

4. Deploy, or redeploy if you added the variables after the first deploy. Every push to the branch you deploy from redeploys the site.

If a variable is missing, the site shows an "Almost there!" page naming it.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:8888, using local.db and .local-photos/
npm test         # end-to-end test of the whole borrowing flow
```

Local mode needs no Turso or Netlify account.

## How it works

1. **Accounts**: username + password. Passwords are hashed with scrypt. Logins are kept in a signed cookie that lasts 60 days.
2. **Listing**: name, description, category, size, condition, optional house rules, and 1–4 photos. The browser shrinks photos to 1600px JPEGs before uploading, because Netlify functions accept about 6 MB per request.
3. **Browse**: search (name, description, owner, category), filter (category, size, "available now"), sort (newest, A–Z, owner, available first).
4. **Borrowing**: add to cart, then check out with dates and a note. In **one database transaction**, each item is marked `borrowed`, a `loans` row is created and the owner gets a notification. Two friends can't grab the same thing.
5. **Borrowed items** still show on the browse page with a BORROWED stamp and "With Jess until Dec 9", but can't be added to a cart.
6. **Inbox**: owners can say "Sounds good" (approve), "Sorry, can't right now" (decline, which frees the item) or "Got it back" (returned, which frees the item). The borrower is notified each time.

## Database

The schema is in [`src/schema.ts`](src/schema.ts). It has six SQLite tables:

```
users ──< items ──< item_photos
  │         │
  │         ├──< cart_items >── users
  │         │
  └──< loans >── items          (borrower_id, lender_id → users)
          │
          └──< notifications >── users
```

- **users**: `username` (unique, case-insensitive), `display_name`, `password_hash`
- **items**: `owner_id`, `name`, `description`, `category`, `size`, `condition`, `rules`, `status` (`available` | `borrowed`)
- **item_photos**: `item_id`, `filename` (the Netlify Blobs key), `position` (0 = cover)
- **cart_items**: `(user_id, item_id)` primary key
- **loans**: `item_id`, `borrower_id`, `lender_id`, `start_date`, `end_date`, `message`, `status` (`requested` → `approved` → `returned`, or `declined`)
- **notifications**: `user_id` (recipient), `actor_id`, `loan_id`, `kind`, `is_read`

## Project layout

```
netlify/functions/app.mts   Netlify entry point (handles every page)
src/app.ts                  routes and logic
src/views.ts                HTML templates
src/db.ts                   Turso / local SQLite
src/storage.ts              Netlify Blobs / local folder for photos
src/auth.ts                 passwords, session cookies, flash messages
public/                     style.css, new-item.js, favicon.svg
scripts/local-server.ts     local dev server
tests/e2e.test.ts           end-to-end test
```

## Ideas for later

- Email notifications, e.g. via Resend, on top of the in-app inbox
- Editing a listing
- Password reset
