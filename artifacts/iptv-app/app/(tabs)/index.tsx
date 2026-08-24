  // filteredChannels so it re-runs after the category switch populates the list.
  // TV layout handles its own scroll inside TVLiveLayout.
  useEffect(() => {
    if (Platform.isTV || !selectedChannel) return;
    const index = filteredChannels.findIndex((c) => c.id === selectedChannel.id);
    if (index < 0) return;
    try {
      channelListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
    } catch (_) {}
  }, [selectedChannel?.id, filteredChannels]);

  const queryClient = useQueryClient();
  const { data: epgMap } = useQuery<Map<string, EpgProgram[]>>({
    queryKey: ['xmltv-epg', credentials],
    queryFn: ({ signal }) => {
      const previous = queryClient.getQueryData<Map<string, EpgProgram[]>>(['xmltv-epg', credentials]);
      return fetchAndParseXmltv(xmltvUrl!, signal, previous);
    },
    enabled: !!xmltvUrl,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });

  // â”€â”€ Derived data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const favSet = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites]);

  const nowPlayingMap = useMemo(() => {
    if (!epgMap) return new Map<string, string>();
    const map = new Map<string, string>();
    for (const [id, progs] of epgMap.entries()) {
      const cur = progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime());
      if (cur) map.set(id, cur.title);
    }
    return map;
  }, [epgMap, nowTs]);

  const channelEpg = useMemo(() => {
    if (!selectedChannel || !epgMap) return [];
    const progs = epgMap.get(selectedChannel.epgId ?? selectedChannel.id) ?? [];
    const nowIdx = progs.findIndex((p) => p.end.getTime() > nowTs);
    return nowIdx >= 0 ? progs.slice(nowIdx, nowIdx + 12) : progs.slice(0, 12);
  }, [selectedChannel, epgMap, nowTs]);

  const currentProg = useMemo(
    () => channelEpg.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null,
    [channelEpg, nowTs],
  );

  // Current programme for the playing channel in the mini-player.
  // Uses playingChannel (not selectedChannel) so the info bar stays correct
  // when the user browses other channels after the mini-player is already open.
  const miniPlayerProg = useMemo(() => {
    if (!playingChannel || !epgMap) return null;
    const progs = epgMap.get(playingChannel.epgId ?? playingChannel.id) ?? [];
    return progs.find((p) => p.start.getTime() <= nowTs && nowTs < p.end.getTime()) ?? null;
  }, [playingChannel, epgMap, nowTs]);

  // â”€â”€ Mini-guide reminder state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Reorder mode handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleEditStart = useCallback(() => {
    Haptics.selectionAsync();
    // Only show non-blocked channels in reorder mode â€” same filter applied elsewhere
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
    setSelectedChannel(ch);
    setPlayingChannel(ch);
    // Record in recently-watched (fire-and-forget â€” never blocks the UI)
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
    // Shared player keeps streaming â€” no pause needed before going fullscreen.

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
        // No stopOnBack â€” BACK collapses to mini-player just like a normal watch.
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
      // TV: the âŠ˜ block button in ChannelRow already calls this (via onTvBlockPress
      // â†’ handleLongPressChannel), so we show the ConfirmModal directly.
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
                nowProg ? `â–¶ Now: ${nowProg}` : null,
                `Category: ${ch.groupTitle || 'â€”'}`,
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
      // TV: dedicated âŠ˜ block button as a 3rd D-pad zone (RIGHT of heart).
      // Calls handleLongPressChannel which routes to ConfirmModal on TV.
      onTvBlockPress={Platform.isTV ? () => handleLongPressChannel(item) : undefined}
    />
  ), [selectedChannel?.id, favSet, nowPlayingMap, colors, handleSelectChannel, handleToggleFav, handleLongPressChannel]);

  // â”€â”€ TV remote (Fire TV / Android TV) direct navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Navigate straight to the fullscreen player â€” no expand animation needed
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
        // No stopOnBack â€” the normal triggerCollapse path handles the return
        // so the player is never paused and the TV video panel remounts cleanly
        // via onCollapseCompleteRef â†’ setVideoKey, matching the phone flow.
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

  // â”€â”€ TV: play a past mini-guide programme directly (skip CatchupSheet) â”€â”€â”€â”€â”€
  // Converts an EpgProgram (which has JS Date fields) into the same catch-up
  // URL params that CatchupSheet uses, then navigates straight to the player.
  // â”€â”€ TV: open CatchupSheet pre-scrolled to a specific past mini-guide row â”€â”€
  // We must NOT derive serverStart from an EpgProgram (XMLTV) Date: getXtreamCatchupUrls
  // requires the raw server-local "YYYY-MM-DD HH:MM:SS" string from get_simple_data_table,
  // which is never safe to reconstruct from a UTC Date (provider server timezone is unknown).
  // CatchupSheet fetches get_simple_data_table itself and uses the correct serverStart.
  const handleTVCatchupProg = useCallback((prog: EpgProgram) => {
    setCatchupInitialProg(prog);
    setShowCatchup(true);
  }, []);

  // Stable callbacks for TVLiveLayout â€” inline arrow functions would be new
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

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // On Fire TV / Android TV use the 3-panel D-pad layout.
  if (Platform.isTV) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TVLiveLayout
          allCategories={allCavÇ6WÐ¢66W76–&ÆS×¶fÇ6WÐ¢–×÷'FçDf÷$66W76–&–Æ—G“Ò&æòÖ†–FRÖFW66VæFçG2 ¢7G–ÆS×µ°¢7G–ÆW2ææF—fU7W&f6T†÷7BÀ¢7G–ÆU6†VWBæ'6öÇWFTf–ÆÂÀ¢×Ð¢à¢ÄæF—fU7G&VÕÆ–W ¢6÷W&6S×·Æ––æt6†ææVÃòç7G&VÕW&Âóò6VÆV7FVD6†ææVÃòç7G&VÕW&ÂóòrwÐ¢Æ–W#×·Æ–W'Ð¢7G–ÆS×µ7G–ÆU6†VWBæ'6öÇWFTf–ÆÇÐ¢&W6—¦TÖöFS×¶æF—fU7W&f6TgVÆÇ67&VVâòv6÷fW"r¢v6öçF–âwÐ¢f–FVô7V7E&F–ó×¶gVÆÇ67&VVåfÆ47V7E&F–÷Ð¢&VÆöD¶W“×·fÆ5&VÆöD¶W—Ð¢öåÆ––æs×¶†æFÆUW'6—7FVçEfÆ5Æ––æwÐ¢öä'VffW&–æs×¶†æFÆUW'6—7FVçEfÆ4'VffW&–æwÐ¢öäW'&÷#×¶†æFÆUW'6—7FVçEfÆ4W'&÷'Ð¢óà¢Âõf–Wsà¢—Ð¢µU4U5ôäD•dUõdÄ2bb€¢Ãà¢¶—4'VffW&–ærbb†4W'&÷"bbæF—fU7W&f6TÖöFRÓÓÒvÖ–æ’rbb€¢Åf–Wrö–çFW$WfVçG3Ò&æöæR"7G–ÆS×·7G–ÆW2çf–FVô÷fW&Æ—Óà¢Ä7F—f—G”–æF–6F÷"6öÆ÷#Ò"6ffb"6—¦SÒ&Æ&vR"óà¢Âõf–Wsà¢—Ð¢¶†4W'&÷"bbæF—fU7W&f6TÖöFRÓÓÒvÖ–æ’rbb€¢Åf–Wrö–çFW$WfVçG3Ò&æöæR"7G–ÆS×·7G–ÆW2çf–FVô÷fW&Æ—Óà¢ÅFW‡B7G–ÆS×·7G–ÆW2æW'%FW‡GÓå7G&VÒVæf–Æ&ÆSÂõFW‡Cà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æW'%FW‡BÂ²föçE6—¦S¢ÂÖ&v–åF÷¢BÂ÷6—G“¢ãrÕ×ÓåFFò&WG'“ÂõFW‡Cà¢Âõf–Wsà¢—Ð¢¶æF—fU7W&f6TÖöFRÓÓÒvÖ–æ’rbb—4'VffW&–ærbb†4W'&÷"bb€¢Åf–Wrö–çFW$WfVçG3Ò&æöæR"7G–ÆS×µ·7G–ÆW2æW‡æD†–çBÂÖ–æ•Æ–W$fö7W6VBbb7G–ÆW2æW‡æD†–çDfö7W6VE×Óà¢ÅFW‡B7G–ÆS×·7G–ÆW2æW‡æD†–çD–6öçÓî)»cÂõFW‡Cà¢Âõf–Wsà¢—Ð¢¶æF—fU7W&f6TÖöFRÓÓÒvÖ–æ’rbb€¢Åf–Wrö–çFW$WfVçG3Ò&æöæR"7G–ÆS×·7G–ÆW2æÆ—fU–ÆÇÓà¢Åf–Wr7G–ÆS×·7G–ÆW2æÆ—fTF÷GÒóà¢ÅFW‡B7G–ÆS×·7G–ÆW2æÆ—fUFW‡GÓäÄ•dSÂõFW‡Cà¢Âõf–Wsà¢—Ð¢Âóà¢—Ð¢²ò¢)H)HæöâÔæG&ö–BFƒ¢7G&VÒÆ–W"²ÆÂ÷fW&Æ—2Æ—fR–ç6–FR)H)H¢÷Ð¢²U4U5ôäD•dUõdÄ2bb—4Æ—fU&Wf–Wt7F—fRbb€¢Äæ–ÖFVBåf–Wp¢ö–çFW$WfVçG3Ò&æöæR ¢7G–ÆS×µ7G–ÆU6†VWBæ'6öÇWFTf–ÆÇÐ¢à¢ÄæF—fU7G&VÕÆ–W ¢6÷W&6S×·Æ––æt6†ææVÃòç7G&VÕW&Âóò6VÆV7FVD6†ææVÃòç7G&VÕW&ÂóòrwÐ¢Æ–W#×·Æ–W'Ð¢7G–ÆS×µ7G–ÆU6†VWBæ'6öÇWFTf–ÆÇÐ¢&W6—¦TÖöFSÒ&6öçF–â ¢òòf–FVô¶W’—2F†RW‡òf–FVõf–Wr7W&f6R×&V&–æBv÷&¶&÷VæBà¢&VÆöD¶W“×¶G·f–FVô¶W—Ó¢G·fÆ5&VÆöD¶W—ÖÐ¢öåÆ––æs×²‚’Óâ°¢6WD—4'VffW&–ær†fÇ6R“°¢6WD†4W'&÷"†fÇ6R“°¢æ–ÖFVBçF–Ö–ær†fÆ6„÷fW&Æ”÷6—G’Â°¢FõfÇVS¢ÂGW&F–öã¢#ÂW6TæF—fTG&—fW#¢G'VRÀ¢Ò’ç7F'B‚“°¢×Ð¢öä'VffW&–æs×²‚’Óâ6WD—4'VffW&–ær‡G'VR—Ð¢öäW'&÷#×²‚’Óâ°¢6WD—4'VffW&–ær†fÇ6R“°¢6WD†4W'&÷"‡G'VR“°¢æ–ÖFVBçF–Ö–ær†fÆ6„÷fW&Æ”÷6—G’Â°¢FõfÇVS¢ÂGW&F–öã¢SÂW6TæF—fTG&—fW#¢G'VRÀ¢Ò’ç7F'B‚“°¢×Ð¢óà¢Âôæ–ÖFVBåf–Wsà¢—Ð¢²U4U5ôäD•dUõdÄ2bb€¢Ãà¢²ò¢fÆ6‚×&WfVçF–öâ÷fW&Æ’¢÷Ð¢Äæ–ÖFVBåf–Wp¢7G–ÆS×µµ7G–ÆU6†VWBæ'6öÇWFTf–ÆÂÂ7G–ÆW2æfÆ6„÷fW&Æ’Â²÷6—G“¢fÆ6„÷fW&Æ”÷6—G’Õ×Ð¢ö–çFW$WfVçG3Ò&æöæR ¢óà¢²†—4'VffW&–ærbb†4W'&÷"’bb€¢Åf–Wr7G–ÆS×·7G–ÆW2çf–FVô÷fW&Æ—Óà¢Ä7F—f—G”–æF–6F÷"6öÆ÷#Ò"6ffb"6—¦SÒ&Æ&vR"óà¢Âõf–Wsà¢—Ð¢¶†4W'&÷"bb€¢Åf–Wr7G–ÆS×·7G–ÆW2çf–FVô÷fW&Æ—Òö–çFW$WfVçG3Ò&&÷‚ÖæöæR#à¢ÅFW‡B7G–ÆS×·7G–ÆW2æW'%FW‡GÓå7G&VÒVæf–Æ&ÆSÂõFW‡Cà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æW'%FW‡BÂ²föçE6—¦S¢ÂÖ&v–åF÷¢BÂ÷6—G“¢ãrÕ×ÓåFFò&WG'“ÂõFW‡Cà¢Âõf–Wsà¢—Ð¢²—4'VffW&–ærbb†4W'&÷"bb€¢Åf–Wr7G–ÆS×µ·7G–ÆW2æW‡æD†–çBÂÖ–æ•Æ–W$fö7W6VBbb7G–ÆW2æW‡æD†–çDfö7W6VE×Óà¢ÅFW‡B7G–ÆS×·7G–ÆW2æW‡æD†–çD–6öçÓî)»cÂõFW‡Cà¢Âõf–Wsà¢—Ð¢Åf–Wr7G–ÆS×·7G–ÆW2æÆ—fU–ÆÇÓà¢Åf–Wr7G–ÆS×·7G–ÆW2æÆ—fTF÷GÒóà¢ÅFW‡B7G–ÆS×·7G–ÆW2æÆ—fUFW‡GÓäÄ•dSÂõFW‡Cà¢Âõf–Wsà¢Âóà¢—Ð¢Âôfö7W6&ÆU&W76&ÆSà¢—Ð ¢²ò¢6†ææVÂ–æfò&"(	BÆövò²æÖR²æ÷r×Æ––ærUrF—FÆR²&öw&W72&"&VÆ÷rF†RÖ–æ’×Æ–W"¢÷Ð¢²æF—fU7W&f6TgVÆÇ67&VVâbbÆ––æt6†ææVÂbb€¢Åf–Wr7G–ÆS×µ·7G–ÆW2æ6„–æfô&"Â²&÷&FW$&÷GFöÔ6öÆ÷#¢6öÆ÷'2æ&÷&FW"Õ×Óà¢Åf–Wr7G–ÆS×µ·7G–ÆW2æ6„–æfôÆövòÂ²&6¶w&÷VæD6öÆ÷#¢6öÆ÷'2ç6V6öæF'’Õ×Óà¢·Æ––æt6†ææVÂæÆövòò€¢Ä–ÖvR6÷W&6S×·²W&“¢Æ––æt6†ææVÂæÆövò×Ò7G–ÆS×µ7G–ÆU6†VWBæ'6öÇWFTf–ÆÇÒ&W6—¦TÖöFSÒ&6öçF–â"óà¢’¢€¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æ6„–æfô–æ—F–Ç2Â²6öÆ÷#¢6öÆ÷'2ç&–Ö'’Õ×Óà¢·Æ––æt6†ææVÂææÖRç6Æ–6RƒÂ"’çFõWW$66R‚—Ð¢ÂõFW‡Cà¢—Ð¢Âõf–Wsà¢Åf–Wr7G–ÆS×·²fÆWƒ¢Âv¢×Óà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æ6„–æfôæÖRÂ²6öÆ÷#¢6öÆ÷'2æf÷&Vw&÷VæBÕ×ÒçVÖ&W$ödÆ–æW3×³Óà¢·Æ––æt6†ææVÂææÖWÐ¢ÂõFW‡Cà¢¶Ö–æ•Æ–W%&örò€¢Ãà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æ6„–æfôæ÷rÂ²6öÆ÷#¢6öÆ÷'2ç&–Ö'’Õ×ÒçVÖ&W$ödÆ–æW3×³Óà¢)kb¶Ö–æ•Æ–W%&örçF—FÆWÐ¢ÂõFW‡Cà¢²ò¢&öw&W72&"(	B6†÷w2†÷rf"F‡&÷Vv‚F†R7W'&VçB&öw&ÖÖRF†Rf–WvW"—2à¢&WW6W2F†R6ÖRWu&öw&W75w&öWu&öw&W74&"7G–ÆW2W6VB–âF†RUrÆ—7Bâ¢÷Ð¢²‚‚’Óâ°¢6öç7BF÷FÂÒÖ–æ•Æ–W%&öræVæBævWEF–ÖR‚’ÒÖ–æ•Æ–W%&örç7F'BævWEF–ÖR‚“°¢6öç7BVÆ6VBÒÖF‚æÖ‚ƒÂæ÷uG2ÒÖ–æ•Æ–W%&örç7F'BævWEF–ÖR‚’“°¢6öç7B7BÒF÷FÂâòÖF‚æÖ–âƒÂVÆ6VBòF÷FÂ’¢°¢6öç7BÖ–ç4ÆVgBÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‚†Ö–æ•Æ–W%&öræVæBævWEF–ÖR‚’Òæ÷uG2’òcó’“°¢&WGW&â€¢Åf–Wr7G–ÆS×·7G–ÆW2æÖ–æ•&öuw&Óà¢Åf–Wr7G–ÆS×µ·7G–ÆW2æWu&öw&W75w&Â²fÆWƒ¢ÂÖ&v–åF÷¢Õ×Óà¢Åf–Wr7G–ÆS×µ·7G–ÆW2æWu&öw&W74&"Â²v–GFƒ¢G´ÖF‚ç&÷VæB‡7B¢—ÒV2ç’Õ×Òóà¢Âõf–Wsà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æÖ–æ•&öuF–ÖTÆVgBÂ²6öÆ÷#¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÕ×Óà¢¶Ö–ç4ÆVgBâòG¶Ö–ç4ÆVgGÖÖ¢sÂÒwÐ¢ÂõFW‡Cà¢Âõf–Wsà¢“°¢Ò’‚—Ð¢Âóà¢’¢‚‚’Óâ°¢òòfÆÂ&6²FòF†RF—FÆRÖöæÇ’7G&–ærg&öÒæ÷uÆ––ætÖv†VâgVÆÀ¢òò&öw&ÖÖRFF—2æ÷B–WBf–Æ&ÆR†RærâUr7F–ÆÂÆöF–ær’à¢6öç7Bæ÷uF—FÆRÒæ÷uÆ––ætÖævWB‡Æ––æt6†ææVÂæWt–BóòÆ––æt6†ææVÂæ–B“°¢&WGW&âæ÷uF—FÆRò€¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æ6„–æfôæ÷rÂ²6öÆ÷#¢6öÆ÷'2ç&–Ö'’Õ×ÒçVÖ&W$ödÆ–æW3×³Óà¢)kb¶æ÷uF—FÆWÐ¢ÂõFW‡Cà¢’¢çVÆÃ°¢Ò’‚—Ð¢Âõf–Wsà¢Âõf–Wsà¢—Ð ¢²æF—fU7W&f6TgVÆÇ67&VVâbb‡6VÆV7FVD6†ææVÂò€¢Ãà¢²ò¢)H)HUr†VFW"&÷rv—F‚÷F–öæÂ6F6‚×W'WGFöâ)H)H¢÷Ð¢Åf–Wr7G–ÆS×·7G–ÆW2æWt†VFW%&÷wÓà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æWt†VFW"Â²6öÆ÷#¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÕ×ÓåEbuT”DSÂõFW‡Cà¢·6VÆV7FVD6†ææVÂçGd&6†—fRÓÓÒbb€¢Äfö7W6&ÆU&W76&ÆP¢öå&W73×²‚’Óâ6WE6†÷t6F6‡W‡G'VR—Ð¢7G–ÆS×·7G–ÆW2æ6F6‡W'FçÐ¢fö7W6VE7G–ÆS×·7G–ÆW2çGdfö7W6VGÐ¢à¢ÅFW‡B7G–ÆS×·7G–ÆW2æ6F6‡W'FåFW‡GÓï	ù8R6F6‚×WÂõFW‡Cà¢Âôfö7W6&ÆU&W76&ÆSà¢—Ð¢Âõf–Wsà¢¶6†ææVÄWræÆVæwF‚âò€¢Å67&öÆÅf–Wp¢6†÷w5fW'F–6Å67&öÆÄ–æF–6F÷#×¶fÇ6WÐ¢7G–ÆS×·²fÆWƒ¢×Ð¢6öçFVçD6öçF–æW%7G–ÆS×·²FF–æt&÷GFöÓ¢–ç6WG2æ&÷GFöÒ²‚×Ð¢&Vc×²‡&Vb’Óâ°¢òò67&öÆÂFòF†R7W'&VçFÇ’Ö—&–ær&öw&ÖÖRv†VâF†RUrFFÆöG0¢–b‚&Vb’&WGW&ã°¢6öç7Bæ÷t–G‚Ò6†ææVÄWræf–æD–æFW‚€¢‡’Óâç7F'BævWEF–ÖR‚’ÃÒæ÷uG2bbæ÷uG2ÂæVæBævWEF–ÖR‚¢“°¢–b†æ÷t–G‚â’°¢òòV6‚Ur&÷r—2&÷†–ÖFVÇ’c‡‚FÆÃ²67&öÆÂ7BV&Æ–W"&÷w0¢6WEF–ÖV÷WB‚‚’Óâ&Vbç67&öÆÅFò‡²“¢ÖF‚æÖ‚ƒÂ†æ÷t–G‚Ò’¢c‚’Âæ–ÖFVC¢fÇ6RÒ’Âƒ“°¢Ð¢×Ð¢à¢¶6†ææVÄWræÖ‚‡&örÂ’’Óâ°¢6öç7B—47W'&VçBÒ&örç7F'BævWEF–ÖR‚’ÃÒæ÷uG2bbæ÷uG2Â&öræVæBævWEF–ÖR‚“°¢6öç7B—4gWGW&RÒ&örç7F'BævWEF–ÖR‚’âæ÷uG3°¢6öç7B&VÖ–æFW$–BÒG·6VÆV7FVD6†ææVÂæ–GÕòG·&örç7F'BçFô•4õ7G&–ær‚—Ö°¢6öç7B†5&VÖ–æFW"ÒÖ–æ•&VÖ–æFW$–G2æ†2‡&VÖ–æFW$–B“°¢&WGW&â€¢Äfö7W6&ÆU&W76&ÆP¢¶W“×¶—Ð¢öå&W73×¶—4gWGW&Rò‚’Óâ†æFÆUFövvÆTÖ–æ•&VÖ–æFW"‡&ör’¢VæFVf–æVGÐ¢fö7W6&ÆS×¶—4gWGW&WÐ¢7G–ÆS×µ°¢7G–ÆW2æWu&÷rÀ¢²&÷&FW$&÷GFöÔ6öÆ÷#¢6öÆ÷'2æ&÷&FW"ÒÀ¢—47W'&VçBbb²&6¶w&÷VæD6öÆ÷#¢w&v&ƒS’Ã3Ã#CbÃã‚’rÒÀ¢×Ð¢fö7W6VE7G–ÆS×¶—4gWGW&Rò7G–ÆW2çGdfö7W6VB¢·×Ð¢öäfö7W3×µÆFf÷&Òæ—5Ebbb—4gWGW&Rò‚’Óâ6WDfö7W6VE&öt–G‚†’’¢VæFVf–æVGÐ¢öä&ÇW#×µÆFf÷&Òæ—5Ebbb—4gWGW&Rò‚’Óâ6WDfö7W6VE&öt–G‚†çVÆÂ’¢VæFVf–æVGÐ¢à¢Åf–Wr7G–ÆS×·7G–ÆW2æWuF–ÖT6öÇÓà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æWuF–ÖRÂ²6öÆ÷#¢—47W'&VçBòr34#ƒ$cbr¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÕ×Óà¢¶f×EF–ÖR‡&örç7F'B—Ð¢ÂõFW‡Cà¢¶—47W'&VçBbb€¢Åf–Wr7G–ÆS×·7G–ÆW2ææ÷t&FvWÓà¢ÅFW‡B7G–ÆS×·7G–ÆW2ææ÷t&FvUFW‡GÓääõsÂõFW‡Cà¢Âõf–Wsà¢—Ð¢Âõf–Wsà¢Åf–Wr7G–ÆS×·²fÆWƒ¢×Óà¢ÅFW‡@¢7G–ÆS×µ·7G–ÆW2æWuF—FÆRÂ²6öÆ÷#¢—47W'&VçBòr4c$c$c"r¢6öÆ÷'2æf÷&Vw&÷VæBÕ×Ð¢çVÖ&W$ödÆ–æW3×³Ð¢à¢·&örçF—FÆWÐ¢ÂõFW‡Cà¢¶—47W'&VçBbb‚‚’Óâ°¢6öç7BF÷FÂÒ&öræVæBævWEF–ÖR‚’Ò&örç7F'BævWEF–ÖR‚“°¢6öç7BVÆ6VBÒÖF‚æÖ‚ƒÂæ÷uG2Ò&örç7F'BævWEF–ÖR‚’“°¢6öç7B7BÒÖF‚æÖ–âƒÂVÆ6VBòF÷FÂ“°¢6öç7BÖ–ç4ÆVgBÒÖF‚æÖ‚ƒÂÖF‚ç&÷VæB‚‡&öræVæBævWEF–ÖR‚’Òæ÷uG2’òcó’“°¢&WGW&â€¢Åf–Wr7G–ÆS×·7G–ÆW2æWu&öw&W75w&Óà¢Åf–Wr7G–ÆS×µ·7G–ÆW2æWu&öw&W74&"Â²v–GFƒ¢G´ÖF‚ç&÷VæB‡7B¢—ÒV2ç’Õ×Òóà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æWuF–ÖTÆVgBÂ²6öÆ÷#¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÕ×Óà¢¶Ö–ç4ÆVgBâòG¶Ö–ç4ÆVgGÖÒÆVgF¢vVæF–ær6ööâwÐ¢ÂõFW‡Cà¢Âõf–Wsà¢“°¢Ò’‚—Ð¢·&öræFW67&—F–öâò€¢ÅFW‡@¢7G–ÆS×µ·7G–ÆW2æWtFW62Â²6öÆ÷#¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÕ×Ð¢çVÖ&W$ödÆ–æW3×³'Ð¢à¢·&öræFW67&—F–öçÐ¢ÂõFW‡Cà¢’¢çVÆÇÐ¢Âõf–Wsà¢¶—4gWGW&Rbb€¢ÅFW‡B7G–ÆS×µ·7G–ÆW2æWt&VÆÂÂ°¢òò3#C“¢'&–v‡FVâ&VÆÂv†VâF†—2&÷r—2B×Bfö7W6VB6ò—@¢òò7F—2&VF&ÆRv–ç7BF†R7–âfö7W2&–æröâf—&Rõ2à¢6öÆ÷#¢…ÆFf÷&Òæ—5Ebbbfö7W6VE&öt–G‚ÓÓÒ’¢òr4dddddbp¢¢††5&VÖ–æFW"òr34#ƒ$cbr¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæB’À¢Õ×Óà¢¶†5&VÖ–æFW"ò	ùIBr¢	ùIRwÐ¢ÂõFW‡Cà¢—Ð¢Âôfö7W6&ÆU&W76&ÆSà¢“°¢Ò—Ð¢Âõ67&öÆÅf–Wsà¢’¢€¢Åf–Wr7G–ÆS×·7G–ÆW2æWtV×G—Óà¢¶WtÖ ¢òÅFW‡B7G–ÆS×·²6öÆ÷#¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÂföçE6—¦S¢"×ÓäæòwV–FRFFf–Æ&ÆSÂõFW‡Cà¢¢ÃãÄ7F—f—G”–æF–6F÷"6öÆ÷#×¶6öÆ÷'2ç&–Ö'—Ò6—¦SÒ'6ÖÆÂ"óãÅFW‡B7G–ÆS×·²6öÆ÷#¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÂföçE6—¦S¢"ÂÖ&v–åF÷¢b×ÓäÆöF–ærwV–F^(
cÂõFW‡CãÂóà¢Ð¢Âõf–Wsà¢—Ð¢Âóà¢’¢€¢Åf–Wr7G–ÆS×·7G–ÆW2ææõ6VÇÓà¢ÅFW‡B7G–ÆS×·²föçE6—¦S¢3bÂÖ&v–ä&÷GFöÓ¢×Óï	ù;£ÂõFW‡Cà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2ææõ6VÅF—FÆRÂ²6öÆ÷#¢6öÆ÷'2æf÷&Vw&÷VæBÕ×Óå6VÆV7B6†ææVÃÂõFW‡Cà¢ÅFW‡B7G–ÆS×µ·7G–ÆW2ææõ6VÅ7V"Â²6öÆ÷#¢6öÆ÷'2æ×WFVDf÷&Vw&÷VæBÕ×Óà¢6†ö÷6R6FVv÷'’ÂF†Vâ–6²6†ææVÂFò&Wf–Wr—B†W&Râ&W72ô²FòvF6‚gVÆÇ67&VVâà¢ÂõFW‡Cà¢Âõf–Wsà¢’—Ð¢Âõf–Wsç²ò¢VæB&Wf–WuæVÂ¢÷Ð ¢²ò¢)H)H6F6‚×W6†VWB)H)H¢÷Ð¢·6†÷t6F6‡Wbb6VÆV7FVD6†ææVÂbb7&VG2bb€¢Ä6F6‡W6†VW@¢¶W“×·6VÆV7FVD6†ææVÂæ–GÐ¢f—6–&ÆS×·6†÷t6F6‡WÐ¢6†ææVÃ×·6VÆV7FVD6†ææVÇÐ¢7&VG3×¶7&VG7Ð¢WtÖ×¶WtÖÐ¢öä6Æ÷6S×²‚’Óâ6WE6†÷t6F6‡W†fÇ6R—Ð¢öå7F'EÆ–&6³×¶†æFÆU7F'D6F6‡WÆ–&6·Ð¢óà¢—Ð ¢²ò¢)H)HEb×6fR&Æö6²÷Væ&Æö6²6öæf—&ÖF–öâ)H)H¢÷Ð¢²ò¢&WÆ6W2ÆW'BæÆW'B‡Vç&VÆ–&ÆRöâf—&Rõ2’f÷"6FVv÷'’æB6†ææVÀ¢&Æö6²7F–öç2âG&–vvW&VB'“¢6V6öæBô²öâ6VÆV7FVB6FVv÷'’ÂF†P¢FVF–6FVB(©‚'WGFöâ–â6†ææVÅ&÷r„B×B$”t…Böb†V'B’Â÷"Æöær×&W70¢‡7F–ÆÂv÷&·226V6öæF'’F‚öâF÷V6‚’â¢÷Ð¢Ä6öæf—&ÔÖöFÀ¢f—6–&ÆS×²&Æö6´6öæf—&×Ð¢F—FÆS×°¢&Æö6´6öæf—&ÓòçG—RÓÓÒv6Bp¢òG¶&Æö6´6öæf—&Òæ—4&Æö6¶VBòuVæ&Æö6²r¢t&Æö6²wÒ6FVv÷'– ¢¢G¶&Æö6´6öæf—&Óòæ—4&Æö6¶VBòuVæ&Æö6²r¢t&Æö6²wÒ6†ææVÆ ¢Ð¢ÖW76vS×°¢&Æö6´6öæf—&ÓòçG—RÓÓÒv6Bp¢òG¶&Æö6´6öæf—&Òæ—4&Æö6¶VBòuVæ&Æö6²r¢t&Æö6²wÒÆÂ6†ææVÇ2–â"G¶&Æö6´6öæf—&ÒææÖWÒ#ö ¢¢&Æö6´6öæf—&Óòæ—4&Æö6¶V@¢òVæ&Æö6²"G¶&Æö6´6öæf—&Òæ6†ææVÂææÖWÒ#ö ¢¢&Æö6²"G¶&Æö6´6öæf—&Óòæ6†ææVÂææÖWÒ#ò—Bv–ÆÂ&R†–FFVâWfW'—v†W&Ræ ¢Ð¢6öæf—&ÔÆ&VÃ×¶&Æö6´6öæf—&Óòæ—4&Æö6¶VBòuVæ&Æö6²r¢t&Æö6²wÐ¢FW7G'V7F—fS×²&Æö6´6öæf—&Óòæ—4&Æö6¶VGÐ¢öä6öæf—&Ó×²‚’Óâ°¢–b‚&Æö6´6öæf—&Ò’&WGW&ã°¢–b†&Æö6´6öæf—&ÒçG—RÓÓÒv6Br’°¢FövvÆT&Æö6¶VD6FVv÷'’†&Æö6´6öæf—&Òæ6D–B“°¢ÒVÇ6R°¢6öç7BWFFVBÒ&Æö6´6öæf—&Òæ—4&Æö6¶V@¢ò&Æö6¶VD6†ææVÇ2æf–ÇFW"‚†–B’Óâ–BÓÒ&Æö6´6öæf—&Òæ6†ææVÂæ–B¢¢²ââæ&Æö6¶VD6†ææVÇ2Â&Æö6´6öæf—&Òæ6†ææVÂæ–EÓ°¢6WD&Æö6¶VD6†ææVÄ–G2‡WFFVB“°¢Ð¢6WD&Æö6´6öæf—&Ò†çVÆÂ“°¢×Ð¢öä6æ6VÃ×²‚’Óâ6WD&Æö6´6öæf—&Ò†çVÆÂ—Ð¢óà ¢Âõf–Wsà¢“°§Ð ¢òò)H)H)H7G–ÆW2)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H)H  ¦6öç7B7G–ÆW2Ò7G–ÆU6†VWBæ7&VFR‡°¢&ö÷C¢²fÆWƒ¢ÂfÆW„F—&V7F–öã¢w&÷rrÒÀ ¢òò)H)HEbòB×Bfö7W2&–æw2)H)H ¢Gdfö7W6VC¢°¢&÷&FW%v–GFƒ¢"À¢&÷&FW$6öÆ÷#¢r3STdbrÀ¢ÒÀ¢Gdfö7W6VE&÷VæC¢°¢&÷&FW%v–GFƒ¢"À¢&÷&FW$6öÆ÷#¢r3STdbrÀ¢&÷&FW%&F—W3¢“’À¢ÒÀ ¢æVÄ†VFW#¢°¢föçE6—¦S¢’À¢föçDfÖ–Ç“¢t–çFW%óc6VÖ”&öÆBrÀ¢ÆWGFW%76–æs¢ãRÀ¢FF–æt†÷&—¦öçFÃ¢"À¢FF–æt&÷GFöÓ¢bÀ¢&÷&FW$&÷GFöÕv–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢Ö&v–ä&÷GFöÓ¢"À¢ÒÀ ¢òò)H)H6†ææVÂæVÂ†VFW"‡F—FÆR²VF—BôFöæR'WGFöâ’)H)H ¢6…æVÄ†VFW#¢°¢fÆW„F—&V7F–öã¢w&÷rrÀ¢Æ–vä—FV×3¢v6VçFW"rÀ¢FF–æu&–v‡C¢‚À¢&÷&FW$&÷GFöÕv–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢Ö&v–ä&÷GFöÓ¢"À¢ÒÀ¢VF—D'Fã¢°¢FF–æt†÷&—¦öçFÃ¢À¢FF–æufW'F–6Ã¢BÀ¢&6¶w&÷VæD6öÆ÷#¢r34#ƒ$cbrÀ¢&÷&FW%&F—W3¢bÀ¢Ö&v–äÆVgC¢vWFòrÀ¢ÒÀ¢VF—D'Fäfö7W6VC¢°¢&÷&FW%v–GFƒ¢"À¢&÷&FW$6öÆ÷#¢r3STdbrÀ¢ÒÀ¢VF—D'FåFW‡C¢°¢6öÆ÷#¢r6ffbrÀ¢föçE6—¦S¢À¢föçDfÖ–Ç“¢t–çFW%óc6VÖ”&öÆBrÀ¢ÆWGFW%76–æs¢ã2À¢ÒÀ ¢òò)H)H6FVv÷'’æVÂ)H)H ¢6EæVÃ¢°¢v–GFƒ¢CÀ¢&÷&FW%&–v‡Ev–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢ÒÀ¢6E6V&6…w&¢°¢FF–æt†÷&—¦öçFÃ¢‚À¢FF–æufW'F–6Ã¢bÀ¢&÷&FW$&÷GFöÕv–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢ÒÀ¢6E6V&6„–çWC¢°¢†V–v‡C¢3BÀ¢&÷&FW%&F—W3¢bÀ¢FF–æt†÷&—¦öçFÃ¢‚À¢FF–æufW'F–6Ã¢BÀ¢föçE6—¦S¢"À¢föçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÀ¢–æ6ÇVFTföçEFF–æs¢fÇ6RÀ¢Ò2ç’À¢6E&÷s¢°¢Ö–ä†V–v‡C¢S"À¢§W7F–g”6öçFVçC¢v6VçFW"rÀ¢FF–æt†÷&—¦öçFÃ¢"À¢FF–æufW'F–6Ã¢‚À¢&÷&FW$&÷GFöÕv–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢fÆW„F—&V7F–öã¢v6öÇVÖârÀ¢v¢"À¢ÒÀ¢6E&÷uFW‡C¢²föçE6—¦S¢"ÂföçDfÖ–Ç“¢t–çFW%óSÖVF—VÒrÂÆ–æT†V–v‡C¢bÒÀ¢6D6÷VçC¢²föçE6—¦S¢’ÂföçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÒÀ ¢òò)H)H6†ææVÂæVÂ)H)H ¢6…æVÃ¢°¢v–GFƒ¢#ƒÀ¢&÷&FW%&–v‡Ev–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢ÒÀ¢6…&÷s¢°¢†V–v‡C¢cÀ¢fÆW„F—&V7F–öã¢w&÷rrÀ¢Æ–vä—FV×3¢v6VçFW"rÀ¢FF–æt†÷&—¦öçFÃ¢À¢v¢‚À¢&÷&FW$&÷GFöÕv–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢÷6—F–öã¢w&VÆF—fRrÀ¢ÒÀ¢6VÆV7FVE—¢°¢÷6—F–öã¢v'6öÇWFRrÀ¢ÆVgC¢ÂF÷¢s#RrÂ&÷GFöÓ¢s#RrÀ¢v–GFƒ¢2Â&6¶w&÷VæD6öÆ÷#¢r34#ƒ$cbrÂ&÷&FW%&F—W3¢“’À¢ÒÀ¢6„çVÓ¢²v–GFƒ¢#BÂföçE6—¦S¢ÂföçDfÖ–Ç“¢t–çFW%óSÖVF—VÒrÂFW‡DÆ–vã¢w&–v‡BrÂfÆW…6‡&–æ³¢ÒÀ¢6„Æövó¢²v–GFƒ¢3‚Â†V–v‡C¢#‚Â&÷&FW%&F—W3¢BÂ÷fW&fÆ÷s¢v†–FFVârÂ§W7F–g”6öçFVçC¢v6VçFW"rÂÆ–vä—FV×3¢v6VçFW"rÂfÆW…6‡&–æ³¢ÒÀ¢6„–æ—F–Ç3¢²föçE6—¦S¢ÂföçDfÖ–Ç“¢t–çFW%ós&öÆBrÒÀ¢6„æÖS¢²föçE6—¦S¢"ÂföçDfÖ–Ç“¢t–çFW%óSÖVF—VÒrÒÀ¢6…7V#¢²föçE6—¦S¢ÂföçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÒÀ¢†V'D'Fã¢²fÆW…6‡&–æ³¢ÂFF–æt†÷&—¦öçFÃ¢BÒÀ¢†V'D–6öã¢²föçE6—¦S¢bÒÀ ¢òò)H)H&Wf–Wrò&–v‡BæVÂ)H)H ¢&Wf–WuæVÃ¢°¢fÆWƒ¢À¢FF–ætÆVgC¢"À¢ÒÀ¢&Wf–WuæVÄgVÆÇ67&VVã¢°¢÷6—F–öã¢v'6öÇWFRrÀ¢F÷¢À¢&–v‡C¢À¢&÷GFöÓ¢À¢ÆVgC¢À¢FF–æs¢À¢¤–æFWƒ¢À¢VÆWfF–öã¢À¢&6¶w&÷VæD6öÆ÷#¢r3rÀ¢ÒÀ ¢6„–æfô&#¢²fÆW„F—&V7F–öã¢w&÷rrÂÆ–vä—FV×3¢v6VçFW"rÂv¢‚ÂFF–æufW'F–6Ã¢bÂFF–æt†÷&—¦öçFÃ¢"ÂÖ&v–ä&÷GFöÓ¢bÂ&÷&FW$&÷GFöÕv–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚ÒÀ¢6„–æfôÆövó¢²v–GFƒ¢#‚Â†V–v‡C¢#‚Â&÷&FW%&F—W3¢BÂ÷fW&fÆ÷s¢v†–FFVârÂ§W7F–g”6öçFVçC¢v6VçFW"rÂÆ–vä—FV×3¢v6VçFW"rÒÀ¢6„–æfô–æ—F–Ç3¢²föçE6—¦S¢’ÂföçDfÖ–Ç“¢t–çFW%ós&öÆBrÒÀ¢6„–æfôæÖS¢²föçE6—¦S¢2ÂföçDfÖ–Ç“¢t–çFW%óc6VÖ”&öÆBrÒÀ¢6„–æfôæ÷s¢²föçE6—¦S¢ÂföçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÒÀ¢f–FVõw&¢°¢v–GFƒ¢sRrÀ¢7V7E&F–ó¢bò’À¢&6¶w&÷VæD6öÆ÷#¢r3rÀ¢&÷&FW%&F—W3¢‚À¢÷fW&fÆ÷s¢v†–FFVârÀ¢÷6—F–öã¢w&VÆF—fRrÀ¢Ö&v–ä&÷GFöÓ¢‚À¢&÷&FW%v–GFƒ¢"À¢&÷&FW$6öÆ÷#¢wG&ç7&VçBrÀ¢ÒÀ¢f–FVõw&fö7W6VC¢°¢&÷&FW$6öÆ÷#¢r3STdbrÀ¢ÒÀ¢gVÆÇ67&VVåf–FVô6öçF–æW#¢°¢fÆWƒ¢À¢v–GFƒ¢sRrÀ¢†V–v‡C¢sRrÀ¢Æ–vå6VÆc¢w7G&WF6‚rÀ¢7V7E&F–ó¢VæFVf–æVBÀ¢Ö&v–ä&÷GFöÓ¢À¢&÷&FW%&F—W3¢À¢&÷&FW%v–GFƒ¢À¢¤–æFWƒ¢À¢VÆWfF–öã¢À¢ÒÀ¢æF—fU7W&f6T†÷7C¢°¢÷6—F–öã¢v'6öÇWFRrÀ¢&6¶w&÷VæD6öÆ÷#¢r3rÀ¢ÒÀ¢W‡æD†–çC¢°¢÷6—F–öã¢v'6öÇWFRrÀ¢&÷GFöÓ¢‚À¢&–v‡C¢‚À¢&6¶w&÷VæD6öÆ÷#¢w&v&ƒÃÃÃãR’rÀ¢&÷&FW%&F—W3¢RÀ¢FF–æt†÷&—¦öçFÃ¢bÀ¢FF–æufW'F–6Ã¢2À¢÷6—G“¢ãrÀ¢ÒÀ¢W‡æD†–çDfö7W6VC¢°¢&6¶w&÷VæD6öÆ÷#¢w&v&ƒÃ##’Ã#SRÃã#R’rÀ¢÷6—G“¢À¢ÒÀ¢W‡æD†–çD–6öã¢°¢6öÆ÷#¢r6ffbrÀ¢föçE6—¦S¢2À¢ÒÀ¢f–FVô÷fW&Æ“¢°¢÷6—F–öã¢v'6öÇWFRrÀ¢F÷¢ÂÆVgC¢Â&–v‡C¢Â&÷GFöÓ¢À¢&6¶w&÷VæD6öÆ÷#¢w&v&ƒÃÃÃãSR’rÀ¢§W7F–g”6öçFVçC¢v6VçFW"rÀ¢Æ–vä—FV×3¢v6VçFW"rÀ¢ÒÀ¢òò6öÆ–B&Æ6²÷fW&Æ’W6VBFò†–FRF†R&Æ6²ÖfÆ6‚öâÆ–W"ç&WÆ6R‚’à¢òò&VæFW&VBB÷6—G’æ÷&ÖÆÇ“²6æVBFò&Vf÷&R&WÆ6R‚’f–¢òòæ–ÖFVBåfÇVRç6WEfÇVR‚’‡7–æ6‡&öæ÷W2Âæò&V7B&V6öæ6–ÆW"FVÆ’’à¢fÆ6„÷fW&Æ“¢°¢&6¶w&÷VæD6öÆ÷#¢r3rÀ¢ÒÀ¢W'%FW‡C¢²6öÆ÷#¢r6ffbrÂföçE6—¦S¢"ÂFW‡DÆ–vã¢v6VçFW"rÒÀ¢Æ—fU–ÆÃ¢°¢÷6—F–öã¢v'6öÇWFRrÀ¢F÷¢‚ÂÆVgC¢‚À¢fÆW„F—&V7F–öã¢w&÷rrÀ¢Æ–vä—FV×3¢v6VçFW"rÀ¢v¢BÀ¢&6¶w&÷VæD6öÆ÷#¢w&v&ƒÃÃÃãb’rÀ¢&÷&FW%&F—W3¢“’À¢FF–æt†÷&—¦öçFÃ¢‚À¢FF–æufW'F–6Ã¢2À¢ÒÀ¢Æ—fTF÷C¢²v–GFƒ¢bÂ†V–v‡C¢bÂ&÷&FW%&F—W3¢“’Â&6¶w&÷VæD6öÆ÷#¢r4TcCCCBrÒÀ¢Æ—fUFW‡C¢²6öÆ÷#¢r4TcCCCBrÂföçE6—¦S¢ÂföçDfÖ–Ç“¢t–çFW%ós&öÆBrÂÆWGFW%76–æs¢ÒÀ ¢F†–çC¢°¢÷6—F–öã¢v'6öÇWFRrÀ¢&÷GFöÓ¢‚À¢&–v‡C¢‚À¢&6¶w&÷VæD6öÆ÷#¢w&v&ƒÃÃÃãCR’rÀ¢&÷&FW%&F—W3¢bÀ¢FF–æt†÷&—¦öçFÃ¢‚À¢FF–æufW'F–6Ã¢BÀ¢ÒÀ¢F†–çEFW‡C¢²6öÆ÷#¢r6ffbrÂföçE6—¦S¢BÒÀ ¢Wt†VFW%&÷s¢°¢fÆW„F—&V7F–öã¢w&÷rrÀ¢Æ–vä—FV×3¢v6VçFW"rÀ¢§W7F–g”6öçFVçC¢w76RÖ&WGvVVârÀ¢Ö&v–ä&÷GFöÓ¢BÀ¢ÒÀ¢Wt†VFW#¢°¢föçE6—¦S¢’À¢föçDfÖ–Ç“¢t–çFW%óc6VÖ”&öÆBrÀ¢ÆWGFW%76–æs¢ãRÀ¢ÒÀ¢6F6‡W'Fã¢°¢fÆW„F—&V7F–öã¢w&÷rrÀ¢Æ–vä—FV×3¢v6VçFW"rÀ¢&6¶w&÷VæD6öÆ÷#¢r3t34TBrÀ¢&÷&FW%&F—W3¢bÀ¢FF–æt†÷&—¦öçFÃ¢‚À¢FF–æufW'F–6Ã¢BÀ¢ÒÀ¢6F6‡W'FåFW‡C¢°¢6öÆ÷#¢r6ffbrÀ¢föçE6—¦S¢À¢föçDfÖ–Ç“¢t–çFW%óc6VÖ”&öÆBrÀ¢ÆWGFW%76–æs¢ã"À¢ÒÀ¢Wu&÷s¢°¢fÆW„F—&V7F–öã¢w&÷rrÀ¢v¢À¢FF–æufW'F–6Ã¢‚À¢FF–æt†÷&—¦öçFÃ¢BÀ¢&÷&FW$&÷GFöÕv–GFƒ¢7G–ÆU6†VWBæ†—&Æ–æUv–GF‚À¢ÒÀ¢WuF–ÖT6öÃ¢²v–GFƒ¢c‚ÂÆ–vä—FV×3¢vfÆW‚×7F'BrÂv¢2ÂfÆW…6‡&–æ³¢ÒÀ¢WuF–ÖS¢²föçE6—¦S¢ÂföçDfÖ–Ç“¢t–çFW%óc6VÖ”&öÆBrÒÀ¢æ÷t&FvS¢²&6¶w&÷VæD6öÆ÷#¢r34#ƒ$cbrÂ&÷&FW%&F—W3¢BÂFF–æt†÷&—¦öçFÃ¢RÂFF–æufW'F–6Ã¢ÒÀ¢æ÷t&FvUFW‡C¢²6öÆ÷#¢r6ffbrÂföçE6—¦S¢’ÂföçDfÖ–Ç“¢t–çFW%ós&öÆBrÒÀ¢WuF—FÆS¢²föçE6—¦S¢"ÂföçDfÖ–Ç“¢t–çFW%óc6VÖ”&öÆBrÂÖ&v–ä&÷GFöÓ¢"ÒÀ¢WtFW63¢²föçE6—¦S¢ÂföçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÂÆ–æT†V–v‡C¢BÒÀ¢Wt&VÆÃ¢²föçE6—¦S¢BÂfÆW…6‡&–æ³¢ÂÆ–vå6VÆc¢v6VçFW"rÂÖ&v–äÆVgC¢BÒÀ¢WtV×G“¢²fÆWƒ¢Â§W7F–g”6öçFVçC¢v6VçFW"rÂÆ–vä—FV×3¢v6VçFW"rÂv¢bÒÀ¢Wu&öw&W75w&¢²Ö&v–åF÷¢2ÂÖ&v–ä&÷GFöÓ¢"Â†V–v‡C¢2Â&÷&FW%&F—W3¢"Â&6¶w&÷VæD6öÆ÷#¢w&v&ƒS’Ã3Ã#CbÃãR’rÂ÷fW&fÆ÷s¢v†–FFVâr26öç7BÒÀ¢Wu&öw&W74&#¢²†V–v‡C¢2Â&÷&FW%&F—W3¢"Â&6¶w&÷VæD6öÆ÷#¢r34#ƒ$cbrÒÀ¢WuF–ÖTÆVgC¢²föçE6—¦S¢’ÂföçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÂÖ&v–åF÷¢"ÒÀ ¢òòÖ–æ’×Æ–W"–æfò&"(	B&öw&W72&÷r†&"²F–ÖR&VÖ–æ–ær6–FR'’6–FR¢Ö–æ•&öuw&¢²fÆW„F—&V7F–öã¢w&÷rrÂÆ–vä—FV×3¢v6VçFW"rÂv¢BÂÖ&v–åF÷¢2ÒÀ¢Ö–æ•&öuF–ÖTÆVgC¢²föçE6—¦S¢’ÂföçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÂfÆW…6‡&–æ³¢ÒÀ ¢æõ6VÃ¢²fÆWƒ¢Â§W7F–g”6öçFVçC¢v6VçFW"rÂÆ–vä—FV×3¢v6VçFW"rÂFF–æt†÷&—¦öçFÃ¢#BÒÀ¢æõ6VÅF—FÆS¢²föçE6—¦S¢bÂföçDfÖ–Ç“¢t–çFW%ós&öÆBrÂÖ&v–ä&÷GFöÓ¢bÒÀ¢æõ6VÅ7V#¢²föçE6—¦S¢"ÂföçDfÖ–Ç“¢t–çFW%óC&VwVÆ"rÂFW‡DÆ–vã¢v6VçFW"rÂÆ–æT†V–v‡C¢‚ÒÀ§Ò“° 