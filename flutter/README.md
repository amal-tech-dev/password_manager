# Password Manager

A reusable Dart client for a self-hosted encrypted password vault. This package
has no Flutter dependency and can be used from Dart CLI, server, and Flutter
projects.

Use only with authorized test accounts. Do not use this for production
credentials or other people's credentials without authorization.

## Install

Add the package to your application's `pubspec.yaml`:

```yaml
dependencies:
  password_manager: ^1.1.3
```

Or use this repository as a path dependency:

```yaml
dependencies:
  password_manager:
    path: ../password_manager/flutter
```

## Use

Call `save` only after the application confirms that login succeeded:

```dart
import 'package:password_manager/password_manager.dart';

final passwordManager = PasswordManager(
  baseUrl: 'https://VAULT-HOST',
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

passwordManager.close();
```

`save` uses the ingest token to write logins. `getPasswords` uses the dashboard
token to read the vault. Both methods throw on validation, network, timeout, and
non-success HTTP errors. Do not log credentials or embed production tokens in
client builds; tokens embedded in an application can be extracted. Use test
accounts and keep the vault server on a trusted private network.

For server setup and the companion web dashboard and browser extension, see
the [repository README](https://github.com/madman-technology/password_manager#readme).
