# Fishing year rules

New Zealand fishstocks do not share one fishing year. myLFR supports the three
that apply to Licenced Fish Receivers, and classifies every fishstock code into
exactly one of them.

This matters because the Home page reports totals "for this fishing year". A
stock counted against the wrong year produces a figure that does not reconcile
with what the receiver is expected to report.

## The three years

| Start month | Period | Applies to |
| --- | --- | --- |
| October | 1 October – 30 September | Most fishstocks. The default. |
| April | 1 April – 31 March | Rock lobster, southern blue whiting, scallops, and specified shellfish and crab stocks |
| February | 1 February – 31 January | Shortfin and longfin eels at Lake Ellesmere (Te Waihora) only |

The selected year is a single per-installation preference, stored as
`app_settings.fishing_year_start_month` and set either in Settings or from the
Home page selector. It is stored as a **zero-based month index** — `9`, `3`, and
`1` for October, April, and February respectively — because it is consumed by
JavaScript's `Date` constructor. Only those three values are accepted; anything
else is rejected at both the command boundary and in
`set_fishing_year_start_month`.

## Which stocks fall in which year

Classification lives in one place: the `ITEM_FISHING_YEAR_START_MONTH`
expression in [`src-tauri/src/db.rs`](../src-tauri/src/db.rs), used by
`dashboard_metrics`. It is a single `CASE`, so every code lands in exactly one
year and no code is counted twice.

### Fishstocks the receiver added

A receiver can add fishstocks that are not in the shipped list. Nothing can
predict the year of a code that did not exist when the application was built, so
the receiver chooses the year when adding the stock, and it is stored with the
stock (`fishstock_codes.fishing_year_start_month`). That stored choice is the
first branch of the `CASE` and always wins: the code rules below never apply to
a receiver-added stock, even one whose code starts with an April prefix such as
`CRA`. The receiver can change the year later; doing so moves the stock's
totals between years without changing any landing.

The rules below classify the shipped catalogue only.

### February — Lake Ellesmere eels

Matched by **exact code**:

```
LFE13   Long-finned eel, Lake Ellesmere
SFE13   Short-finned eel, Lake Ellesmere
```

Only these two stocks use the February year. Every other `LFE` and `SFE` stock —
`LFE11`, `SFE22`, and so on — is an October stock, so this must stay an exact
match and must never become a prefix match.

Exploratory variants such as `LFE13E` are not landed, so exact matches suffice.

### April — rock lobster, southern blue whiting, shellfish, crabs

Matched by **three-letter prefix**:

| Prefix | Species |
| --- | --- |
| `BYA` | Frilled venus shell |
| `CHC` | Red crab |
| `CRA` | Spiny red rock lobster |
| `DAN` | Ringed dosinia |
| `DSU` | Silky dosinia |
| `GSC` | Giant spider crab |
| `HOR` | Horse mussel |
| `KIC` | King crab |
| `MDI` | Trough shell |
| `MMI` | Large trough shell |
| `PDO` | Deepwater tuatua |
| `PHC` | Packhorse rock lobster |
| `SAE` | Triangle shell |
| `SBW` | Southern blue whiting |
| `SCA` | Scallop |
| `SCC` | Sea cucumber |

Plus one **exact** code:

```
GLM9    Green-lipped mussel, Auckland (West)
```

`GLM9` is exact deliberately. Other green-lipped mussel stocks — `GLM1`, `GLM3`,
`GLM7A`, and so on — use the October year, so a `GLM` prefix match would be
wrong.

### October — everything else

The default: the `ELSE` branch of the `CASE`, so every catalogue code that no
rule above matches is an October stock.

## Rules for changing this

1. **Prefix or exact is a real decision.** Use a prefix only when *every* code
   with that prefix shares the year. `SCA` qualifies: all 27 scallop codes use
   April. `GLM` and `LFE` do not.
2. **Check the whole catalogue before adding a prefix.** A prefix match silently
   captures codes that do not exist yet. Confirm against
   `fishstock-catalogue.json` that no current or plausible future code with that
   prefix belongs to a different year.
3. **Keep the receiver's choice first.** The `CASE` takes the first branch that
   matches, so the stored year of a receiver-added stock must stay the first
   branch, ahead of every code rule.
4. **Exploratory codes are not landed.** Codes ending in `E`, such as `LFE13E` or
   `SCA1E`, are exploratory permits and never appear on a landing, so exact-match
   lists do not need to enumerate them.
5. **Add a test.** Every classification change should come with a case in
   [`src-tauri/src/tests.rs`](../src-tauri/src/tests.rs) proving the affected
   codes land in the intended year and that neighbouring codes did not move.
   `dashboard_metrics_put_every_scallop_stock_in_the_april_fishing_year` is the
   pattern to copy.

## Known limitation

The fishing year is a **single installation-wide preference**, not a per-stock
property. A receiver handling both scallops and snapper sees one year at a time
and switches the selector to see the other. The classification above decides
which stocks are counted for the selected year; it does not let two years be
displayed at once.

This is a deliberate simplification. Revisit it if receivers routinely work
across year groups, since the alternative — reporting each stock against its own
year simultaneously — is a substantially different Home page.

## Where this is implemented

| Concern | File |
| --- | --- |
| Year options, labels, and date-range maths | [`src/lib/fishingYear.ts`](../src/lib/fishingYear.ts) |
| Stock classification and metric scoping | `ITEM_FISHING_YEAR_START_MONTH` and `dashboard_metrics` in [`src-tauri/src/db.rs`](../src-tauri/src/db.rs) |
| Receiver-added stocks and their chosen year | [`src/pages/Species.tsx`](../src/pages/Species.tsx) and `add_user_fishstock` in [`src-tauri/src/db.rs`](../src-tauri/src/db.rs) |
| Stored preference and validation | `get`/`set_fishing_year_start_month` in [`src-tauri/src/db.rs`](../src-tauri/src/db.rs) |
| Home page selector | [`src/pages/Dashboard.tsx`](../src/pages/Dashboard.tsx) |
| Settings selector | [`src/pages/Settings.tsx`](../src/pages/Settings.tsx) |
| Tests | `dashboard_metrics_*` in [`src-tauri/src/tests.rs`](../src-tauri/src/tests.rs) |
