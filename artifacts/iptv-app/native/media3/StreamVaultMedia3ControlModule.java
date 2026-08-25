package com.prg213.streamvault.media3;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/** Commands that are independent of a React Native presentation view. */
public final class StreamVaultMedia3ControlModule extends ReactContextBaseJavaModule {
  private final StreamVaultMedia3Session session;

  StreamVaultMedia3ControlModule(@NonNull ReactApplicationContext context) {
    super(context);
    session = StreamVaultMedia3Session.get(context);
  }

  @NonNull
  @Override
  public String getName() {
    return "StreamVaultMedia3Control";
  }

  @ReactMethod
  public void retry() {
    session.retry();
  }

  @ReactMethod
  public void setPaused(boolean paused) {
    session.setPaused(paused);
  }

  @ReactMethod
  public void selectAudioTrack(String id) {
    session.selectTrack(id, androidx.media3.common.C.TRACK_TYPE_AUDIO);
  }

  @ReactMethod
  public void selectSubtitleTrack(String id) {
    session.selectTrack(id, androidx.media3.common.C.TRACK_TYPE_TEXT);
  }

  @ReactMethod
  public void clearSubtitleTrack() {
    session.clearTrackType(androidx.media3.common.C.TRACK_TYPE_TEXT);
  }

  @ReactMethod
  public void getCapabilities(Promise promise) {
    promise.resolve(session.capabilities());
  }
}