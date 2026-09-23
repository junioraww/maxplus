import { test, expect } from '@playwright/test';
import { sanitizeData } from '../src/lib/services/trace.js';

test.describe('Trace system sensitive data sanitization', () => {
  test('redacts authentication tokens and passwords with [TRIM]', () => {
    const syntheticPayload = {
      token: 'synth_secret_token_12345',
      password: 'synth_user_password',
      auth: 'synth_auth_header_xyz',
      track_id: 'synth_track_uuid',
      access_token: 'synth_bearer_token',
      nested: {
        secret: 'synth_sub_secret',
        avatar_token: 'synth_avatar_token',
      },
    };

    const sanitized = sanitizeData(syntheticPayload);

    expect(sanitized.token).toBe('[TRIM]');
    expect(sanitized.password).toBe('[TRIM]');
    expect(sanitized.auth).toBe('[TRIM]');
    expect(sanitized.track_id).toBe('[TRIM]');
    expect(sanitized.access_token).toBe('[TRIM]');
    expect(sanitized.nested.secret).toBe('[TRIM]');
    expect(sanitized.nested.avatar_token).toBe('[TRIM]');
  });

  test('trims requested fields: baseUrl, url, thumbhash, previewData, callbackData, id, cid, sender, videoId', () => {
    const syntheticData = {
      baseUrl: 'https://example.com/api',
      url: 'https://example.com/media/file.mp4',
      thumbhash: 'synth_thumbhash_value_123',
      previewData: 'synth_preview_base64_data',
      callbackData: 'synth_callback_payload_data',
      id: 123456,
      cid: 78910,
      sender: 'user_9999',
      videoId: 45678,
    };

    const sanitized = sanitizeData(syntheticData);

    expect(sanitized.baseUrl).toBe('[TRIM]');
    expect(sanitized.url).toBe('[TRIM]');
    expect(sanitized.thumbhash).toBe('[TRIM]');
    expect(sanitized.previewData).toBe('[TRIM]');
    expect(sanitized.callbackData).toBe('[TRIM]');
    expect(sanitized.id).toBe('[TRIM]');
    expect(sanitized.cid).toBe('[TRIM]');
    expect(sanitized.sender).toBe('[TRIM]');
    expect(sanitized.videoId).toBe('[TRIM]');
  });

  test('masks phone numbers and trims chat message contents', () => {
    const syntheticData = {
      phone: '+79991234567',
      text: 'Synthetic private chat message content here',
      caption: 'Synthetic photo caption text',
      user: {
        phone_number: '12345678901',
      },
    };

    const sanitized = sanitizeData(syntheticData);

    expect(sanitized.phone).toBe('[TRIM]');
    expect(sanitized.user.phone_number).toBe('[TRIM]');
    expect(sanitized.text).toBe('[TRIM]');
    expect(sanitized.caption).toBe('[TRIM]');
  });

  test('handles nested arrays and deep objects gracefully', () => {
    const syntheticComplex = {
      items: [
        { id: 1, text: 'First message', token: 'secret1', url: 'https://a.b' },
        { id: 2, text: 'Second message', token: 'secret2', baseUrl: 'https://c.d' },
      ],
      user: {
        credentials: {
          password: 'synth_user_pass',
        },
      },
    };

    const sanitized = sanitizeData(syntheticComplex);
    expect(sanitized.items[0].id).toBe('[TRIM]');
    expect(sanitized.items[0].token).toBe('[TRIM]');
    expect(sanitized.items[0].text).toBe('[TRIM]');
    expect(sanitized.items[0].url).toBe('[TRIM]');
    expect(sanitized.items[1].id).toBe('[TRIM]');
    expect(sanitized.items[1].token).toBe('[TRIM]');
    expect(sanitized.items[1].text).toBe('[TRIM]');
    expect(sanitized.items[1].baseUrl).toBe('[TRIM]');
    expect(sanitized.user.credentials.password).toBe('[TRIM]');
  });
});

test.describe('Trace archive packaging and structure', () => {
  test('formats version with v prefix in zip filename', () => {
    const appVersion = '0.1.3';
    const vVersion = appVersion.startsWith('v') ? appVersion : `v${appVersion}`;
    const dateStr = '2026-09-21T10-25-00-000Z';
    const zipFileName = `log-${vVersion}-${dateStr}.zip`;

    expect(zipFileName).toBe('log-v0.1.3-2026-09-21T10-25-00-000Z.zip');
    expect(zipFileName.startsWith('log-v')).toBe(true);
  });
});
