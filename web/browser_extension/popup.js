let apiToken = '';
let baseUrl = '';
let activeTabId = null;
let activeDomain = '';

const $ = id => document.getElementById(id);

async function serverRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(baseUrl + path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
  } catch {
    throw new Error('Could not reach the vault server. Check the connection and HTTPS setup.');
  }
  if (!response.ok) {
    throw new Error(`Vault server rejected the request (HTTP ${response.status}).`);
  }
  return response.json();
}

async function getActiveSite() {
  const [tab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
  if (!tab || !Number.isInteger(tab.id) || !tab.url) {
    throw new Error('No active browser page is available.');
  }
  const url = new URL(tab.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('This page cannot be used for passwords.');
  }
  activeTabId = tab.id;
  activeDomain = url.hostname.toLowerCase();
  $('siteLabel').textContent = activeDomain;
  return {tab, domain: activeDomain};
}

async function ensureSameSite() {
  const tab = await chrome.tabs.get(activeTabId);
  if (!tab.url || new URL(tab.url).hostname.toLowerCase() !== activeDomain) {
    throw new Error('The active page changed. Reopen the extension on the intended site.');
  }
}

function scanLoginFields() {
  const visible = element => element.getClientRects().length > 0 &&
    !element.disabled && element.type !== 'hidden';
  const passwordInput = [...document.querySelectorAll('input[type="password"]')]
    .find(visible);
  if (!passwordInput) return null;

  const form = passwordInput.form || document;
  const candidates = [...form.querySelectorAll(
    'input:not([type]), input[type="text"], input[type="email"], input[type="tel"]'
  )].filter(visible);
  const passwordIndex = [...document.querySelectorAll('input')].indexOf(passwordInput);
  const usernameInput = candidates
    .filter(input => [...document.querySelectorAll('input')].indexOf(input) < passwordIndex)
    .sort((left, right) => {
      const score = input => /user|email|login|account/i.test(
        `${input.name} ${input.id} ${input.autocomplete}`
      ) ? 1 : 0;
      return score(right) - score(left);
    })[0];
  return {
    username: usernameInput?.value || '',
    password: passwordInput.value || '',
    usernameIndex: usernameInput
      ? [...document.querySelectorAll('input')].indexOf(usernameInput)
      : -1,
    passwordIndex
  };
}

function fillLoginFields(username, password, usernameIndex, passwordIndex) {
  const inputs = [...document.querySelectorAll('input')];
  const passwordInput = inputs[passwordIndex];
  const usernameInput = inputs[usernameIndex];
  if (!passwordInput || passwordInput.type !== 'password') return false;
  if (!usernameInput || !['text', 'email', 'tel'].includes(usernameInput.type || 'text')) {
    return false;
  }

  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      'value'
    )?.set;
    if (!setter) return false;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
  };
  return setValue(usernameInput, username) && setValue(passwordInput, password);
}

async function unlock(event) {
  event.preventDefault();
  $('unlockStatus').textContent = '';
  const passphrase = $('unlockPassphrase').value;
  try {
    const {vaultConnection} = await chrome.storage.local.get('vaultConnection');
    if (!vaultConnection) {
      $('setupHint').hidden = false;
      throw new Error('Configure the extension connection first.');
    }
    apiToken = await decryptVaultToken(vaultConnection, passphrase, vaultConnection.baseUrl);
    baseUrl = vaultConnection.baseUrl;
    await getActiveSite();
    $('unlockPassphrase').value = '';
    $('unlockPanel').hidden = true;
    $('vaultPanel').hidden = false;
  } catch (error) {
    apiToken = '';
    baseUrl = '';
    $('unlockStatus').textContent = error.name === 'OperationError'
      ? 'Could not unlock. Check your passphrase.'
      : error.message;
  }
}

