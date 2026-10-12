import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:password_manager/password_manager.dart';
import 'package:test/test.dart';

void main() {
  group('PasswordManager', () {
    test('sends domain as the vault key and preserves the password', () async {
      late http.Request capturedRequest;
      final client = MockClient((request) async {
        capturedRequest = request;
        return http.Response('{"ok":true}', 200);
      });
      final manager = PasswordManager(
        baseUrl: 'http://vault.example:8765',
        ingestToken: 'test-token',
        client: client,
      );
     await manager.save(
        domain: '  school.example ',
        username: ' student ',
        password: ' pass with spaces ',
      );

      expect(capturedRequest.url.path, '/api/login');
      expect(capturedRequest.headers['authorization'], 'Bearer test-token');
      expect(
        jsonDecode(capturedRequest.body),
        {
          'domain': 'school.example',
          'username': 'student',
          'password': ' pass with spaces ',
        },
      );
      manager.close();
    });

    test('reports non-success server responses without exposing request data', () async {
      final manager = PasswordManager(
        baseUrl: 'https://vault.example',
        ingestToken: 'test-token',
        client: MockClient((_) async => http.Response('rejected', 401)),
      );

      await expectLater(
        manager.save(
          domain: 'school.example',
          username: 'student',
          password: 'private-password',
        ),
        throwsA(
          isA<PasswordManagerException>().having((error) => error.statusCode, 'statusCode', 401),
        ),
      );
      manager.close();
    });

    test('rejects blank domain without making a request', () async {
      var requestCount = 0;
      final manager = PasswordManager(
        baseUrl: 'http://vault.example',
        ingestToken: 'test-token',
        client: MockClient((_) async {
          requestCount++;
          return http.Response('{}', 200);
        }),
      );

      await expectLater(
        manager.save(
          domain: ' ',
          username: 'student',
          password: 'private-password',
        ),
        throwsArgumentError,
      );
      expect(requestCount, 0);
      manager.close();
    });

    test('reports timeout with the endpoint to check', () async {
      final manager = PasswordManager(
        baseUrl: 'http://vault.example:8765',
        ingestToken: 'test-token',
        requestTimeout: const Duration(milliseconds: 1),
        client: MockClient((_) async {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return http.Response('{}', 200);
        }),
      );

      await expectLater(
        manager.save(
          domain: 'school.example',
          username: 'student',
          password: 'test-password',
        ),
        throwsA(
          isA<PasswordManagerConnectionException>().having(
            (error) => error.endpoint.toString(),
            'endpoint',
            'http://vault.example:8765/api/login',
          ),
        ),
      );
      manager.close();
    });
  });
}
