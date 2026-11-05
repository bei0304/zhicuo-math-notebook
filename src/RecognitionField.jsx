import React, { lazy, Suspense } from 'react';

const MathText = lazy(() => import('./MathText.jsx'));

export default function RecognitionField({ label, value, onChange, placeholder, rows = 7, disabled = false, optional = false }) {
  return <div className="recognition-field">
    <div className="recognition-label">{label}{optional && <span className="muted">（没有可留空）</span>}</div>
    <div className="recognition-preview" aria-label={`${label}预览`}>
      {value.trim() ? <Suspense fallback={<p className="muted">正在排版公式…</p>}><MathText>{value}</MathText></Suspense> : <p className="muted">{optional ? '未提供作答过程，本次只分析题目。' : '尚未录入题目，请展开下方编辑区补充。'}</p>}
    </div>
    <details className="recognition-editor">
      <summary>{value.trim() ? '修改' : '补充'}{label}文字</summary>
      <label className="field-label">编辑{label}
        <textarea rows={rows} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} />
      </label>
      <p className="field-help">修改后上方预览会同步更新，请对照原照片核对。公式编辑区中的 $ 和反斜杠是排版标记。</p>
    </details>
  </div>;
}
