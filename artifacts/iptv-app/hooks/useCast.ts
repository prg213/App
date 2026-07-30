// No-op cast hook for iOS and web.
// On iOS, AirPlay is handled natively by expo-video's AVPlayer; the CastButton
// component shows an Alert guiding the user to iOS Control Centre.
// On web, casting is not supported.

export type CastStatus = {
  isConnected: boolean;
  isConnecting: boolean;
  noDevices: boolean;
  deviceName: string | null;
  playRemote: () => void;
  pauseRemote: () => void;
  seekRemote: (position: number) => void;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function useCast(_url: string, _title: string, _isLive: boolean): CastStatus {
  return {
    isConnected:  false,
    isConnecting: false,
    noDevices:    true,
    deviceName:   null,
    playRemote:   () => {},
    pauseRemote:  () => {},
    seekRemote:   () => {},
  };
}
