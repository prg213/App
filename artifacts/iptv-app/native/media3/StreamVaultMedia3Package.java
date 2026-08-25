package com.prg213.streamvault.media3;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Workspace-owned bridge for the Android Live TV renderer.
 *
 * The session is intentionally process-scoped. React Native containers may be
 * resized, hidden, or replaced while navigating between mini-player and
 * fullscreen, but those presentation changes must never recreate the decoder.
 */
public final class StreamVaultMedia3Package implements ReactPackage {
  @Override
  public List<NativeModule> createNativeModules(ReactApplicationContext context) {
    return Collections.singletonList(new StreamVaultMedia3ControlModule(context));
  }

  @Override
  public List<ViewManager<?, ?>> createViewManagers(ReactApplicationContext context) {
    List<ViewManager<?, ?>> managers = new ArrayList<>();
    managers.add(new StreamVaultMedia3ViewManager(context));
    return managers;
  }
}