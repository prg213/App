export type ConnectionType = 'xtream' | 'm3u';

export interface Reminder {
  /** Unique key — channelId + ISO start time */
  id: string;
  channelId: string;
  channelName: string;
  channelLogo?: string;
  /** Stream URL for the channel — stored at creation time so the Reminders
   *  screen can open the player without fetching the full channel list. */
  streamUrl?: string;
  programTitle: string;
  programDescription?: string;
  /** ISO 8601 */
  start: string;
  /** ISO 8601 */
  end: string;
  createdAt: string;
  /** Expo local-notification identifier — present when a notification was
   *  successfully scheduled for this reminder. */
  notificationId?: string;
  /** How many minutes before the programme starts the notification fires.
   *  Stored per-reminder so rescheduling a single reminder doesn't affect
   *  others that still use the global default. */
  leadMins?: number;
}

/** Age-rating ceiling for parental content filter.
 *  Numeric strings map to European/international content age bands.
 *  'all' means no restriction. */
export type MaxRating = 'all' | '7' | '12' | '16' | '18';

export interface ParentalSettings {
  maxRating: MaxRating;
  lockEnabled: boolean;
  /** IDs of channels hidden from the Live TV list and player navigation. */
  blockedChannels: string[];
  /** Category IDs whose channels are hidden everywhere (Live TV, Search). */
  blockedCategories?: string[];
}

export interface Credentials {
  type: ConnectionType;
  host?: string | null;
  username?: string | null;
  password?: string | null;
  m3uUrl?: string | null;
}

export interface Channel {
  id: string;
  name: string;
  logo?: string;
  groupTitle: string;
  streamUrl: string;
  epgId?: string;
  num?: number;
  /** 1 if the channel supports catch-up/archive */
  tvArchive?: number;
  /** How many days of archive are kept */
  tvArchiveDuration?: number;
}

export interface CatchupProgram {
  id: string;
  title: string;
  description?: string;
  start: Date;
  end: Date;
  hasArchive: boolean;
  /** Raw server-local start string ("YYYY-MM-DD HH:MM:SS") — used verbatim
   *  for timeshift URLs so device timezone never shifts the replay window. */
  serverStart: string;
  /** Unix seconds from start_timestamp — used for ?utc= style catchup URLs. */
  startTimestamp: number;
}

export interface Category {
  id: string;
  name: string;
  count?: number;
}

export interface Movie {
  id: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  streamId: string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  rating?: string;
  duration?: string;
  containerExtension: string;
  /** Unix timestamp (seconds) when this stream was added to the server */
  added?: number;
  /** YouTube video ID or full URL from the provider's VOD info */
  trailerUrl?: string;
}

export interface Series {
  id: string;
  name: string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  rating?: string;
  categoryId: string;
  categoryName?: string;
  /** Unix timestamp (seconds) when this series was added to the server */
  added?: number;
  /** YouTube video ID or full URL from the provider's series info */
  trailerUrl?: string;
}

export interface Season {
  id: number;
  name: string;
  seasonNumber: number;
  episodes: Episode[];
}

export interface Episode {
  id: string;
  title: string;
  episodeNum: number;
  seasonNum: number;
  streamId: string;
  containerExtension: string;
  info?: {
    plot?: string;
    duration?: string;
    rating?: string;
    releaseDate?: string;
    cover?: string;
  };
}

export interface FavoriteChannel {
  id: string;
  name: string;
  logo?: string;
  groupTitle: string;
  streamUrl: string;
  epgId?: string;
}

export interface FavoriteMovie {
  id: string;
  name: string;
  cover?: string;
  rating?: string;
  genre?: string;
  streamId: string;
  containerExtension: string;
  categoryId: string;
  plot?: string;
  cast?: string;
  director?: string;
  releaseDate?: string;
  duration?: string;
}

export interface FavoriteSeries {
  id: string;
  name: string;
  cover?: string;
  rating?: string;
  genre?: string;
  categoryId: string;
  plot?: string;
  cast?: string;
  director?: string;
}

export interface EpgProgram {
  channelId: string;
  title: string;
  description?: string;
  category?: string;
  start: Date;
  end: Date;
  icon?: string;
}

export interface WatchHistoryEntry {
  id: string;
  /** For series episodes: the parent series ID so the rail can navigate to the series page. */
  parentId?: string;
  title: string;
  /** For series episodes: the parent series name, used to label the card on the Recently Watched list. */
  parentTitle?: string;
  cover?: string;
  type: 'movie' | 'series';
  position?: number;
  duration?: number;
  timestamp: number;
}

/** A channel entry saved to the recently-watched list. */
export interface RecentChannel {
  id: string;
  name: string;
  logo?: string;
  groupTitle: string;
  streamUrl: string;
  epgId?: string;
  /** Unix ms timestamp of when the user last selected or watched this channel. */
  watchedAt: number;
}
