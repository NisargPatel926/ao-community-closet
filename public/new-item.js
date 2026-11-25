// "List an item" page: show previews and shrink photos in the browser before upload.
// Netlify functions accept about 6 MB per request, and phone photos are often 3–8 MB each.
(function () {
  var form = document.getElementById('new-item');
  var input = document.getElementById('photos');
  var box = document.getElementById('previews');
  var btn = document.getElementById('submit-btn');
  if (!form || !input) return;

  var MAX_SIDE = 1600;
  var QUALITY = 0.85;

  input.addEventListener('change', function () {
    box.innerHTML = '';
    Array.prototype.slice.call(input.files, 0, 4).forEach(function (f) {
      var img = document.createElement('img');
      img.alt = f.name;
      img.src = URL.createObjectURL(f);
      box.appendChild(img);
    });
  });

  function shrink(file) {
    return new Promise(function (resolve) {
      if (!/^image\//.test(file.type) || file.type === 'image/gif') return resolve(file);
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        if (scale === 1 && file.size < 1.5e6) { URL.revokeObjectURL(url); return resolve(file); }
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          if (!blob) return resolve(file);
          var name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        }, 'image/jpeg', QUALITY);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); }; // e.g. HEIC on Chrome: send as-is
      img.src = url;
    });
  }

  var ready = false;
  form.addEventListener('submit', function (e) {
    if (ready || !input.files.length || typeof DataTransfer === 'undefined') return;
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Shrinking photos…';
    var files = Array.prototype.slice.call(input.files, 0, 4);
    Promise.all(files.map(shrink)).then(function (small) {
      try {
        var dt = new DataTransfer();
        small.forEach(function (f) { dt.items.add(f); });
        input.files = dt.files;
      } catch (err) { /* keep the originals */ }
      ready = true;
      btn.textContent = 'Uploading…';
      form.submit();
    });
  });
})();
