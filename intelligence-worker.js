'use strict';
importScripts('./planner.js','./semantic-protocol.js');
let engine = null;
self.onmessage = async ({data:{id,input,excluded}}) => {
  const report = update => self.postMessage({id,type:'progress',update});
  try {
    if (!engine) {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter || !adapter.features.has('shader-f16')) throw new Error('Видеоустройство не поддерживает необходимые возможности WebGPU. Обычная сборка доступна.');
      const sdk = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.81/+esm');
      const name = 'Qwen3-8B-q4f16_1-MLC';
      const record = sdk.prebuiltAppConfig.model_list.find(item => item.model_id === name);
      if (!record) throw new Error('Не найден совместимый вариант модели.');
      const config = {
        ...sdk.prebuiltAppConfig,
        useIndexedDBCache:true,
        model_list:[{...record,model:'https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC/resolve/b3d55c289eae58f77095f5b68c895eeea358ee09/'}]
      };
      engine = await sdk.CreateMLCEngine(name,{
        appConfig:config,
        initProgressCallback(update) {
          const progress = Math.min(1,Math.max(0,update.progress || 0));
          report({phase:'loading',progress,text:'Загрузка модели — '+Math.round(progress*100)+'%. Первый запуск может занять несколько минут.'});
        }
      },{context_window_size:2048});
    }
    report({phase:'thinking',text:'Подбираю визуальную трактовку…'});
    const response = await engine.chat.completions.create({
      messages:IllustrationSemanticProtocol.messages(input,excluded),
      temperature:0, max_tokens:220,
      extra_body:{enable_thinking:false},
      response_format:{type:'json_object',schema:JSON.stringify(IllustrationSemanticProtocol.schema)}
    });
    self.postMessage({id,type:'result',content:response.choices[0].message.content});
  } catch(error) {
    engine = null;
    self.postMessage({id,type:'error',message:error.message || 'Не удалось загрузить модель.'});
  }
};
