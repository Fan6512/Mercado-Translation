// Translation-domain helpers kept DOM-free for easier testing and reuse.

function countChars(text, isCN) {
  if (!text) return 0;
  if (!isCN) return text.length;
  let n = 0;
  for (const ch of text) {
    n += /[一-鿿　-〿＀-￯]/.test(ch) ? 2 : 1;
  }
  return n;
}

function stripPromptComments(text) {
  if (!text) return text;
  return text
    .split('\n')
    .filter(line => {
      const t = line.trimStart();
      return !t.startsWith('//') && !t.startsWith('#!') && !t.startsWith('#！');
    })
    .join('\n');
}

const LANG_EN_NAME = { en: 'English', es: 'Español', pt: 'Português', zh: '中文' };

function buildRoutePrompt(basePrompt, langs, titleCount = 1) {
  const count = Math.min(3, Math.max(1, Number.parseInt(titleCount, 10) || 1));
  const pair = langs.map(l => {
    const needAnalysis = (l === 'es' || l === 'pt');
    return `    "${l}": { "title": "..."${needAnalysis ? ', "analysis": "..."' : ''} }`;
  }).join(',\n');

  if (count === 1) {
    return basePrompt + `

【本次输出范围 — 优先于上文所有语种要求】
本次只需输出：${langs.map(l => `${l}（${LANG_EN_NAME[l]}）`).join('、')}。其余语种字段直接省略，不要出现在 JSON 中。
只返回如下 JSON，不要 markdown 代码块：
{
${pair.replace(/^    /gm, '  ')}
}`;
  }

  const versions = Array.from({ length: count }, (_, i) => `  {
    "version": ${i + 1},
${pair}
  }`).join(',\n');

  return basePrompt + `

【本次输出数量与范围 — 优先于上文输出格式要求】
本次需要生成 ${count} 套候选标题。这里只规定数量与 JSON 结构；每套标题的内容规则、SEO规则、字符规则仍严格遵守上文 Prompt。
每套都只输出：${langs.map(l => `${l}（${LANG_EN_NAME[l]}）`).join('、')}。其余语种字段直接省略。
${count} 套标题应彼此有合理差异，但不得为了差异而添加原商品没有的信息。
只返回如下 JSON，不要 markdown 代码块：
{
  "versions": [
${versions}
  ]
}`;
}
