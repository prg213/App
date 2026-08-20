import {
  consumePendingLivePlayerReturn,
  getPendingLivePlayerReturn,
  setPendingLivePlayerReturn,
} from '../lib/livePlayerHandoff';

const channel = {
  id: 'live-42',
  name: 'Sports HD',
  streamUrl: 'https://provider.example/live-42',
  groupTitle: 'Sports',
  epgId: 'sports-hd',
};

describe('live-player return handoff', () => {
  afterEach(() => {
    consumePendingLivePlayerReturn();
  });

  it('keeps the live channel available until Live TV consumes it', () => {
    setPendingLivePlayerReturn(channel);

    expect(getPendingLivePlayerReturn()).toEqual(channel);
    expect(consumePendingLivePlayerReturn()).toEqual(channel);
    expect(getPendingLivePlayerReturn()).toBeNull();
  });

  it('replaces an older pending handoff with the channel currently playing', () => {
    setPendingLivePlayerReturn({ ...channel, id: 'old-channel' });
    setPendingLivePlayerReturn(channel);

    expect(consumePendingLivePlayerReturn()).toEqual(channel);
  });
});