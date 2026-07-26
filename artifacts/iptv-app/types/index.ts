export type ConnectionType = 'xtream' | 'm3u';

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
  title: string;
  cover?: string;
  type: 'movie' | 'series';
  position?: number;
  duration?: number;
  timestamp: number;
}
