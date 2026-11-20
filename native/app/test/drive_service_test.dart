import 'package:flutter_test/flutter_test.dart';
import 'package:mynote_app/services/drive_service.dart';

void main() {
  test('classifyDriveResponse', () {
    expect(classifyDriveResponse(401), 'expired');
    expect(classifyDriveResponse(403), 'forbidden');
    expect(classifyDriveResponse(200), isNull);
    expect(classifyDriveResponse(500), isNull);
  });

  test('selectMynoteBackup：zip 优先，其次最新', () {
    final files = [
      const DriveFile(
        id: 'a',
        name: 'memories_backup.json',
        modifiedTime: '2026-01-02T00:00:00Z',
      ),
      const DriveFile(
        id: 'b',
        name: 'memories_backup.zip',
        modifiedTime: '2026-01-01T00:00:00Z',
      ),
      const DriveFile(
        id: 'c',
        name: 'memories_backup.zip',
        modifiedTime: '2026-01-03T00:00:00Z',
      ),
      const DriveFile(
        id: 'd',
        name: 'other.zip',
        modifiedTime: '2026-01-04T00:00:00Z',
      ),
    ];
    expect(selectMynoteBackup(files)?.id, 'c');
    expect(selectMynoteBackup(const [])?.id, isNull);
    expect(selectMynoteBackup([files[3]])?.id, isNull);
  });
}
