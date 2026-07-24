export const template = `
<!DOCTYPE html>
<html lang="{{ cossackLang }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light dark">
        <script>
          (function () {
            try {
              // Resolve theme BEFORE first paint to avoid a flash of the wrong
              // theme (FOUC). Preference order: cs-theme cookie → system
              // prefers-color-scheme → default dark. The .dark class lives on
              // <html> so the dark CSS variables cascade to everything.
              var cookie = document.cookie.split('; ').find(function (c) {
                return c.indexOf('cs-theme=') === 0;
              });
              var stored = cookie ? cookie.split('=')[1] : null;
              var theme = stored === 'light' || stored === 'dark'
                ? stored
                : (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
              var root = document.documentElement;
              root.classList.toggle('dark', theme === 'dark');
              root.style.colorScheme = theme;
            } catch (e) {
              document.documentElement.classList.add('dark');
              document.documentElement.style.colorScheme = 'dark';
            }
          })();
        </script>
        {{ cossackScripts }}
    </head>
    <body class="antialiased">
        {{ cossackBody }}
    </body>
</html>
`;
