export type PlayerNavigationMode =
  | 'hidden'
  | 'controls'
  | 'scrubber'
  | 'audio'
  | 'subtitles'
  | 'settings'
  | 'channelMenu';

export type PlayerNavigationAction =
  | 'ok'
  | 'back'
  | 'left'
  | 'right'
  | 'up'
  | 'down';

export type PlayerNavigationResult = {
  mode: PlayerNavigationMode;
  action?: 'open' | 'close' | 'seekLeft' | 'seekRight' | 'previousChannel' | 'nextChannel' | 'move';
};

/**
 * Pure state machine for Fire TV player controls.
 *
 * It deliberately contains no React state, timers, native focus calls, or
 * playback APIs. The player screen remains responsible for rendering and
 * executing the returned action. This keeps remote routing deterministic and
 * preserves the existing touch/mobile implementation.
 */
export class PlayerNavigationController {
  private mode: PlayerNavigationMode = 'hidden';

  getMode(): PlayerNavigationMode {
    return this.mode;
  }

  setMode(mode: PlayerNavigationMode): PlayerNavigationMode {
    this.mode = mode;
    return mode;
  }

  handle(action: PlayerNavigationAction): PlayerNavigationResult {
    if (action === 'back') {
      return this.handleBack();
    }

    if (this.mode === 'hidden') {
      if (action === 'ok') {
        this.mode = 'controls';
        return { mode: this.mode, action: 'open' };
      }
      return { mode: this.mode };
    }

    if (this.mode === 'scrubber') {
      if (action === 'left') return { mode: this.mode, action: 'seekLeft' };
      if (action === 'right') return { mode: this.mode, action: 'seekRight' };
      if (action === 'ok') {
        this.mode = 'controls';
        return { mode: this.mode, action: 'close' };
      }
      return { mode: this.mode, action: action === 'up' || action === 'down' ? 'move' : undefined };
    }

    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
      return { mode: this.mode, action: 'move' };
    }

    if (action === 'ok') {
      // Selection is intentionally left to the focused UI control. The
      // controller only owns which modal/interaction layer is active.
      return { mode: this.mode, action: 'move' };
    }

    return { mode: this.mode };
  }

  private handleBack(): PlayerNavigationResult {
    switch (this.mode) {
      case 'audio':
      case 'subtitles':
      case 'settings':
      case 'channelMenu':
        this.mode = 'controls';
        return { mode: this.mode, action: 'close' };
      case 'scrubber':
        this.mode = 'controls';
        return { mode: this.mode, action: 'close' };
      case 'controls':
        this.mode = 'hidden';
        return { mode: this.mode, action: 'close' };
      case 'hidden':
      default:
        return { mode: this.mode };
    }
  }
}

export const playerNavigationController = new PlayerNavigationController();
