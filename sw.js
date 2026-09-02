/* ==========================================================================
   Service worker – JEN kvůli tomu, aby šel web na Androidu nainstalovat
   jako aplikace (Chrome to bez něj nabídne jen jako zástupce).

   SCHVÁLNĚ NIC NECACHUJE. Verze souborů se řídí `?v=NNN` v odkazech a
   nasazuje se přes GitHub Pages – kdyby tady ležela kopie, lidé by po
   nasazení koukali na starý web a nikdo by nepoznal proč. Fetch handler
   tu musí být (bez něj prohlížeč instalaci nenabídne), ale záměrně
   nevolá `respondWith`, takže požadavek jde rovnou na síť.
   (Michal 2. 9. 2026.)
   ========================================================================== */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* nic – vyřídí to prohlížeč sám */ });
