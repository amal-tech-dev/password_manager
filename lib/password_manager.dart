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
    http.Client? client,
  })  : _baseUrl = _validatedBaseUrl(baseUrl),
        _ingestToken = _validatedIngestToken(ingestToken),
        _client = client ?? http.Client(),
        _ownsClient = client == null;

  final Uri _baseUrl;
  final String _ingestToken;
  final http.Client _client;
  final bool _ownsClient;

  /// Saves credentials for [domain] and [username].
  ///
  /// The domain is used as the vault's institution/grouping key. Call this
  /// only after the application confirms the login succeeded. Password text
  /// is sent unchanged; domain and username are trimmed.
  ///
  /// Throws [ArgumentError] for blank login fields and
  /// [PasswordManagerException] when the server rejects the request. Network
  /// errors from `package:http` are allowed to propagate to the caller.
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

    final response = await _client
        .post(
          _baseUrl.resolve('/api/login'),
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
        .timeout(const Duration(seconds: 5));

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw PasswordManagerException(response.statusCode);
    }
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
}

/// Indicates that the vault server rejected a password save request.
class PasswordManagerException implements Exception {
  const PasswordManagerException(this.statusCode);

  final int statusCode;

  @override
  String toString() => 'Password vault rejected the request (HTTP $statusCode).';
}
