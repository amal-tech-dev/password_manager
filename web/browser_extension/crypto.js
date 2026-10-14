const VAULT_KDF_ITERATIONS = 310000;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function deriveVaultKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: VAULT_KDF_ITERATIONS,
      hash: 'SHA-256'
    },
    material,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVaultToken(token, passphrase, associatedData) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    {name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(associatedData)},
    key,
    new TextEncoder().encode(token)
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptVaultToken(record, passphrase, associatedData) {
  const key = await deriveVaultKey(passphrase, base64ToBytes(record.salt));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(record.iv),
      additionalData: new TextEncoder().encode(associatedData)
    },
    key,
    base64ToBytes(record.ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}
