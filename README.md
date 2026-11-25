# AO Community Closet

A small lending marketplace for a friend group. People list clothes and other stuff with photos, and friends borrow it by adding it to a cart and checking out.

Built with **Flask + SQLite**, server-rendered templates, and no JavaScript framework.

## Run it locally

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
INVITE_CODE=pickasecretword flask --app app run --debug
# open http://127.0.0.1:5000/signup
```

The database (`closet.db`) and `uploads/` folder are created automatically on first run.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `INVITE_CODE` | empty | If set, people need this code to sign up. Share it in the group chat. |
| `SECRET_KEY` | random, saved in `.secret_key` | Signs login cookies. Set it in production. |
| `DATABASE` | `./closet.db` | Path to the SQLite file. |
| `UPLOAD_FOLDER` | `./uploads` | Where photos are stored. |

## How it works

1. **Accounts**: username + password. Passwords are stored as scrypt hashes (werkzeug).
2. **Listing**: name, description, category, size, condition, optional house rules, and 1–4 photos.
3. **Browse**: search (name, description, owner, category), filter (category, size, "available now"), sort (newest, A–Z, owner, available first).
4. **Borrowing**: add to cart, then check out with pick-up/return dates and a note. Each item gets a `loans` row and the owner gets a `borrow_request` notification. The item flips to `borrowed` **in the same transaction**, so two friends can't check out the same thing.
5. **Borrowed items** still show on the browse page with a BORROWED stamp and "With Jess until Dec 9", but can't be added to a cart.
6. **Lender inbox**: "Sounds good" (approve), "Sorry, can't right now" (decline, which makes the item available again), and "Got it back" (marks it returned and available). The borrower gets a notification for each.

## Database

See [`schema.sql`](schema.sql). Six tables:

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
- **item_photos**: `item_id`, `filename`, `position` (0 = cover)
- **cart_items**: `(user_id, item_id)` primary key
- **loans**: `item_id`, `borrower_id`, `lender_id`, `start_date`, `end_date`, `message`, `status` (`requested` → `approved` → `returned`, or `declined`)
- **notifications**: `user_id` (recipient), `actor_id`, `loan_id`, `kind`, `is_read`

## Deploying

Any host that keeps a persistent disk works, because SQLite and the photos live on disk. Good options are a small VPS, Fly.io with a volume, Render with a persistent disk, or PythonAnywhere.

```bash
gunicorn -w 2 -b 0.0.0.0:8000 app:app
```

Set `SECRET_KEY` and `INVITE_CODE`, put `DATABASE` and `UPLOAD_FOLDER` on the persistent volume, and serve it over HTTPS. To back it up, copy `closet.db` and `uploads/`.

## Ideas for later

- Email or text notifications on top of the in-app inbox
- Editing a listing
- Password reset
- Image resizing and thumbnails (e.g. with Pillow)
