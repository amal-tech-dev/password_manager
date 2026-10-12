# Changelog

## 1.1.1

- Make the server listen on all network interfaces by default for private
  network clients.
- Allow the client request timeout to be configured and report timeout
  failures with the endpoint to check.
- Document network address and reachability checks for client devices.

## 1.1.0

- Update the package release to 1.1.0.
- Keep vault login records focused on domain, username, and password.
- Improve package setup and usage guidance for Dart and Flutter applications.

## 1.0.5

- Use domain, username, and password as the account fields.
- Provide the Dart client as a reusable package for Dart and Flutter projects.
- Keep the self-hosted encrypted vault server and dashboard for saving and
  managing accounts.

## 1.0.0

- Add a reusable Dart client for sending domain, username, and password records
  to a self-hosted encrypted vault.
- Add a cross-platform Python server and dashboard for managing the vault.
- Encrypt vault data at rest and protect ingest and dashboard endpoints with
  separate bearer tokens.
