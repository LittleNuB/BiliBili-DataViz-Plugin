import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'src/background/favorites/taxonomy.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const tempPath = path.join(os.tmpdir(), `bili-taxonomy-test-${Date.now()}.mjs`);

try {
  fs.writeFileSync(tempPath, compiled, 'utf8');
  const taxonomy = await import(pathToFileURL(tempPath).href);

  const v2Region = taxonomy.resolveBiliRegion({ tidV2: 2096 });
  assert.deepEqual(v2Region.v2Path, ['人工智能', 'AI学习']);
  assert.deepEqual(v2Region.preferredPath, ['人工智能', 'AI学习']);

  const legacyRegion = taxonomy.resolveBiliRegion({ tid: 231 });
  assert.deepEqual(legacyRegion.legacyPath, ['科技', '计算机技术']);

  const favorite = {
    itemKey: '1:BV1test',
    mediaId: 1,
    folderTitle: '默认收藏夹',
    avid: 1,
    bvid: 'BV1test',
    title: 'Codex APP 保姆级教程',
    intro: 'AI 编程和代码管理教程',
    authorName: 'tester',
    authorMid: 1,
    tid: 231,
    tname: '计算机技术',
    tidV2: 2096,
    tagName: '计算机技术',
    tags: ['编程', 'Codex'],
    cover: '',
    duration: 0,
    pubtime: 0,
    favTime: 0,
    syncedAt: 0,
  };
  assert.deepEqual(
    taxonomy.normalizeFavoritePath({ topicTail: ['编程', 'Codex'] }, favorite),
    ['人工智能', 'AI学习', '编程', 'Codex'],
  );

  const migratedMusicFavorite = {
    ...favorite,
    itemKey: '1:BVmusic',
    title: '王力宏 2006 盖世英雄演唱会',
    intro: '高清音乐现场饭拍，音质修复',
    tid: 25,
    tname: 'MMD·3D',
    tidV2: 2018,
    tnameV2: 'MMD·3D',
    pidV2: 1005,
    pidNameV2: '动画',
    tagName: 'MMD·3D',
    tags: ['王力宏', '演唱会', '音质修复'],
  };
  assert.deepEqual(
    taxonomy.normalizeFavoritePath({ topicTail: ['王力宏', '演唱会'] }, migratedMusicFavorite),
    ['音乐', '音乐现场', '王力宏', '演唱会'],
  );
  assert.equal(taxonomy.resolveFavoriteBasePath(migratedMusicFavorite).source, 'tag_override');

  const expanded = taxonomy.expandFavoriteSearchTerms(['代码']);
  assert.ok(expanded.includes('编程'));

  console.log('taxonomy tests passed');
} finally {
  fs.rmSync(tempPath, { force: true });
}
