# Changelog

## 1.1.3

- Publish the reusable Dart client with vault read support.
- Support current password records and legacy string-valued records.
- Use the dashboard token for vault reads and report malformed server data.

## 1.1.2

- Add retrieval of stored passwords as a nested
  `Map<String, Map<String, String>>`.

## 1.1.1

- Make the server listen on all network interfaces by default for private
  network clients.
- Allow the client request timeout to be configured and report timeout
  failures with the endpoint to check.

## 1.1.0

- Keep vault login records focused on domain, username, and password.
- Improve setup and usage guidance for Dart and Flutter applications.

## 1.0.5

- Use domain, username, and password as the account fields.
- Provide the Dart client as a reusable package for Dart and Flutter projects.

## 1.0.0

- Add a reusable Dart client for sending credentials to a self-hosted vault.
