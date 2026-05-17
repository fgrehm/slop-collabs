(function () {
  var STORAGE_KEY = 'clickwall:accepted';
  var MAX_ENTRIES = 50;

  function readAccepted() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeAccepted(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      // ignore: quota, private mode, etc.
    }
  }

  function markAccepted(key) {
    var list = readAccepted().filter(function (k) { return k !== key; });
    list.push(key);
    while (list.length > MAX_ENTRIES) list.shift();
    writeAccepted(list);
  }

  function reveal(wall) {
    wall.classList.add('clickwall-revealed');
    var content = wall.querySelector('[data-clickwall-content]');
    if (content) content.setAttribute('aria-hidden', 'false');
  }

  function init() {
    var walls = document.querySelectorAll('[data-clickwall]');
    var accepted = readAccepted();
    walls.forEach(function (wall) {
      var key = wall.getAttribute('data-clickwall-key');
      if (accepted.indexOf(key) !== -1) {
        wall.classList.add('clickwall-accepted');
        var c = wall.querySelector('[data-clickwall-content]');
        if (c) c.setAttribute('aria-hidden', 'false');
        var onEnter = function () {
          reveal(wall);
          wall.removeEventListener('mouseenter', onEnter);
          wall.removeEventListener('touchstart', onEnter);
        };
        wall.addEventListener('mouseenter', onEnter);
        wall.addEventListener('touchstart', onEnter, { passive: true });
        return;
      }
      var btn = wall.querySelector('[data-clickwall-accept]');
      if (!btn) return;
      btn.addEventListener('click', function () {
        markAccepted(key);
        reveal(wall);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
