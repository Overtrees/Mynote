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

/// 非 Web 端：原生阶段接 google_sign_in。
Future<GoogleSession?> requestGoogleAccess() async => null;
