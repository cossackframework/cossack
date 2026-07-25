export const template = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <script>
      (function () {
        try {
          var cookie = document.cookie.split('; ').find(function (item) {
            return item.indexOf('cossack-studio-theme=') === 0;
          });
          var saved = cookie ? cookie.split('=')[1] : null;
          var theme = saved === 'light' || saved === 'dark'
            ? saved
            : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light');
          document.documentElement.classList.toggle('dark', theme === 'dark');
          document.documentElement.style.colorScheme = theme;
        } catch (_) {}
      })();
    </script>
    {{ cossackScripts }}
  </head>
  <body>{{ cossackBody }}</body>
</html>
`;
