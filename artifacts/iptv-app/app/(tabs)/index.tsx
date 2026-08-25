(playingChannel.epgId ?? playingChannel.id) ?? [];
    return progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null;
  }, [playingChannel, epgMap, nowTs]);

  // ── Mini-guide reminder state ─────────────────────────────────────────────
  const [miniReminderIds, setMiniReminderIds] = useState<Set<string>>(new Set());
  // #249: track which EPG future row currently has D-pad focus so the bell icon
  // brightens alongside the cyan focus ring (TV only; no-op on touch).
  const [focusedProgIdx, setFocusedProgIdx] = useState<number | null>(null);

  // Reload which programs have reminders whenever the EPG list changes or the
  // screen comes back into focus (e.g. after visiting the Reminders tab).
  useEffect(() => {
    if (!selectedChannel || channelEpg.length === 0) return;
    StorageService.getReminders().then((all) => {
      const ids = new Set(all.map((r) => r.id));
      setMiniReminderIds(ids);
    });
  }, [channelEpg, selectedChannel]);

  useFocusEffect(useCallback(() => {
    StorageService.getReminders().then((all) => {
      setMiniReminderIds(new Set(all.map((r) => r.id)));
    });
  }, []));

  // #125: keep miniReminderIds in sync when a reminder is set/removed from another
  // screen (e.g. TV Guide) while the Live TV tab is already focused.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('reminders:changed', () => {
      StorageService.getReminders().then((all) => {
        setMiniReminderIds(new Set(all.map((r) => r.id)));
      });
    });
    return () => sub.remove();
  }, []);

  const handleToggleMiniReminder = useCallback(async (prog: EpgProgram) => {
    if (!selectedChannel) return;
    const reminderId = `${selectedChannel.id}_${prog.start.toISOString()}`;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (miniReminderIds.has(reminderId)) {
      const nid = await StorageService.getReminderNotificationId(reminderId);
      await cancelReminderNotification(nid);
      await StorageService.removeReminder(reminderId);
      setMiniReminderIds((prev) => { const s = new Set(prev); s.delete(reminderId); return s; });
    } else {
      const leadMins = await StorageService.getReminderLeadMins();
      const reminder = {
        id: reminderId,
        channelId: selectedChannel.id,
        channelName: selectedChannel.name,
        channelLogo: selectedChannel.logo,
        streamUrl: selectedChannel.streamUrl,
        programTitle: prog.title,
        programDescription: prog.description,
        start: prog.start.toISOString(),
        end: prog.end.toISOString(),
        createdAt: new Date().toISOString(),
        leadMins,
      };
      const notificationId = await scheduleReminderNotification(reminder, leadMins) ?? undefined;
      await StorageService.addReminder({ ...reminder, notificationId });
      setMiniReminderIds((prev) => new Set([...prev, reminderId]));
    }
    DeviceEventEmitter.emit('reminders:changed');
  }, [selectedChannel, miniReminderIds]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectCat = useCallback((catId: string) => {
    StorageService.setPrefLiveCat(catId).catch(() => {});
    Haptics.selectionAsync();
    setSelectedCatId(catId);
    // Phone/tablet keeps its existing category-selection behavior. TV browsing
    // preserves the active mini-preview until the viewer explicitly picks a
    // different channel or navigates to another sidebar destination.
    if (!Platform.isTV) setSelectedChannel(null);
    // Exit reorder mode whenever the user switches category
    setIsReordering(false);
    // Scroll the channel list back to the top so the first channel is visible
    channelListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // ── Reorder mode handlers ─────────────────────────────────────────────────

  const handleEditStart = useCallback(() => {
    Haptics.selectionAsync();
    // Only show non-blocked channels in reorder mode — same filter applied elsewhere
    const visible = blockedSet.size > 0
      ? favorites.filter((f) => !blockedSet.has(f.id))
      : favorites;
    setReorderedFavs(visible);
    setIsReordering(true);
    setSelectedChannel(null);
  }, [favorites, blockedSet]);

  const handleDone = useCallback(async () => {
    Haptics.selectionAsync();
    setIsReordering(false);
    // Reordered list only contains visible channels; re-append blocked ones at the
    // end so they stay in storage and reappear if the block is ever lifted.
    const blockedFavs = blockedSet.size > 0
      ? favorites.filter((f) => blockedSet.has(f.id))
      : [];
    const merged = [...reorderedFavs, ...blockedFavs];
    setFavorites(merged);
    await StorageService.saveFavorites(merged);
    pushRemoteChannels(deviceMac, merged);
  }, [reorderedFavs, favorites, blockedSet, deviceMac]);

  const handleSelectChannel = useCallback((ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // First native VLC selection: force the persistent mini-player surface to
    // bind immediately. On a cold Live TV launch the native view can already be
    // mounted with an empty source, so relying only on the selected-channel
    // effect can leave the first stream invisible until fullscreen causes a
    // later native layout/rebind. Only do this when there is no active VLC URL,
    // so normal channel changes never restart the working continuous stream.
    if (USES_NATIVE_VLC && !liveUrlRef.current) {
      liveUrlRef.current = ch.streamUrl;
      setNativeSurfaceUrl(ch.streamUrl);
      setVlcReloadKey((key) => key + 1);
      setIsBuffering(true);
      setHasError(false);
    }

    setSelectedChannel(ch);
    setPlayingChannel(ch);
    // Record in recently-watched (fire-and-forget — never blocks the UI)
    StorageService.addRecentChannel({
      id: ch.id,
      name: ch.name,
      logo: ch.logo,
      groupTitle: ch.groupTitle,
      streamUrl: ch.streamUrl,
      epgId: ch.epgId,
      watchedAt: Date.now(),
    }).catch(() => {});
  }, []);

  const handleToggleFav = useCallback(async (ch: Channel) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const updated = await StorageService.toggleFavorite({
      id: ch.id,
      name: ch.name,
      logo: ch.logo,
      groupTitle: ch.groupTitle,
      streamUrl: ch.streamUrl,
      epgId: ch.epgId,
    });
    setFavorites(updated);
    // #22: show syncing indicator while the push is in flight
    setFavSyncState('syncing');
    const ok = await pushRemoteChannels(deviceMac, updated);
    // #21: if the push failed (offline / server rejection), queue it for retry on foreground
    if (!ok) pendingFavPushRef.current = updated;
    setFavSyncState('synced');
    setTimeout(() => setFavSyncState('idle'), 2000);
  }, [deviceMac]);

  const handleWatch = useCallback(() => {
    // The highlighted row can change while the mini-player continues showing a
    // different channel. Fullscreen is a presentation change for the active
    // decoder, so it must always follow the channel already playing.
    const activeChannel = playingChannel ?? selectedChannel;
    if (!activeChannel) return;
    goingToPlayerRef.current = true;
    // Shared player keeps streaming — no pause needed before going fullscreen.

    // Sort by channel number when the provider assigns them so that D-pad
    // LEFT/RIGHT and Ch Up/Down follow the numeric order the viewer expects.
    // When no channels have numbers the existing provider order is preserved.
    const hasNums = channels.some((ch) => ch.num != null);
    const orderedChannels = hasNums
      ? [...channels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : channels;
    const chList = orderedChannels.map((ch) => ({
      url: ch.streamUrl,
      title: ch.name,
      epgId: ch.epgId ?? ch.id,
      logo: ch.logo ?? '',
      channelId: ch.id,
      num: ch.num,
      groupTitle: ch.groupTitle,
      tvArchive: ch.tvArchive,
      tvArchiveDuration: ch.tvArchiveDuration,
    }));
    // Index must be from the sorted list, not the original array.
    const idx = chList.findIndex((c) => c.channelId === activeChannel.id);
    let nativeSurfaceHandoffId: string | undefined;

    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: activeChannel.streamUrl,
        title: activeChannel.name,
        type: 'live',
        logo: activeChannel.logo ?? '',
        epgId: activeChannel.epgId ?? activeChannel.id,
        channelId: activeChannel.id,
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
        nativeSurfaceHandoffId,
      },
    });

    // Android/Fire TV keeps the mini-player's VLC view mounted and grows that
    // exact native surface before showing the fullscreen controls route.
    if (USES_NATIVE_VLC) {
      // Do not rely on the selected-channel effect to publish this value: a
      // remote press can enter fullscreen before that effect has committed.
      // The controls route uses this as its proof that the mini-player already
      // owns the live decoder, so it must be set in the same update as the
      // surface-mode transition.
      setNativeSurfaceUrl(activeChannel.streamUrl);
      nativeSurfaceHandoffId = beginNativeSurfaceHandoff(activeChannel.streamUrl);
      transitionNativeSurface('fullscreen', navigate);
    } else {
      triggerExpand(navigate);
    }
  }, [selectedChannel, playingChannel, channels, player, router, beginNativeSurfaceHandoff, setNativeSurfaceUrl, transitionNativeSurface, triggerExpand]);

  // The persistent Android VLC TextureView is elevated above the original
  // preview card so it can animate outside clipped panels. Keep one shared
  // press handler for the card and the transparent mobile relay above that
  // native texture; otherwise the TextureView can swallow a touch before the
  // card's onPress receives it.
  const handleMiniPlayerPress = useCallback(() => {
    if (hasError && selectedChannel) {
      setHasError(false);
      setIsBuffering(true);
      if (USES_NATIVE_VLC) {
        setVlcReloadKey((key) => key + 1);
      } else {
        try {
          player.replace(selectedChannel.streamUrl);
          player.play();
        } catch {}
      }
      return;
    }
    handleWatch();
  }, [hasError, selectedChannel, player, handleWatch]);

  /** Navigate directly to the fullscreen player from a recently-watched card.
   *  Behaves identically to handleWatch (TV menu): back collapses to mini-player,
   *  full channel list is passed for prev/next navigation. */
  const handleWatchChannel = useCallback((ch: Channel, cardRef?: React.RefObject<View | null>) => {
    goingToPlayerRef.current = true;
    // Update the right-panel EPG and make the persistent playback container
    // visible before the fullscreen controls route borrows it.
    setSelectedChannel(ch);
    setPlayingChannel(ch);

    const hasNums = channels.some((c) => c.num != null);
    const orderedChannels = hasNums
      ? [...channels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : channels;
    const chList = orderedChannels.map((c) => ({
      url: c.streamUrl,
      title: c.name,
      epgId: c.epgId ?? c.id,
      logo: c.logo ?? '',
      channelId: c.id,
      num: c.num,
      groupTitle: c.groupTitle,
      tvArchive: c.tvArchive,
      tvArchiveDuration: c.tvArchiveDuration,
    }));
    const idx = chList.findIndex((c) => c.channelId === ch.id);
    let nativeSurfaceHandoffId: string | undefined;

    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: ch.streamUrl,
        title: ch.name,
        type: 'live',
        logo: ch.logo ?? '',
        epgId: ch.epgId ?? ch.id,
        channelId: ch.id,
        // Pass full channel list for prev/next navigation, same as the TV menu.
        // No stopOnBack — BACK collapses to mini-player just like a normal watch.
        channelsJson: idx >= 0 ? JSON.stringify(chList) : '[]',
        channelIndex: String(idx),
        nativeSurfaceHandoffId,
      },
    });

    // The VLC path expands the real playback container, never the tapped card.
    // The generic Expo-video route keeps its existing navigation hooks.
    if (USES_NATIVE_VLC) {
      // The Live TV mini-player becomes visible on this render. Give it one
      // layout pass before measuring and expanding its persistent VLC surface.
      setNativeSurfaceUrl(ch.streamUrl);
      nativeSurfaceHandoffId = beginNativeSurfaceHandoff(ch.streamUrl);
      requestAnimationFrame(() => transitionNativeSurface('fullscreen', navigate));
    } else if (cardRef) {
      triggerExpandFromRef(cardRef, navigate);
    } else {
      triggerExpand(navigate);
    }
  }, [channels, router, beginNativeSurfaceHandoff, setNativeSurfaceUrl, transitionNativeSurface, triggerExpandFromRef, triggerExpand]);

  const renderCat = useCallback(({ item }: { item: Category }) => {
    const isBlockable = item.id !== FAVS_CAT_ID && item.id !== ALL_CAT_ID;
    const isBlocked = isBlockable && blockedCategoryIds.includes(item.id);
    // Compute channel count: All = total non-blocked, Favs = favourites, others = by groupTitle name
    let channelCount: number | undefined;
    if (item.id === ALL_CAT_ID) {
      channelCount = fetchedChannels.filter((ch) => !blockedSet.has(ch.id)).length;
    } else if (item.id === FAVS_CAT_ID) {
      channelCount = favorites.length;
    } else {
      channelCount = catChannelCountMap.get(item.name);
    }
    return (
      <CategoryRow
        cat={item}
        isSelected={item.id === selectedCatId}
        isBlocked={isBlocked}
        channelCount={channelCount}
        colors={colors}
        onPress={() => handleSelectCat(item.id)}
        onLongPress={isBlockable ? () => {
          if (Platform.isTV) {
            // TV: show ConfirmModal (Alert.alert buttons unreliable on Fire OS).
            // CategoryRow's onPress already calls this on second-OK of a selected
            // category, so the user has a reliable D-pad path.
            setBlockConfirm({ type: 'cat', catId: item.id, name: item.name, isBlocked });
          } else {
            const action = isBlocked ? 'Unblock' : 'Block';
            Alert.alert(
              `${action} Category`,
              `${action} all channels in "${item.name}"?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: action, style: isBlocked ? 'default' : 'destructive', onPress: () => toggleBlockedCategory(item.id) },
              ],
            );
          }
        } : undefined}
      />
    );
  }, [selectedCatId, blockedCategoryIds, catChannelCountMap, fetchedChannels, blockedSet, favorites, colors, handleSelectCat, toggleBlockedCategory]);

  const handleLongPressChannel = useCallback((ch: Channel) => {
    const isBlocked = blockedChannels.includes(ch.id);
    const action = isBlocked ? 'Unblock' : 'Block';
    if (Platform.isTV) {
      // TV: the ⊘ block button in ChannelRow already calls this (via onTvBlockPress
      // → handleLongPressChannel), so we show the ConfirmModal directly.
      setBlockConfirm({ type: 'chan', channel: ch, isBlocked });
      return;
    }
    Alert.alert(
      ch.name,
      isBlocked ? 'Unblock this channel?' : 'Block this channel? It will be hidden everywhere.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Show Info',
          onPress: () => {
            const nowProg = nowPlayingMap.get(ch.epgId ?? ch.id);
            Alert.alert(
              ch.name,
              [
                nowProg ? `▶ Now: ${nowProg}` : null,
                `Category: ${ch.groupTitle || '—'}`,
                `Stream ID: ${ch.id}`,
                ch.epgId ? `EPG ID: ${ch.epgId}` : null,
                ch.num != null ? `Channel #: ${ch.num}` : null,
              ].filter(Boolean).join('\n'),
            );
          },
        },
        {
          text: action,
          style: isBlocked ? 'default' : 'destructive',
          onPress: () => {
            const updated = isBlocked
              ? blockedChannels.filter((id) => id !== ch.id)
              : [...blockedChannels, ch.id];
            setBlockedChannelIds(updated);
          },
        },
      ],
    );
  }, [blockedChannels, setBlockedChannelIds, nowPlayingMap]);

  const renderChannel = useCallback(({ item }: { item: Channel }) => (
    <ChannelRow
      channel={item}
      isSelected={item.id === selectedChannel?.id}
      isFav={favSet.has(item.id)}
      nowPlaying={nowPlayingMap.get(item.epgId ?? item.id)}
      colors={colors}
      onPress={() => handleSelectChannel(item)}
      onHeartPress={() => handleToggleFav(item)}
      onLongPress={() => handleLongPressChannel(item)}
      // TV: dedicated ⊘ block button as a 3rd D-pad zone (RIGHT of heart).
      // Calls handleLongPressChannel which routes to ConfirmModal on TV.
      onTvBlockPress={Platform.isTV ? () => handleLongPressChannel(item) : undefined}
    />
  ), [selectedChannel?.id, favSet, nowPlayingMap, colors, handleSelectChannel, handleToggleFav, handleLongPressChannel]);

  // ── TV remote (Fire TV / Android TV) direct navigation ───────────────────
  // Navigate straight to the fullscreen player — no expand animation needed
  // on a TV where there is no mini-player position to animate from.
  const handleTVWatch = useCallback(() => {
    // D-pad OK expands the currently visible mini-player stream, not merely
    // the last list row that received focus.
    const activeChannel = playingChannel ?? selectedChannel;
    if (!activeChannel) return;
    goingToPlayerRef.current = true;
    const hasNums = channels.some((ch) => ch.num != null);
    const orderedChannels = hasNums
      ? [...channels].sort((a, b) => (a.num ?? Infinity) - (b.num ?? Infinity))
      : channels;
    const chList = orderedChannels.map((ch) => ({
      url: ch.streamUrl,
      title: ch.name,
      epgId: ch.epgId ?? ch.id,
      logo: ch.logo ?? '',
      channelId: ch.id,
      num: ch.num,
      groupTitle: ch.groupTitle,
      tvArchive: ch.tvArchive,
      tvArchiveDuration: ch.tvArchiveDuration,
    }));
    const idx = chList.findIndex((c) => c.channelId === activeChannel.id);
    let nativeSurfaceHandoffId: string | undefined;
    const navigate = () => router.push({
      pathname: '/player',
      params: {
        url: activeChannel.streamUrl,
        title: activeChannel.name,
        type: 'live',
        logo: activeChannel.logo ?? '',
        epgId: activeChannel.epgId ?? activeChannel.id,
        channelId: activeChannel.id,
        // No stopOnBack — the normal triggerCollapse path handles the return
        // so the player is never paused and the TV video panel remounts cleanly
        // via onCollapseCompleteRef → setVideoKey, matching the phone flow.
        channelsJson: JSON.stringify(chList),
        channelIndex: String(idx),
        nativeSurfaceHandoffId,
      },
    });
    if (USES_NATIVE_VLC) {
      // Publish ownership before navigation so player.tsx stays a controls-only
      // route even when Fire OS commits the route faster than effects run.
      setNativeSurfaceUrl(activeChannel.streamUrl);
      nativeSurfaceHandoffId = beginNativeSurfaceHandoff(activeChannel.streamUrl);
      transitionNativeSurface('fullscreen', navigate);
    } else {
      navigate();
    }
  }, [selectedChannel, playingChannel, channels, router, beginNativeSurfaceHandoff, setNativeSurfaceUrl, transitionNativeSurface]);

  // ── TV: play a past mini-guide programme directly (skip CatchupSheet) ─────
  // Converts an EpgProgram (which has JS Date fields) into the same catch-up
  // URL params that CatchupSheet uses, then navigates straight to the player.
  // ── TV: open CatchupSheet pre-scrolled to a specific past mini-guide row ──
  // We must NOT derive serverStart from an EpgProgram (XMLTV) Date: getXtreamCatchupUrls
  // requires the raw server-local "YYYY-MM-DD HH:MM:SS" string from get_simple_data_table,
  // which is never safe to reconstruct from a UTC Date (provider server timezone is unknown).
  // CatchupSheet fetches get_simple_data_table itself and uses the correct serverStart.
  const handleTVCatchupProg = useCallback((prog: EpgProgram) => {
    setCatchupInitialProg(prog);
    setShowCatchup(true);
  }, []);

  // Stable callbacks for TVLiveLayout — inline arrow functions would be new
  // references on every render, which can contribute to update-depth crashes
  // when the component tree is re-evaluating effects.
  const handleOpenCatchup = useCallback(() => {
    setCatchupInitialProg(null);
    setShowCatchup(true);
  }, []);

  const handleCatchupFocusChange = useCallback((focused: boolean) => {
    catchupFocusedRef.current = focused;
  }, []);

  const handlePreviewFocusChange = useCallback((focused: boolean) => {
    previewFocusedRef.current = focused;
  }, []);

  const handleGuideFocusChange = useCallback((focused: boolean) => {
    guideFocusedRef.current = focused;
  }, []);

  const handleCategoryFocusChange = useCallback((focused: boolean) => {
    categoryFocusedRef.current = focused;
  }, []);

  const handleTVCloseCatchup = useCallback(() => {
    setShowCatchup(false);
    setCatchupInitialProg(null);
  }, []);

  const handleStartCatchupPlayback = useCallback((channel: Channel) => {
    // Prevent Live TV's tab-blur cleanup from clearing its selected channel
    // while Catch-up temporarily owns the shared player.
    catchupPreviewReturnRef.current = channel;
    goingToPlayerRef.current = true;
    // Catch-up deliberately replaces the live source. Unlike a live
    // mini/fullscreen handoff, it must unmount the shared VLC view so live
    // audio cannot continue underneath the catch-up player.
    if (USES_NATIVE_VLC) {
      setIsLivePreviewActive(false);
      transitionNativeSurface('hidden');
    }
  }, [transitionNativeSurface]);

  // ── Render ────────────────────────────────────────────────────────────────

  // On Fire TV / Android TV use the 3-panel D-pad layout.
  if (Platform.isTV) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TVLiveLayout
          allCategories={allCategories}
          selectedCatId={selectedCatId}
          onCatSelect={handleSelectCat}
          channels={filteredChannels}
          channelsLoading={channelsLoading}
          epgMap={epgMap}
          nowTs={nowTs}
          selectedChannel={selectedChannel}
          onChannelSelect={handleSelectChannel}
          onWatchFullscreen={handleTVWatch}
          onOpenCatchup={handleOpenCatchup}
          onOpenCatchupProg={handleTVCatchupProg}
          nowPlayingMap={nowPlayingMap}
          colors={colors}
          insets={insets}
          player={player}
          videoKey={videoKey}
          streamUrl={selectedChannel?.streamUrl ?? ''}
          vlcReloadKey={vlcReloadKey}
          isPlaybackActive={isLivePreviewActive}
          nativeSurfaceFullscreen={nativeSurfaceFullscreen}
           onNativeSurfaceLayout={(bounds) => {
             commitNativeSurfaceLayout(nativeSurfaceMode, bounds);
           }}
          isBuffering={isBuffering}
          hasError={hasError}
          onVlcPlaying={handlePersistentVlcPlaying}
          onVlcBuffering={handlePersistentVlcBuffering}
          onVlcError={handlePersistentVlcError}
          miniPlayerRef={miniPlayerRef}
          onPreviewFocusChange={handlePreviewFocusChange}
          onCatchupFocusChange={handleCatchupFocusChange}
          onGuideFocusChange={handleGuideFocusChange}
          onCategoryFocusChange={handleCategoryFocusChange}
          onExitToSidebar={handleExitToSidebar}
          highlightedChNodeRef={highlightedChNodeRef}
          entryResetCallbackRef={tvLiveEntryResetRef}
          focusHighlightedChCategoryRef={focusHighlightedChCategoryRef}
          focusPlayingChannelRef={focusPlayingChannelRef}
        />
        {showCatchup && selectedChannel && creds && (
          <CatchupSheet
            key={selectedChannel.id}
            visible={showCatchup}
            channel={selectedChannel}
            creds={creds}
            epgMap={epgMap}
            initialProg={catchupInitialProg ?? undefined}
            onClose={handleTVCloseCatchup}
            onStartPlayback={handleStartCatchupPlayback}
          />
        )}

      </View>
    );
  }

  return (
    <View
      ref={nativeSurfaceRootRef}
      collapsable={false}
      onLayout={handleNativeRootLayout}
      style={[styles.root, { backgroundColor: colors.background }]}
    >

      {/* ══ LEFT: vertical category list ══ */}
      <View style={[styles.catPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>
          CATEGORIES
        </Text>
        {/* Category search box
            TV: TVTextInput wraps the field in a FocusablePressable so D-pad
            focus lands on it and OK opens the system keyboard.  Plain TextInput
            is invisible to D-pad navigation on Fire OS (requestFocus places the
            cursor but never opens the keyboard without the explicit wrapper). */}
        <View style={[styles.catSearchWrap, { borderBottomColor: colors.border }]}>
          <TVTextInput
            focusable
            style={[styles.catSearchInput, { color: colors.foreground, backgroundColor: colors.secondary }]}
            placeholder="Search…"
            placeholderTextColor={colors.mutedForeground}
            value={catSearch}
            onChangeText={setCatSearch}
            clearButtonMode="while-editing"
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
        </View>
        <FlatList
          data={filteredCategories}
          keyExtractor={(c) => c.id}
          renderItem={renderCat}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: 52, offset: 52 * i, index: i })}
          contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
          removeClippedSubviews={false}
          ListEmptyComponent={
            catSearch.trim() ? (
              <View style={{ padding: 10, alignItems: 'center' }}>
                <Text style={{ fontSize: 18, marginBottom: 4 }}>🔍</Text>
                <Text style={{ color: '#888', fontSize: 10, textAlign: 'center' }}>
                  No categories match
                </Text>
              </View>
            ) : null
          }
        />
      </View>

      {/* ══ MIDDLE: channel list ══ */}
      <View style={[styles.chPanel, { borderRightColor: colors.border, paddingTop: insets.top + 4 }]}>
        {/* Panel header — shows Edit/Done button when Favourites is active */}
        <View style={[styles.chPanelHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.panelHeader, { color: colors.mutedForeground, borderBottomWidth: 0, marginBottom: 0, paddingBottom: 0 }]}>
            {currentCat?.name?.toUpperCase() ?? 'CHANNELS'}
          </Text>
          {/* #22: sync indicator */}
          {isFavsSelected && favSyncState !== 'idle' && (
            <Text style={{ fontSize: 10, color: favSyncState === 'synced' ? '#22C55E' : colors.mutedForeground, fontFamily: 'Inter_500Medium' }}>
              {favSyncState === 'syncing' ? '⟳' : '✓'}
            </Text>
          )}
          {/* Refresh button — pull-to-refresh is gesture-only on TV so this
              gives Firestick/Android TV users an explicit refresh action. */}
          {!isReordering && (
            <FocusablePressable
              onPress={() => refetch()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.editBtn}
              focusedStyle={styles.editBtnFocused}
            >
              <Text style={[styles.editBtnText, { color: isRefetching ? colors.primary : colors.mutedForeground }]}>↻</Text>
            </FocusablePressable>
          )}
          {isFavsSelected && favorites.length > 1 && (
            <FocusablePressable
              onPress={isReordering ? handleDone : handleEditStart}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.editBtn}
              focusedStyle={styles.editBtnFocused}
            >
              <Text style={styles.editBtnText}>
                {isReordering ? 'Done' : 'Edit'}
              </Text>
            </FocusablePressable>
          )}
        </View>

        {/* Channel filter input — hidden during drag-reorder
            TV: same TVTextInput pattern as the category search above. */}
        {!isReordering && (
          <View style={[styles.catSearchWrap, { borderBottomColor: colors.border }]}>
            <TVTextInput
              focusable
              style={[styles.catSearchInput, { color: colors.foreground, backgroundColor: colors.secondary }]}
              placeholder="Filter channels…"
              placeholderTextColor={colors.mutedForeground}
              value={channelFilter}
              onChangeText={setChannelFilter}
              clearButtonMode="while-editing"
              returnKeyType="search"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
          </View>
        )}

        {channelsLoading && !isFavsSelected ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : channels.length === 0 && !isFavsSelected && !channelsLoading ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>📡</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>No channels</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              No channels found in this category. Try another category or check your provider settings.
            </Text>
          </View>
        ) : filteredChannels.length === 0 && channelFilter.trim().length > 0 ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🔍</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>No channels match</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              No channels found for "{channelFilter.trim()}". Try a different search term.
            </Text>
          </View>
        ) : channels.length === 0 && isFavsSelected ? (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>♡</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>No favourites yet</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              Tap ♡ next to any channel to add it here.
            </Text>
          </View>
        ) : isFavsSelected && isReordering ? (
          <DraggableFavList
            data={reorderedFavs}
            keyExtractor={(ch) => ch.id}
            renderItem={(ch) => (
              <ChannelRow
                channel={{ id: ch.id, name: ch.name, logo: ch.logo, groupTitle: ch.groupTitle, streamUrl: ch.streamUrl, epgId: ch.epgId }}
                isSelected={false}
                isFav
                nowPlaying={nowPlayingMap.get(ch.epgId ?? ch.id)}
                colors={colors}
                onPress={() => {}}
                onHeartPress={() => {}}
                hideHeart
              />
            )}
            onReorder={setReorderedFavs}
            rowHeight={60}
            colors={colors}
          />
        ) : (
          <FlatList
            ref={channelListRef}
            data={filteredChannels}
            keyExtractor={(ch) => ch.id}
            renderItem={renderChannel}
            showsVerticalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: 60, offset: 60 * i, index: i })}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
            removeClippedSubviews={false}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => refetch()}
                tintColor={colors.primary}
              />
            }
          />
        )}
      </View>

      {/* ══ RIGHT: preview + EPG ══ */}
      <View style={[
        styles.previewPanel,
        { paddingTop: insets.top + 4, paddingRight: insets.right + 8 },
      ]}
      collapsable={false}
      onLayout={handleNativePreviewPanelLayout}
      >

        {!isWeb && (
          /* collapsable={false} ensures the native view is created immediately
             so the persistent native surface is created immediately. Focusable
             lets D-pad / remote users highlight the box and press
             Select to open fullscreen — no separate button needed. */
          <FocusablePressable
            ref={miniPlayerRef as any}
            collapsable={false}
            onPress={handleMiniPlayerPress}
            onFocus={() => setMiniPlayerFocused(true)}
            onBlur={() => setMiniPlayerFocused(false)}
            onLayout={handleNativeMiniOwnerLayout}
            focusedStyle={{}}
            style={(focused) => [
              styles.videoWrap,
              !playingChannel && { display: 'none' },
              focused && styles.videoWrapFocused,
            ]}
          >
            {USES_NATIVE_VLC && (
              <>
                {isBuffering && !hasError && nativeSurfaceMode === 'mini' && (
                  <View pointerEvents="none" style={styles.videoOverlay}>
                    <ActivityIndicator color="#fff" size="large" />
                  </View>
                )}
                {hasError && nativeSurfaceMode === 'mini' && (
                  <View pointerEvents="none" style={styles.videoOverlay}>
                    <Text style={styles.errText}>Stream unavailable</Text>
                    <Text style={[styles.errText, { fontSize: 11, marginTop: 4, opacity: 0.7 }]}>Tap to retry</Text>
                  </View>
                )}
                {nativeSurfaceMode === 'mini' && !isBuffering && !hasError && (
                  <View pointerEvents="none" style={[styles.expandHint, miniPlayerFocused && styles.expandHintFocused]}>
                    <Text style={styles.expandHintIcon}>⛶</Text>
                  </View>
                )}
                {nativeSurfaceMode === 'mini' && (
                  <View pointerEvents="none" style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                )}
              </>
            )}
            {/* ── Non-Android path: stream player + all overlays live inside ── */}
            {!USES_NATIVE_VLC && isLivePreviewActive && (
              <Animated.View
                pointerEvents="none"
                style={StyleSheet.absoluteFill}
              >
                <NativeStreamPlayer
                  source={playingChannel?.streamUrl ?? selectedChannel?.streamUrl ?? ''}
                  player={player}
                  style={StyleSheet.absoluteFill}
                  resizeMode="contain"
                  // videoKey is the Expo VideoView surface-rebind workaround.
                  reloadKey={`${videoKey}:${vlcReloadKey}`}
                  onPlaying={() => {
                    setIsBuffering(false);
                    setHasError(false);
                    Animated.timing(flashOverlayOpacity, {
                      toValue: 0, duration: 200, useNativeDriver: true,
                    }).start();
                  }}
                  onBuffering={() => setIsBuffering(true)}
                  onError={() => {
                    setIsBuffering(false);
                    setHasError(true);
                    Animated.timing(flashOverlayOpacity, {
                      toValue: 0, duration: 150, useNativeDriver: true,
                    }).start();
                  }}
                />
              </Animated.View>
            )}
            {!USES_NATIVE_VLC && (
              <>
                {/* Flash-prevention overlay */}
                <Animated.View
                  style={[StyleSheet.absoluteFill, styles.flashOverlay, { opacity: flashOverlayOpacity }]}
                  pointerEvents="none"
                />
                {(isBuffering && !hasError) && (
                  <View style={styles.videoOverlay}>
                    <ActivityIndicator color="#fff" size="large" />
                  </View>
                )}
                {hasError && (
                  <View style={styles.videoOverlay} pointerEvents="box-none">
                    <Text style={styles.errText}>Stream unavailable</Text>
                    <Text style={[styles.errText, { fontSize: 11, marginTop: 4, opacity: 0.7 }]}>Tap to retry</Text>
                  </View>
                )}
                {!isBuffering && !hasError && (
                  <View style={[styles.expandHint, miniPlayerFocused && styles.expandHintFocused]}>
                    <Text style={styles.expandHintIcon}>⛶</Text>
                  </View>
                )}
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              </>
            )}
          </FocusablePressable>
        )}

        {/* Channel info bar — logo + name + now-playing EPG title + progress bar below the mini-player */}
        {!nativeSurfaceFullscreen && playingChannel && (
          <View style={[styles.chInfoBar, { borderBottomColor: colors.border }]}>
            <View style={[styles.chInfoLogo, { backgroundColor: colors.secondary }]}>
              {playingChannel.logo ? (
                <Image source={{ uri: playingChannel.logo }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              ) : (
                <Text style={[styles.chInfoInitials, { color: colors.primary }]}>
                  {playingChannel.name.slice(0, 2).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={[styles.chInfoName, { color: colors.foreground }]} numberOfLines={1}>
                {playingChannel.name}
              </Text>
              {miniPlayerProg ? (
                <>
                  <Text style={[styles.chInfoNow, { color: colors.primary }]} numberOfLines={1}>
                    ▶ {miniPlayerProg.title}
                  </Text>
                  {/* Progress bar — shows how far through the current programme the viewer is.
                      Reuses the same epgProgressWrap/epgProgressBar styles used in the EPG list. */}
                  {(() => {
                    const total = miniPlayerProg.end.getTime() - miniPlayerProg.start.getTime();
                    const elapsed = Math.max(0, nowTs - miniPlayerProg.start.getTime());
                    const pct = total > 0 ? Math.min(1, elapsed / total) : 0;
                    const minsLeft = Math.max(0, Math.round((miniPlayerProg.end.getTime() - nowTs) / 60_000));
                    return (
                      <View style={styles.miniProgWrap}>
                        <View style={[styles.epgProgressWrap, { flex: 1, marginTop: 0 }]}>
                          <View style={[styles.epgProgressBar, { width: `${Math.round(pct * 100)}%` as any }]} />
                        </View>
                        <Text style={[styles.miniProgTimeLeft, { color: colors.mutedForeground }]}>
                          {minsLeft > 0 ? `${minsLeft}m` : '< 1m'}
                        </Text>
                      </View>
                    );
                  })()}
                </>
              ) : (() => {
                // Fall back to the title-only string from nowPlayingMap when full
                // programme data is not yet available (e.g. EPG still loading).
                const nowTitle = nowPlayingMap.get(playingChannel.epgId ?? playingChannel.id);
                return nowTitle ? (
                  <Text style={[styles.chInfoNow, { color: colors.primary }]} numberOfLines={1}>
                    ▶ {nowTitle}
                  </Text>
                ) : null;
              })()}
            </View>
          </View>
        )}

        {!nativeSurfaceFullscreen && (selectedChannel ? (
          <>
            {/* ── EPG header row with optional Catch-up button ── */}
            <View style={styles.epgHeaderRow}>
              <Text style={[styles.epgHeader, { color: colors.mutedForeground }]}>TV GUIDE</Text>
              {selectedChannel.tvArchive === 1 && (
                <FocusablePressable
                  onPress={() => setShowCatchup(true)}
                  style={styles.catchupBtn}
                  focusedStyle={styles.tvFocused}
                >
                  <Text style={styles.catchupBtnText}>📅 Catch-up</Text>
                </FocusablePressable>
              )}
            </View>
            {channelEpg.length > 0 ? (
              <ScrollView
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
                ref={(ref) => {
                  // Scroll to the currently-airing programme when the EPG data loads
                  if (!ref) return;
                  const nowIdx = channelEpg.findIndex(
                    (p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()
                  );
                  if (nowIdx > 0) {
                    // Each EPG row is approximately 68px tall; scroll past earlier rows
                    setTimeout(() => ref.scrollTo({ y: Math.max(0, (nowIdx - 1) * 68), animated: false }), 80);
                  }
                }}
              >
                {channelEpg.map((prog, i) => {
                  const isCurrent = prog.start.getTime() <= nowTs && nowTs < prog.end.getTime();
                  const isFuture = prog.start.getTime() > nowTs;
                  const reminderId = `${selectedChannel!.id}_${prog.start.toISOString()}`;
                  const hasReminder = miniReminderIds.has(reminderId);
                  return (
                    <FocusablePressable
                      key={i}
                      onPress={isFuture ? () => handleToggleMiniReminder(prog) : undefined}
                      focusable={isFuture}
                      style={[
                        styles.epgRow,
                        { borderBottomColor: colors.border },
                        isCurrent && { backgroundColor: 'rgba(59,130,246,0.08)' },
                      ]}
                      focusedStyle={isFuture ? styles.tvFocused : {}}
                      onFocus={Platform.isTV && isFuture ? () => setFocusedProgIdx(i) : undefined}
                      onBlur={Platform.isTV && isFuture ? () => setFocusedProgIdx(null) : undefined}
                    >
                      <View style={styles.epgTimeCol}>
                        <Text style={[styles.epgTime, { color: isCurrent ? '#3B82F6' : colors.mutedForeground }]}>
                          {fmtTime(prog.start)}
                        </Text>
                        {isCurrent && (
                          <View style={styles.nowBadge}>
                            <Text style={styles.nowBadgeText}>NOW</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.epgTitle, { color: isCurrent ? '#F2F2F2' : colors.foreground }]}
                          numberOfLines={1}
                        >
                          {prog.title}
                        </Text>
                        {isCurrent && (() => {
                          const total = prog.end.getTime() - prog.start.getTime();
                          const elapsed = Math.max(0, nowTs - prog.start.getTime());
                          const pct = Math.min(1, elapsed / total);
                          const minsLeft = Math.max(0, Math.round((prog.end.getTime() - nowTs) / 60_000));
                          return (
                            <View style={styles.epgProgressWrap}>
                              <View style={[styles.epgProgressBar, { width: `${Math.round(pct * 100)}%` as any }]} />
                              <Text style={[styles.epgTimeLeft, { color: colors.mutedForeground }]}>
                                {minsLeft > 0 ? `${minsLeft}m left` : 'ending soon'}
                              </Text>
                            </View>
                          );
                        })()}
                        {prog.description ? (
                          <Text
                            style={[styles.epgDesc, { color: colors.mutedForeground }]}
                            numberOfLines={2}
                          >
                            {prog.description}
                          </Text>
                        ) : null}
                      </View>
                      {isFuture && (
                        <Text style={[styles.epgBell, {
                          // #249: brighten bell when this row is D-pad focused so it
                          // stays readable against the cyan focus ring on Fire OS.
                          color: (Platform.isTV && focusedProgIdx === i)
                            ? '#FFFFFF'
                            : (hasReminder ? '#3B82F6' : colors.mutedForeground),
                        }]}>
                          {hasReminder ? '🔔' : '🔕'}
                        </Text>
                      )}
                    </FocusablePressable>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.epgEmpty}>
                {epgMap
                  ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>No guide data available</Text>
                  : <><ActivityIndicator color={colors.primary} size="small" /><Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>Loading guide…</Text></>
                }
              </View>
            )}
          </>
        ) : (
          <View style={styles.noSel}>
            <Text style={{ fontSize: 36, marginBottom: 10 }}>📺</Text>
            <Text style={[styles.noSelTitle, { color: colors.foreground }]}>Select a channel</Text>
            <Text style={[styles.noSelSub, { color: colors.mutedForeground }]}>
              Choose a category, then pick a channel to preview it here. Press OK to watch fullscreen.
            </Text>
          </View>
        ))}
      </View>{/* end previewPanel */}

      {/* Android VLC presentation host. This stays a direct child of the Live
          TV root for both mini and fullscreen. The mini control above only
          reports its real bounds; fullscreen fills this root after the tab
          shell releases its sidebar margin. */}
      {USES_NATIVE_VLC
        && isLivePreviewActive
        && nativeSurfaceMode !== 'hidden'
        && activeNativeSurfaceUrl
        && (
          nativeSurfaceFullscreen
            ? nativeSurfaceViewport.width > 0 && nativeSurfaceViewport.height > 0
            : true
        ) && (
        <View
          collapsable={false}
          pointerEvents="none"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={styles.nativeSurfacePresentationLayer}
        >
          <View
            collapsable={false}
            onLayout={(event) => {
              const { width, height, x, y } = event.nativeEvent.layout;
              console.log(VLC_TRACE, 'react-owner-layout', {
                width,
                height,
                x,
                y,
                fullscreen: nativeSurfaceFullscreen,
              });
              // The fullscreen presentation frame is explicitly sized from
              // the Android window dimensions. Do not reject the layout ack just
              // because an intermediate React Navigation container reports an
              // older preview width.
              commitNativeSurfaceLayout(nativeSurfaceMode, {
                width: nativeSurfaceFullscreen ? screenWidth : width,
                height: nativeSurfaceFullscreen ? screenHeight : height,
                x: nativeSurfaceFullscreen ? 0 : x,
                y: nativeSurfaceFullscreen ? 0 : y,
              });
            }}
            style={[
              styles.nativeSurfacePresentationFrame,
              nativeSurfaceFullscreen
                ? {
                    left: 0,
                    top: 0,
                    width: screenWidth,
                    height: screenHeight,
                  }
                : {
                    left: nativeOwnerBounds.x,
                    top: nativeOwnerBounds.y,
                    width: nativeOwnerBounds.width,
                    height: nativeOwnerBounds.height,
                  },
            ]}
          >
            <NativeStreamPlayer
              source={activeNativeSurfaceUrl}
              player={player}
              style={StyleSheet.absoluteFill}
              // Keep this native playback prop invariant across the mini/fullscreen
              // handoff. The owner frame alone changes size; libVLC starts in fill
              // mode so the same decoder can occupy the full Android viewport
              // without receiving a playback-prop update during the transition.
              resizeMode="fill"
              reloadKey={vlcReloadKey}
              onPlaying={handlePersistentVlcPlaying}
              onBuffering={handlePersistentVlcBuffering}
              onError={handlePersistentVlcError}
            />
          </View>
        </View>
      )}

      {/* ── Catch-up sheet ── */}
      {showCatchup && selectedChannel && creds && (
        <CatchupSheet
          key={selectedChannel.id}
          visible={showCatchup}
          channel={selectedChannel}
          creds={creds}
          epgMap={epgMap}
          onClose={() => setShowCatchup(false)}
          onStartPlayback={handleStartCatchupPlayback}
        />
      )}

      {/* ── TV-safe block/unblock confirmation ── */}
      {/* Replaces Alert.alert (unreliable on Fire OS) for category and channel
          block actions.  Triggered by: second OK on a selected category, the
          dedicated ⊘ button in ChannelRow (D-pad RIGHT of heart), or long-press
          (still works as a secondary path on touch). */}
      <ConfirmModal
        visible={!!blockConfirm}
        title={
          blockConfirm?.type === 'cat'
            ? `${blockConfirm.isBlocked ? 'Unblock' : 'Block'} Category`
            : `${blockConfirm?.isBlocked ? 'Unblock' : 'Block'} Channel`
        }
        message={
          blockConfirm?.type === 'cat'
            ? `${blockConfirm.isBlocked ? 'Unblock' : 'Block'} all channels in "${blockConfirm.name}"?`
            : blockConfirm?.isBlocked
              ? `Unblock "${blockConfirm.channel.name}"?`
              : `Block "${blockConfirm?.channel.name}"? It will be hidden everywhere.`
        }
        confirmLabel={blockConfirm?.isBlocked ? 'Unblock' : 'Block'}
        destructive={!blockConfirm?.isBlocked}
        onConfirm={() => {
          if (!blockConfirm) return;
          if (blockConfirm.type === 'cat') {
            toggleBlockedCategory(blockConfirm.catId);
          } else {
            const updated = blockConfirm.isBlocked
              ? blockedChannels.filter((id) => id !== blockConfirm.channel.id)
              : [...blockedChannels, blockConfirm.channel.id];
            setBlockedChannelIds(updated);
          }
          setBlockConfirm(null);
        }}
        onCancel={() => setBlockConfirm(null)}
      />

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', position: 'relative' },

  // ── TV / D-pad focus rings ──
  tvFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
  tvFocusedRound: {
    borderWidth: 2,
    borderColor: '#00E5FF',
    borderRadius: 99,
  },

  panelHeader: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },

  // ── Channel panel header (title + Edit/Done button) ──
  chPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 2,
  },
  editBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#3B82F6',
    borderRadius: 6,
    marginLeft: 'auto',
  },
  editBtnFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
  editBtnText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },

  // ── Category panel ──
  catPanel: {
    width: 140,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  catSearchWrap: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catSearchInput: {
    height: 34,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    includeFontPadding: false,
  } as any,
  catRow: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    gap: 2,
  },
  catRowText: { fontSize: 12, fontFamily: 'Inter_500Medium', lineHeight: 16 },
  catCount: { fontSize: 9, fontFamily: 'Inter_400Regular' },

  // ── Channel panel ──
  chPanel: {
    width: 280,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  chRow: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    position: 'relative',
  },
  selectedPip: {
    position: 'absolute',
    left: 0, top: '20%', bottom: '20%',
    width: 3, backgroundColor: '#3B82F6', borderRadius: 99,
  },
  chNum: { width: 24, fontSize: 11, fontFamily: 'Inter_500Medium', textAlign: 'right', flexShrink: 0 },
  chLogo: { width: 38, height: 28, borderRadius: 4, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  chInitials: { fontSize: 10, fontFamily: 'Inter_700Bold' },
  chName: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  chSub: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  heartBtn: { flexShrink: 0, paddingHorizontal: 4 },
  heartIcon: { fontSize: 16 },

  // ── Preview / right panel ──
  previewPanel: {
    flex: 1,
    paddingLeft: 12,
  },
  previewPanelFullscreen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 0,
    zIndex: 100,
    elevation: 100,
    backgroundColor: '#000',
  },

  chInfoBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 2, marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  chInfoLogo: { width: 28, height: 28, borderRadius: 4, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  chInfoInitials: { fontSize: 9, fontFamily: 'Inter_700Bold' },
  chInfoName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  chInfoNow: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  videoWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  videoWrapFocused: {
    borderColor: '#00E5FF',
  },
  fullscreenVideoContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignSelf: 'stretch',
    aspectRatio: undefined,
    marginBottom: 0,
    borderRadius: 0,
    borderWidth: 0,
    zIndex: 1,
    elevation: 1,
  },
  nativeSurfaceHost: {
    position: 'absolute',
    backgroundColor: '#000',
  },
  nativeSurfacePresentationLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 50,
    elevation: 50,
    pointerEvents: 'none',
  },
  nativeSurfacePresentationFrame: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  expandHint: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
    opacity: 0.7,
  },
  expandHintFocused: {
    backgroundColor: 'rgba(0,229,255,0.25)',
    opacity: 1,
  },
  expandHintIcon: {
    color: '#fff',
    fontSize: 13,
  },
  videoOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Solid black overlay used to hide the black-flash on player.replace().
  // Rendered at opacity 0 normally; snapped to 1 before replace() via
  // Animated.Value.setValue() (synchronous, no React reconciler delay).
  flashOverlay: {
    backgroundColor: '#000',
  },
  errText: { color: '#fff', fontSize: 12, textAlign: 'center' },
  livePill: {
    position: 'absolute',
    top: 8, left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  liveDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: '#EF4444' },
  liveText: { color: '#EF4444', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 1 },

  tapHint: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tapHintText: { color: '#fff', fontSize: 14 },

  epgHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  epgHeader: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 1.5,
  },
  catchupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  catchupBtnText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
  },
  epgRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  epgTimeCol: { width: 68, alignItems: 'flex-start', gap: 3, flexShrink: 0 },
  epgTime: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  nowBadge: { backgroundColor: '#3B82F6', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  nowBadgeText: { color: '#fff', fontSize: 9, fontFamily: 'Inter_700Bold' },
  epgTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  epgDesc: { fontSize: 10, fontFamily: 'Inter_400Regular', lineHeight: 14 },
  epgBell: { fontSize: 14, flexShrink: 0, alignSelf: 'center', marginLeft: 4 },
  epgEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 6 },
  epgProgressWrap: { marginTop: 3, marginBottom: 2, height: 3, borderRadius: 2, backgroundColor: 'rgba(59,130,246,0.15)', overflow: 'hidden' as const },
  epgProgressBar: { height: 3, borderRadius: 2, backgroundColor: '#3B82F6' },
  epgTimeLeft: { fontSize: 9, fontFamily: 'Inter_400Regular', marginTop: 2 },

  // Mini-player info bar — progress row (bar + time remaining side by side)
  miniProgWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  miniProgTimeLeft: { fontSize: 9, fontFamily: 'Inter_400Regular', flexShrink: 0 },

  noSel: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  noSelTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 6 },
  noSelSub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
