# Urdu Language Support + Urdu Printing

Add a global language switcher (English ⇄ Urdu) that translates the entire UI, sidebar, forms, dashboards, and tables. Same toggle controls the language of printed invoices, loading slips, and reports.

## What the user gets

- A language switch in the sidebar header (EN / اردو) — one click flips the whole app.
- Selection is saved in `localStorage` and remembered across sessions and devices.
- When Urdu is active:
  - Page direction becomes RTL (right-to-left).
  - Noto Nastaliq Urdu font is used for Urdu text.
  - Numbers stay in Western digits (so totals/weights stay readable for accounting).
- Print pages (POS invoice A4 + thermal, delivery loading slip) follow the same setting — print in Urdu when the app is in Urdu, in English otherwise. A small "Print language" toggle on each print page lets you override per print.

## Technical approach

1. **i18n library**: install `i18next` + `react-i18next` (lightweight, no backend, JSON dictionaries bundled).
2. **Dictionaries**: `src/i18n/en.json` and `src/i18n/ur.json` containing every label, button, column, toast, placeholder, and print template string used in the app.
3. **Init**: `src/i18n/index.ts` configures i18next with both resources, reads saved language from `localStorage`, defaults to English.
4. **Provider + direction**: a small `LanguageProvider` (or effect in `App.tsx`) sets `document.documentElement.lang` and `dir` (`rtl` for `ur`, `ltr` for `en`) whenever language changes.
5. **Styling**:
   - Add Noto Nastaliq Urdu via Google Fonts in `index.html`.
   - In `index.css`: when `html[lang="ur"]`, apply the Urdu font family and increase line-height; add RTL-friendly utilities (`text-start`/`text-end` already work with Tailwind's logical properties — verify and switch a few hard-coded `text-left`/`text-right` to logical equivalents only where needed).
6. **Component refactor**: replace hardcoded strings with `t("key")` across:
   - `AppLayout` sidebar nav labels + sign-out
   - `Auth` / `ResetPassword` pages
   - Every page: Dashboard, POS, Farms, Shops, Customers, Suppliers, Purchases, Supplies, Expenses, Trucks, Deliveries, Inventory, Settings
   - Shared `CrudPage` (search placeholder, "Add", empty states)
   - Toast messages
7. **Language switcher UI**: small segmented control (EN / اردو) in the sidebar header that calls `i18n.changeLanguage(...)` and persists to `localStorage`.
8. **Print pages** (`Invoice.tsx`, `Deliveries.tsx` loading slip):
   - Use the same `t()` keys with an Urdu-specific print stylesheet that increases font size for Nastaliq legibility.
   - Add a "Print in اردو / English" toggle button at the top so the user can override the current app language just for this print.
9. **Dates**: keep ISO dates as-is; add a helper that formats them with `Intl.DateTimeFormat("ur-PK")` when Urdu is active for display only (DB values unchanged).

## Out of scope (can be added later if you want)

- Translating dynamic data the user typed in (farm names, customer names, notes) — those stay as entered.
- Server-side / email template translations.
- Right-to-left mirroring of charts on the Dashboard (numbers/labels will translate, chart layout stays LTR).

Approve and I will implement.