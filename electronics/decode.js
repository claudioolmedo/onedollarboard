

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

  
  function getMagicTracesFromURL() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('magicTrace');
    if (!raw) return [];

    const segments = raw.split(';');
    const elements = [];

    segments.forEach(seg => {
      
      const parts = seg.split(':');
      if (parts.length < 2) return;

      const p1Str = parts[0].split(',');
      const p2Str = parts[1].split(',');
      const net = (parts[2] || '').toUpperCase();

      if (p1Str.length === 2 && p2Str.length === 2) {
        elements.push({
          type: 'trace',
          layer: 'F.Cu',
          width: 0.25,
          pts: [
            { x: parseFloat(p1Str[0]), y: parseFloat(p1Str[1]) },
            { x: parseFloat(p2Str[0]), y: parseFloat(p2Str[1]) }
          ],
          net: net
        });
      }
    });

    if (elements.length > 0) {
      console.log(`[decode.js] ✨ Injected ${elements.length} MagicTraces`);
    }
    return elements;
  }

  
  const urlElements = getElementsFromURL() || [];
  const magicElements = getMagicTracesFromURL();
  
  window.DECODED_ELEMENTS_FROM_URL = [...urlElements, ...magicElements];
  
  if (window.DECODED_ELEMENTS_FROM_URL.length > 0) {
    console.log('[decode.js] 🚀 PCB Elements ready for injection');
  }
})();
