import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreateTaskPayload, createVideoTask, queryVideoTask, pollVideoTask } from '../ui/seedance.mjs';

test('buildCreateTaskPayload validates input and constructs correct payload', () => {
  assert.throws(() => buildCreateTaskPayload({ prompt: '' }), /提示词/);
  assert.throws(() => buildCreateTaskPayload({ prompt: '   ' }), /提示词/);

  const t2v = buildCreateTaskPayload({
    prompt: '一艘帆船驶向夕阳',
    ratio: '16:9',
    duration: 5,
    resolution: '1080p'
  });
  assert.equal(t2v.model, 'doubao-seedance-2.5');
  assert.equal(t2v.ratio, '16:9');
  assert.equal(t2v.duration, 5);
  assert.equal(t2v.resolution, '1080p');
  assert.equal(t2v.content.length, 1);
  assert.equal(t2v.content[0].type, 'text');
  assert.equal(t2v.content[0].text, '一艘帆船驶向夕阳');

  const i2v = buildCreateTaskPayload({
    prompt: '帆船继续航行',
    imageBase64: 'AAAA',
    imageMime: 'image/jpeg',
    ratio: 'adaptive',
    duration: 10,
    resolution: '720p'
  });
  assert.equal(i2v.content.length, 2);
  assert.equal(i2v.content[1].type, 'image_url');
  assert.equal(i2v.content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
});

test('createVideoTask submits request to Ark API and handles errors', async () => {
  const mockPayload = { model: 'doubao-seedance-2.5', content: [{ type: 'text', text: '测试' }] };

  // Success
  const clientSuccess = {
    network: {
      request: async (options) => {
        assert.equal(options.url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks');
        assert.equal(options.method, 'POST');
        assert.equal(options.credential, 'volcengine-ark-key');
        assert.equal(options.credentialHeader, 'Authorization');
        return { status: 200, data: { id: 'cgt-123456' } };
      }
    }
  };
  const taskId = await createVideoTask(clientSuccess, mockPayload);
  assert.equal(taskId, 'cgt-123456');

  // 401 error
  const client401 = { network: { request: async () => ({ status: 401 }) } };
  await assert.rejects(createVideoTask(client401, mockPayload), /API 密钥无效/);

  // 402 error
  const client402 = { network: { request: async () => ({ status: 402 }) } };
  await assert.rejects(createVideoTask(client402, mockPayload), /账户额度不足/);

  // 429 error
  const client429 = { network: { request: async () => ({ status: 429 }) } };
  await assert.rejects(createVideoTask(client429, mockPayload), /过于频繁/);

  // Missing id
  const clientMissingId = { network: { request: async () => ({ status: 200, data: {} }) } };
  await assert.rejects(createVideoTask(clientMissingId, mockPayload), /未返回有效的任务 ID/);
});

test('queryVideoTask and pollVideoTask track task status lifecycle', async () => {
  let queryCount = 0;
  const mockClient = {
    network: {
      request: async (options) => {
        assert.match(options.url, /tasks\/cgt-123456$/);
        queryCount++;
        if (queryCount === 1) {
          return { status: 200, data: { status: 'queued' } };
        }
        if (queryCount === 2) {
          return { status: 200, data: { status: 'running' } };
        }
        return {
          status: 200,
          data: {
            status: 'succeeded',
            content: [{ video_url: { url: 'https://example.com/video.mp4' } }]
          }
        };
      }
    }
  };

  const progressEvents = [];
  const result = await pollVideoTask(
    mockClient,
    'cgt-123456',
    (status, attempt) => progressEvents.push({ status, attempt }),
    { intervalMs: 1, maxAttempts: 10 }
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.videoUrl, 'https://example.com/video.mp4');
  assert.deepEqual(progressEvents, [
    { status: 'queued', attempt: 1 },
    { status: 'running', attempt: 2 },
    { status: 'succeeded', attempt: 3 }
  ]);

  // Failure handling in pollVideoTask
  const failClient = {
    network: {
      request: async () => ({
        status: 200,
        data: { status: 'failed', error: { message: '提示词包含敏感词' } }
      })
    }
  };
  await assert.rejects(
    pollVideoTask(failClient, 'cgt-failed', null, { intervalMs: 1, maxAttempts: 5 }),
    /包含敏感词/
  );
});
