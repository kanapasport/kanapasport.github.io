# Pasport Kaňa – firemní web

Interní web firmy Pasport Kaňa: návody, úkoly, kalendář a výkazy práce.

- Statický web bez buildu (čisté HTML + JS), hostovaný na GitHub Pages.
- Data a přihlašování: Firebase (Firestore + Authentication). Veškerý firemní
  obsah je za přihlášením a chrání ho serverová pravidla (`firestore.rules`);
  v tomhle repozitáři žádná data nejsou.
- Bez přihlášení jsou vidět jen veřejné návody.

## Struktura

| Co | Kde |
|---|---|
| stránky webu | `*.html` v kořeni |
| styly, skripty, fonty | `assets/` |
| pravidla databáze | `firestore.rules` (nasazují se ručně ve Firebase konzoli) |
