import 'dart:async';
import 'dart:convert';
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:http/http.dart' as http;

import '../core/diag.dart';
import '../core/prefs_store.dart';

class GoogleSession {
  const GoogleSession({
    required this.accessToken,
    required this.expiresAt,
    this.name,
  });
  final String accessToken;
  final DateTime expiresAt;
  final String? name;

  bool get isValid => DateTime.now().isBefore(expiresAt);
}

/// 与 Web 版一致的 OAuth 客户端与权限范围（constants.js GOOGLE_CLIENT_ID）。
const _clientId =
    '993589743002-6o74a8e7d5jck2g55rag7me7q60ogehr.apps.googleusercontent.com';
const _scope =
    'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';

/// 弹出 GIS 授权并取得 access token（仅内存保存）。
Future<GoogleSession?> requestGoogleAccess() async {
  final google = globalContext.getProperty('google'.toJS) as JSObject?;
  if (google == null) {
    Diag.error('DRIVE', 'GIS not loaded');
    return null;
  }
  final oauth2 = (google.getProperty('accounts'.toJS) as JSObject).getProperty(
    'oauth2'.toJS,
  ) as JSObject;
  final completer = Completer<GoogleSession?>();
  final callback = (JSObject resp) {
    final error = resp.getProperty('error'.toJS) as JSString?;
    if (error != null) {
      Diag.error('DRIVE', 'GIS error: ${error.toDart}');
      completer.complete(null);
      return;
    }
    final token = (resp.getProperty('access_token'.toJS) as JSString?)?.toDart;
    final expiresIn =
        (resp.getProperty('expires_in'.toJS) as JSNumber?)?.toDartInt ?? 3600;
    if (token == null) {
      completer.complete(null);
      return;
    }
    completer.complete(
      GoogleSession(
        accessToken: token,
        expiresAt: DateTime.now().add(Duration(seconds: expiresIn - 60)),
      ),
    );
  }.toJS;
  final config = JSObject()
    ..setProperty('client_id'.toJS, _clientId.toJS)
    ..setProperty('scope'.toJS, _scope.toJS)
    ..setProperty('callback'.toJS, callback);
  final client = oauth2.callMethod('initTokenClient'.toJS, config) as JSObject;
  client.callMethod('requestAccessToken'.toJS, JSObject());
  final session = await completer.future;
  if (session == null) return null;
  // 附带读取用户昵称用于状态展示（失败不阻断）
  try {
    final res = await http.get(
      Uri.parse('https://www.googleapis.com/oauth2/v3/userinfo'),
      headers: {'Authorization': 'Bearer ${session.accessToken}'},
    );
    if (res.statusCode == 200) {
      final info = jsonDecode(res.body) as Map<String, dynamic>;
      Diag.log('DRIVE', 'google connected: ${info['name']}');
      // 列表页头部头像（原版 google_avatar 约定）
      final picture = info['picture']?.toString();
      if (picture != null && picture.isNotEmpty) {
        prefsSet('google_avatar', picture);
      }
      return GoogleSession(
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
        name: info['name']?.toString(),
      );
    }
  } catch (_) {}
  return session;
}
