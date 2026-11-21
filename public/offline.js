(function () {
  var en = false;
  try { en = localStorage.getItem('cp_lang') === 'en'; } catch (e) { /* কিছু না */ }
  if (en) {
    document.documentElement.lang = 'en';
    document.title = 'Ruvo — Offline';
    document.getElementById('h').textContent = 'You are offline';
    document.getElementById('p').textContent = 'Check your connection and try again';
    document.getElementById('retry').textContent = 'Try again';
  }
  document.getElementById('retry').addEventListener('click', function () { location.reload(); });
})();
