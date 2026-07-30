import { useEffect, useRef, useState } from 'react';
import {
  useCastState,
  useCastSession,
  useRemoteMediaClient,
  CastState,
} from 'react-native-google-cast';

export type CastStatus = {
  isConnected: boolean;
  isConnecting: boolean;
  noDevices: boolean;
  deviceName: string | null;
  playRemote: () => void;
  pauseRemote: () => void;
  seekRemote: (position: number) => void;
};

/**
 * Manages Chromecast state for the player on Android.
 * Auto-loads the given stream URL whenever a session connects or the URL changes.
 */
export function useCast(url: string, title: string, isLive: boolean): CastStatus {
  const castState   = useCastState();
  const castSession = useCastSession();
  const client      = useRemoteMediaClient();

  const [deviceName, setDeviceName] = useState<string | null>(null);

  // Resolve device name when a session starts/ends
  useEffect(() => {
    if (castSession) {
      castSession.getCastDevice()
        .then((d) => setDeviceName(d?.friendlyName ?? null))
        .catch(() => setDeviceName(null));
    } else {
      setDeviceName(null);
    }
  }, [castSession]);

  // Auto-load media on the cast device whenever the session connects or the
  // active stream URL changes (e.g. user navigates to a different channel).
  const prevUrlRef = useRef('');
  useEffect(() => {
    if (!client) { prevUrlRef.current = ''; return; }
    if (url !== prevUrlRef.current) {
      prevUrlRef.current = url;
      client
        .loadMedia({
          mediaInfo: {
            contentUrl: url,
            contentType: 'application/x-mpegURL',
            streamType: isLive ? 'live' : 'buffered',
            metadata: { type: 'generic', title },
          },
          autoplay: true,
        })
        .catch((e: unknown) => console.warn('[Cast] loadMedia error:', e));
    }
  }, [client, url, title, isLive]);

  return {
    isConnected:  castState === CastState.CONNECTED,
    isConnecting: castState === CastState.CONNECTING,
    noDevices:    castState === CastState.NO_DEVICES_AVAILABLE || castState == null,
    deviceName,
    playRemote:  () => client?.play().catch(console.warn),
    pauseRemote: () => client?.pause().catch(console.warn),
    seekRemote:  (position: number) => client?.seek({ position }).catch(console.warn),
  };
}
