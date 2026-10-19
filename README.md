# tool-signout
Ener.co crew tool sign-out sheet

## Warehouse surplus sale (`surplus.html`)

Sells retired warehouse equipment, staff first and then the public. It's built to be dropped into
the field hub (enerfieldhub.netlify.app) next to the other warehouse pages, and it stores its data
in the hub's Firebase under `warehouse/surplus/`.

- **Public:** sees the used-market comparable price for each item. They can send a request to buy
  once the sale is switched to the public phase.
- **Staff** (clubhouse password): see the discounted staff prices and can place holds or bids.
- **Admin** (warehouse full-numbers password): bulk photo upload, editing listings, the inbox,
  sale settings and the live loss report.

Staff prices, staff names and bids are encrypted with a key derived from the staff password.
What we paid is encrypted with the admin key. Public buyers' contact details are encrypted to an
admin-only RSA key. None of it is readable from the page source or the database.

To change a password or refresh the price catalog, rebuild the vault:

    node tools/build-surplus-vault.mjs master.json <staff-password> <admin-password> tools/surplus-comps.json

`master.json` is the `DEFAULT_MASTER` array from the hub's kit-inventory page. Don't commit it,
because it holds purchase prices in plain text and this repo is public. Rebuilding the vault with
a new staff password makes existing staff prices and bids unreadable, so do it before listing.
