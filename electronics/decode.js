

(function () {
  
  function decodeBase64(encoded) {
    try {
      
      const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '=='.slice(0, (4 - normalized.length % 4) % 4);
      
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      console.warn('[decode.js] ❌ Base64 decode failed:', e.message);
      return null;
    }
  }

  
  function getElementsFromURL() {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('elements');
    
    if (encoded) {
      console.log('[decode.js] 🔗 Found elements param in URL');
      const decoded = decodeBase64(encoded);
      if (!decoded) return null;

      try {
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed)) {
          console.log('[decode.js] ✅ Successfully parsed PCB elements');
          return parsed;
        } else {
          console.warn('[decode.js] ⚠️ Decoded content is not an array of elements');
          return null;
        }
      } catch (e) {
        console.warn('[decode.js] ❌ JSON parse failed for elements:', e.message);
        return null;
      }
    }
    return null;
  }

  
  window.DECODED_ELEMENTS_FROM_URL = getElementsFromURL();
  
  if (window.DECODED_ELEMENTS_FROM_URL) {
    console.log('[decode.js] 🚀 PCB Elements ready for injection');
  }
})();
