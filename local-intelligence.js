'use strict';
const LocalIllustrationIntelligence = (() => {
  let worker = null;
  let active = null;
  let ready = false;
  let serial = 0;
  let capabilities;
  function availability() {
    if (!capabilities) capabilities = (async () => {
      if (!/^https?:$/.test(location.protocol)) return false;
      try {
        const response = await fetch('/api/capabilities',{signal:AbortSignal.timeout(1500)});
        if (!response.ok) return false;
        return (await response.json()).localModel === true;
      } catch { return false; }
    })();
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
    worker = new Worker('./intelligence-worker.js');
    worker.onmessage = ({data}) => {
      if (!active || data.id !== active.id) return;
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
        const plan = IllustrationSemanticProtocol.decode(data.content,request.excluded);
        ready = true;
        request.resolve(plan);
      } catch (error) { request.reject(error); }
    };
    worker.onerror = () => stop(new Error('Не удалось запустить модель. Попробуйте Chrome или Edge с аппаратным ускорением.'));
    return worker;
  }
  async function suggest(input,{signal,onProgress} = {}) {
    if (active) throw new Error('Дождитесь завершения текущего анализа.');
    if (signal?.aborted) throw new DOMException('Отменено','AbortError');
    const excluded = IllustrationPlanner.excludedKeys(input);
    IllustrationSemanticProtocol.messages(input,excluded);
    if (await availability()) {
      onProgress?.({phase:'thinking',text:'Анализирую заголовок на этом компьютере…'});
      const response = await fetch('/api/interpret',{
        method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({input})
      });
      const output = await response.json();
      if (!response.ok) throw new Error(output.error || 'Не удалось выполнить анализ.');
      const plan = output.plan;
      const keys = IllustrationSemanticProtocol.schema.properties.main.enum;
      if (!plan || !Array.isArray(plan.items) || plan.items.length > 3 ||
          !plan.items.every(item=>keys.includes(item.key) && item.key !== 'none' && !excluded.includes(item.key) &&
            ['main','background'].includes(item.role))) throw new Error('Получен некорректный ответ модели.');
      return plan;
    }
    if (!navigator.gpu) throw new Error('Для анализа в браузере нужен Chrome или Edge с WebGPU. Можно запустить node server.cjs с установленной моделью Ollama.');
    return new Promise((resolve,reject) => {
      const id = ++serial;
      const abort = () => stop(new DOMException('Отменено','AbortError'));
      active = {id,resolve,reject,signal,onProgress,abort,excluded};
      signal?.addEventListener('abort',abort,{once:true});
      try { getWorker().postMessage({id,input,excluded}); }
      catch(error) { stop(error); }
    });
  }
  return {suggest,availability,get ready(){return ready;},downloadSize:'около 5 ГБ'};
})();
globalThis.LocalIllustrationIntelligence = LocalIllustrationIntelligence;
