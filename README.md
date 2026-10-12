# Password Manager

A reusable Dart client and self-hosted server for an encrypted password vault. The Dart client has no Flutter dependency, so it can be used from Dart CLI, server, and Flutter projects.

Use only with authorized test accounts. Do not use this for production credentials or other people's credentials without authorization.

## Vault data

New records are grouped by the `domain` passed to `saveSuccessfulLogin`:

```text
domain -> username -> password and optional dashboard details
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

Generate an encryption key and two different random tokens:

```text
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Set these environment variables before starting the server:

```text
DEV_VAULT_FERNET_KEY=<generated Fernet key>
DEV_VAULT_INGEST_TOKEN=<random app-ingest token, at least 32 characters>
DEV_VAULT_DASHBOARD_TOKEN=<different random dashboard token, at least 32 characters>
DEV_VAULT_HOST=0.0.0.0
DEV_VAULT_PORT=8765
DEV_VAULT_ALLOWED_ORIGINS=*
```

The server binds to all network interfaces by default, allowing authorized devices on the private network to reach it. Start it with:

```text
python server.py
```

Open `http://127.0.0.1:8765` on the server device, or `http://HOST-DEVICE-IP:8765` from an authorized client device. Enter the dashboard token to unlock the vault. The PC does not need to be the host; any supported device with Python and persistent storage can run the server.

Use a private network such as Tailscale, restrict firewall access to approved devices, and do not expose this HTTP service to the public internet. Use HTTPS for other network setups. Set `DEV_VAULT_DATA_DIR` if the encrypted vault should be stored outside the project directory.
For browser-based Dart/Flutter clients hosted on another origin, set `DEV_VAULT_ALLOWED_ORIGINS` to a comma-separated list of allowed origins instead of `*`.

## Use the Dart package

Add this package to another Dart/Flutter project's `pubspec.yaml` using its checkout path:

```yaml
dependencies:
  password_manager:
    path: ../password_manager
```

If you host this package in a Git repository, you can also use a Git dependency. Then call it only after the application's login succeeds:

```dart
import 'package:password_manager/password_manager.dart';

final passwordManager = PasswordManager(
  baseUrl: 'http://VAULT-HOST-IP:8765',
  ingestToken: 'YOUR_INGEST_TOKEN',
);

await passwordManager.saveSuccessfulLogin(
  domain: domain,
  username: username,
  password: password,
);
```

The `domain` argument is saved as the vault group key instead of an institution code. The package sends credentials only to the configured server; it does not persist them locally. `saveSuccessfulLogin` throws on validation, network, and non-success HTTP errors, so callers can catch failures without logging credentials. Close the manager when finished with it:

```dart
passwordManager.close();
```

The ingest token is present in the client application and can be extracted from it. Use test accounts, keep the server on a private network, and rotate the token if the app is shared. Do not put production secrets in client builds.

## Backup and recovery

Back up `data/vault.enc` securely. The Fernet key is required to decrypt it. Anyone who obtains both the vault file and key can read the passwords. Protect the host device with full-disk encryption and lock the dashboard when finished.
