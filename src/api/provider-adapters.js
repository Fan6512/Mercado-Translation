// OpenAI-compatible provider/request adapter layer.
// Keeps provider/model quirks out of the main application flow without changing UI behavior.
(function (global) {
  'use strict';

  function detectProvider(profile) {
    const base = String(profile?.base || '').toLowerCase();
    if (base.includes('openrouter.ai')) return 'openrouter';
    if (base.includes('generativelanguage.googleapis.com')) return 'gemini';
    if (base.includes('api.deepseek.com')) return 'deepseek';
    if (base.includes('dashscope.aliyuncs.com')) return 'qwen';
    if (base.includes('api.openai.com')) return 'openai';
    return 'generic';
  }

  function usesCompletionTokenField(model) {
    const name = String(model || '').toLowerCase();
    return /^(?:o[134](?:-|$)|gpt-(?:5|6)(?:[.-]|$))/.test(name);
  }

  function supportsTemperature(profile) {
    // OpenAI reasoning-generation families reject or ignore temperature on some endpoints.
    return !usesCompletionTokenField(profile?.model);
  }

  function buildChatRequest(profile, options = {}) {
    const body = {
      model: profile.model,
      stream: options.stream === true,
      messages: options.messages || [],
    };

    const maxTokens = options.maxTokens ?? profile.maxTokens;
    if (Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) {
      if (usesCompletionTokenField(profile.model)) {
        body.max_completion_tokens = Math.round(Number(maxTokens));
      } else {
        body.max_tokens = Math.round(Number(maxTokens));
      }
    }

    const temperature = options.temperature ?? profile.temp;
    if (supportsTemperature(profile) && Number.isFinite(Number(temperature))) {
      body.temperature = Number(temperature);
    }

    return body;
  }

  global.ProviderAdapters = Object.freeze({
    detectProvider,
    usesCompletionTokenField,
    supportsTemperature,
    buildChatRequest,
  });
})(window);
