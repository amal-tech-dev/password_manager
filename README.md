# Password Manager

A reusable Dart client and self-hosted server for an encrypted password vault. The Dart client has no Flutter dependency, so it can be used from Dart CLI, server, and Flutter projects.

## Repository layout

- `flutter/` contains the publishable Dart package.
- The root contains the Python vault server, Python requirements, and server
  configuration.
- `web/` contains the dashboard and browser extension.
- `test/web/` contains web/server tests, and `test/flutter/` contains Dart
  package tests.
- The encrypted vault remains at `data/vault.enc` by default. Shared project
  setup and release documentation stays at the repository root.

Use only with authorized test accounts. Do not use this for production credentials or other people's credentials without authorization.

## Vault data

New records are grouped by the `domain` passed to `PasswordManager.save`:

```text
domain -> username -> password
```

The dashboard stores only the domain, username, and password. Existing vault entries with older optional details remain readable; new or updated entries use only these three fields.

The vault is encrypted at rest in `data/vault.enc`. The dashboard hides passwords by default. Keep a secure backup of the encrypted file and its Fernet key.

## Run the server

The Python server runs on Windows, macOS, or Linux with Python 3.11 or later. On the device that will host the vault:

```text
python -m venv .venv
```

Activate the virtual environment (`.venv\Scripts\Activate.ps1` in PowerShell, or `source .venv/bin/activate` on macOS/Linux), then install:

```text
pip install -r requirements.txt
```

Generate an encryption key and two different random tokens. Generate a third,
separate token if you plan to use the browser extension:

```text
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Set these environment variables before starting the server:

```text
DEV_VAULT_FERNET_KEY=<generated Fernet key>
DEV_VAULT_INGEST_TOKEN=<random app-ingest token, at least 32 characters>
DEV_VAULT_DASHBOARD_TOKEN=<different random dashboard token, at least 32 characters>
DEV_VAULT_EXTENSION_TOKEN=<optional separate browser extension token, at least 32 characters>
DEV_VAULT_HOST=0.0.0.0
DEV_VAULT_PORT=8765
DEV_VAULT_ALLOWED_ORIGINS=*
```

The server binds to all network interfaces by default, allowing authorized devices on the private network to reach it. Start it with:

```text
python server.py
```

Open `http://127.0.0.1:8765` on the server device, or `http://HOST-DEVICE-IP:8765` from an authorized client device. Enter the dashboard token to unlock the vault. The PC does not need to be the host; any supported device with Python and persistent storage can run the server.

When connecting from a different device, use the server device's LAN/Tailscale IP in the client URL, not `127.0.0.1`. For an Android emulator use `10.0.2.2` to reach the development host. Confirm `http://SERVER-IP:8765/health` opens from the client device, and allow inbound TCP port 8765 through the host firewall. Use a private network such as Tailscale, restrict firewall access to approved devices, and do not expose this HTTP service to the public internet. Use HTTPS for other network setups. Set `DEV_VAULT_DATA_DIR` if the encrypted vault should be stored outside the project directory.
For browser-based Dart/Flutter clients hosted on another origin, set
`DEV_VAULT_ALLOWED_ORIGINS` to a comma-separated list of allowed origins
instead of `*`. If restricting origins while using the extension, also allow
its browser origin (`chrome-extension://<extension-id>` in Chrome or Edge).

## Browser extension (Chrome and Edge)

The Manifest V3 extension in `web/browser_extension/` supports user-initiated login
scanning, saving, and filling. It does not scan pages in the background,
autofill automatically, or submit website forms. Install it by opening
`chrome://extensions` (or `edge://extensions`), enabling Developer mode, and
choosing **Load unpacked** to select the `web/browser_extension` directory.

The extension requires its own separate random access token. Generate one and
add it as `DEV_VAULT_EXTENSION_TOKEN`; do not reuse the dashboard or ingest
token:

```text
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Restart the server after adding the token. In the extension's **Connection
settings**, enter the server origin, the extension token, and a strong
encryption passphrase. HTTPS is required for remote hosts; plain HTTP is allowed
only for `localhost` during local development. For remote access, use a private
HTTPS endpoint such as Tailscale Serve and do not expose the vault server to
the public internet. The extension requests access only to the configured
server origin.

The token is encrypted in browser extension storage using the passphrase and
AES-GCM, with PBKDF2-SHA-256 key derivation. It is decrypted only while the
extension popup is open; unlock it again when reopening the popup. Forgetting
the passphrase requires generating a new extension token and configuring it
again. Lock the extension by closing its popup or using **Lock this session**.

From a site, open the extension and explicitly choose **Check this page for a
login** to inspect visible login fields. Review the captured values and confirm
before saving. To fill, choose **Find saved logins**, then explicitly select an
account and confirm. The extension fills matching hostname records only and
never submits the page form. Entries are stored under the current hostname
(for example, `login.example.com`); existing entries need to use the same
hostname to be offered for that site. Only top-level pages with ordinary HTML
username/password inputs are supported; browser-internal pages and some custom
login forms cannot be accessed.

Treat the extension token like a vault credential: anyone who obtains it can
read accounts for requested domains and add vault records. Use a private,
trusted browser profile, keep extension access restricted, and rotate the token
if it may have been exposed. The extension does not store website passwords
locally; it keeps the encrypted vault token in extension storage.

## Use the Dart package

The Dart package is located in `flutter/`. Add it to another Dart/Flutter
project's `pubspec.yaml` using its checkout path:

```yaml
dependencies:
  password_manager:
    path: ../password_manager/flutter
```

If you host this package in a Git repository, you can also use a Git dependency. Then call it only after the application's login succeeds:

```dart
import 'package:password_manager/password_manager.dart';

final passwordManager = PasswordManager(
  baseUrl: 'http://VAULT-HOST-IP:8765',
  ingestToken: 'YOUR_INGEST_TOKEN',
);

await passwordManager.save(
  domain: domain,
  username: username,
  password: password,
);

final storedPasswords = await passwordManager.getPasswords(
  dashboardToken: 'YOUR_DASHBOARD_TOKEN',
);
// Map<String, Map<String, String>>: domain -> username -> password
```

The `domain` argument is saved as the vault group key instead of an institution code. `save` uses the ingest token to write logins; `getPasswords` uses the dashboard token to read the full vault and returns `Map<String, Map<String, String>>` in domain → username → password form. Keep both tokens private. The package sends credentials only to the configured server; it does not persist them locally. Both methods throw on validation, network, timeout, and non-success HTTP errors, so callers can catch failures without logging credentials. The timeout defaults to 10 seconds and can be configured with `requestTimeout`. A timeout usually means the device cannot reach the configured server address; check `/health`, the server bind address, and the firewall rather than only increasing the timeout. Close the manager when finished with it:

```dart
passwordManager.close();
```

The ingest token is present in the client application and can be extracted from it. Use test accounts, keep the server on a private network, and rotate the token if the app is shared. Do not put production secrets in client builds.

## Backup and recovery

Back up `data/vault.enc` securely. The Fernet key is required to decrypt it. Anyone who obtains both the vault file and key can read the passwords. Protect the host device with full-disk encryption and lock the dashboard when finished.
