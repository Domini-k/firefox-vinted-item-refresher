chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.type === 'fetchImage') {
    fetch(request.url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        sendResponse({ success: true, b64: btoa(binary) });
      })
      .catch(function (err) {
        sendResponse({ success: false, error: err.message });
      });
    return true; // keep channel open for async response
  }
});
