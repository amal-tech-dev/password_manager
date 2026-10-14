import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Sends successful developer-build logins to a private password vault.
///
/// Use test accounts only. The ingest token is included in the calling
/// application's configuration, so restrict access to the vault server and
/// rotate the token if the application is shared.
class PasswordManager {
  PasswordManager({
    required String baseUrl,
    required String ingestToken,
    Duration requestTimeout = const Duration(seconds: 10),
    http.Client? client,
  })  : _baseUrl = _validatedBaseUrl(baseUrl),
        _ingestToken = _validatedIngestToken(ingestToken),
        _requestTimeout = _validatedTimeout(requestTimeout),
        _client = client ?? http.Client(),
        _ownsClient = client == null;

  final Uri _baseUrl;
  final String _ingestToken;
  final Duration _requestTimeout;
  final http.Client _client;
  final bool _ownsClient;

  /// Saves credentials for [domain] and [username].
  ///
  /// The domain is used as the vault's institution/grouping key. Call this
  /// only after the application confirms the login succeeded. Password text
  /// is sent unchanged; domain and username are trimmed.
  ///
  /// Throws [ArgumentError] for blank login fields and
  /// [PasswordManagerException] when the server rejects the request,
  /// [PasswordManagerConnectionException] when the request times out, and
  /// package HTTP exceptions for other network errors.
  Future<void> save({
    required String domain,
    required String username,
    required String password,
  }) async {
    final normalizedDomain = domain.trim();
    final normalizedUsername = username.trim();
    if (normalizedDomain.isEmpty) {
      throw ArgumentError.value(domain, 'domain', 'Must not be blank');
    }
    if (normalizedUsername.isEmpty) {
      throw ArgumentError.value(username, 'username', 'Must not be blank');
    }
    if (password.isEmpty) {
      throw ArgumentError.value(password, 'password', 'Must not be blank');
    }

    final endpoint = _baseUrl.resolve('/api/login');
    late final http.Response response;
    try {
      response = await _client
        .post(
          endpoint,
          headers: {
            'Authorization': 'Bearer $_ingestToken',
            'Content-Type': 'application/json',
          },
          body: jsonEncode({
            'domain': normalizedDomain,
            'username': normalizedUsername,
            'password': password,
          }),
        )
          .timeout(_requestTimeout);
    } on TimeoutException {
      throw PasswordManagerConnectionException(endpoint);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PasswordManagerException(response.statusCode);
    }
  }

  /// Retrieves all saved domain, username, and password records.
  ///
  /// The dashboard token is required because the server protects vault reads
  /// separately from app login writes. Current record objects and legacy
  /// string-valued records are both converted to the requested nested map.
  ///
  /// Throws [ArgumentError] if [dashboardToken] is blank,
  /// [PasswordManagerException] if the server rejects the request, and
  /// [FormatException] if the server response is not a vault map.
  Future<Map<String, Map<String, String>>> getPasswords({
    required String dashboardToken,
  }) async {
    final normalizedToken = dashboardToken.trim();
    if (normalizedToken.isEmpty) {
      throw ArgumentError.value(
        dashboardToken,
        'dashboardToken',
        'Must not be blank',
      );
    }

    final endpoint = _baseUrl.resolve('/api/vault');
    late final http.Response response;
    try {
      response = await _client
          .get(
            endpoint,
            headers: {'Authorization': 'Bearer $normalizedToken'},
          )
          .timeout(_requestTimeout);
    } on TimeoutException {
      throw PasswordManagerConnectionException(endpoint);
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PasswordManagerException(response.statusCode);
    }
    return _parseVault(response.body);
  }

  static Map<String, Map<String, String>> _parseVault(String body) {
    final decoded = jsonDecode(body);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Vault response must be a JSON object.');
    }

    final vault = <String, Map<String, String>>{};
    for (final entry in decoded.entries) {
      final domain = entry.key;
      final accounts = entry.value;
      if (accounts is! Map<String, dynamic>) {
        throw FormatException('Vault accounts for "$domain" must be an object.');
      }

      final users = <String, String>{};
      for (final account in accounts.entries) {
        final value = account.value;
        final password = switch (value) {
          String legacyPassword => legacyPassword,
          Map<String, dynamic> record when record['password'] is String =>
            record['password'] as String,
          _ => throw FormatException(
              'Vault password for "${account.key}" under "$domain" is invalid.',
            ),
        };
        users[account.key] = password;
      }
      vault[domain] = users;
    }
    return vault;
  }

  /// Closes the internally created HTTP client, if any.
  ///
  /// A client passed to the constructor remains owned by the caller.
  void close() {
    if (_ownsClient) {
      _client.close();
    }
  }

  static Uri _validatedBaseUrl(String value) {
    final uri = Uri.tryParse(value);
    if (uri == null ||
        !uri.hasScheme ||
        uri.host.isEmpty ||
        (uri.scheme != 'http' && uri.scheme != 'https')) {
      throw ArgumentError.value(value, 'baseUrl', 'Must be an absolute HTTP(S) URL');
    }
    return uri;
  }

  static String _validatedIngestToken(String value) {
    if (value.trim().isEmpty) {
      throw ArgumentError.value(value, 'ingestToken', 'Must not be blank');
    }
    return value.trim();
  }

  static Duration _validatedTimeout(Duration value) {
    if (value <= Duration.zero) {
      throw ArgumentError.value(value, 'requestTimeout', 'Must be positive');
    }
    return value;
  }
}

/// Indicates that the vault server rejected a password save request.
class PasswordManagerException implements Exception {
  const PasswordManagerException(this.statusCode);

  final int statusCode;

  @override
  String toString() => 'Password vault rejected the request (HTTP $statusCode).';
}

/// Indicates that the vault server did not respond to the login request.
class PasswordManagerConnectionException implements Exception {
  const PasswordManagerConnectionException(this.endpoint);

  final Uri endpoint;

  @override
  String toString() =>
      'Timed out connecting to $endpoint. Check that the vault server is '
      'running, reachable from this device, and listening on the expected port.';
}
