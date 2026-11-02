import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTunnelOrigin } from './launch.mjs';

test('failed API requests never become a demo URL',()=>{
  assert.equal(extractTunnelOrigin('failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": network is unreachable'),null);
  assert.equal(extractTunnelOrigin('Your tunnel: https://quiet-marble-otter.trycloudflare.com'), 'https://quiet-marble-otter.trycloudflare.com');
});
