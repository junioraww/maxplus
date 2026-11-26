const obfuscators = new Map();
const ciphers = new Map();
const extensions = new Map();
const messageCards = new Map();

export const CryptoPluginRegistry = {
  registerObfuscator(name, handler) {
    obfuscators.set(name, handler);
  },
  unregisterObfuscator(name) {
    obfuscators.delete(name);
  },
  getObfuscator(name) {
    return obfuscators.get(name);
  },
  hasObfuscator(name) {
    return obfuscators.has(name);
  },

  registerCipher(cipherId, handler) {
    ciphers.set(cipherId, handler);
  },
  unregisterCipher(cipherId) {
    ciphers.delete(cipherId);
  },
  getCipher(cipherId) {
    return ciphers.get(cipherId);
  },

  registerExtension(typeId, handler) {
    extensions.set(typeId, handler);
  },
  unregisterExtension(typeId) {
    extensions.delete(typeId);
  },
  getExtension(typeId) {
    return extensions.get(typeId);
  },

  findObfuscator(text) {
    for (const [name, handler] of obfuscators.entries()) {
      if (typeof handler.detect === "function" && handler.detect(text)) {
        return { name, handler };
      }
    }
    return null;
  },

  registerMessageCard(id, handler) {
    messageCards.set(id, handler);
  },
  unregisterMessageCard(id) {
    messageCards.delete(id);
  },
  findMessageCard(text, msg = null) {
    if (!text || typeof text !== "string") return null;
    for (const [id, handler] of messageCards.entries()) {
      try {
        if (typeof handler?.match === "function" && handler.match(text, msg)) {
          return { id, handler };
        }
      } catch {}
    }
    return null;
  }
};
