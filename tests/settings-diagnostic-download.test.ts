import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadLocalDataDiagnostic,
  type DiagnosticDownloadAdapter,
  type DiagnosticDownloadAnchor,
} from '../dashboard/modules/settings/settings-diagnostic-download.ts';
import type { LocalDataDiagnosticExport } from '../src/shared/local-data-privacy.ts';

test('diagnostic downloader serializes the user-facing schema and releases its object URL', () => {
  const calls: string[] = [];
  let serialized = '';
  let contentType = '';
  const anchor: DiagnosticDownloadAnchor = {
    href: '',
    download: '',
    click: () => { calls.push('click'); },
    remove: () => { calls.push('remove'); },
  };
  const adapter: DiagnosticDownloadAdapter = {
    createBlob: (contents, type) => {
      serialized = contents;
      contentType = type;
      return {} as Blob;
    },
    createObjectUrl: () => 'blob:diagnostic',
    revokeObjectUrl: url => { calls.push(`revoke:${url}`); },
    createAnchor: () => anchor,
    appendAnchor: () => { calls.push('append'); },
    defer: operation => operation(),
  };

  downloadLocalDataDiagnostic(diagnosticFixture(), 'bili-bill-diagnostic-2026-07-20.json', adapter);

  assert.deepEqual(Object.keys(JSON.parse(serialized)), [
    '导出时间',
    '应用',
    '隐私边界',
    '本地数据类别',
    '功能状态',
  ]);
  assert.equal(contentType, 'application/json;charset=utf-8');
  assert.equal(anchor.href, 'blob:diagnostic');
  assert.equal(anchor.download, 'bili-bill-diagnostic-2026-07-20.json');
  assert.deepEqual(calls, ['append', 'click', 'remove', 'revoke:blob:diagnostic']);
});

test('diagnostic downloader cleans up and rethrows when the browser click fails', () => {
  const calls: string[] = [];
  const adapter: DiagnosticDownloadAdapter = {
    createBlob: () => ({} as Blob),
    createObjectUrl: () => 'blob:diagnostic-failure',
    revokeObjectUrl: url => { calls.push(`revoke:${url}`); },
    createAnchor: () => ({
      href: '',
      download: '',
      click: () => { throw new Error('synthetic click failure'); },
      remove: () => { calls.push('remove'); },
    }),
    appendAnchor: () => { calls.push('append'); },
    defer: operation => operation(),
  };

  assert.throws(
    () => downloadLocalDataDiagnostic(diagnosticFixture(), 'diagnostic.json', adapter),
    /synthetic click failure/,
  );
  assert.deepEqual(calls, ['append', 'remove', 'revoke:blob:diagnostic-failure']);
});

test('diagnostic downloader fails closed when required browser APIs are unavailable', () => {
  assert.throws(
    () => downloadLocalDataDiagnostic(diagnosticFixture(), 'diagnostic.json'),
    /DIAGNOSTIC_DOWNLOAD_UNAVAILABLE/,
  );
});

function diagnosticFixture(): LocalDataDiagnosticExport {
  return {
    '导出时间': '2026-07-20T00:00:00.000Z',
    '应用': { '产品': 'Bili-Bill', '诊断格式版本': 1 },
    '隐私边界': { '包含': ['数量'], '不包含': ['正文'] },
    '本地数据类别': [{ '类别': '观看历史', '数量': 0, '占用字节': 0 }],
    '功能状态': {
      '当前视频文本': {
        'B站字幕来源': 0,
        'B站字幕片段': 0,
        '已缓存视频分P': 0,
        '过期片段': 0,
      },
      '当前视频助手': { '摘要与亮点分P': 0, '问答会话': 0 },
      '动态账单': {
        '账单项': 0,
        '暂停中的UP主': 0,
        '解释': 0,
        '最近生成': '暂无记录',
        '最近同步': '暂无记录',
        '同步状态': '等待同步',
      },
      '视频盲盒': { '最近抽取': 0, '最多保留': 50 },
    },
  };
}
