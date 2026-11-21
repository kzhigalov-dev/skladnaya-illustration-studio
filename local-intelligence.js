'use strict';
const LocalIllustrationIntelligence = (() => {
  let worker = null;
  let active = null;
  let ready = false;
  let serial = 0;
  let capabilities;
  let capabilitiesAt = 0;
  let pending = false;
  function availability() {
    if (!capabilities || Date.now() - capabilitiesAt > 5000) {
      capabilitiesAt = Date.now();
      capabilities = (async () => {
        if (!/^https?:$/.test(location.protocol)) return false;
        try {
          const response = await fetch('/api/capabilities',{signal:AbortSignal.timeout(1500)});
          if (!response.ok) return false;
          return (await response.json()).localModel === true;
        } catch { return false; }
      })();
    }
    return capabilities;
  }
  function stop(reason) {
    worker?.terminate();
    worker = null;
    ready = false;
    if (active) {
      active.signal?.removeEventListener('abort',active.abort);
      active.reject(reason);
      active = null;
    }
  }
  function getWorker() {
    if (worker) return worker;
    const instance = new Worker('./intelligence-worker.js');
    worker = instance;
    instance.onmessage = ({data}) => {
      if (worker !== instance || !active || data.id !== active.id) return;
      if (data.type === 'progress') {
        active.onProgress?.(data.update);
        return;
      }
      const request = active;
      active = null;
      request.signal?.removeEventListener('abort',request.abort);
      if (data.type === 'error') {
        stop(new Error(data.message));
        request.reject(new Error(data.message));
        return;
      }
      try {
        const plan = IllustrationSemanticProtocol.decode(data.content,request.excluded,request.input);
        ready = true;
        request.resolve(plan);
      } catch (error) { request.reject(error); }
    };
    instance.onerror = () => {
      if (worker === instance) stop(new Error('Не удалось запустить модель. Попробуйте Chrome или Edge с аппаратным ускорением.'));
    };
    return worker;
  }
  async function suggest(input,{signal,onProgress} = {}) {
    if (pending) throw new Error('Дождитесь завершения текущего анализа.');
    if (signal?.aborted) throw new DOMException('Отменено','AbortError');
    const excluded = IllustrationPlanner.excludedKeys(input);
    IllustrationSemanticProtocol.messages(input,excluded);
    pending = true;
    try {
      if (!/^https?:$/.test(location.protocol)) throw new Error('Для анализа модели откройте приложение через локальный сервер или опубликованную ссылку. Обычная сборка доступна с диска.');
      const local = await availability();
      signal?.throwIfAborted();
      if (local) {
        onProgress?.({phase:'thinking',text:'Анализирую заголовок на этом компьютере…'});
        const response = await fetch('/api/interpret',{
          method:'POST',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),headers:{'Content-Type':'application/json'},body:JSON.stringify({input})
        });
        const output = await response.json();
        signal?.throwIfAborted();
        if (!response.ok) throw new Error(output.error || 'Не удалось выполнить анализ.');
        const plan = output.plan;
        const keys = IllustrationSemanticProtocol.schema.properties.main.enum;
        if (!plan || !Array.isArray(plan.items) || plan.items.length > 3 ||
            !plan.items.every(item=>keys.includes(item.key) && item.key !== 'none' && !excluded.includes(item.key) &&
              ['main','background'].includes(item.role))) throw new Error('Получен некорректный ответ модели.');
        return plan;
      }
      if (!navigator.gpu) throw new Error('Для анализа в браузере нужен Chrome или Edge с WebGPU. Можно запустить node server.cjs с установленной моделью Ollama.');
      return await new Promise((resolve,reject) => {
        const id = ++serial;
        const abort = () => stop(new DOMException('Отменено','AbortError'));
        active = {id,resolve,reject,signal,onProgress,abort,excluded,input};
        signal?.addEventListener('abort',abort,{once:true});
        try { getWorker().postMessage({id,input,excluded}); }
        catch(error) { stop(error); }
      });
    } finally { pending = false; }
  }
  return {suggest,availability,get ready(){return ready;},downloadSize:'около 5 ГБ'};
})();
globalThis.LocalIllustrationIntelligence = LocalIllustrationIntelligence;
