package com.prg213.streamvault.media3;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackGroup;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.ui.PlayerView;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

/**
 * One continuous Media3 session for Android Live TV.
 *
 * This class deliberately has no React view lifecycle ownership. A mini-player
 * or fullscreen view can come and go; only an explicit stream change prepares a
 * new MediaItem. DefaultRenderersFactory is configured to prefer the Media3
 * FFmpeg extension whenever the vetted optional extension AAR is bundled,
 * allowing MPEG Layer II audio without a VLC fallback.
 */
final class StreamVaultMedia3Session implements Player.Listener {
  private static StreamVaultMedia3Session instance;

  static synchronized StreamVaultMedia3Session get(@NonNull ReactApplicationContext context) {
    if (instance == null) instance = new StreamVaultMedia3Session(context);
    return instance;
  }

  private final ReactApplicationContext reactContext;
  private final DefaultTrackSelector trackSelector;
  private final ExoPlayer player;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final Set<StreamVaultMedia3View> views = new CopyOnWriteArraySet<>();
  private @Nullable PlayerView attachedView;
  private String activeSource = "";
  private boolean progressScheduled;

  private final Runnable progressRunnable = new Runnable() {
    @Override
    public void run() {
      if (player.isPlaying()) emitProgress();
      mainHandler.postDelayed(this, 500);
    }
  };

