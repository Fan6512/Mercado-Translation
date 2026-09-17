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

function buildRoutePrompt(basePrompt, langs) {
  const pair = langs.map(l => {
    const needAnalysis = (l === 'es' || l === 'pt');
    return `  "${l}": { "title": "..."${needAnalysis ? ', "analysis": "..."' : ''} }`;
  }).join(',\n');
  return basePrompt + `

【本次输出范围 — 优先于上文所有语种要求】
本次只需输出：${langs.map(l => `${l}（${LANG_EN_NAME[l]}）`).join('、')}。其余语种字段直接省略，不要出现在 JSON 中。
只返回如下 JSON，不要 markdown 代码块：
{
${pair}
}`;
}
