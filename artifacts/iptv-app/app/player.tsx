.actionBtnSecondaryText}>← Previous</Text>
                </FocusablePressable>
              ) : <View style={{ flex: 1 }} />}
              {nextChannel ? (
                <FocusablePressable
                  style={styles.actionBtnSecondary}
                  onPress={() => {
                    const idx = (channelIdx + 1) % channelList.length;
                    switchChannel(nextChannel, idx);
                    if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 400);
                  }}
                >
                  <Text style={styles.actionBtnSecondaryText}>Next →</Text>
                </FocusablePressable>
              ) : <View style={{ flex: 1 }} />}
            </View>
          )}
        </View>
      ) : videoMounted && !usesPersistentNativeSurface ? (
        <NativeStreamPlayer
          source={activeUrl}
          player={player}
          style={StyleSheet.absoluteFill}
          resizeMode={contentFit}
          paused={!isPlaying}
          reloadKey={vlcReloadKey}
          seekPosition={vlcSeekPosition}
          onPlaying={() => {
            if (reconnectTimerRef.current) {
              clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = null;
            }
            setIsPlaying(true);
            setIsBuffering(false);
            setHasError(false);
            setIsReconnecting(false);
            setIsResolvingUrl(false);
            setReconnectAttempt(0);
            reconnectAttemptRef.current = 0;
            // A healthy VLC start re-arms one stale URL refresh for any later
            // provider rotation, matching Expo's readyToPlay success path.
            didResolveStaleUrlRef.current = false;
            resolveSessionRef.current += 1;
            if (isLive) notifyPlayerReady();
          }}
          onBuffering={() => setIsBuffering(true)}
          onError={() => {
            if (USES_NATIVE_VLC) {
              handleNativeVlcError();
            } else {
              setIsBuffering(false);
              setErrorMsg('VLC could not open this stream.');
              setHasError(true);
            }
          }}
          onProgress={(time, reportedDuration) => {
            if (isCatchup) return;
            setCurrentTime(time);
            if (reportedDuration > 0 && isFinite(reportedDuration)) {
              setDuration(reportedDuration);
              // Expo's ready listener is intentionally disabled on Android.
              // Apply saved VOD history once VLC has reported a usable duration.
              if (USES_NATIVE_VLC && !didInitialSeekRef.current && startAtSecs > 0) {
                didInitialSeekRef.current = true;
                const resumeAt = Math.min(startAtSecs, reportedDuration);
                setCurrentTime(resumeAt);
                currentTimeRef.current = resumeAt;
                setVlcSeekPosition(Math.max(0, Math.min(1, resumeAt / reportedDuration)));
              }
            }
          }}
        />
      ) : null}

      {/* ── Channel-loading overlay ────────────────────────────────────────────
          Shown during initial load and every channel switch.  Covers the blank
          VideoView so the user never sees a frozen/empty player surface.
          pointerEvents="none" keeps Back and D-pad zones fully active. */}
      {isBuffering && !usesPersistentNativeSurface && !isReconnecting && !isResolvingUrl && !hasError && !isWeb && !(isLive && (hasZapped || Platform.isTV)) && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <View style={styles.loadingContent}>
            {!!activeLogo && (
              <Image
                source={{ uri: activeLogo }}
                style={styles.loadingLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            )}
            <ActivityIndicator size="large" color="#ffffff" />
            <Text style={styles.loadingTitle} numberOfLines={1}>
              {activeTitle || 'Loading…'}
            </Text>
            <Text style={styles.loadingSubtitle}>Connecting to stream</Text>
          </View>
        </View>
      )}

      {/* Refreshing stream overlay — shown during silent URL re-resolve (#137) */}
      {isResolvingUrl && !isWeb && (
        <View style={styles.reconnectOverlay} pointerEvents="none">
          <View style={styles.bufferCircle}>
            <Text style={styles.bufferIcon}>⟳</Text>
          </View>
          <Text style={styles.reconnectText}>Refreshing stream…</Text>
        </View>
      )}

      {/* Reconnecting overlay (live streams only) */}
      {isReconnecting && !isResolvingUrl && !isWeb && (
        <View style={styles.reconnectOverlay} pointerEvents="none">
          <View style={styles.bufferCircle}>
            <Text style={styles.bufferIcon}>↺</Text>
          </View>
          <Text style={styles.reconnectText}>
            Reconnecting… ({reconnectAttempt}/{MAX_RECONNECTS})
          </Text>
        </View>
      )}

      {/* Tap catcher — single tap shows controls, double tap on VOD seeks ±10 s */}
      {!isWeb && !hasError && (
        <GestureDetector gesture={combinedGesture}>
          <View style={StyleSheet.absoluteFill}>
            {doubleTapSide !== null && (
              <View
                style={[
                  styles.doubleTapFeedback,
                  doubleTapSide === 'back'
                    ? { left: 0, right: '50%' }
                    : { left: '50%', right: 0 },
                ]}
                pointerEvents="none"
              >
                <Text style={styles.doubleTapIcon}>
                  {doubleTapSide === 'back' ? '« 10s' : '10s »'}
                </Text>
              </View>
            )}
          </View>
        </GestureDetector>
      )}

      {/* ── Fire TV / Android TV: VOD idle focus catcher ─────────────────────
          When the controls overlay is hidden there is nothing focusable on
          screen for the D-pad remote.  This full-screen transparent Pressable
          with hasTVPreferredFocus acts as the "resting" focus target.
          • OK (select) → show the controls overlay and move focus to ▶/⏸.
          • BACK is handled by the BackHandler registered above (dismisses
            controls if visible, otherwise navigates back).
          When controls are visible this element yields focus (focusable=false)
          so the remote can reach the actual control buttons. */}
      {Platform.isTV && !isLive && !isWeb && !hasError && (
        <Pressable
          ref={tvVodIdleRef as any}
          focusable={!showControls}
          style={StyleSheet.absoluteFill}
          onPress={showVodControls}
        />
      )}

      {/* ── Controls overlay (VOD: play/seek/back) ── */}
      {showControls && !isWeb && !isLive && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: controlsOpacity }]} pointerEvents="box-none">
          {/* VOD title bar — top-centre */}
          <View style={styles.vodTitleBar} pointerEvents="none">
            {params.parentTitle ? (
              <Text style={styles.vodParentTitle} numberOfLines={1}>{params.parentTitle}</Text>
            ) : null}
            <Text style={styles.vodTitle} numberOfLines={1}>{params.title}</Text>
          </View>
          {/* Back button + casting pill — absolute top-left */}
          <View style={{ position: 'absolute', top: insets.top + 8, left: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <FocusablePressable style={styles.backBtn} onPress={handleBack}>
              <Text style={styles.backIcon}>←</Text>
            </FocusablePressable>
            {isCasting && (
              <View style={styles.castingPill}>
                <Text style={styles.castingText}>
                  {castDeviceName ? `📺 ${castDeviceName}` : '📺 Casting'}
                </Text>
              </View>
            )}
          </View>

          {/* Cast button + Audio + CC + Settings ⚙ — absolute top-right */}
          <View style={{ position: 'absolute', top: insets.top + 8, right: 16, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <CastButton />
            {/* Audio track button — always visible */}
            <FocusablePressable
              ref={audioChipRef}
              style={[styles.trackPill, audioTracks.length === 0 && { opacity: 0.35 }]}
              onPress={() => setShowAudioPicker(true)}
            >
              <Text style={styles.trackPillText}>
                🎵 {activeAudioTrack?.label || activeAudioTrack?.language || 'Audio'}
              </Text>
            </FocusablePressable>
            {/* CC / Subtitle button.
                Touch: tap cycles off→first→next→off; long-press opens picker.
                TV/D-pad: OK always opens the picker so the user can jump to any
                track without cycling through all of them. */}
            <FocusablePressable
              ref={ccChipRef}
              style={[styles.trackPill, subtitleTracks.length === 0 && { opacity: 0.35 }, activeSubtitleTrack !== null && styles.trackPillActive]}
              onPress={Platform.isTV ? () => setShowSubPicker(true) : handleCcPress}
              onLongPress={() => setShowSubPicker(true)}
              delayLongPress={400}
            >
              <Text style={[styles.trackPillText, activeSubtitleTrack !== null && styles.trackPillTextActive]}>
                CC {activeSubtitleTrack ? `· ${(activeSubtitleTrack.language || '').toUpperCase()}` : ''}
              </Text>
            </FocusablePressable>
            <FocusablePressable
              ref={settingsChipRef}
              style={styles.backBtn}
              onPress={() => { setShowSettings(true); }}
            >
              <Text style={{ fontSize: 18, color: '#fff' }}>⚙</Text>
            </FocusablePressable>
          </View>

          {/* Seek + play/pause buttons — absolute centre */}
          <View style={styles.centerAbs} pointerEvents="box-none">
            <FocusablePressable
              ref={tvSeek30BackRef}
              style={styles.seekBtn}
              onPress={() => seek(-30)}
            >
              <Text style={styles.seekIcon}>⏮</Text>
              <Text style={styles.seekLabel}>-30s</Text>
            </FocusablePressable>
            <View style={{ alignItems: 'center' }}>
              <FocusablePressable
                ref={tvPlayBtnRef}
                style={styles.playBtn}
                focusedStyle={styles.focusRing}
                onPress={togglePlay}
              >
                <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
              </FocusablePressable>
              {!isPlaying && !isLive && (
                <Text style={styles.pausedLabel}>PAUSED</Text>
              )}
            </View>
            <FocusablePressable
              ref={tvSeek30FwdRef}
              style={styles.seekBtn}
              onPress={() => seek(+30)}
            >
              <Text style={styles.seekIcon}>⏭</Text>
              <Text style={styles.seekLabel}>+30s</Text>
            </FocusablePressable>
          </View>

          {/* Scrubber + times — touch scrubber (phones/tablets) */}
          {!Platform.isTV && (
            <VodScrubber
              currentTime={currentTime}
              duration={duration}
              insetBottom={insets.bottom}
              onScrubStart={() => {
                // Enable scrubbing mode only for the duration of the drag.
                // On Android, scrubbingModeEnabled suppresses playback when
                // left on permanently — so we scope it tightly to the gesture.
                try { if (player) (player as any).scrubbingModeOptions = { scrubbingModeEnabled: true }; } catch {}
              }}
              onScrubEnd={() => {
                // Always restore normal playback mode when the drag ends.
                try { if (player) (player as any).scrubbingModeOptions = { scrubbingModeEnabled: false }; } catch {}
              }}
              onSeek={(t) => {
                scheduleHide();

                if (!seekCatchupTo(t)) {
                  // Optimistic update so the scrubber stays at the dragged position
                  setCurrentTime(t);
                  currentTimeRef.current = t;
                  if (isCasting) {
                    seekRemote(t);
                  } else if (USES_NATIVE_VLC && duration > 0) {
                    setVlcSeekPosition(Math.max(0, Math.min(1, t / duration)));
                  } else {
                    player.currentTime = t;
                  }
                }
              }}
            />
          )}

          {/* ── TV scrubber row ───────────────────────────────────────────────
              RNGH Pan gestures do not fire from the D-pad remote.  Instead we
              render a focusable anchor bar (progress + times) with invisible
              "bounce" Pressables wired to its nextFocusLeft / nextFocusRight.
              When D-pad left/right lands on a bounce target its onFocus handler
              seeks ±10 s and immediately returns focus to the anchor — the same
              focus-bounce technique used for live TV channel switching. */}
          {Platform.isTV && (
            <>
              {/* Invisible seek-back target — receives focus when D-pad LEFT on anchor */}
              <Pressable
                ref={tvSeekBackRef as any}
                focusable
                style={[styles.tvSeekBounce, { left: 0, bottom: insets.bottom + 48 }]}
                onFocus={() => {
                  holdTvScrubFocus();
                  seekTvStep(-10);
                  scheduleHide();
                  setTimeout(() => requestTvFocus(tvScrubAnchorRef.current), 70);
                }}
              />

              {/* Focusable progress bar — D-pad can reach it; LEFT/RIGHT wired below */}
              <FocusablePressable
                ref={tvScrubAnchorRef}
                focusable
                // FocusablePressable clears its own focus state while the
                // invisible bounce target owns native focus. Drive the visual
                // treatment from the latched state as well, so it stays steady
                // throughout LEFT/RIGHT scrubbing.
                style={(focused) => [
                  styles.tvScrubAnchor,
                  { bottom: insets.bottom + 48 },
                  (focused || tvScrubFocused) && styles.tvScrubAnchorFocused,
                ]}
                onPress={() => { /* OK on scrubber: no-op; LEFT/RIGHT seek via bounce targets */ }}
                onFocus={holdTvScrubFocus}
                onBlur={deferTvScrubFocusClear}
              >
                <View style={styles.tvScrubRailWrap}>
                  <View style={styles.tvScrubRail}>
                    <Animated.View
                      style={[
                        styles.tvScrubFill,
                        { width: tvScrubProgress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
                      ]}
                    />
                  </View>
                  {/* Round thumb — mirrors the phone scrubber's drag handle so
                      the seek position is visible; grows + glows when the bar
                      is selected with the D-pad. */}
                   <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.tvScrubThumb,
                      tvScrubFocused && styles.tvScrubThumbFocused,
                       { left: tvScrubProgress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) },
                    ]}
                  />
                </View>
                <View style={styles.tvScrubTimes}>
                  <Text style={styles.tvScrubTimeText}>{fmtSecs(currentTime)}</Text>
                  <Text style={styles.tvScrubTimeText}>
                    {duration > 0 && isFinite(duration) ? fmtSecs(duration) : isCatchup ? 'CATCH-UP' : 'LIVE'}
                  </Text>
                </View>
              </FocusablePressable>

              {/* Invisible seek-forward target — receives focus when D-pad RIGHT on anchor */}
              <Pressable
                ref={tvSeekFwdRef as any}
                focusable
                style={[styles.tvSeekBounce, { right: 0, bottom: insets.bottom + 48 }]}
                onFocus={() => {
                  holdTvScrubFocus();
                  seekTvStep(+10);
                  scheduleHide();
                  setTimeout(() => requestTvFocus(tvScrubAnchorRef.current), 70);
                }}
              />
            </>
          )}
        </Animated.View>
      )}

      {/* Back button + Cast button + Audio + CC for Live — phone/tablet only.
          On TV these chips live inside the OSD info bar; no separate bar needed. */}
      {showControls && !isWeb && isLive && !Platform.isTV && (
        <Animated.View
          style={{ opacity: controlsOpacity, position: 'absolute', top: insets.top + 8, left: 0, right: 0, flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 16 }}
          pointerEvents="box-none"
        >
          <FocusablePressable style={styles.backBtn} onPress={handleBackLive}>
            <Text style={styles.backIcon}>←</Text>
          </FocusablePressable>
          <CastButton />
          <View style={{ flex: 1 }} />
          {/* Channel browser button — opens the LiveChannelMenu overlay */}
          <FocusablePressable
            style={styles.trackPill}
            onPress={() => {
              showChannelMenuRef.current = true; // before OSD dismiss — see onMenu
              if (showInfoRef.current) dismissInfoBar();
              setShowChannelMenu(true);
            }}
          >
            <Text style={styles.trackPillText}>≡ Channels</Text>
          </FocusablePressable>
          {/* Audio track button */}
          <FocusablePressable
            ref={audioChipRef}
            style={[styles.trackPill, audioTracks.length === 0 && { opacity: 0.35 }]}
            onPress={() => setShowAudioPicker(true)}
          >
            <Text style={styles.trackPillText}>
              🎵 {activeAudioTrack?.label || activeAudioTrack?.language || 'Audio'}
            </Text>
          </FocusablePressable>
          {/* CC / Subtitle button.
              Touch: tap cycles off→first→next→off; long-press opens picker.
              TV/D-pad: OK always opens the picker. */}
          <FocusablePressable
            ref={ccChipRef}
            style={[styles.trackPill, activeSubtitleTrack !== null && styles.trackPillActive]}
            onPress={Platform.isTV ? () => setShowSubPicker(true) : handleCcPress}
            onLongPress={() => setShowSubPicker(true)}
            delayLongPress={400}
          >
            <Text style={[styles.trackPillText, activeSubtitleTrack !== null && styles.trackPillTextActive]}>
              CC {activeSubtitleTrack ? `· ${(activeSubtitleTrack.language || '').toUpperCase()}` : ''}
            </Text>
          </FocusablePressable>
        </Animated.View>
      )}

      {/* ── Live TV info bar (NOW/NEXT + prev/next channel) ── */}
      {isLive && !isWeb && !hasError && showInfo && (
        <Animated.View
          style={[styles.infoBar, { paddingBottom: insets.bottom + 8, opacity: infoOpacity }]}
          pointerEvents="box-none"
        >
          {/* Single compact row: channel num + LIVE pill + logo + name + NOW + Audio/CC (TV) + back */}
          <View style={styles.infoTop}>
            {activeChannelNum != null && (
              <Text style={styles.infoChannelNum}>{activeChannelNum}</Text>
            )}
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            {isCasting && (
              <View style={styles.castingPill}>
                <Text style={styles.castingText}>
                  {castDeviceName ? `📺 ${castDeviceName}` : '📺 Casting'}
                </Text>
              </View>
            )}
            {activeSubtitleTrack !== null && !Platform.isTV && (
              <View style={styles.ccActiveBadge}>
                <Text style={styles.ccActiveBadgeText}>{ccLabel}</Text>
              </View>
            )}
            {!!activeLogo && (
              <Image
                source={{ uri: activeLogo }}
                style={styles.infoChannelLogo}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
            )}
            <Text style={styles.infoChannel} numberOfLines={1}>{activeTitle}</Text>
            {currentProg && (
              <>
                <View style={styles.infoSep} />
                <Text style={styles.infoNowLabel}>NOW</Text>
                <Text style={styles.infoNowTitle} numberOfLines={1}>{currentProg.title}</Text>
                <Text style={styles.infoProgTime}>
                  {fmtTime(currentProg.start)}–{fmtTime(currentProg.end)}
                </Text>
              </>
            )}
            {!Platform.isTV && (
              <FocusablePressable onPress={handleBackLive} style={styles.backBtnSmall}>
                <Text style={styles.backIcon}>←</Text>
              </FocusablePressable>
            )}
          </View>

          {/* TV controls get their own row so long channel/program/audio
              labels cannot push the menu or Back button off-screen. */}
          {Platform.isTV && (
            <View style={styles.infoTvControls}>
              {/* Keep the chips inside the OSD so they're D-pad reachable. */}
              <FocusablePressable
                style={styles.infoOsdChip}
                focusedStyle={styles.infoOsdChipFocused}
                onFocus={() => { if (!infoBarUserInvokedRef.current) showInfoBarRef.current?.(); }}
                onPress={() => {
                  showChannelMenuRef.current = true; // before OSD dismiss — see onMenu
                  if (showInfoRef.current) dismissInfoBar();
                  setShowChannelMenu(true);
                }}
              >
                <Text style={styles.infoOsdChipText}>≡ Channels</Text>
              </FocusablePressable>
              <FocusablePressable
                style={styles.infoOsdChip}
                focusedStyle={styles.infoOsdChipFocused}
                onFocus={() => { if (!infoBarUserInvokedRef.current) showInfoBarRef.current?.(); }}
                onPress={() => setShowAudioPicker(true)}
              >
                <Text style={styles.infoOsdChipText} numberOfLines={1} ellipsizeMode="tail">
                  🎵 {activeAudioTrack?.label || activeAudioTrack?.language || 'Audio'}
                </Text>
              </FocusablePressable>
              <FocusablePressable
                style={[styles.infoOsdChip, activeSubtitleTrack !== null && styles.infoOsdChipActive]}
                focusedStyle={styles.infoOsdChipFocused}
                onFocus={() => { if (!infoBarUserInvokedRef.current) showInfoBarRef.current?.(); }}
                onPress={() => setShowSubPicker(true)}
              >
                <Text style={[styles.infoOsdChipText, activeSubtitleTrack !== null && styles.infoOsdChipTextActive]}>
                  CC {activeSubtitleTrack ? `· ${(activeSubtitleTrack.language || '').toUpperCase()}` : ''}
                </Text>
              </FocusablePressable>
              <FocusablePressable onPress={handleBackLive} style={styles.backBtnSmall}>
                <Text style={styles.backIcon}>←</Text>
              </FocusablePressable>
            </View>
          )}

          {/* Programme progress bar — thin bar showing how far through the current show */}
          {currentProg && (
            <View style={styles.infoProgBarRow}>
              <View style={styles.infoProgBarBg}>
                <View style={[styles.infoProgBarFill, {
                  width: `${Math.min(100, Math.max(0,
                    (nowTs - currentProg.start.getTime()) /
                    (currentProg.end.getTime() - currentProg.start.getTime()) * 100,
                  ))}%` as any,
                }]} />
              </View>
            </View>
          )}

          {/* NEXT row — dimmed, compact */}
          {nextProg && (
            <View style={[styles.infoRow, styles.infoRowNext]}>
              <Text style={[styles.infoLabel, styles.infoLabelNext]}>NEXT</Text>
              <Text style={[styles.infoProgTitle, styles.infoProgTitleNext]} numberOfLines={1}>
                {nextProg.title}
              </Text>
              <Text style={[styles.infoProgTime, { color: 'rgba(255,255,255,0.4)' }]}>
                {fmtTime(nextProg.start)}–{fmtTime(nextProg.end)}
              </Text>
            </View>
          )}

        </Animated.View>
      )}

      {/* Ambient Now & Next strip REMOVED — the full OSD info bar is now the
          single bottom overlay for the live player. The ambient strip's
          "mutually exclusive" render condition (!showInfo) overlapped with the
          OSD's 300 ms fade-out, so users saw two stacked bottom overlays. */}

      {/* ── TV / Fire TV D-pad zones ─────────────────────────────────────────
          The center zone is the only player focus target. LEFT/RIGHT are
          intentionally non-focusable so they cannot change channels; the
          shared remote handler below reserves channel zapping for UP/DOWN.
          ────────────────────────────────────────────────────────────────── */}
      {Platform.isTV && isLive && !hasError && !isWeb && (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {/* Left third — transparent layout layer only.
              Deliberately excluded from
              the TV focus graph so LEFT cannot zap a channel. */}
          <Pressable
            focusable={false}
            style={styles.tvZoneLeft}
            onPress={showInfo ? dismissInfoBar : () => showInfoBar()}
            onBlur={() => setTvZoneFocused(null)}
            onFocus={() => {
              // Channel browser is open — bounce focus straight back into the
              // overlay so D-pad can't reach the player zones behind it.
              if (showChannelMenuRef.current) {
                setTimeout(() => channelMenuFocusRef.current?.(), 50);
                return;
              }
              setTvZoneFocused('left');
              // Fire OS can still send focus to a `focusable={false}` Pressable.
              // LEFT must remain inert during fullscreen live playback, so
              // always return to the centre target instead of zapping.
              setTimeout(() => requestTvFocus(tvCenterRef.current), 50);
            }}
          />
          {/* Centre — explicit focus target; OK shows/hides info bar + controls.
              hasTVPreferredFocus has been intentionally removed: on Fire OS it calls
              the native requestFocus() on EVERY re-render, which races with ExoPlayer's
              audio-focus acquisition during player.replace() and can leave the remote
              with no stable UI focus target.  Initial focus and post-switch focus are
              now handled by the useEffect[channelIdx] above. */}
          <Pressable
            ref={tvCenterRef as any}
            focusable
            style={styles.tvZoneCenter}
            onBlur={() => setTvZoneFocused(null)}
            onFocus={() => {
              // Channel browser is open — bounce focus straight back into the
              // overlay so D-pad can't reach the player zones behind it.
              if (showChannelMenuRef.current) {
                setTimeout(() => channelMenuFocusRef.current?.(), 50);
                return;
              }
              setTvZoneFocused('center');
            }}
            onPress={() => {
              if (Platform.isTV) {
                // Fire TV: OK toggles the OSD info bar.
                // When opening via OK the bar is "user-invoked" and stays
                // visible until the user explicitly closes it again.
                // Audio/CC are now chips inside the info bar — the old separate
                // controls bar is not shown on TV any more.
                if (showInfoRef.current) {
                  dismissInfoBar();
                } else {
                  showInfoBar(true); // user-invoked — no auto-dismiss
                }
              } else {
                // Phone/tablet: toggle info bar (touch path).
                if (showInfo) { dismissInfoBar(); } else { showInfoBar(); }
              }
            }}
          />
          {/* Right third — transparent layout layer only.
              Deliberately excluded from
              the TV focus graph so RIGHT cannot zap a channel. */}
          <Pressable
            focusable={false}
            style={styles.tvZoneRight}
            onPress={showInfo ? dismissInfoBar : () => showInfoBar()}
            onBlur={() => setTvZoneFocused(null)}
            onFocus={() => {
              // Channel browser is open — bounce focus straight back into the
              // overlay so D-pad can't reach the player zones behind it.
              if (showChannelMenuRef.current) {
                setTimeout(() => channelMenuFocusRef.current?.(), 50);
                return;
              }
              setTvZoneFocused('right');
              // Same protection for RIGHT. Fullscreen live zapping is reserved
              // for UP/DOWN and dedicated channel-up/channel-down media keys.
              setTimeout(() => requestTvFocus(tvCenterRef.current), 50);
            }}
          />
          {/* ── TV zone focus indicators ─────────────────────────────────────
              Visible only when D-pad focus is on a navigation zone so the user
              always knows where the remote cursor is while no overlay is shown.
              pointerEvents="none" so they never intercept touch/D-pad events. */}
          {/* Zone focus indicators intentionally NOT rendered: the translucent
              highlight bands (and centre dot) were permanently visible on real
              TV panels — the centre zone always holds focus during playback,
              so the "subtle" rgba band read as a stuck overlay on screen.
              tvZoneFocused state is still tracked for OK-button behaviour. */}
        </View>
      )}

      {/* ── TV channel-switch preview overlay ───────────────────────────────
          Fades in for ~1 s when D-pad left/right is pressed so the viewer
          knows which channel is coming before the stream switches.
          Positioned at the bottom-centre, similar to the live info bar.
          Only rendered on TV (Platform.isTV check is in the condition above). */}
      {Platform.isTV && isLive && !hasError && !isWeb && tvPreviewChannel && (
        <Animated.View
          style={[styles.tvChannelPreview, { bottom: insets.bottom + 20, opacity: tvPreviewOpacity }]}
          pointerEvents="none"
        >
          <Text style={styles.tvPreviewArrow}>{tvPreviewDir === 'prev' ? '‹' : '›'}</Text>
          {!!tvPreviewChannel.logo && (
            <Image
              source={{ uri: tvPreviewChannel.logo }}
              style={styles.tvPreviewLogo}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          )}
          {/* Channel name + programme info column */}
          <View style={styles.tvPreviewInfo}>
            <View style={styles.tvPreviewChRow}>
              {tvPreviewChannel.num != null && (
                <Text style={styles.tvPreviewNum}>{tvPreviewChannel.num}</Text>
              )}
              <Text style={styles.tvPreviewTitle} numberOfLines={1}>{tvPreviewChannel.title}</Text>
            </View>
            {tvPreviewNowProg && (
              <>
                <Text style={styles.tvPreviewProgTitle} numberOfLines={1}>{tvPreviewNowProg.title}</Text>
                <View style={styles.tvPreviewProgBg}>
                  <View style={[styles.tvPreviewProgFill, {
                    width: `${Math.min(100, Math.max(0,
                      (nowTs - tvPreviewNowProg.start.getTime()) /
                      (tvPreviewNowProg.end.getTime() - tvPreviewNowProg.start.getTime()) * 100,
                    ))}%` as any,
                  }]} />
                </View>
              </>
            )}
          </View>
        </Animated.View>
      )}

      {/* Always-visible back button for live TV on phones.
          All swipe gestures (left/right/up/down) are bound to channel zapping,
          so users need a permanent tap target to exit the player without having
          to first tap to reveal the OSD.  Hidden when the OSD controls bar is
          already showing its own back button to avoid a visual duplicate. */}
      {isLive && !isWeb && !Platform.isTV && !showControls && (
        <TouchableOpacity
          style={[styles.liveExitBtn, { top: insets.top + 8 }]}
          onPress={handleBackLive}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
      )}

      {/* Web back button */}
      {isWeb && (
        <TouchableOpacity
          style={[styles.backBtn, { position: 'absolute', top: insets.top + 8, left: 16 }]}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
      )}

      {/* ── Audio Track picker ── */}
      <Modal
        visible={showAudioPicker}
        transparent
        animationType="slide"
        onShow={() => {
          // TV: focus the first audio chip on modal open (replaces hasTVPreferredFocus
          // which fires requestFocus on every re-render and causes races on Fire OS).
          if (Platform.isTV) setTimeout(() => requestTvFocus(firstAudioChipRef.current), 80);
        }}
        onRequestClose={() => {
          setShowAudioPicker(false);
          // On TV: return to the centre zone (the chip may be unmounted if the
          // OSD was dismissed; centre is always safe).  On mobile: chip ref.
          if (Platform.isTV) {
            setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          } else {
            setTimeout(() => requestTvFocus(audioChipRef.current), 150);
          }
        }}
      >
        <Pressable
          style={styles.settingsBackdrop}
          focusable={false}
          accessible={false}
          onPress={() => {
            setShowAudioPicker(false);
            if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          }}
        />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal={true}>
          <View style={styles.settingsHandle} />
          <Text style={styles.settingsTitle}>Audio Track</Text>
          {audioTracks.length === 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 }}>
              No audio tracks detected yet — they appear once the stream has loaded.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {audioTracks.map((track, idx) => {
                const label = track.label || track.name || track.language || `Track ${idx + 1}`;
                const isActive =
                  activeAudioTrack != null &&
                  (track.id != null
                    ? track.id === activeAudioTrack.id
                    : track.language === activeAudioTrack.language && track.label === activeAudioTrack.label);
                return (
                  <FocusablePressable
                    key={track.id ?? `audio-${idx}`}
                    ref={idx === 0 ? firstAudioChipRef : undefined}
                    focusedStyle={styles.chipFocus}
                    style={[styles.chip, isActive && styles.chipActive]}
                    onPress={() => {
                      try {
                        player.audioTrack = track;
                        setActiveAudioTrack(track);
                        if (track.language) {
                          StorageService.setPrefAudioLanguage(track.language).catch(() => {});
                          setPrefAudioLang(track.language);
                        }
                      } catch {}
                      setShowAudioPicker(false);
                      // TV: return to centre zone (the chip lives inside the
                      // OSD bar which may auto-dismiss; centre is always safe).
                      if (Platform.isTV) {
                        setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
                      } else {
                        setTimeout(() => requestTvFocus(audioChipRef.current), 150);
                      }
                    }}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
                  </FocusablePressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Subtitle / CC picker ── */}
      <Modal
        visible={showSubPicker}
        transparent
        animationType="slide"
        onShow={() => {
          if (Platform.isTV) setTimeout(() => requestTvFocus(firstSubChipRef.current), 80);
        }}
        onRequestClose={() => {
          setShowSubPicker(false);
          if (Platform.isTV) {
            setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          } else {
            setTimeout(() => requestTvFocus(ccChipRef.current), 150);
          }
        }}
      >
        <Pressable
          style={styles.settingsBackdrop}
          focusable={false}
          accessible={false}
          onPress={() => {
            setShowSubPicker(false);
            if (Platform.isTV) setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
          }}
        />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal={true}>
          <View style={styles.settingsHandle} />
          <Text style={styles.settingsTitle}>Subtitles / CC</Text>
          {subtitleTracks.length === 0 ? (
            <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 12 }}>
              No subtitle tracks detected for this stream.
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              <FocusablePressable
                ref={firstSubChipRef}
                focusedStyle={styles.chipFocus}
                style={[styles.chip, activeSubtitleTrack === null && styles.chipActive]}
                onPress={() => {
                  try {
                    player.subtitleTrack = null;
                    setActiveSubtitleTrack(null);
                    StorageService.clearPrefSubtitleLang().catch(() => {});
                  } catch {}
                  setShowSubPicker(false);
                  if (Platform.isTV) {
                    setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
                  } else {
                    setTimeout(() => requestTvFocus(ccChipRef.current), 150);
                  }
                }}
              >
                <Text style={[styles.chipText, activeSubtitleTrack === null && styles.chipTextActive]}>Off</Text>
              </FocusablePressable>
              {subtitleTracks.map((track, idx) => {
                const label = track.label || track.name || track.language || `Track ${idx + 1}`;
                const isActive =
                  activeSubtitleTrack != null &&
                  (track.id != null
                    ? track.id === activeSubtitleTrack.id
                    : track.language === activeSubtitleTrack.language && track.label === activeSubtitleTrack.label);
                return (
                  <FocusablePressable
                    key={track.id ?? `sub-${idx}`}
                    focusedStyle={styles.chipFocus}
                    style={[styles.chip, isActive && styles.chipActive]}
                    onPress={() => {
                      try {
                        player.subtitleTrack = track;
                        setActiveSubtitleTrack(track);
                        if (track.language) StorageService.setPrefSubtitleLang(track.language).catch(() => {});
                      } catch {}
                      setShowSubPicker(false);
                      if (Platform.isTV) {
                        setTimeout(() => requestTvFocus(tvCenterRef.current), 150);
                      } else {
                        setTimeout(() => requestTvFocus(ccChipRef.current), 150);
                      }
                    }}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{label}</Text>
                  </FocusablePressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* ── Settings tray ── */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onShow={() => {
          if (Platform.isTV) setTimeout(() => requestTvFocus(firstSpeedChipRef.current), 80);
        }}
        onRequestClose={() => {
          setShowSettings(false);
          setTimeout(() => requestTvFocus(settingsChipRef.current), 150);
        }}
      >
        <Pressable
          style={styles.settingsBackdrop}
          focusable={false}
          accessible={false}
          onPress={() => setShowSettings(false)}
        />
        <View style={[styles.settingsSheet, { paddingBottom: insets.bottom + 16 }]} accessibilityViewIsModal={true}>
          <View style={styles.settingsHandle} />

          {/* Vertical scroll so audio/subtitle sections are reachable on small screens */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          >
          <Text style={styles.settingsTitle}>Playback Speed</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {SPEEDS.map((s, idx) => (
              <FocusablePressable
                key={s}
                ref={idx === 0 ? firstSpeedChipRef : undefined}
                focusedStyle={styles.chipFocus}
                style={[styles.chip, speed === s && styles.chipActive]}
                onPress={() => {
                  setSpeed(s);
                  player.playbackRate = s;
                  StorageService.setPrefPlaybackSpeed(s).catch(() => {});
                }}
              >
                <Text style={[styles.chipText, speed === s && styles.chipTextActive]}>
                  {s === 1 ? '1× Normal' : `${s}×`}
                </Text>
              </FocusablePressable>
            ))}
          </ScrollView>

          <Text style={[styles.settingsTitle, { marginTop: 8 }]}>Aspect Ratio</Text>
          <View style={styles.chipRow}>
            {FITS.map((f) => (
              <FocusablePressable
                key={f.value}
                focusedStyle={styles.chipFocus}
                style={[styles.chip, contentFit === f.value && styles.chipActive]}
                onPress={() => setContentFit(f.value)}
              >
                <Text style={[styles.chipText, contentFit === f.value && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </FocusablePressable>
            ))}
          </View>

          </ScrollView>
        </View>
      </Modal>
      {/* ── Live TV Channel Menu (TV + phone) ───────────────────────────────
          On TV: opened by the Menu/hamburger button on the Firestick remote.
          On phone: opened by the ≡ button in the Live TV OSD toolbar.
          Renders on top of all other overlays; BACK closes it. */}
      {showChannelMenu && isLive && !isWeb && (
        <LiveChannelMenu
          currentChannelId={activeChannelId}
          epgMap={epgMap}
          onSelectChannel={handleMenuSelectChannel}
          onClose={handleMenuClose}
          focusCallbackRef={channelMenuFocusRef}
        />
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  nativeSurfaceControls: { backgroundColor: 'transparent' },

  // ── TV / Fire TV VOD scrubber ────────────────────────────────────────────
  // Invisible bounce targets sit to the left/right of the anchor.
  // Their onFocus seeks ±10 s then returns focus to the anchor.
  tvSeekBounce: {
    position: 'absolute',
    width: 8,
    height: 64,
    opacity: 0,
  },
  // Focusable progress-bar shown on TV in place of the RNGH drag scrubber.
  // 48px side margins keep the bar inside the TV-safe area — TVs crop up to
  // ~5% of the picture edge (overscan), which was hiding the bar entirely.
  tvScrubAnchor: {
    position: 'absolute',
    left: 48, right: 48,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  tvScrubAnchorFocused: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.08)',
  },
  tvScrubRailWrap: {
    justifyContent: 'center',
    height: 20,
  },
  tvScrubThumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.4)',
  },
  tvScrubThumbFocused: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginLeft: -9,
    backgroundColor: '#00E5FF',
    borderColor: '#FFFFFF',
  },
  tvScrubRail: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  tvScrubFill: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    backgroundColor: '#7C3AED',
    borderRadius: 2,
  },
  tvScrubTimes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tvScrubTimeText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },

  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  topBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
  /** Always-visible exit button on the live player (phone/tablet).
   *  Slightly translucent so it doesn't dominate the picture, but
   *  always present so users never have to tap just to find the back button. */
  liveExitBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 20,
    opacity: 0.75,
    zIndex: 10,
  },
  backBtnSmall: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    flexShrink: 0,
  },
  backIcon: { fontSize: 20, color: '#fff' },

  center: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  playIcon: { fontSize: 28, color: '#fff' },
  seekBtn: {
    alignItems: 'center', gap: 4,
    paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 12, borderWidth: 2, borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  seekIcon: { fontSize: 22, color: '#fff' },
  seekLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium' },
  focusRing: { borderColor: '#00E5FF' },

  centerAbs: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 32,
  },
  vodBar: { gap: 6 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Inter_500Medium' },
  track: { height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#3B82F6', borderRadius: 2 },

  // ── Live info bar ──
  infoBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  infoTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  infoTvControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239,68,68,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    flexShrink: 0,
  },
  liveDot: { width: 5, height: 5, borderRadius: 99, backgroundColor: '#EF4444' },
  liveText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#EF4444', letterSpacing: 1 },
  vodTitleBar: { position: 'absolute', top: 0, left: 80, right: 80, alignItems: 'center', paddingTop: 12 },
  vodParentTitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.6)', letterSpacing: 0.3 },
  vodTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff', textAlign: 'center' },
  infoChannelLogo: { width: 28, height: 20, marginRight: 6, flexShrink: 0 },
  infoChannel: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff', flexShrink: 1 },
  infoSep: { width: StyleSheet.hairlineWidth, height: 16, backgroundColor: 'rgba(255,255,255,0.25)', flexShrink: 0 },
  infoNowLabel: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#3B82F6', letterSpacing: 0.5, flexShrink: 0 },
  infoNowTitle: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoRowNext: { opacity: 0.65 },
  infoLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#3B82F6',
    letterSpacing: 0.5,
    width: 34,
    flexShrink: 0,
  },
  infoLabelNext: { color: 'rgba(255,255,255,0.5)' },
  infoProgTitle: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  infoProgTitleNext: { fontFamily: 'Inter_400Regular' },
  infoProgTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.6)',
    flexShrink: 0,
  },

  // ── Settings tray ──
  settingsBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  settingsSheet: {
    backgroundColor: '#111',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 8,
  },
  settingsHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  settingsTitle: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  chipActive: {
    backgroundColor: 'rgba(59,130,246,0.25)',
    borderColor: '#3B82F6',
  },
  chipFocus: {
    borderColor: '#00E5FF',
    backgroundColor: 'rgba(0,229,255,0.1)',
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.6)',
  },
  chipTextActive: {
    color: '#60A5FA',
    fontFamily: 'Inter_600SemiBold',
  },

  // ── Audio / CC track pills ──
  trackPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackPillActive: {
    backgroundColor: 'rgba(59,130,246,0.3)',
    borderColor: '#3B82F6',
  },
  trackPillText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 0.3,
  },
  trackPillTextActive: {
    color: '#60A5FA',
  },

  // ── Casting pill ──
  castingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59,130,246,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 99,
    flexShrink: 0,
  },
  castingText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#60A5FA',
    letterSpacing: 0.5,
  },

  // CC subtitle-active pill
  ccPill: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.65)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 99,
    flexShrink: 0,
  },
  ccText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#C4B5FD',
    letterSpacing: 0.8,
  },

  // CC active badge on the Subtitles settings row header
  ccActiveBadge: {
    backgroundColor: 'rgba(124,58,237,0.30)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.65)',
    borderRadius: 99,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ccActiveBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#C4B5FD',
    letterSpacing: 0.8,
  },

  // Buffering
  bufferWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 16 },
  bufferCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  bufferIcon: { fontSize: 24, color: '#fff' },
  bufferText: { fontSize: 14, color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular' },
  pausedLabel: { fontSize: 10, color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_600SemiBold', letterSpacing: 1.5, marginTop: 4 },

  // Double-tap seek feedback flash
  doubleTapFeedback: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 12,
  },
  doubleTapIcon: { fontSize: 22, color: '#fff', fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },

  // Reconnecting overlay
  reconnectOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 14, backgroundColor: 'rgba(0,0,0,0.55)' },
  reconnectText: { fontSize: 15, color: '#fff', fontFamily: 'Inter_600SemiBold', letterSpacing: 0.2 },

  // Error / web message
  msgView: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 40 },
  msgIcon: { fontSize: 40, color: '#fff' },
  msgTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  msgSub: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textAlign: 'center', lineHeight: 20 },
  actionBtn: { marginTop: 8, backgroundColor: '#3B82F6', borderRadius: 10, paddingHorizontal: 28, paddingVertical: 12 },
  actionBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  actionBtnSecondary: { marginTop: 8, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  actionBtnSecondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  errorChannelRow: { flexDirection: 'row', gap: 12, marginTop: 4 },

  // ── TV / Fire TV D-pad navigation zones (transparent, pointerEvents=none on parent) ──
  tvZoneLeft: {
    position: 'absolute', top: 0, bottom: 0,
    left: 0, width: '30%',
  },
  tvZoneCenter: {
    position: 'absolute', top: 0, bottom: 0,
    left: '30%', right: '30%',
  },
  tvZoneRight: {
    position: 'absolute', top: 0, bottom: 0,
    right: 0, width: '30%',
  },
  // (TV zone focus indicator styles removed — the translucent bands/dot were
  // permanently visible on real TV panels and read as a stuck overlay.)

  // ── TV channel-switch preview overlay ──
  tvChannelPreview: {
    position: 'absolute',
    left: 60,
    right: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  tvPreviewArrow: {
    fontSize: 32,
    color: 'rgba(255,255,255,0.55)',
    lineHeight: 36,
    flexShrink: 0,
  },
  tvPreviewLogo: {
    width: 56,
    height: 38,
    flexShrink: 0,
  },
  tvPreviewInfo: {
    flex: 1,
    gap: 4,
  },
  tvPreviewChRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  tvPreviewNum: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.50)',
    flexShrink: 0,
  },
  tvPreviewTitle: {
    flex: 1,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: 0.2,
  },
  tvPreviewProgTitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
  },
  tvPreviewProgBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 2,
  },
  tvPreviewProgFill: {
    height: 3,
    backgroundColor: '#00D4FF',
    borderRadius: 2,
  },

  // ── OSD info bar — channel number ──
  infoChannelNum: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: 'rgba(255,255,255,0.55)',
    marginRight: 4,
    flexShrink: 0,
  },

  // ── OSD info bar — Audio/CC chips (TV only, inside the info bar) ──
  infoOsdChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 180,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    flexShrink: 0,
  },
  infoOsdChipFocused: {
    backgroundColor: 'rgba(0,212,255,0.20)',
    borderColor: '#00D4FF',
  },
  infoOsdChipActive: {
    backgroundColor: 'rgba(0,212,255,0.18)',
    borderColor: '#00D4FF',
  },
  infoOsdChipText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  infoOsdChipTextActive: {
    color: '#00D4FF',
  },

  // ── OSD info bar — programme progress bar ──
  infoProgBarRow: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  infoProgBarBg: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  infoProgBarFill: {
    height: 3,
    backgroundColor: '#00D4FF',
    borderRadius: 2,
  },

  // ── Channel-loading overlay (buffering while switching channels) ──────────
  loadingOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContent: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  loadingLogo: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginBottom: 4,
  },
  loadingTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
    textAlign: 'center',
  },
  loadingSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
  },

});
