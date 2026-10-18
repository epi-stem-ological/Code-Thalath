/* =========================================================================
   Upload: a tap target you can actually hit, a preview before you commit,
   and a progress bar so a song over mobile data doesn't look like a hang.

   Progressive enhancement. Mark up a plain <input type="file"> inside a
   .uploader and this takes over; with JavaScript off, the form still works.
   ========================================================================= */

(function () {
  'use strict';

  function human(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function clock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    return m + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
  }

  /* ----------------------------------------------------------------------
     ID3v2 title/artist, so nobody has to retype what the file already knows.
     Deliberately minimal: enough for the tags phones and iTunes write, and
     silent on anything it doesn't recognise.
     ------------------------------------------------------------------- */
  function readTags(file, done) {
    var slice = file.slice(0, 256 * 1024);
    var fr = new FileReader();
    fr.onerror = function () { done(null); };
    fr.onload = function () {
      try { done(parseId3(new DataView(fr.result))); }
      catch (e) { done(null); }
    };
    fr.readAsArrayBuffer(slice);
  }

  function parseId3(dv) {
    if (dv.byteLength < 10) return null;
    if (dv.getUint8(0) !== 0x49 || dv.getUint8(1) !== 0x44 || dv.getUint8(2) !== 0x33) return null; // "ID3"
    var major = dv.getUint8(3);
    // synchsafe integer: 7 bits per byte
    var size = (dv.getUint8(6) << 21) | (dv.getUint8(7) << 14) | (dv.getUint8(8) << 7) | dv.getUint8(9);
    var pos = 10;
    var end = Math.min(10 + size, dv.byteLength);
    var out = {};

    while (pos + 10 <= end) {
      var id = '';
      for (var i = 0; i < 4; i++) id += String.fromCharCode(dv.getUint8(pos + i));
      if (!/^[A-Z0-9]{4}$/.test(id)) break;

      var fsize = major >= 4
        ? ((dv.getUint8(pos + 4) << 21) | (dv.getUint8(pos + 5) << 14) | (dv.getUint8(pos + 6) << 7) | dv.getUint8(pos + 7))
        : dv.getUint32(pos + 4);
      pos += 10;
      if (fsize <= 0 || pos + fsize > end) break;

      if (id === 'TIT2' || id === 'TPE1' || id === 'TALB') {
        var enc = dv.getUint8(pos);
        var bytes = [];
        for (var j = 1; j < fsize; j++) bytes.push(dv.getUint8(pos + j));
        var text = decodeText(enc, bytes).replace(/\0+$/, '').trim();
        if (text) {
          if (id === 'TIT2') out.title = text;
          if (id === 'TPE1') out.artist = text;
          if (id === 'TALB') out.album = text;
        }
      }
      pos += fsize;
    }
    return (out.title || out.artist) ? out : null;
  }

  function decodeText(enc, bytes) {
    try {
      var u8 = new Uint8Array(bytes);
      if (enc === 1 || enc === 2) return new TextDecoder('utf-16').decode(u8);
      if (enc === 3) return new TextDecoder('utf-8').decode(u8);
      return new TextDecoder('iso-8859-1').decode(u8);
    } catch (e) {
      return bytes.map(function (b) { return String.fromCharCode(b); }).join('');
    }
  }

  /* ------------------------------------------------------------------- */

  document.querySelectorAll('.uploader').forEach(function (box) {
    var input = box.querySelector('input[type=file]');
    if (!input) return;

    var kind     = box.getAttribute('data-kind') || 'file';   // 'audio' | 'image'
    var maxMb    = parseFloat(box.getAttribute('data-max-mb') || '12');
    var form     = box.closest('form');
    var drop     = box.querySelector('[data-drop]');
    var preview  = box.querySelector('[data-preview]');
    var titleEl  = form && form.querySelector('[name=song_title]');
    var artistEl = form && form.querySelector('[name=song_artist]');

    input.classList.add('uploader-input');

    function say(html, cls) {
      if (!preview) return;
      preview.innerHTML = html;
      preview.className = 'uploader-preview' + (cls ? ' ' + cls : '');
      preview.hidden = false;
    }

    function handle(files) {
      if (!files || !files.length) return;
      var f = files[0];

      if (f.size > maxMb * 1024 * 1024) {
        say('<b>That file is too big.</b><br>' + human(f.size) + ' &mdash; the limit is ' + maxMb +
            ' MB. Try a shorter clip, or a smaller version.', 'bad');
        input.value = '';
        return;
      }

      var url = URL.createObjectURL(f);

      if (kind === 'audio') {
        say('<div class="up-name">' + escapeHtml(f.name) + '</div>' +
            '<div class="up-meta">' + human(f.size) + ' &middot; <span data-dur>reading&hellip;</span></div>' +
            '<audio controls preload="metadata" src="' + url + '"></audio>' +
            '<div class="up-ok">Have a listen before you save it.</div>');
        var a = preview.querySelector('audio');
        a.addEventListener('loadedmetadata', function () {
          var d = preview.querySelector('[data-dur]');
          if (d) d.textContent = clock(a.duration);
        });
        // fill in the title and artist the file already carries
        readTags(f, function (tags) {
          if (!tags) return;
          if (titleEl && !titleEl.value.trim() && tags.title) titleEl.value = tags.title;
          if (artistEl && !artistEl.value.trim() && tags.artist) artistEl.value = tags.artist;
          var note = document.createElement('div');
          note.className = 'up-ok';
          note.textContent = 'Found the track details in the file and filled them in.';
          preview.appendChild(note);
        });
      } else {
        say('<img class="up-thumb" alt="" src="' + url + '">' +
            '<div class="up-name">' + escapeHtml(f.name) + '</div>' +
            '<div class="up-meta">' + human(f.size) +
            (files.length > 1 ? ' &middot; +' + (files.length - 1) + ' more' : '') + '</div>' +
            '<div class="up-ok">Location data is removed when this is saved.</div>');
      }
    }

    input.addEventListener('change', function () { handle(input.files); });

    if (drop) {
      drop.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;
        input.click();
      });
      drop.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
      });
      ['dragenter', 'dragover'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
      });
      ['dragleave', 'drop'].forEach(function (ev) {
        drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
      });
      drop.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files.length) {
          input.files = e.dataTransfer.files;
          handle(input.files);
        }
      });
    }

    /* Upload with a progress bar. A 20 MB song on mobile data takes long
       enough that a silent form submit looks like the app has frozen. */
    if (form && window.XMLHttpRequest && window.FormData) {
      form.addEventListener('submit', function (e) {
        if (!input.files || !input.files.length) return;  // nothing to show progress for
        e.preventDefault();

        var submit = form.querySelector('button[type=submit], button:not([type]), input[type=submit]');
        if (submit) { submit.disabled = true; submit.dataset.was = submit.textContent; submit.textContent = 'Uploading...'; }

        var bar = document.createElement('div');
        bar.className = 'up-progress';
        bar.innerHTML = '<i></i><span>0%</span>';
        box.appendChild(bar);
        var fill = bar.querySelector('i');
        var pct  = bar.querySelector('span');

        var xhr = new XMLHttpRequest();
        xhr.open(form.method || 'POST', form.action, true);
        xhr.upload.addEventListener('progress', function (ev) {
          if (!ev.lengthComputable) return;
          var p = Math.round((ev.loaded / ev.total) * 100);
          fill.style.width = p + '%';
          pct.textContent = p < 100 ? p + '%' : 'Saving...';
        });
        xhr.addEventListener('load', function () {
          // the server redirects on success; follow wherever we ended up
          window.location.href = xhr.responseURL || form.action;
        });
        xhr.addEventListener('error', function () {
          bar.remove();
          if (submit) { submit.disabled = false; submit.textContent = submit.dataset.was; }
          say('<b>The upload did not go through.</b><br>Check your connection and try again. Nothing was saved.', 'bad');
        });
        xhr.send(new FormData(form));
      });
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
})();
