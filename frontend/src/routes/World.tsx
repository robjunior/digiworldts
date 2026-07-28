import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { getWorldObjects, getWorldRegions } from '../lib/api-world';
import { acceptQuest, claimQuest, getQuests } from '../lib/api-quests';
import type { WorldRegion, Biome } from '@digiworld/shared/world';
import { useAuth } from '../hooks/useAuth';
import '../styles/extensions-world.css';

import { WorldGlobe } from '../components/world/WorldGlobe';
import { WorldStrip } from '../components/world/WorldStrip';
import { WorldHoverTip } from '../components/world/WorldHoverTip';
import type { WorldHoverTipData } from '../components/world/WorldHoverTip';
import { RegionRail } from '../components/world/RegionRail';

export function World(): JSX.Element {
  useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const { data: regionsRaw = [] } = useQuery({
    queryKey: ['world-regions'],
    queryFn: getWorldRegions
  });
  const regions = useMemo(() => regionsRaw.filter((region) => region.dungeonId !== null), [regionsRaw]);
  const worldObjectsQuery = useQuery({
    queryKey: ['world-objects'],
    queryFn: getWorldObjects,
  });
  const worldObjects = worldObjectsQuery.data?.objects ?? [];
  const questsQuery = useQuery({ queryKey: ['world-quests'], queryFn: getQuests });
  const quests = questsQuery.data ?? [];

  const [tab, setTab] = useState<'regions' | 'quests'>('regions');
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number>(-1);
  const [autoSpin, setAutoSpin] = useState<boolean>(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [webGLFailed, setWebGLFailed] = useState<boolean>(false);
  const [hoverTip, setHoverTip] = useState<WorldHoverTipData | null>(null);
  const [pendingQuestIds, setPendingQuestIds] = useState<ReadonlySet<string>>(() => new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const addPending = useCallback((id: string) => {
    setPendingQuestIds((prev) => { const next = new Set(prev); next.add(id); return next; });
  }, []);
  const removePending = useCallback((id: string) => {
    setPendingQuestIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptQuest(id),
    onMutate: (id) => addPending(id),
    onSuccess: (quest) => showToast(`Accepted “${quest.name}”.`),
    onError: (err) => showToast(err instanceof Error ? err.message : 'Could not accept quest.'),
    onSettled: (_data, _err, id) => { removePending(id); void queryClient.invalidateQueries({ queryKey: ['world-quests'] }); },
  });
  const claimMutation = useMutation({
    mutationFn: (id: string) => claimQuest(id),
    onMutate: (id) => addPending(id),
    onSuccess: (result) => {
      const parts: string[] = [];
      if (result.creditsGranted > 0) parts.push(`+${result.creditsGranted} DigiCredits`);
      for (const drop of result.itemsGranted) parts.push(`${drop.qty}× ${drop.itemId}`);
      showToast(parts.length > 0 ? `Reward claimed — ${parts.join(' · ')}.` : 'Reward claimed.');
    },
    onError: (err) => showToast(err instanceof Error ? err.message : 'Could not claim reward.'),
    onSettled: (_data, _err, id) => {
      removePending(id);
      void queryClient.invalidateQueries({ queryKey: ['world-quests'] });
      void queryClient.invalidateQueries({ queryKey: ['shop'] });
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  const selectBiome = useCallback((biome: Biome) => {
    const idx = regions.findIndex((r) => r.biome === biome);
    if (idx >= 0) {
      setSelectedIdx(idx);
      setTab('regions');
    }
  }, [regions]);
  
  const enterDungeon = useCallback((region: WorldRegion) => {
    if (region.dungeonId) {
      navigate('/dungeon/' + region.dungeonId);
    } else {
      console.log('Nav intent for un-linked region', region.label);
    }
  }, [navigate]);

  const handleHoverChange = useCallback((idx: number) => setHoveredIdx(idx), []);
  const handleSelect = useCallback((idx: number) => setSelectedIdx(idx), []);
  const handleHoverTip = useCallback((tip: WorldHoverTipData | null) => setHoverTip(tip), []);
  const handleFailWebGL = useCallback(() => setWebGLFailed(true), []);
  const handleToggleAutoSpin = useCallback(() => setAutoSpin(prev => !prev), []);
  const handleTabChange = useCallback((newTab: 'regions' | 'quests') => setTab(newTab), []);
  const handleAcceptQuest = useCallback((id: string) => acceptMutation.mutate(id), [acceptMutation]);
  const handleClaimQuest = useCallback((id: string) => claimMutation.mutate(id), [claimMutation]);

  const selectedRegion = selectedIdx !== null ? (regions[selectedIdx] ?? null) : null;

  return (
    <>
      <div className="stage" data-od-id="globe-stage">
        <WorldGlobe
          regions={regions}
          worldObjects={worldObjects}
          autoSpin={autoSpin}
          selectedIdx={selectedIdx}
          hoveredIdx={hoveredIdx}
          onHoverChange={handleHoverChange}
          onSelect={handleSelect}
          onHoverTip={handleHoverTip}
          onFailWebGL={handleFailWebGL}
        />
        
        {webGLFailed && (
          <div className="stage-fallback show" id="globe-fallback" role="img" aria-label="3D globe unavailable — regions still selectable">
            <div className="box"><b>3D globe unavailable</b><br/>Your device blocked WebGL. Pick a region from the list on the right to scout it.</div>
          </div>
        )}

        <div className="overlay">
          <WorldStrip
            selectedRegion={selectedRegion}
            autoSpin={autoSpin}
            onToggleAutoSpin={handleToggleAutoSpin}
          />
          <WorldHoverTip tip={hoverTip} />
        </div>
      </div>

      <RegionRail
        regions={regions}
        quests={quests}
        selectedIdx={selectedIdx}
        tab={tab}
        pendingQuestIds={pendingQuestIds}
        loadingQuests={questsQuery.isPending}
        onTabChange={handleTabChange}
        onSelectIdx={handleSelect}
        onEnterDungeon={enterDungeon}
        onSelectBiome={selectBiome}
        onAcceptQuest={handleAcceptQuest}
        onClaimQuest={handleClaimQuest}
      />
    </>
  );
}
