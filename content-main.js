(function () {
  // Invokes React onClick/onMouseDown handlers directly via __reactProps$.
  // Falls back to native mouse event sequence if no React props found.
  function reactInvoke(el) {
    var rKey = Object.keys(el).find(function (k) {
      return k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$');
    });
    if (rKey) {
      var props = el[rKey];
      var synth = {
        preventDefault: function () {},
        stopPropagation: function () {},
        target: el,
        currentTarget: el,
        bubbles: true,
        type: 'click'
      };
      if (props.onMouseDown) props.onMouseDown(synth);
      if (props.onClick) props.onClick(synth);
      if (props.onMouseDown || props.onClick) return true;
    }
    return false;
  }

  // Detail payloads are dispatched by the isolated content script. In Firefox the
  // MAIN world can't touch a content-script object, so content.js cloneInto()s the
  // payload into this scope; on Chrome the raw object arrives directly. Accept
  // either, plus a JSON-string form as a forward-compatible fallback.
  function readDetail(e) {
    var d = e && e.detail;
    if (typeof d === 'string') {
      try { return JSON.parse(d); } catch (err) { return null; }
    }
    return d || null;
  }

  document.addEventListener('sah-ext-click', function (e) {
    var det = readDetail(e);
    var sel = det && det.selector;
    if (!sel) return;
    var el = document.querySelector(sel);
    if (!el) return;
    if (!reactInvoke(el)) {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window }));
      el.click();
    }
  });

  // Simulates real per-character keyboard typing so React search handlers fire.
  document.addEventListener('sah-ext-type', function (e) {
    var det = readDetail(e);
    var sel = det && det.selector;
    var value = det && det.value;
    if (!sel || value == null) return;
    var el = document.querySelector(sel);
    if (!el) return;

    var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    nativeSetter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));

    var chars = String(value).split('');
    var delay = 0;
    chars.forEach(function (ch) {
      setTimeout(function () {
        el.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true, cancelable: true }));
        nativeSetter.call(el, el.value + ch);
        el.dispatchEvent(new InputEvent('input', { data: ch, inputType: 'insertText', bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',    { key: ch, bubbles: true, cancelable: true }));
      }, delay);
      delay += 30;
    });

    setTimeout(function () {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, delay + 30);
  });
})();
