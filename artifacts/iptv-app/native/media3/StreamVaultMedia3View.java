package com.prg213.streamvault.media3;

import android.content.Context;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import com.facebook.react.bridge.ReactApplicationContext;

/**
 * A thin output target around Media3's PlayerView.
 *
 * The view never owns or releases ExoPlayer. Attaching a new React Native host
 * switches the single session output to this PlayerView; detaching only clears
 * the output so the session can survive the navigation/layout boundary.
 */
final class StreamVaultMedia3View extends FrameLayout {
  private final StreamVaultMedia3Session session;
  private final PlayerView playerView;
  private String source = "";
  private String reloadKey;
  private boolean paused;

  StreamVaultMedia3View(
      @NonNull Context context,
      @NonNull ReactApplicationContext applicationContext
  ) {
    super(context);
    setBackgroundColor(android.graphics.Color.BLACK);
    setClipChildren(true);
    setClipToPadding(true);

    playerView = new PlayerView(context);
    playerView.setUseController(false);
    playerView.setKeepContentOnPlayerReset(true);
    playerView.setShutterBackgroundColor(android.graphics.Color.BLACK);
    addView(
        playerView,
        new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
    );

    session = StreamVaultMedia3Session.get(applicationContext);
    session.registerView(this);
  }

  void setSource(String nextSource) {
    String normalised = nextSource == null ? "" : nextSource.trim();
    if (normalised.equals(source)) return;
    source = normalised;
    if (!source.isEmpty()) {
      session.setSource(source, false);
    }
  }

  void setReloadKey(String nextReloadKey) {
    if (reloadKey == null) {
      reloadKey = nextReloadKey;
      return;
    }
    if (java.util.Objects.equals(reloadKey, nextReloadKey)) return;
    reloadKey = nextReloadKey;
    if (!source.isEmpty()) session.setSource(source, true);
  }

  void setPaused(boolean nextPaused) {
    if (paused == nextPaused) return;
    paused = nextPaused;
    session.setPaused(paused);
  }

  void setResizeMode(String resizeMode) {
    playerView.setResizeMode("cover".equals(resizeMode)
        ? AspectRatioFrameLayout.RESIZE_MODE_ZOOM
        : "fill".equals(resizeMode)
        ? AspectRatioFrameLayout.RESIZE_MODE_FILL
        : AspectRatioFrameLayout.RESIZE_MODE_FIT);
  }

  @Override
  protected void onAttachedToWindow() {
    super.onAttachedToWindow();
    session.attach(playerView);
    session.setPaused(paused);
  }

  @Override
  protected void onDetachedFromWindow() {
    session.detach(playerView);
    super.onDetachedFromWindow();
  }

  void disposePresentation() {
    session.unregisterView(this);
    session.detach(playerView);
  }
}