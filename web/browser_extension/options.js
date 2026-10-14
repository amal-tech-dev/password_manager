const settingsForm = document.getElementById('settingsForm');
const settingsStatus = document.getElementById('settingsStatus');
const forgetSettings = document.getElementById('forgetSettings');

function validateServerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid vault server URL.');
  }

  const localHosts = new Set(['localhost', '127.0.0.1']);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHosts.has(url.hostname))) {
    throw new Error('Use HTTPS. HTTP is permitted only for localhost.');
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Enter only the server origin, without a path or credentials.');
  }
  return url;
}

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  settingsStatus.textContent = '';
  const serverUrl = document.getElementById('serverUrl').value.trim();
  const extensionToken = document.getElementById('extensionToken').value.trim();
  const passphrase = document.getElementById('passphrase').value;
  const passphraseConfirm = document.getElementById('passphraseConfirm').value;

  try {
    const url = validateServerUrl(serverUrl);
    if (extensionToken.length < 32) {
      throw new Error('The extension access token must contain at least 32 characters.');
    }
    if (passphrase.length < 12) {
      throw new Error('Use an encryption passphrase with at least 12 characters.');
    }
    if (passphrase !== passphraseConfirm) {
      throw new Error('The passphrases do not match.');
    }

    const granted = await chrome.permissions.request({
      origins: [`${url.origin}/*`]
    });
    if (!granted) {
      throw new Error('Permission to connect to this vault server was not granted.');
    }

    const encrypted = await encryptVaultToken(extensionToken, passphrase, url.origin);
    await chrome.storage.local.set({
      vaultConnection: {
        baseUrl: url.origin,
        ...encrypted
      }
    });
    document.getElementById('extensionToken').value = '';
    document.getElementById('passphrase').value = '';
    document.getElementById('passphraseConfirm').value = '';
    settingsStatus.textContent = 'Settings saved. Unlock the extension from its toolbar button.';
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
});

forgetSettings.addEventListener('click', async () => {
  settingsStatus.textContent = '';
  try {
    const {vaultConnection} = await chrome.storage.local.get('vaultConnection');
    if (!vaultConnection) {
      settingsStatus.textContent = 'There are no saved settings to forget.';
      return;
    }

    const confirmed = confirm(
      'Remove the encrypted token and server permission from this browser?'
    );
    if (!confirmed) return;
    await chrome.storage.local.remove('vaultConnection');
    const origin = new URL(vaultConnection.baseUrl).origin;
    await chrome.permissions.remove({origins: [`${origin}/*`]});
    settingsStatus.textContent = 'Saved settings and server permission removed.';
  } catch {
    settingsStatus.textContent = 'Could not remove the saved settings.';
  }
});

chrome.storage.local.get('vaultConnection').then(({vaultConnection}) => {
  if (vaultConnection) {
    document.getElementById('serverUrl').value = vaultConnection.baseUrl;
    settingsStatus.textContent = 'A server is configured. Saving new settings replaces its encrypted token.';
  }
}).catch(() => {
  settingsStatus.textContent = 'Could not read the saved extension settings.';
});