  private StreamVaultMedia3Session(@NonNull ReactApplicationContext context) {
    reactContext = context;
    trackSelector = new DefaultTrackSelector(context);
    DefaultRenderersFactory renderersFactory = new DefaultRenderersFactory(context)
        // This is a no-op when the optional FFmpeg extension is absent and
        // becomes active automatically when its vetted AAR is supplied.
        .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);
    player = new ExoPlayer.Builder(context)
        .setTrackSelector(trackSelector)
        .setRenderersFactory(renderersFactory)
        .build();
    player.setAudioAttributes(
        new androidx.media3.common.AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
            .build(),
        true
    );
    player.addListener(this);
    mainHandler.post(progressRunnable);
    progressScheduled = true;
    emitCapabilities();
  }

  void registerView(StreamVaultMedia3View view) {
    views.add(view);
  }

  void unregisterView(StreamVaultMedia3View view) {
    views.remove(view);
  }

  void attach(@NonNull PlayerView nextView) {
    if (attachedView == nextView) return;
    PlayerView.switchTargetView(player, attachedView, nextView);
    attachedView = nextView;
  }

  void detach(@NonNull PlayerView view) {
    if (attachedView != view) return;
    PlayerView.switchTargetView(player, view, null);
    attachedView = null;
  }

  void setSource(@NonNull String source, boolean forceReload) {
    if (!forceReload && source.equals(activeSource)) {
      if (!player.getPlayWhenReady()) player.play();
      return;
    }
    activeSource = source;
    emitState("loading");
    MediaItem item = new MediaItem.Builder().setUri(source).build();
    player.setMediaItem(item, true);
    player.prepare();
    player.play();
  }

  void retry() {
    if (activeSource.isEmpty()) return;
    setSource(activeSource, true);
  }

  void setPaused(boolean paused) {
    if (paused) player.pause(); else player.play();
  }

  void selectTrack(@NonNull String id, int trackType) {
    Tracks tracks = player.getCurrentTracks();
    for (Tracks.Group group : tracks.getGroups()) {
      if (group.getType() != trackType) continue;
      TrackGroup mediaTrackGroup = group.getMediaTrackGroup();
      for (int index = 0; index < group.length; index++) {
        if (id.equals(trackId(mediaTrackGroup, index))) {
          TrackSelectionOverride override =
              new TrackSelectionOverride(mediaTrackGroup, Collections.singletonList(index));
          trackSelector.setParameters(trackSelector.buildUponParameters()
              .clearOverridesOfType(trackType)
              .setOverrideForType(override));
          emitTracks(tracks);
          return;
        }
      }
    }
  }

  void clearTrackType(int trackType) {
    trackSelector.setParameters(trackSelector.buildUponParameters()
        .clearOverridesOfType(trackType)
        .setTrackTypeDisabled(trackType, true));
    emitTracks(player.getCurrentTracks());
  }

  WritableMap capabilities() {
    WritableMap result = Arguments.createMap();
    result.putString("engine", "media3");
    result.putBoolean("ffmpegAudioExtension", isFfmpegAvailable());
    result.putBoolean("m2AudioSupported", isFfmpegAvailable());
    result.putString(
        "m2AudioStrategy",
        isFfmpegAvailable() ? "media3-ffmpeg-extension" : "platform-codecs-only"
    );
    return result;
  }

  private boolean isFfmpegAvailable() {
    try {
      Class<?> library = Class.forName("androidx.media3.decoder.ffmpeg.FfmpegLibrary");
      Object available = library.getMethod("isAvailable").invoke(null);
      return Boolean.TRUE.equals(available);
    } catch (Throwable ignored) {
      return false;
    }
  }

  @Override
  public void onPlaybackStateChanged(int state) {
    if (state == Player.STATE_BUFFERING) emitState("buffering");
    else if (state == Player.STATE_READY) {
      emitState(player.isPlaying() ? "playing" : "ready");
      emitTracks(player.getCurrentTracks());
    } else if (state == Player.STATE_ENDED) emitState("ended");
    else if (state == Player.STATE_IDLE) emitState("idle");
  }

  @Override
  public void onIsPlayingChanged(boolean isPlaying) {
    emitState(isPlaying ? "playing" : "paused");
  }

  @Override
  public void onPlayerError(@NonNull PlaybackException error) {
    WritableMap payload = Arguments.createMap();
    payload.putString("type", "error");
    payload.putString("message", error.getMessage() == null ? "Media3 could not open this stream." : error.getMessage());
    payload.putInt("code", error.errorCode);
    payload.putBoolean("ffmpegAudioExtension", isFfmpegAvailable());
    emit(payload);
  }

  @Override
  public void onTracksChanged(@NonNull Tracks tracks) {
    emitTracks(tracks);
  }

  private void emitTracks(Tracks tracks) {
    WritableArray audio = Arguments.createArray();
    WritableArray subtitles = Arguments.createArray();
    for (Tracks.Group group : tracks.getGroups()) {
      if (group.getType() != C.TRACK_TYPE_AUDIO && group.getType() != C.TRACK_TYPE_TEXT) continue;
      TrackGroup trackGroup = group.getMediaTrackGroup();
      for (int index = 0; index < group.length; index++) {
        WritableMap track = Arguments.createMap();
        track.putString("id", trackId(trackGroup, index));
        track.putString("language", trackGroup.getFormat(index).language);
        track.putString("label", trackGroup.getFormat(index).label);
        track.putBoolean("selected", group.isTrackSelected(index));
        if (group.getType() == C.TRACK_TYPE_AUDIO) audio.pushMap(track);
        else subtitles.pushMap(track);
      }
    }
    WritableMap payload = Arguments.createMap();
    payload.putString("type", "tracks");
    payload.putArray("audio", audio);
    payload.putArray("subtitles", subtitles);
    emit(payload);
  }

  private String trackId(TrackGroup group, int index) {
    return group.id + ":" + index;
  }

  private void emitProgress() {
    WritableMap payload = Arguments.createMap();
    payload.putString("type", "progress");
    payload.putDouble("position", player.getCurrentPosition() / 1000d);
    long duration = player.getDuration();
    payload.putDouble("duration", duration == C.TIME_UNSET ? 0d : duration / 1000d);
    emit(payload);
  }

  private void emitState(String state) {
    WritableMap payload = Arguments.createMap();
    payload.putString("type", "state");
    payload.putString("state", state);
    emit(payload);
  }

  private void emitCapabilities() {
    WritableMap payload = capabilities();
    payload.putString("type", "capabilities");
    emit(payload);
  }

  private void emit(WritableMap payload) {
    if (!reactContext.hasActiveCatalystInstance()) return;
    reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
        .emit("streamvault:media3-event", payload);
  }
}