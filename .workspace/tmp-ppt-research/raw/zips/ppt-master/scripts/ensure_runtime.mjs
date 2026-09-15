#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(scriptDir, '..');
const projectDir = path.join(skillRoot, 'project');
const packageFile = path.join(projectDir, 'package.json');
const archiveFile = path.join(skillRoot, 'project-runtime.tar.gz');
const partPattern = /^project-runtime\.part\d+\.txt$/;

if (fs.existsSync(packageFile)) process.exit(0);

let archiveToExtract = archiveFile;
let temporaryArchive = null;

if (!fs.existsSync(archiveFile)) {
  const parts = fs.readdirSync(skillRoot).filter(name => partPattern.test(name)).sort();
  if (!parts.length) {
    throw new Error('PPT大师运行资源缺失: 未找到 project-runtime 文本分片');
  }
  const encoded = parts.map(name => fs.readFileSync(path.join(skillRoot, name), 'utf8').trim()).join('');
  temporaryArchive = path.join(os.tmpdir(), `ppt-master-runtime-${process.pid}-${Date.now()}.tar.gz`);
  fs.writeFileSync(temporaryArchive, Buffer.from(encoded, 'base64'));
  archiveToExtract = temporaryArchive;
}

try {
  fs.rmSync(projectDir, { recursive: true, force: true });
  execFileSync('tar', ['-xzf', archiveToExtract, '-C', skillRoot], { stdio: 'inherit' });
} finally {
  if (temporaryArchive) fs.rmSync(temporaryArchive, { force: true });
}

if (!fs.existsSync(packageFile)) {
  throw new Error('PPT大师运行包解压失败: 未找到 project/package.json');
}

process.stdout.write('PPT大师运行环境已准备完成。\n');
