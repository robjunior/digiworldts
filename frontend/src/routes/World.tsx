import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getPveWorld } from '../lib/api-world';
import type { WorldRegion } from '@digiworld/shared/world';
import { requestExpeditionConfig } from '../lib/rail-expeditions-store';
import { WorldStrip } from '../components/world/WorldStrip';
import { WorldHoverTip } from '../components/world/WorldHoverTip';
import { useWorldGlobeUI, worldGlobeStore, usePopupAnchor, popupAnchorStore } from '../lib/world-globe-store';
import { AdventureIcon, CloseIcon, RosterIcon } from '../components/common/icons';
import '../styles/extensions-world.css';

// A cena 3D (globo + digimons) vive no WorldSceneHost (AppShell), persistente —
// esta página só desenha a UI do overlay por cima dela e lê o worldGlobeStore
// pro estado interativo (seleção, hover, auto-spin, fallback de WebGL). A
// configuração de party/expedição mora no RAIL (Expedições → Config), então o
// popup aqui é compacto: só nome da localidade + ícones que abrem o rail.
export function World(): JSX.Element {
  const world = useQuery({ queryKey: ['pve-world'], queryFn: getPveWorld });

  const ui = useWorldGlobeUI();
  const popupAnchor = usePopupAnchor();

  const places = world.data?.places ?? [];
  const regions = useMemo<readonly WorldRegion[]>(
    () =>
      places.map((place) => ({
        id: place.id,
        label: place.name,
        description: place.description,
        element: 'null',
        biome: 'forest',
        lat: 0,
        lon: 0,
        dungeonId: place.id,
        levelCap: place.maxWildLevel ?? 99,
        danger: place.maxWildLevel ?? 1,
        scouted: true,
      })),
    [places],
  );
  const selectedPlace = ui.selectedIdx === null ? null : (places[ui.selectedIdx] ?? null);

  const toggleSpin = useCallback(() => worldGlobeStore.set({ autoSpin: !worldGlobeStore.get().autoSpin }), []);
  // Fecha o popup: limpa seleção/foco, solta a âncora e retoma o giro.
  const closePopup = useCallback(() => {
    worldGlobeStore.set({ selectedIdx: null, focus: null, autoSpin: true });
    popupAnchorStore.set(null);
  }, []);
  // Party e expedição são configurados no rail (Expedições → Config), com o
  // node já pré-selecionado.
  const openInRail = useCallback(() => {
    if (selectedPlace) requestExpeditionConfig(selectedPlace.id);
  }, [selectedPlace]);

  return (
    <main className="world-page-layout world-legacy">
      <div className="stage" data-od-id="globe-stage">
        {ui.webglFailed ? (
          <div className="stage-fallback show" role="status">
            <div className="box">
              <b>Mapa 3D indisponível</b>
              <br />
              Selecione uma localidade na lista.
            </div>
          </div>
        ) : null}
        <div className="overlay">
          <WorldStrip
            selectedRegion={ui.selectedIdx === null ? null : regions[ui.selectedIdx] ?? null}
            autoSpin={ui.autoSpin}
            onToggleAutoSpin={toggleSpin}
          />
          <WorldHoverTip tip={ui.hoverTip} />
        </div>
      </div>
      {selectedPlace ? (
        <section
          className="world-place-popup"
          aria-label={`Localidade ${selectedPlace.name}`}
          style={popupAnchor ? { position: 'fixed', left: popupAnchor.x, top: popupAnchor.y - 14, transform: 'translate(-50%, -100%)', zIndex: 50, margin: 0 } : undefined}
        >
          <button type="button" className="world-place-popup__close" onClick={closePopup} aria-label="Fechar localidade">
            <CloseIcon />
          </button>
          <span className="world-place-popup__eyebrow">LOCALIDADE</span>
          <h2>{selectedPlace.name}</h2>
          <div className="world-place-popup__actions">
            <button type="button" className="world-place-popup__act" onClick={openInRail} aria-label="Configurar party" title="Configurar party no rail">
              <RosterIcon />
            </button>
            <button type="button" className="world-place-popup__act" onClick={openInRail} aria-label="Enviar expedição" title="Enviar expedição no rail">
              <AdventureIcon />
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}