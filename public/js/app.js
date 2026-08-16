/* Thalath Space — client bits. No framework, it's 2005. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- profile song
  var player = document.getElementById('ms-player');
  if (player) {
    var src = player.getAttribute('data-src');
    var audio = new Audio(src);
    audio.preload = 'metadata';
    audio.loop = true;
    var btn = player.querySelector('[data-act=play]');
    var bar = player.querySelector('[data-act=seek]');
    var fill = bar ? bar.querySelector('i') : null;
    var time = player.querySelector('.time');
    var hint = player.querySelector('[data-role=hint]');
    var key = 'song:' + src;

    function fmt(s) {
      if (!isFinite(s) || s < 0) s = 0;
      var m = Math.floor(s / 60);
      return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    }
    function paint() {
      var d = audio.duration || 0;
      if (fill) fill.style.width = d ? (audio.currentTime / d) * 100 + '%' : '0';
      if (time) time.textContent = fmt(audio.currentTime) + ' / ' + fmt(d);
    }
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('loadedmetadata', function () {
      var at = parseFloat(sessionStorage.getItem(key) || '0');
      if (at > 0 && at < audio.duration - 1) audio.currentTime = at;
      paint();
    });
    audio.addEventListener('play', function () {
      player.classList.add('playing');
      if (btn) btn.textContent = 'Pause';
      if (hint) hint.style.display = 'none';
    });
    audio.addEventListener('pause', function () {
      player.classList.remove('playing');
      if (btn) btn.textContent = 'Play';
    });
    window.addEventListener('pagehide', function () {
      try { sessionStorage.setItem(key, String(audio.currentTime)); } catch (e) {}
    });

    if (btn) btn.addEventListener('click', function () {
      if (audio.paused) audio.play().catch(function () {}); else audio.pause();
    });
    if (bar) bar.addEventListener('click', function (e) {
      var r = bar.getBoundingClientRect();
      if (audio.duration) audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    });

    if (player.getAttribute('data-autoplay') === '1') {
      var tryPlay = audio.play();
      if (tryPlay && tryPlay.catch) {
        tryPlay.catch(function () {
          if (hint) hint.style.display = 'block';
          // Browsers unlock audio on the first real gesture — take it.
          var kick = function () {
            audio.play().catch(function () {});
            document.removeEventListener('pointerdown', kick);
            document.removeEventListener('keydown', kick);
          };
          document.addEventListener('pointerdown', kick, { once: true });
          document.addEventListener('keydown', kick, { once: true });
        });
      }
    }
  }

  // ------------------------------------------------------------- sortable lists
  document.querySelectorAll('ul.sortable').forEach(function (list) {
    var target = document.querySelector(list.getAttribute('data-target') || '#order-field');

    function sync() {
      var ids = [].map.call(list.children, function (li) { return li.getAttribute('data-id'); });
      if (target) target.value = ids.join(',');
      [].forEach.call(list.children, function (li, i) {
        var idx = li.querySelector('.idx');
        if (idx) idx.textContent = i + 1;
      });
    }

    list.addEventListener('click', function (e) {
      var up = e.target.closest('[data-mv=up]');
      var dn = e.target.closest('[data-mv=down]');
      var rm = e.target.closest('[data-mv=remove]');
      if (!up && !dn && !rm) return;
      e.preventDefault();
      var li = e.target.closest('li');
      if (up && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      if (dn && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      if (rm) li.remove();
      sync();
    });

    // pointer drag (works with touch)
    var dragging = null;
    list.addEventListener('pointerdown', function (e) {
      var li = e.target.closest('li');
      if (!li || e.target.closest('button')) return;
      dragging = li;
      li.classList.add('drag');
      li.setPointerCapture(e.pointerId);
    });
    list.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      e.preventDefault();
      var over = document.elementFromPoint(e.clientX, e.clientY);
      var li = over && over.closest ? over.closest('li') : null;
      if (li && li !== dragging && li.parentElement === list) {
        var rect = li.getBoundingClientRect();
        var after = e.clientY > rect.top + rect.height / 2;
        list.insertBefore(dragging, after ? li.nextSibling : li);
      }
    });
    function endDrag() {
      if (!dragging) return;
      dragging.classList.remove('drag');
      dragging = null;
      sync();
    }
    list.addEventListener('pointerup', endDrag);
    list.addEventListener('pointercancel', endDrag);

    sync();
  });

  // --------------------------------------------------------------- add-to-top-8
  document.querySelectorAll('[data-add-top]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      var list = document.querySelector('ul.sortable');
      if (!list) return;
      var li = document.createElement('li');
      li.setAttribute('data-id', el.getAttribute('data-add-top'));
      li.innerHTML = '<span class="grip">⣿</span><span class="idx"></span>' +
        '<img src="' + el.getAttribute('data-avatar') + '" alt="">' +
        '<b style="flex:1">' + el.getAttribute('data-name') + '</b>' +
        '<button type="button" class="btn small" data-mv="up">▲</button>' +
        '<button type="button" class="btn small" data-mv="down">▼</button>' +
        '<button type="button" class="btn small danger" data-mv="remove">✕</button>';
      list.appendChild(li);
      el.closest('.p, li, .row')?.remove();
      list.dispatchEvent(new Event('click'));
      var ids = [].map.call(list.children, function (x) { return x.getAttribute('data-id'); });
      var field = document.querySelector('#order-field');
      if (field) field.value = ids.join(',');
      [].forEach.call(list.children, function (x, i) {
        var idx = x.querySelector('.idx');
        if (idx) idx.textContent = i + 1;
      });
    });
  });

  // ------------------------------------------------------------------- live prefs
  document.querySelectorAll('[data-live-css]').forEach(function (form) {
    var out = document.getElementById('ms-user-css');
    if (!out) return;
    var t;
    form.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        fetch('/edit/design/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': form.querySelector('[name=_csrf]').value },
          body: new URLSearchParams(new FormData(form)),
        }).then(function (r) { return r.text(); }).then(function (css) { out.textContent = css; })
          .catch(function () {});
      }, 350);
    });
  });

  // --------------------------------------------------------- theme card selection
  document.querySelectorAll('.themecard').forEach(function (card) {
    card.addEventListener('click', function () {
      var input = card.querySelector('input[type=radio]');
      if (input) input.checked = true;
      document.querySelectorAll('.themecard').forEach(function (c) { c.classList.remove('sel'); });
      card.classList.add('sel');
      var apply = document.querySelector('[name=apply_theme]');
      if (apply) apply.checked = true;
      card.closest('form')?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // ----------------------------------------------------------- confirm-on-submit
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // ------------------------------------------------------------- character counts
  document.querySelectorAll('[data-count]').forEach(function (el) {
    var out = document.querySelector(el.getAttribute('data-count'));
    if (!out) return;
    var upd = function () { out.textContent = el.value.length + ' characters'; };
    el.addEventListener('input', upd);
    upd();
  });

  // ------------------------------------------------------------------- PWA + push
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  window.enablePush = function () {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      alert('This browser cannot do push notifications.\n\nOn iPhone: add the site to your Home Screen first, then open it from there.');
      return;
    }
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { alert('Notifications were not allowed.'); return; }
      return fetch('/push/key').then(function (r) { return r.json(); }).then(function (d) {
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlB64(d.key),
          });
        });
      }).then(function (sub) {
        return fetch('/push/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': document.querySelector('meta[name=csrf]')?.content || '',
          },
          body: JSON.stringify(sub),
        });
      }).then(function () {
        var s = document.getElementById('push-status');
        if (s) s.textContent = 'Push notifications are ON for this device.';
        else alert('Push notifications are on.');
      });
    }).catch(function (e) { alert('Could not turn on notifications: ' + e.message); });
  };

  function urlB64(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  // ------------------------------------------------------------------ install hint
  var installBtn = document.getElementById('install-btn');
  if (installBtn) {
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      installBtn.style.display = 'inline-block';
    });
    installBtn.addEventListener('click', function () {
      if (deferred) { deferred.prompt(); deferred = null; }
      else alert('On iPhone: tap Share, then "Add to Home Screen".\nOn Android: menu ⋮, then "Install app".');
    });
  }
})();
