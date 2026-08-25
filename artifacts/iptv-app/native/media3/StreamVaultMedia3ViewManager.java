package com.prg213.streamvault.media3;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.SimpleViewManager;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.annotations.ReactProp;

/**
 * The React Native view is a presentation target only. Source preparation and
 * player lifetime are delegated to {@link StreamVaultMedia3Session}.
 */
public final class StreamVaultMedia3ViewManager extends SimpleViewManager<StreamVaultMedia3View> {
  static final String REACT_CLASS = "StreamVaultMedia3View";
  private final ReactApplicationContext applicationContext;

  StreamVaultMedia3ViewManager(ReactApplicationContext applicationContext) {
    this.applicationContext = applicationContext;
  }

  @NonNull
  @Override
  public String getName() {
    return REACT_CLASS;
  }

  @NonNull
  @Override
  protected StreamVaultMedia3View createViewInstance(@NonNull ThemedReactContext context) {
    return new StreamVaultMedia3View(context, applicationContext);
  }

  @ReactProp(name = "source")
  public void setSource(StreamVaultMedia3View view, @Nullable String source) {
    view.setSource(source);
  }

  @ReactProp(name = "reloadKey")
  public void setReloadKey(StreamVaultMedia3View view, @Nullable String reloadKey) {
    view.setReloadKey(reloadKey);
  }

  @ReactProp(name = "paused", defaultBoolean = false)
  public void setPaused(StreamVaultMedia3View view, boolean paused) {
    view.setPaused(paused);
  }

  @ReactProp(name = "resizeMode")
  public void setResizeMode(StreamVaultMedia3View view, @Nullable String resizeMode) {
    view.setResizeMode(resizeMode);
  }

  @Override
  public void onDropViewInstance(@NonNull StreamVaultMedia3View view) {
    view.disposePresentation();
    super.onDropViewInstance(view);
  }
}