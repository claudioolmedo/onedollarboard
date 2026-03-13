/**
 * decode.js - Load source code into the editor via URL parameter
 *
 * Usage: index.html?code=BASE64_ENCODED_CODE
 *
 * This script runs before Monaco initialization.
 */

(function () {
  /**
   * Decodes Base64 to string, handling UTF-8 and URL-safe characters.
   */
  function decodeBase64(encoded) {
    try {
      // Handle URL-safe Base64 normalization
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

  /**
   * Extracts 'code' from URL and decodes it.
   */
  function getCodeFromURL() {
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get('code');
    
    if (encoded) {
      console.log('[decode.js] 🔗 Found code param in URL');
      return decodeBase64(encoded);
    }
    return null;
  }

  // Expose the result for index.html to use during editor creation
  window.DECODED_CODE_FROM_URL = getCodeFromURL();
  
  if (window.DECODED_CODE_FROM_URL) {
    console.log('[decode.js] ✅ Code ready for editor injection');
  }
})();
