# tool-signout
Ener.co crew tool sign-out sheet

## Warehouse surplus sale (`surplus.html`)

Sells retired warehouse equipment, staff first and then the public. It's built to be dropped into
the field hub (enerfieldhub.netlify.app) next to the other warehouse pages, and it stores its data
in the hub's Firebase under `warehouse/surplus/`.

- **Public:** sees the used-market comparable price for each item. They can send a request to buy
  once the sale is switched to the public phase.
- **Staff** (clubhouse password): see the discounted staff prices and can place holds or bids.
- **Helper** (assistant password): uploads or takes photos and adds a name, condition and
  description. Helpers never see costs or staff prices, and everything they add stays a draft.
- **Admin** (warehouse full-numbers password): bulk photo upload, editing listings, the inbox,
  sale settings and the live loss report.

Staff prices, staff names and bids are encrypted with a key derived from the staff password.
What we paid is encrypted with the admin key. Public buyers' contact details are encrypted to an
admin-only RSA key. None of it is readable from the page source or the database.

To change a password or refresh the price catalog, rebuild the vault:

    node tools/build-surplus-vault.mjs master.json <staff-password> <admin-password> <helper-password> tools/surplus-comps.json

`master.json` is the `DEFAULT_MASTER` array from the hub's kit-inventory page. Don't commit it,
because it holds purchase prices in plain text and this repo is public. Rebuilding the vault with
a new staff password makes existing staff prices and bids unreadable, so do it before listing.

### Google Drive photo sync (`tools/drive-sync.gs`)

Photos can go in through either door, and they end up in both places:

- **Into Drive:** drop photos in either surplus folder. A loose photo becomes one draft listing.
  A sub-folder becomes one listing named after the folder, with every photo inside it, including
  photos added to it later. Drive turns iPhone HEIC photos into JPEGs on the way.
- **Into the site:** a helper or admin snaps or uploads photos on the page. Every 5 minutes they
  are copied to `<first folder>/From the sale site/<listing title>/` as a backup.

One-time setup, done while signed in to the Google account that owns the folders:

1. Go to script.google.com → **New project**, paste in `tools/drive-sync.gs`, and save it.
2. Pick `setup` in the function menu, click **Run**, and approve the permissions.
   It runs the first sync and schedules one every 5 minutes.
3. Share the Drive folders with the assistants (Editor access).

The admin listings page shows when the last sync ran and any errors.
