export function buildCreateTaskPayload({ prompt, imageBase64, imageMime = 'image/png', ratio = 'adaptive', duration = 5, resolution = '720p' }) {
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('请输入视频提示词。');
  }
  const content = [{ type: 'text', text: prompt.trim() }];
  if (imageBase64) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${imageMime};base64,${imageBase64}`
      }
    });
  }
  return {
    model: 'doubao-seedance-2.5',
    content,
    ratio: ratio || 'adaptive',
    duration: Number(duration) || 5,
    resolution: resolution || '720p',
    watermark: false
  };
}

export async function createVideoTask(client, payload) {
  const response = await client.network.request({
    url: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
    method: 'POST',
    credential: 'volcengine-ark-key',
    credentialHeader: 'Authorization',
    json: payload,
    taskId: 'seedance-create'
  });
  if (response.status === 401 || response.status === 403) throw new Error('火山方舟 API 密钥无效或未授权。');
  if (response.status === 402) throw new Error('火山方舟账户额度不足或未开通服务。');
  if (response.status === 429) throw new Error('服务请求过于频繁，请稍后手动重试。');
  if (response.status < 200 || response.status >= 300) throw new Error(`视频生成任务提交失败（${response.status}）。`);
  const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  const taskId = data?.id || data?.task_id;
  if (!taskId) throw new Error('服务端未返回有效的任务 ID。');
  return taskId;
}

export async function queryVideoTask(client, taskId) {
  const response = await client.network.request({
    url: `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(taskId)}`,
    method: 'GET',
    credential: 'volcengine-ark-key',
    credentialHeader: 'Authorization',
    taskId: 'seedance-query'
  });
  if (response.status === 401 || response.status === 403) throw new Error('火山方舟 API 密钥无效或未授权。');
  if (response.status < 200 || response.status >= 300) throw new Error(`查询视频生成任务状态失败（${response.status}）。`);
  const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
  const status = data?.status || 'unknown';
  let videoUrl = null;
  let videoBase64 = null;
  if (status === 'succeeded') {
    const content = data.content;
    if (Array.isArray(content) && content.length > 0) {
      const item = content[0];
      videoUrl = item?.video_url?.url || item?.url || (typeof item === 'string' ? item : null);
      videoBase64 = item?.b64_json || item?.video_base64 || null;
    } else if (data.video_url) {
      videoUrl = data.video_url;
    }
  }
  return { status, videoUrl, videoBase64, error: data?.error?.message || null };
}

export async function pollVideoTask(client, taskId, onProgress, options = {}) {
  const intervalMs = options.intervalMs || 3000;
  const maxAttempts = options.maxAttempts || 100;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await queryVideoTask(client, taskId);
    if (onProgress) onProgress(result.status, attempt);
    if (result.status === 'succeeded') {
      return result;
    }
    if (result.status === 'failed') {
      throw new Error(result.error ? `视频生成失败：${result.error}` : '视频生成失败。');
    }
    if (result.status === 'canceled') {
      throw new Error('任务已被取消。');
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error('视频生成任务处理超时，请稍后刷新重试。');
}
