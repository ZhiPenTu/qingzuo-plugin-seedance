import { createPluginClient } from './sdk.mjs';
import { buildCreateTaskPayload, createVideoTask, pollVideoTask } from './seedance.mjs';

const client = createPluginClient();
const bridge = globalThis.commercePlugin;
const $ = id => document.getElementById(id);

let selectedImageToken = null;
let selectedImageBase64 = null;
let currentVideoToken = null;
let currentVideoUrl = null;
let currentTaskId = null;
let busy = false;
let pollingCancelled = false;

function message(text, type = '') {
  const el = $('status');
  el.textContent = text;
  el.className = type;
}

function updateControls() {
  $('key').disabled = busy;
  $('save-key').disabled = busy;
  $('clear-key').disabled = busy;
  $('mode').disabled = busy;
  $('pick-image').disabled = busy;
  $('clear-image').disabled = busy;
  $('prompt').disabled = busy;
  $('ratio').disabled = busy;
  $('duration').disabled = busy;
  $('resolution').disabled = busy;
  $('run').disabled = busy || !$('prompt').value.trim();
  $('cancel').disabled = !busy;
  $('save-video').disabled = busy || (!currentVideoToken && !currentVideoUrl);
}

async function refreshKeyStatus() {
  try {
    const hasKey = await client.credentials.status('volcengine-ark-key');
    $('key-status').textContent = hasKey
      ? '已配置火山方舟 API 密钥。任务调用费用由您的火山方舟账户扣除。'
      : '尚未配置 API 密钥，请先输入密钥并保存。';
  } catch (e) {
    $('key-status').textContent = '检查密钥状态失败：' + e.message;
  }
}

$('save-key').onclick = async () => {
  const val = $('key').value.trim();
  if (!val) {
    message('请输入有效的 API 密钥。', 'error');
    return;
  }
  try {
    await client.credentials.set('volcengine-ark-key', val);
    $('key').value = '';
    message('API 密钥已安全保存至系统凭据库。', 'success');
    await refreshKeyStatus();
  } catch (e) {
    message(e.message, 'error');
  }
};

$('clear-key').onclick = async () => {
  try {
    await client.credentials.clear('volcengine-ark-key');
    message('已清除保存的 API 密钥。', 'success');
    await refreshKeyStatus();
  } catch (e) {
    message(e.message, 'error');
  }
};

$('mode').onchange = () => {
  const isI2V = $('mode').value === 'i2v';
  $('image-group').hidden = !isI2V;
};

$('pick-image').onclick = async () => {
  try {
    const file = await client.files.pick({ extensions: ['png', 'jpg', 'jpeg', 'webp'] });
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('请选择小于 20 MB 的图片。');
    }
    if (selectedImageToken) {
      await client.files.release(selectedImageToken.token).catch(() => {});
    }
    selectedImageToken = file;
    const fileContent = await client.files.read(file.token);
    selectedImageBase64 = fileContent.data;

    const previewUrl = await client.files.url(file.token);
    $('first-frame-preview').src = previewUrl;
    $('first-frame-preview').hidden = false;
    $('clear-image').hidden = false;
    message(`已选择首帧图片：${file.name}`);
  } catch (e) {
    message(e.message, 'error');
  }
};

$('clear-image').onclick = async () => {
  if (selectedImageToken) {
    await client.files.release(selectedImageToken.token).catch(() => {});
    selectedImageToken = null;
    selectedImageBase64 = null;
  }
  $('first-frame-preview').hidden = true;
  $('first-frame-preview').removeAttribute('src');
  $('clear-image').hidden = true;
  message('已移除首帧图片。');
};

$('prompt').oninput = updateControls;

$('run').onclick = async () => {
  const prompt = $('prompt').value.trim();
  if (!prompt) {
    message('请输入视频提示词。', 'error');
    return;
  }
  const isI2V = $('mode').value === 'i2v';
  if (isI2V && !selectedImageBase64) {
    message('图生视频模式下请先选择首帧图片。', 'error');
    return;
  }

  busy = true;
  pollingCancelled = false;
  updateControls();
  message('正在提交视频生成任务至火山方舟…');

  $('video-result').hidden = true;
  $('video-result').removeAttribute('src');
  $('preview-placeholder').hidden = false;
  $('preview-placeholder').textContent = '正在处理视频生成任务，请稍候…';

  try {
    const payload = buildCreateTaskPayload({
      prompt,
      imageBase64: isI2V ? selectedImageBase64 : null,
      imageMime: selectedImageToken ? selectedImageToken.mime : 'image/png',
      ratio: $('ratio').value,
      duration: $('duration').value,
      resolution: $('resolution').value
    });

    currentTaskId = await createVideoTask(client, payload);
    message(`任务已提交（ID: ${currentTaskId}），正在排队与渲染…`);

    const result = await pollVideoTask(
      client,
      currentTaskId,
      (status, attempt) => {
        if (pollingCancelled) throw new Error('任务已被取消。');
        const statusMap = {
          queued: '任务排队中…',
          running: '模型正在渲染生成视频…'
        };
        message(statusMap[status] || `任务状态：${status}（第 ${attempt} 次轮询）`);
      },
      { intervalMs: 3000, maxAttempts: 100 }
    );

    if (result.videoBase64) {
      if (currentVideoToken) await client.files.release(currentVideoToken.token).catch(() => {});
      currentVideoToken = await client.files.create({
        data: result.videoBase64,
        filename: `seedance-${Date.now()}.mp4`,
        mime: 'video/mp4'
      });
      const videoSrc = await client.files.url(currentVideoToken.token);
      $('video-result').src = videoSrc;
      $('video-result').hidden = false;
      $('preview-placeholder').hidden = true;
      currentVideoUrl = null;
    } else if (result.videoUrl) {
      $('video-result').src = result.videoUrl;
      $('video-result').hidden = false;
      $('preview-placeholder').hidden = true;
      currentVideoUrl = result.videoUrl;
    }

    message('视频生成完成！可以在线播放或保存。', 'success');
  } catch (error) {
    message(error.message, 'error');
    $('preview-placeholder').textContent = '生成未完成，请检查配置后重试。';
  } finally {
    busy = false;
    updateControls();
  }
};

$('cancel').onclick = async () => {
  pollingCancelled = true;
  message('正在取消任务…');
  try {
    if (bridge?.invoke) {
      await bridge.invoke('tasks.cancel', { id: 'seedance-create' });
      await bridge.invoke('tasks.cancel', { id: 'seedance-query' });
    }
    message('任务已取消。');
  } catch (e) {
    message(e.message, 'error');
  } finally {
    busy = false;
    updateControls();
  }
};

$('save-video').onclick = async () => {
  try {
    if (currentVideoToken) {
      await client.files.save(currentVideoToken.token, currentVideoToken.name || `seedance-${Date.now()}.mp4`);
      message('视频保存成功！', 'success');
    } else if (currentVideoUrl) {
      const response = await client.network.request({
        url: currentVideoUrl,
        method: 'GET',
        responseType: 'file',
        filename: `seedance-${Date.now()}.mp4`
      });
      if (response.file) {
        await client.files.save(response.file.token, response.file.name);
        await client.files.release(response.file.token).catch(() => {});
        message('视频保存成功！', 'success');
      }
    }
  } catch (e) {
    message(e.message, 'error');
  }
};

client.onDispose(() => {
  $('video-result').removeAttribute('src');
  $('first-frame-preview').removeAttribute('src');
});

refreshKeyStatus();
updateControls();