async function scanPage() {
  $('scanStatus').textContent = '';
  $('saveForm').hidden = true;
  try {
    const {tab} = await getActiveSite();
    const [result] = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: scanLoginFields
    });
    if (!result?.result) {
      $('scanStatus').textContent = 'No visible password field was found on this page.';
      return;
    }
    $('siteUsername').value = result.result.username;
    $('sitePassword').value = result.result.password;
    $('saveForm').dataset.usernameIndex = result.result.usernameIndex;
    $('saveForm').dataset.passwordIndex = result.result.passwordIndex;
    $('saveForm').hidden = false;
    $('scanStatus').textContent = 'Review the fields, then choose whether to save.';
  } catch (error) {
    $('scanStatus').textContent = error.message;
  }
}

async function saveLogin(event) {
  event.preventDefault();
  const username = $('siteUsername').value.trim();
  const password = $('sitePassword').value;
  if (!username || !password) {
    $('scanStatus').textContent = 'Enter both a username and password.';
    return;
  }
  if (!confirm(`Save this login for ${activeDomain}?`)) return;

  $('saveLogin').disabled = true;
  $('scanStatus').textContent = 'Saving login…';
  try {
    await ensureSameSite();
    const result = await serverRequest('/api/extension/login', {
      method: 'POST',
      body: JSON.stringify({domain: activeDomain, username, password})
    });
    $('scanStatus').textContent = result.result === 'updated'
      ? 'Login updated in your vault.'
      : result.result === 'unchanged'
        ? 'This login is already up to date.'
        : 'Login saved to your vault.';
    $('saveForm').hidden = true;
    $('sitePassword').value = '';
  } catch (error) {
    $('scanStatus').textContent = error.message;
  } finally {
    $('saveLogin').disabled = false;
  }
}

async function findLogins() {
  $('vaultStatus').textContent = '';
  $('savedLogins').replaceChildren();
  try {
    await getActiveSite();
    const result = await serverRequest(
      `/api/extension/matches?domain=${encodeURIComponent(activeDomain)}`
    );
    if (!result.accounts.length) {
      $('vaultStatus').textContent = 'No saved logins for this site.';
      return;
    }
    for (const account of result.accounts) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-button';
      button.textContent = `Fill as ${account.username}`;
      button.addEventListener('click', () => fillLogin(account));
      $('savedLogins').append(button);
    }
    $('vaultStatus').textContent = 'Choose an account to review and fill.';
  } catch (error) {
    $('vaultStatus').textContent = error.message;
  }
}

async function fillLogin(account) {
  if (!confirm(`Fill the login for ${account.username} on ${activeDomain}?`)) return;
  try {
    await ensureSameSite();
    const [scan] = await chrome.scripting.executeScript({
      target: {tabId: activeTabId},
      func: scanLoginFields
    });
    if (!scan?.result || scan.result.usernameIndex < 0) {
      $('vaultStatus').textContent = 'Could not identify a username and password field. Nothing was filled.';
      return;
    }
    const [filled] = await chrome.scripting.executeScript({
      target: {tabId: activeTabId},
      func: fillLoginFields,
      args: [
        account.username,
        account.password,
        scan.result.usernameIndex,
        scan.result.passwordIndex
      ]
    });
    $('vaultStatus').textContent = filled?.result
      ? 'Login filled. Review it and submit the site form yourself.'
      : 'The page fields changed. Nothing was filled; try again.';
  } catch (error) {
    $('vaultStatus').textContent = error.message;
  }
}

async function lockSession() {
  apiToken = '';
  baseUrl = '';
  activeTabId = null;
  activeDomain = '';
  $('sitePassword').value = '';
  $('savedLogins').replaceChildren();
  $('vaultPanel').hidden = true;
  $('unlockPanel').hidden = false;
  $('unlockPassphrase').value = '';
}

$('unlockForm').addEventListener('submit', unlock);
$('openSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('scanPage').addEventListener('click', scanPage);
$('saveForm').addEventListener('submit', saveLogin);
$('findLogins').addEventListener('click', findLogins);
$('lockSession').addEventListener('click', lockSession);
window.addEventListener('pagehide', () => {
  apiToken = '';
  baseUrl = '';
  $('sitePassword').value = '';
});

chrome.storage.local.get('vaultConnection').then(({vaultConnection}) => {
  $('setupHint').hidden = Boolean(vaultConnection);
});
