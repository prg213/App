# StreamVault IPTV

Expo-based IPTV player with TMDB metadata, trailer previews, reminders, and channel management.

## Environment variables

Create a `.env.local` file (or set these as Replit Secrets) before running the app:

| Variable | Required | Description |
|---|---|---|
| `EXPO_PUBLIC_TMDB_API_KEY` | Yes | TMDB API v3 key — used for title search, poster images, and trailer lookups. Get one free at https://www.themoviedb.org/settings/api |
| `EXPO_PUBLIC_YOUTUBE_API_KEY` | No | YouTube Data API v3 key — enables a reliable fallback when the YouTube HTML scrape returns no results (common on Android where YouTube may serve a different page format). Without this key, the app degrades gracefully: trailers from TMDB still work and the scrape is attempted first. Get one at https://console.cloud.google.com — enable the **YouTube Data API v3** and restrict the key to that API. |

### Why is `EXPO_PUBLIC_YOUTUBE_API_KEY` optional?

The app first tries to find trailer candidates by scraping the YouTube search results page. On Android the network path sometimes returns a page format the parser doesn't recognise, leaving the candidate list empty. When that happens:

- **Without** the key: the app falls back to TMDB-supplied trailer IDs only. TMDB trailers are sometimes embedding-disabled (YouTube error 150/152), which can mean no trailer plays.
- **With** the key: the app calls `search.list` with `videoEmbeddable=true`, so all fallback candidates are guaranteed embeddable.

A Metro console warning is emitted when the scrape returns empty so you can diagnose the issue during development:

```
[tmdb] YouTube HTML scrape returned no results for "Dune". Set EXPO_PUBLIC_YOUTUBE_API_KEY to enable the Data API v3 fallback.
```

## Development

```bash
pnpm --filter @workspace/iptv-app run dev
```
