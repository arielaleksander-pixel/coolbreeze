Cool Breeze dashboard, multi-page version (build 2026-11-08.2)
Same layout as the Best Plumber multi-page site.

Pages
  index.html           Home (landing page, with About Cool Breeze)
  dashboard.html       Executive Dashboard (the existing dashboard: Jobs, Sales, Marketing, Operations, Financials)
  knowledge-base.html  Knowledge Base
  health.html          Dashboard Health
Shared files (must be uploaded too)
  cb-health.js, cb-pages.css

How it fits together
  - A bar at the top links the four pages. On the Executive Dashboard the links sit at the right end of its menu.
  - Home's "Jump straight to" buttons open a specific tab, e.g. dashboard.html#bills, #ar, #reviews, #memberships.
  - Dashboard Health quietly opens dashboard.html in a hidden frame to read what it loaded (jobs, reviews, downloads).
    Home and the Knowledge Base show the result of the last check made in the same browser.

How to publish
  1. Upload all 6 files together to the same folder on the web host. index.html becomes the landing page.
  2. Open the site, press Hard Refresh (Ctrl+Shift+R), then open Dashboard Health.
     Section 1 should say "running the latest published version" and "the Executive Dashboard page is the same version".
  The pages must be served from a web address (not opened as files from disk): the hidden frame and the
  version checks are blocked by the browser for file:// pages.

Coolbreeze_Accounting_Dashboard.html (one folder up) is still the all-in-one single-file version.
