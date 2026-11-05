import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { readableFilename } from '../server/filename.js';

test('用户截图回归：奇函数选择题公式正常排版，四个选项保留换行和原文', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  t.after(() => vite.close());
  const { default: MathText } = await vite.ssrLoadModule('/src/MathText.jsx');
  const question = String.raw`2.（多选）已知 $f(x)$ 是 $\mathbf{R}$ 上的奇函数，且当 $x\in[0,+\infty)$ 时，$f(x)=x^{2}-2x$，则（　　）
A. $f(-5)=-15$
B. $f(x)$ 的递增区间 $(-\infty,-1)\cup(1,+\infty)$
C. $f(x)$ 的递减区间 $(-1,1)$
D. 若 $f(x)$ 在区间 $[0,m]$ 上的值域为 $[-1,0]$，则实数 $m$ 的取值范围为 $[1,2]$`;
  const html = renderToStaticMarkup(React.createElement(MathText, { children: question }));
  assert.ok(html.includes('class="katex"'));
  assert.ok(!html.includes('katex-error'));
  assert.equal((html.match(/<br\s*\/>/g) || []).length, 4);
  assert.ok(html.includes('∪'));
  assert.ok(html.includes('∞'));
  assert.ok(html.includes('A. ') && html.includes('B. ') && html.includes('C. ') && html.includes('D. '));
  assert.ok(html.includes('f(-5)=-15'));
  assert.ok(!html.includes('>$f'));
  const title = renderToStaticMarkup(React.createElement(MathText, { inline: true, children: '函数 $f(x)$ 的图像' }));
  assert.ok(title.startsWith('<span'));
  assert.ok(!title.includes('<p>'));
});

test('中文上传文件名解码兼容旧记录，不破坏原有 Unicode 名称', () => {
  const name = '屏幕截图 2026-11-06 004901.png';
  assert.equal(readableFilename(Buffer.from(name).toString('latin1')), name);
  assert.equal(readableFilename(name), name);
  assert.equal(readableFilename('photo.jpg'), 'photo.jpg');
  assert.equal(readableFilename('café.png'), 'café.png');
});
